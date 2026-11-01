import assert from "node:assert/strict";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { installationPaths } from "../src/cli/config.ts";
import { stopService } from "../src/cli/service.ts";
import { setupInstallation } from "../src/cli/setup.ts";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "jira setup-"));
  const home = join(root, "개인 home");
  const market = join(root, "market");
  const source = join(market, "plugins/codex/fast-jira");
  await mkdir(source, { recursive: true });
  for (const name of ["server", "cli", "client"])
    await cp(
      new URL(`../dist/${name}`, import.meta.url),
      join(source, "dist", name),
      { recursive: true },
    );
  await writeFile(
    join(source, "package.json"),
    JSON.stringify({ name: "fast-jira", version: "0.1.1", type: "module" }),
  );
  await writeFile(join(source, "LICENSE"), "MIT");
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((done) => server.close(() => done()));
  t.after(async () => {
    await stopService(installationPaths(home));
    await rm(root, { recursive: true, force: true });
  });
  return { root, home, source, market, port: address.port };
}

test("등록할 AI가 없어도 실제 웹과 로컬 MCP를 유지하고 인증 대기를 구분한다", async (t) => {
  const f = await fixture(t);
  const result = await setupInstallation({
    source: f.source,
    marketplace: f.market,
    home: f.home,
    port: f.port,
    platform: "codex",
    domainConsent: false,
    open: false,
    run: async () => null,
    checkAssistant: async () => false,
  });
  assert.equal(result.appReady, true);
  assert.equal(result.web.code, "web_ready");
  assert.equal(result.plugin.code, "plugin_missing_cli");
  assert.equal(result.mcp.code, "mcp_host_pending");
  assert.equal(result.domain.code, "domain_skipped");
  assert.equal(result.jira.code, "jira_pending");
  assert.equal((await fetch(`http://127.0.0.1:${f.port}/`)).status, 200);
  const before = await readFile(installationPaths(f.home).mcpToken, "utf8");
  const cachedSource = join(f.root, "AI plugin cache");
  await cp(f.source, cachedSource, { recursive: true });
  const again = await setupInstallation({
    source: cachedSource,
    home: f.home,
    port: f.port,
    platform: "codex",
    domainConsent: false,
    open: false,
    run: async () => null,
    checkAssistant: async () => false,
  });
  assert.equal(again.appReady, true);
  assert.equal(
    again.plugin.code,
    "plugin_missing_cli",
    "재실행은 기존 설치 원본을 기록에서 찾아야 함",
  );
  assert.equal(
    await readFile(installationPaths(f.home).mcpToken, "utf8"),
    before,
  );
});

test("잘못된 플랫폼은 서비스와 플러그인을 변경하기 전에 거부한다", async (t) => {
  const f = await fixture(t);
  let called = false;
  await assert.rejects(
    setupInstallation({
      source: f.source,
      home: f.home,
      platform: "other",
      domainConsent: false,
      open: false,
      run: async () => {
        called = true;
        return null;
      },
    }),
    /플랫폼/,
  );
  assert.equal(called, false);
  await assert.rejects(readFile(installationPaths(f.home).config));
});

test("배포 CLI의 한 명령이 웹 설치·플랫폼 등록·MCP 확인까지 이어진다", async (t) => {
  const f = await fixture(t);
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { bindMarketplace } = await import("../src/cli/release-artifact.ts");
  const { dirname } = await import("node:path");
  await writeFile(
    join(f.source, ".mcp.json"),
    JSON.stringify({
      mcpServers: { fast_jira: { command: "node", args: ["bridge"] } },
    }),
  );
  await bindMarketplaceFixture();
  async function bindMarketplaceFixture() {
    const claude = join(f.market, "plugins/claude/fast-jira");
    await mkdir(claude, { recursive: true });
    await writeFile(
      join(claude, ".mcp.json"),
      JSON.stringify({
        mcpServers: { fast_jira: { command: "node", args: ["bridge"] } },
      }),
    );
    await bindMarketplace(f.market, f.home);
  }
  const result = await promisify(execFile)(
    process.execPath,
    [
      join(f.source, "dist/cli/main.js"),
      "setup",
      "--platform",
      "codex",
      "--marketplace",
      f.market,
      "--home",
      f.home,
      "--port",
      String(f.port),
      "--domain",
      "no",
      "--no-open",
    ],
    {
      timeout: 60000,
      env: {
        ...process.env,
        HOME: f.root,
        PATH:
          dirname(process.execPath) +
          (process.platform === "win32" ? ";" : ":") +
          (process.platform === "win32"
            ? `${process.env.SystemRoot ?? "C:\\Windows"}\\System32`
            : "/usr/bin:/bin"),
        FAST_JIRA_CODEX_BIN: fileURLToPath(
          new URL("./fixtures/platform-cli.mjs", import.meta.url),
        ),
        FAST_JIRA_CLAUDE_BIN: join(f.root, "missing"),
        FAST_JIRA_TEST_PLUGIN_STATE: join(f.root, "registered"),
        FAST_JIRA_TEST_MARKETPLACE: f.market,
      },
    },
  );
  const report = JSON.parse(result.stdout);
  assert.equal(report.appReady, true);
  assert.equal(report.plugin.code, "plugin_ready");
  assert.equal(report.mcp.code, "mcp_host_pending");
  assert.equal(report.opened, false);
  assert.equal(await readFile(join(f.root, "registered"), "utf8"), "installed");
});

