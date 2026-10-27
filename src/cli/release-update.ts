import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AppRelease,
  decodeUpdateJob,
  UPDATE_REPOSITORY,
  type UpdateJob,
  updating,
  versionParts,
} from "../domain/app-update.ts";
import { record } from "../domain/validation.ts";
import { installationPaths } from "./config.ts";
import { PluginUpdateError, withPluginUpdates } from "./plugin-update.ts";
import { setupService, withServiceLock } from "./service.ts";

interface StoredUpdateJob extends UpdateJob {
  commit: string;
  pid?: number;
}
const jobPath = (home: string) => join(home, "update-job.json");
export async function writeUpdateJob(home: string, job: StoredUpdateJob) {
  const temporary = `${jobPath(home)}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(job), {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, jobPath(home));
  } finally {
    await rm(temporary, { force: true });
  }
}
async function storedJob(home: string): Promise<StoredUpdateJob | null> {
  const contents = await readFile(jobPath(home), "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw new Error("업데이트 상태를 읽지 못했어요.");
    },
  );
  if (contents === null) return null;
  const data = record(JSON.parse(contents)),
    job = decodeUpdateJob(data);
  if (typeof data.commit !== "string" || !/^[a-f0-9]{40}$/.test(data.commit))
    throw new Error("업데이트 코드 정보가 올바르지 않습니다.");
  return {
    ...job,
    commit: data.commit,
    ...(Number.isSafeInteger(data.pid) && Number(data.pid) > 0
      ? { pid: Number(data.pid) }
      : {}),
  };
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}
function interrupted(job: StoredUpdateJob | null): boolean {
  return Boolean(
    job &&
      updating(job) &&
      (job.pid ? !alive(job.pid) : Date.now() - job.startedAt > 30000),
  );
}
export async function readUpdateJob(home: string): Promise<UpdateJob | null> {
  let job = await storedJob(home);
  // 작업자가 완료를 기록하고 종료한 사이 읽은 스냅샷일 수 있어 다시 확인한다.
  // 조회 경로는 작업자가 쓰는 파일을 덮어쓰지 않는다.
  if (!interrupted(job)) return job ? decodeUpdateJob(job) : null;
  job = await storedJob(home);
  if (!job) return null;
  return interrupted(job)
    ? {
        ...decodeUpdateJob(job),
        phase: "failed",
        message:
          "업데이트 작업이 중단됐어요. Managing으로 실행 상태를 확인해 주세요.",
      }
    : decodeUpdateJob(job);
}
function updateEnvironment(environment: NodeJS.ProcessEnv) {
  const env = Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) =>
        !/^(JIRA_|FAST_JIRA_|NODE_OPTIONS$|NODE_PATH$|PORT$|GIT_)/.test(key),
    ),
  );
  env.PATH = [
    dirname(process.execPath),
    environment.PATH ?? "/usr/bin:/bin",
    join(homedir(), ".local/bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
  ].join(":");
  return env;
}
type Execute = (
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
) => Promise<void>;
const execute: Execute = async (command, args, cwd, env) => {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "ignore",
    timeout: 180000,
  });
  if (result.status !== 0)
    throw new Error(`${command} 실행을 완료하지 못했어요.`);
};
/** 기존 checkout을 수정하지 않고 고정 커밋을 별도 폴더에서 빌드한 뒤 교체한다. */
export async function runReleaseUpdate(
  home: string,
  id: string,
  options: {
    environment?: NodeJS.ProcessEnv;
    execute?: Execute;
    install?: (source: string) => Promise<void>;
    plugins?: typeof withPluginUpdates;
  } = {},
) {
  const paths = installationPaths(home),
    work = join(home, `.update-${id}`);
  let started = false;
  try {
    await withServiceLock(paths, async () => {
      const job = await storedJob(home);
      if (!job || job.id !== id || job.phase !== "preparing")
        throw new Error("진행할 업데이트가 없습니다.");
      started = true;
      job.pid = process.pid;
      await writeUpdateJob(home, job);
      const source = join(work, "source");
      await mkdir(source, { recursive: true, mode: 0o700 });
      const run = options.execute ?? execute,
        env = updateEnvironment(options.environment ?? process.env);
      for (const args of [
        ["init"],
        [
          "fetch",
          "--depth",
          "1",
          `https://github.com/${UPDATE_REPOSITORY}.git`,
          job.commit,
        ],
        ["checkout", "--detach", job.commit],
      ])
        await run("git", args, source, env);
      async function verifyVersion() {
        const pkg = record(
          JSON.parse(await readFile(join(source, "package.json"), "utf8")),
        );
        if (pkg.name !== "fast-jira" || pkg.version !== job?.version)
          throw new Error("선택한 배포 버전과 코드가 일치하지 않습니다.");
      }
      await verifyVersion();
      await run("npm", ["ci", "--ignore-scripts"], source, env);
      await run("npm", ["run", "build"], source, env);
      await verifyVersion();
      await run(process.execPath, ["scripts/package-plugin.mjs"], source, env);
      job.phase = "installing";
      job.message = "앱과 설치된 Fast Jira 플러그인을 업데이트하고 있어요…";
      await writeUpdateJob(home, job);
      await (options.plugins ?? withPluginUpdates)(
        source,
        job.version,
        env,
        () =>
          (options.install ?? ((root) => setupService(root, paths)))(source),
      );
      job.phase = "complete";
      job.message =
        "앱과 플러그인을 업데이트했어요. 새 버전으로 화면을 열고 있어요…";
      await writeUpdateJob(home, job);
    });
  } catch (error) {
    const job = await storedJob(home);
    if (job?.id === id && (started || !job.pid)) {
      job.phase = "failed";
      job.message =
        error instanceof PluginUpdateError
          ? error.message
          : "업데이트하지 못했어요. 기존 앱 상태를 확인하거나 Managing으로 복구해 주세요.";
      await writeUpdateJob(home, job);
    }
  } finally {
    if (started) await rm(work, { recursive: true, force: true });
  }
}
/** 교체될 runtime 밖에 작업자를 복사해 서버가 재시작돼도 작업을 이어간다. */
export async function launchReleaseUpdate(
  home: string,
  release: AppRelease,
): Promise<UpdateJob> {
  versionParts(release.version);
  if (!/^[a-f0-9]{40}$/.test(release.commit))
    throw new Error("업데이트 코드가 올바르지 않습니다.");
  const job: StoredUpdateJob = {
    id: randomUUID(),
    version: release.version,
    commit: release.commit,
    phase: "preparing",
    startedAt: Date.now(),
    message: "업데이트를 준비하고 있어요. 잠시만 기다려 주세요…",
  };
  const work = join(home, `.update-${job.id}`);
  await mkdir(work, { recursive: true, mode: 0o700 });
  try {
    const worker = join(work, "worker.mjs");
    await copyFile(
      fileURLToPath(new URL("../cli/release-main.js", import.meta.url)),
      worker,
    );
    await writeUpdateJob(home, job);
    const child = spawn(process.execPath, [worker, home, job.id], {
      detached: true,
      cwd: home,
      env: updateEnvironment(process.env),
      stdio: "ignore",
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    return decodeUpdateJob(job);
  } catch {
    job.phase = "failed";
    job.message = "업데이트 작업을 시작하지 못했어요. 다시 시도해 주세요.";
    await writeUpdateJob(home, job);
    await rm(work, { recursive: true, force: true });
    throw new Error(job.message);
  }
}
