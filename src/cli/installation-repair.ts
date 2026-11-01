import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { installationPlatform } from "../domain/installation.ts";
import {
  decodeRepairJob,
  type RepairJob,
  type RepairTarget,
  repairing,
} from "../domain/installation-management.ts";
import { record } from "../domain/validation.ts";
import { installationPaths } from "./config.ts";
import { installationTargets } from "./installation-record.ts";
import { platformCommand } from "./platform-command.ts";
import { registerPlatform } from "./platform-registration.ts";
import { atomicWrite, setupDomain, withServiceLock } from "./service.ts";

const execute = promisify(execFile);
type StoredJob = RepairJob & { pid?: number };
const jobPath = (home: string) => join(home, "config/repair-job.json");
export async function writeRepairJob(home: string, job: StoredJob) {
  await atomicWrite(jobPath(home), JSON.stringify(job));
}
async function storedJob(home: string): Promise<StoredJob | null> {
  const text = await readFile(jobPath(home), "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  if (text === null) return null;
  const data = record(JSON.parse(text));
  return {
    ...decodeRepairJob(data),
    ...(Number.isSafeInteger(data.pid) && Number(data.pid) > 0
      ? { pid: Number(data.pid) }
      : {}),
  };
}
function interrupted(job: StoredJob) {
  if (!repairing(job)) return false;
  if (!job.pid) return Date.now() - job.startedAt > 30000;
  try {
    process.kill(job.pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}
export async function readRepairJob(home: string): Promise<RepairJob | null> {
  let job = await storedJob(home);
  if (job && interrupted(job)) job = await storedJob(home);
  return job
    ? {
        ...decodeRepairJob(job),
        ...(interrupted(job) ? { phase: "interrupted" } : {}),
      }
    : null;
}
export function repairEnvironment(environment: NodeJS.ProcessEnv) {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) =>
        ["FAST_JIRA_CODEX_BIN", "FAST_JIRA_CLAUDE_BIN"].includes(key) ||
        !/^(JIRA_|FAST_JIRA_|NODE_OPTIONS$|NODE_PATH$|PORT$|OPENAI_API_KEY$|ANTHROPIC_API_KEY$|ANTHROPIC_AUTH_TOKEN$)/.test(
          key,
        ),
    ),
  );
}
async function performRepair(home: string, target: RepairTarget) {
  if (target === "domain") {
    const result = await setupDomain(installationPaths(home), true);
    if (result.url !== "https://fast-jira.local")
      throw new Error("Domain unavailable");
    return;
  }
  const platform = installationPlatform(target.replace(/-login$/, ""));
  if (target.endsWith("-login")) {
    const env = repairEnvironment(process.env),
      command = await platformCommand(platform, process.env);
    if (!command) throw new Error("CLI unavailable");
    await execute(
      command.command,
      [
        ...command.prefix,
        ...(platform === "codex" ? ["login"] : ["auth", "login", "--claudeai"]),
      ],
      { env, timeout: 600000, maxBuffer: 100000, windowsHide: true },
    );
    return;
  }
  const registered = (await installationTargets(home)).find(
    (item) => item.platform === platform,
  );
  if (!registered) throw new Error("Installation receipt required");
  const pkg = record(
    JSON.parse(await readFile(join(home, "runtime/package.json"), "utf8")),
  );
  const result = await registerPlatform({
    ...registered,
    version: String(pkg.version),
    home,
    env: repairEnvironment(process.env),
  });
  if (result.state !== "ready") throw new Error("Registration unavailable");
}
/** 서버 재시작과 분리하며, 기록된 단일 작업만 실행한다. */
export async function runInstallationRepair(
  home: string,
  id: string,
  perform = (target: RepairTarget) => performRepair(home, target),
) {
  const paths = installationPaths(home);
  try {
    await withServiceLock(paths, async () => {
      const job = await storedJob(home);
      if (!job || job.id !== id || job.phase !== "pending") return;
      job.pid = process.pid;
      job.phase = "running";
      await writeRepairJob(home, job);
      try {
        await perform(job.target);
        job.phase = "complete";
      } catch {
        job.phase = "failed";
      }
      await writeRepairJob(home, job);
    });
  } catch {
    const job = await storedJob(home);
    if (job?.id === id && job.phase === "pending")
      await writeRepairJob(home, { ...job, phase: "failed" });
  }
}
export async function launchInstallationRepair(
  home: string,
  target: RepairTarget,
  worker = fileURLToPath(new URL("../cli/repair-main.js", import.meta.url)),
): Promise<RepairJob> {
  const paths = installationPaths(home);
  const job: RepairJob = {
    id: randomUUID(),
    target,
    phase: "pending",
    startedAt: Date.now(),
  };
  const work = join(home, `.repair-${job.id}`);
  try {
    await withServiceLock(paths, async () => {
      if (repairing(await readRepairJob(home)))
        throw new Error(
          "연결 작업이 진행 중이에요. 완료 후 다시 시도해 주세요.",
        );
      await mkdir(work, { mode: 0o700 });
      await copyFile(worker, join(work, "worker.mjs"));
      await writeRepairJob(home, job);
    });
    const child = spawn(
      process.execPath,
      [join(work, "worker.mjs"), home, job.id],
      {
        cwd: home,
        env: repairEnvironment(process.env),
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      },
    );
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    return job;
  } catch {
    const current = await storedJob(home);
    if (current?.id === job.id)
      await writeRepairJob(home, { ...job, phase: "failed" });
    await rm(work, { recursive: true, force: true });
    throw new Error("연결 작업을 시작하지 못했어요. 다시 시도해 주세요.");
  }
}
