import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { installationPaths } from "../src/cli/config.ts";
import { migrateConfiguration, readServiceConfig } from "../src/cli/service.ts";
import { credentialPath } from "../src/server/environment.ts";

test("웹과 MCP는 실행 위치와 무관하게 공통 설정 경로를 사용한다", () => {
  const paths = installationPaths("/tmp/jira home");
  assert.equal(paths.config, "/tmp/jira home/config/service.json");
  assert.equal(
    credentialPath(paths.home),
    "/tmp/jira home/config/connection.env",
  );
});
test("기존 설정과 인증은 내용 노출 없이 이전하고 새 설정을 덮어쓰지 않는다", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "jira-migrate-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const paths = installationPaths(home);
  await writeFile(join(home, ".env"), "JIRA_API_TOKEN=fake-token");
  await writeFile(
    join(home, "service.json"),
    JSON.stringify({
      version: 1,
      port: 4173,
      instance: "existing",
      node: process.execPath,
    }),
  );
  await migrateConfiguration(paths);
  assert.equal(
    await readFile(credentialPath(home), "utf8"),
    "JIRA_API_TOKEN=fake-token",
  );
  assert.equal((await readServiceConfig(paths))?.instance, "existing");
  await writeFile(credentialPath(home), "NEW=keep");
  await migrateConfiguration(paths);
  assert.equal(await readFile(credentialPath(home), "utf8"), "NEW=keep");
});
test("잘못된 설정 이전은 기존 파일을 삭제하지 않는다", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "jira-invalid-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, "config"));
  await writeFile(join(home, "service.json"), "invalid");
  await assert.rejects(migrateConfiguration(installationPaths(home)));
  assert.equal(await readFile(join(home, "service.json"), "utf8"), "invalid");
});

test("설치 실행기가 종료된 뒤에도 Node가 유지되고 중복 실행·종료·업데이트가 동작한다", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const { createServer } = await import("node:net");
  const { once } = await import("node:events");
  const { resolve } = await import("node:path");
  const home = await mkdtemp(join(tmpdir(), "jira-daemon-"));
  const paths = installationPaths(home);
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((done) => reservation.close(() => done()));
  const run = (command: string) => {
    const result = spawnSync(
      process.execPath,
      [
        resolve("dist/cli/main.js"),
        command,
        "--home",
        home,
        ...(command === "setup" ? ["--port", String(address.port)] : []),
      ],
      {
        encoding: "utf8",
        timeout: 60000,
        env: {
          ...process.env,
          JIRA_SITE: "",
          JIRA_EMAIL: "",
          JIRA_API_TOKEN: "",
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout) as {
      running: boolean;
      registered: boolean;
      url: string;
    };
  };
  t.after(async () => {
    try {
      run("stop");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
  const installed = run("setup");
  assert.equal(installed.running, true);
  assert.equal(installed.registered, false);
  const base = `http://127.0.0.1:${address.port}`;
  const first = (await (await fetch(`${base}/api/health`)).json()) as {
    pid: number;
  };
  assert.equal(run("start").running, true);
  assert.equal(
    ((await (await fetch(`${base}/api/health`)).json()) as { pid: number }).pid,
    first.pid,
  );
  await writeFile(paths.credentials, "# user settings\n");
  assert.equal(run("stop").running, false);
  assert.equal(run("start").running, true);
  assert.equal(run("update").running, true);
  assert.equal(await readFile(paths.credentials, "utf8"), "# user settings\n");
  await writeFile(join(home, "service.json"), await readFile(paths.config));
  assert.equal(run("remove").running, false);
  assert.equal(await readServiceConfig(paths), null);
  assert.equal(await readFile(paths.credentials, "utf8"), "# user settings\n");
  assert.equal(run("setup").running, true);
  assert.equal(run("remove").running, false);
});

test("서비스 상태 확인은 전역 fetch 오류와 관계없이 본인 인스턴스를 확인한다", async (t) => {
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  const { serviceStatus } = await import("../src/cli/service.ts");
  const home = await mkdtemp(join(tmpdir(), "jira-health-"));
  const paths = installationPaths(home);
  let instance = "owned";
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ app: "fast-jira", instance }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await mkdir(join(home, "config"));
  await writeFile(
    paths.config,
    JSON.stringify({
      version: 1,
      port: address.port,
      instance: "owned",
      node: process.execPath,
    }),
  );
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("setTypeOfService EINVAL");
  });
  assert.equal((await serviceStatus(paths)).running, true);
  instance = "another-installation";
  assert.equal((await serviceStatus(paths)).running, false);
});
