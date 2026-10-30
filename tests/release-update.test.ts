import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { packRelease } from "../src/cli/release-artifact.ts";
import {
  readUpdateJob,
  runReleaseUpdate,
  writeUpdateJob,
} from "../src/cli/release-update.ts";
import { validateRuntime } from "../src/cli/runtime.ts";

test("미리 빌드된 ZIP을 받아 앱·플러그인을 같은 작업으로 교체하고 개인 설정을 보존한다", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "fast-jira-release-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(join(home, ".env"), "JIRA_API_TOKEN=test-private-value\\n");
  const commit = "a".repeat(40);
  const market = join(home, "fixture");
  for (const platform of ["codex", "claude"])
    for (const name of [
      "dist/server/main.js",
      "dist/client/index.html",
      "dist/cli/main.js",
      "package.json",
      ".mcp.json",
    ]) {
      const path = join(market, "plugins", platform, "fast-jira", name);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(
        path,
        name === "package.json"
          ? JSON.stringify({
              name: "fast-jira",
              version: "0.1.1",
              engines: { node: "24.22.2" },
            })
          : name === ".mcp.json"
            ? JSON.stringify({
                mcpServers: {
                  fast_jira: { command: "node", args: ["bridge.js"] },
                },
              })
            : "fixture",
      );
    }
  const packed = await packRelease(
    market,
    "0.1.1",
    commit,
    new Uint8Array([1]),
  );
  await writeUpdateJob(home, {
    id: "job-1",
    version: "0.1.1",
    commit,
    phase: "preparing",
    startedAt: Date.now(),
    message: "준비 중",
  });
  let installs = 0,
    plugins = 0;
  await runReleaseUpdate(home, "job-1", {
    fetcher: async (input) =>
      String(input).endsWith(".json")
        ? Response.json(packed.manifest)
        : new Response(packed.archive),
    plugins: async (source, _version, env, install) => {
      plugins++;
      assert.equal(env.JIRA_API_TOKEN, undefined);
      assert.equal(env.NODE_OPTIONS, undefined);
      await readFile(
        join(source, "dist/marketplace/plugins/claude/fast-jira/package.json"),
      );
      await install();
    },
    environment: {
      PATH: process.env.PATH,
      JIRA_API_TOKEN: "test-private-value",
      NODE_OPTIONS: "--inspect",
    },
    install: async (source) => {
      installs++;
      await validateRuntime(source);
      assert.equal((await readUpdateJob(home))?.phase, "installing");
    },
  });
  assert.equal(installs, 1);
  assert.equal(plugins, 1);
  assert.equal((await readUpdateJob(home))?.phase, "complete");
  assert.equal(
    await readFile(join(home, ".env"), "utf8"),
    "JIRA_API_TOKEN=test-private-value\\n",
  );
});
test("검증 정보를 받지 못하면 기존 실행본과 개인 설정을 교체하지 않는다", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "fast-jira-release-fail-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(join(home, ".env"), "private");
  await writeUpdateJob(home, {
    id: "job-2",
    version: "0.1.1",
    commit: "b".repeat(40),
    phase: "preparing",
    startedAt: Date.now(),
    message: "준비 중",
  });
  await runReleaseUpdate(home, "job-2", {
    fetcher: async () => Response.json({ version: "9.0.0" }),
    plugins: async () =>
      assert.fail("검증되지 않은 파일로 플러그인을 교체하면 안 됨"),
    install: async () =>
      assert.fail("검증되지 않은 파일로 앱을 교체하면 안 됨"),
  });
  assert.equal((await readUpdateJob(home))?.phase, "failed");
  assert.equal(await readFile(join(home, ".env"), "utf8"), "private");
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