test("도메인을 요청하지 않은 기본 앱의 설정은 재시작 없이 그대로 유지한다", async (t) => {
  const f = await fixture(t);
  const { setupService, setupDomain } = await import("../src/cli/service.ts");
  const paths = installationPaths(f.home);
  await setupService(f.source, paths, f.port);
  const before = await readFile(paths.process, "utf8");
  const result = await setupDomain(paths, false);
  assert.equal(result.url, `http://localhost:${f.port}`);
  assert.equal(await readFile(paths.process, "utf8"), before);
});

test("도메인 설정 실패 후 실제 localhost와 기본 실행 설정이 복구된다", async (t) => {
  const f = await fixture(t);
  const { setupService, setupDomain, serviceStatus, readServiceConfig } =
    await import("../src/cli/service.ts");
  const paths = installationPaths(f.home);
  await setupService(f.source, paths, f.port);
  const token = await readFile(paths.mcpToken, "utf8");
  const result = await setupDomain(paths, true, async () => {
    throw new Error("OS denied");
  });
  assert.equal(result.url, `http://localhost:${f.port}`);
  assert.equal((await serviceStatus(paths)).running, true);
  assert.equal((await readServiceConfig(paths))?.publicUrl, undefined);
  assert.equal((await fetch(`http://127.0.0.1:${f.port}/`)).status, 200);
  assert.equal(await readFile(paths.mcpToken, "utf8"), token);
});

test("설치된 실제 HTTP 앱은 Jira 인증 전에도 연결 상태와 별도 로그인 복구를 제공한다", async (t) => {
  const f = await fixture(t);
  const cli = join(f.root, "official-login-fixture.mjs"),
    output = join(f.root, "login.json");
  await writeFile(
    cli,
    `import {writeFileSync} from "node:fs"; writeFileSync(${JSON.stringify(output)},JSON.stringify(process.argv.slice(2)));`,
  );
  const previous = process.env.FAST_JIRA_CODEX_BIN;
  process.env.FAST_JIRA_CODEX_BIN = cli;
  t.after(async () => {
    if (previous === undefined) delete process.env.FAST_JIRA_CODEX_BIN;
    else process.env.FAST_JIRA_CODEX_BIN = previous;
  });
  await setupInstallation({
    source: f.source,
    marketplace: f.market,
    home: f.home,
    port: f.port,
    platform: "codex",
    domainConsent: false,
    open: false,
    run: async () => null,
    checkAssistant: async () => false,
  });
  const origin = `http://127.0.0.1:${f.port}`,
    status = async () =>
      (await fetch(`${origin}/api/installation/status`)).json();
  const before = await status();
  assert.equal(before.supported, true);
  assert.deepEqual(before.platforms, ["codex"]);
  assert.equal(before.domain, false);
  assert.equal(before.job, null);
  const response = await fetch(`${origin}/api/installation/repair`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ target: "codex-login" }),
  });
  assert.equal(response.status, 200);
  let state = await status();
  const until = Date.now() + 10000;
  while (
    ["pending", "running"].includes(state.job?.phase) &&
    Date.now() < until
  ) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    state = await status();
  }
  assert.equal(state.job?.phase, "complete");
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), ["login"]);
  assert.equal((await fetch(`${origin}/`)).status, 200);
});

test("현재 빌드의 실제 ZIP을 풀어 통합 설치하고 종료·재시작해도 같은 앱이 열린다", async (t) => {
  const f = await fixture(t);
  const { packRelease, extractRelease } = await import(
    "../src/cli/release-artifact.ts"
  );
  await cp(f.source, join(f.market, "plugins/claude/fast-jira"), {
    recursive: true,
  });
  const packed = await packRelease(
    f.market,
    "0.1.1",
    "a".repeat(40),
    new Uint8Array([1]),
  );
  const unpacked = join(f.root, "배포 ZIP");
  await extractRelease(packed.archive, unpacked);
  const market = join(unpacked, "dist/marketplace");
  const report = await setupInstallation({
    source: join(market, "plugins/codex/fast-jira"),
    marketplace: market,
    home: f.home,
    port: f.port,
    platform: "codex",
    domainConsent: false,
    open: false,
    run: async () => null,
    checkAssistant: async () => false,
  });
  assert.equal(report.appReady, true);
  assert.equal(report.mcp.code, "mcp_host_pending");
  const origin = `http://127.0.0.1:${f.port}`;
  const before = await (await fetch(`${origin}/api/health`)).json();
  const { startService, stopService } = await import("../src/cli/service.ts");
  await startService(installationPaths(f.home), false);
  assert.equal(
    (await (await fetch(`${origin}/api/health`)).json()).pid,
    before.pid,
  );
  await stopService(installationPaths(f.home));
  await startService(installationPaths(f.home), false);
  assert.equal((await fetch(origin)).status, 200);
});
