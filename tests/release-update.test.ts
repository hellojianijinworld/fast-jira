import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  readUpdateJob,
  runReleaseUpdate,
  writeUpdateJob,
} from "../src/cli/release-update.ts";
import { validateRuntime } from "../src/cli/runtime.ts";

test("고정한 코드로 별도 빌드한 뒤에만 교체하며 개인 인증·원본 checkout은 건드리지 않는다", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "fast-jira-release-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(join(home, ".env"), "JIRA_API_TOKEN=test-private-value\n");
  const commit = "a".repeat(40);
  await writeUpdateJob(home, {
    id: "job-1",
    version: "0.1.1",
    commit,
    phase: "preparing",
    startedAt: Date.now(),
    message: "준비 중",
  });
  const commands: string[][] = [];
  let installs = 0;
  await runReleaseUpdate(home, "job-1", {
    plugins: async (_source, _version, _env, install) => install(),
    environment: {
      PATH: process.env.PATH,
      JIRA_API_TOKEN: "test-private-value",
      NODE_OPTIONS: "--inspect",
      FAST_JIRA_HOME: home,
    },
    execute: async (command, args, cwd, env) => {
      commands.push([command, ...args]);
      assert.equal(env.JIRA_API_TOKEN, undefined);
      assert.equal(env.NODE_OPTIONS, undefined);
      assert.equal(env.FAST_JIRA_HOME, undefined);
      assert.ok(!cwd.startsWith(join(home, "runtime")));
      if (command === "git" && args[0] === "checkout")
        await writeFile(
          join(cwd, "package.json"),
          JSON.stringify({ name: "fast-jira", version: "0.1.1" }),
        );
      if (command === "npm" && args[0] === "run") {
        for (const name of [
          "server/main.js",
          "cli/main.js",
          "client/index.html",
        ]) {
          await mkdir(join(cwd, "dist", name.split("/")[0] ?? ""), {
            recursive: true,
          });
          await writeFile(join(cwd, "dist", name), "fixture");
        }
      }
    },
    install: async (source) => {
      installs++;
      await validateRuntime(source);
      assert.equal((await readUpdateJob(home))?.phase, "installing");
    },
  });
  assert.equal(installs, 1);
  assert.ok(
    commands.some(
      (args) =>
        args[0] === "git" && args[1] === "fetch" && args.includes(commit),
    ),
  );
  assert.equal((await readUpdateJob(home))?.phase, "complete");
  assert.equal(
    await readFile(join(home, ".env"), "utf8"),
    "JIRA_API_TOKEN=test-private-value\n",
  );
});

test("버전이 다르거나 준비가 실패하면 서비스 교체 전에 멈추고 실패 상태를 남긴다", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "fast-jira-release-fail-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeUpdateJob(home, {
    id: "job-2",
    version: "0.1.1",
    commit: "b".repeat(40),
    phase: "preparing",
    startedAt: Date.now(),
    message: "준비 중",
  });
  await runReleaseUpdate(home, "job-2", {
    execute: async (_command, args, cwd) => {
      if (args[0] === "checkout")
        await writeFile(
          join(cwd, "package.json"),
          JSON.stringify({ name: "fast-jira", version: "9.0.0" }),
        );
    },
    install: async () => assert.fail("검증되지 않은 버전을 교체하면 안 된다"),
  });
  assert.equal((await readUpdateJob(home))?.phase, "failed");
});

test("상태 조회가 중단된 작업을 안내하더라도 작업 파일을 덮어쓰지 않는다", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "fast-jira-release-status-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeUpdateJob(home, {
    id: "interrupted-job",
    version: "0.1.1",
    commit: "c".repeat(40),
    phase: "preparing",
    startedAt: Date.now() - 60000,
    message: "준비 중",
  });
  const before = await readFile(join(home, "update-job.json"), "utf8");
  assert.equal((await readUpdateJob(home))?.phase, "failed");
  assert.equal(await readFile(join(home, "update-job.json"), "utf8"), before);
});

test("살아 있는 작업자의 상태는 같은 스냅샷에서 다시 판정하지 않는다", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "fast-jira-release-race-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeUpdateJob(home, {
    id: "finishing-job",
    version: "0.1.1",
    commit: "d".repeat(40),
    phase: "installing",
    pid: 777,
    startedAt: Date.now(),
    message: "교체 중",
  });
  let checks = 0;
  t.mock.method(process, "kill", () => {
    if (++checks === 1) return true;
    throw Object.assign(new Error("exited"), { code: "ESRCH" });
  });
  assert.equal((await readUpdateJob(home))?.phase, "installing");
  assert.equal(checks, 1);
});
