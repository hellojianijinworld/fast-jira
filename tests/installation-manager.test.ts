import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { RepairJob } from "../src/domain/installation-management.ts";
import { createHttpServer } from "../src/server/http.ts";
import {
  createInstallationManager,
  createRuntimeInstallationManager,
} from "../src/server/installation-manager.ts";

test("설치 복구는 개발 실행·추가 명령·동의 없는 도메인을 거부한다", async () => {
  let calls = 0;
  const manager = createInstallationManager({
    supported: false,
    read: async () => ({ url: "", domain: false, platforms: [], job: null }),
    start: async () => {
      calls++;
      throw Error();
    },
  });
  await assert.rejects(manager.repair({ target: "codex" }));
  assert.equal(calls, 0);
});

test("HTTP 복구는 Jira 연결 없이 조회되며 동일 출처 JSON과 단일 고정 대상만 받는다", async (t) => {
  const calls: string[] = [];
  let job: RepairJob | null = null;
  const manager = createInstallationManager({
    supported: true,
    read: async () => ({
      url: "http://localhost:4173",
      domain: false,
      platforms: ["codex"],
      job,
    }),
    start: async (target) => {
      calls.push(target);
      job = {
        id: "11111111-1111-1111-1111-111111111111",
        target,
        phase: "pending",
        startedAt: Date.now(),
      };
      return job;
    },
  });
  const server = createHttpServer(
    () => {
      throw Error("Jira must not be used");
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    manager,
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(`${origin}/api/installation/status`)).status, 200);
  const send = (input: unknown, caller = origin) =>
    fetch(`${origin}/api/installation/repair`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: caller },
      body: JSON.stringify(input),
    });
  assert.equal(
    (await send({ target: "codex" }, "https://attacker.example")).status,
    403,
  );
  assert.equal((await send({ target: "domain" })).status, 400);
  assert.equal((await send({ target: "codex", command: "rm" })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await send({ target: "codex" })).status, 200);
  assert.deepEqual(calls, ["codex"]);
  assert.equal((await send({ target: "claude" })).status, 409);
  assert.deepEqual(calls, ["codex"]);
});

test("도메인 설정이 남아도 HTTPS 연결 실패면 실제 localhost 주소와 재연결 상태를 제공한다", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "jira domain status-")),
    previous = process.cwd();
  t.after(async () => {
    process.chdir(previous);
    await rm(home, { recursive: true, force: true });
  });
  await mkdir(join(home, "config"));
  await writeFile(
    join(home, "config/service.json"),
    JSON.stringify({
      version: 1,
      port: 49123,
      instance: "fixture-domain",
      node: process.execPath,
      publicUrl: "https://fast-jira.local",
    }),
  );
  process.chdir(home);
  const state = await (await createRuntimeInstallationManager()).status();
  assert.equal(state.domain, false);
  assert.equal(state.url, "http://localhost:49123");
});
