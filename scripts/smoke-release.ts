import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import packageInfo from "../package.json" with { type: "json" };
import { installationPaths } from "../src/cli/config.ts";
import { extractRelease } from "../src/cli/release-artifact.ts";
import { stopService } from "../src/cli/service.ts";
import {
  artifactNames,
  BOOTSTRAP_FILES,
  decodeReleaseManifest,
} from "../src/domain/release-artifact.ts";

for (const key of Object.keys(process.env))
  if (key.startsWith("JIRA_")) delete process.env[key];

const root = await mkdtemp(join(tmpdir(), "fast-jira-release-smoke-"));
// 공백·비 ASCII 경로와 별도 CLI 프로세스에서도 설치가 유지되는지 확인한다.
const paths = installationPaths(join(root, "개인 작업 home"));
const cli = join(
  root,
  "unpacked/dist/marketplace/plugins/codex/fast-jira/dist/cli/main.js",
);
const execute = promisify(execFile);
async function manage(...args: string[]) {
  const env = {
    ...process.env,
    FAST_JIRA_CODEX_BIN: join(root, "missing-codex"),
    FAST_JIRA_CLAUDE_BIN: join(root, "missing-claude"),
  };
  try {
    const result = await execute(
      process.execPath,
      [cli, ...args, "--home", paths.home],
      { timeout: 90000, env },
    );
    return JSON.parse(result.stdout);
  } catch (error) {
    const failure = error as { code?: number; stdout?: string };
    if (
      args[0] === "setup" &&
      args.includes("--platform") &&
      failure.code === 2 &&
      failure.stdout
    )
      return JSON.parse(failure.stdout);
    throw error;
  }
}
const names = artifactNames(packageInfo.version);
const manifest = decodeReleaseManifest(
  JSON.parse(await readFile(join("dist/release", names.manifest), "utf8")),
  { version: packageInfo.version, commit: process.env.RELEASE_COMMIT ?? "" },
);
assert(manifest.bootstrapSha256, "배포 설치기 검증 정보 누락");
for (const kind of ["sh", "ps1"] as const)
  assert.equal(
    createHash("sha256")
      .update(await readFile(join("dist/release", BOOTSTRAP_FILES[kind])))
      .digest("hex"),
    manifest.bootstrapSha256[kind],
  );
const archive = await readFile(join("dist/release", names.archive));
assert.equal(
  createHash("sha256").update(archive).digest("hex"),
  manifest.sha256,
);
const client = new Client({
  name: "release-smoke",
  version: packageInfo.version,
});
try {
  await extractRelease(archive, join(root, "unpacked"));
  assert.equal((await manage("doctor")).ready, true);
  const port = createServer();
  port.listen(0, "127.0.0.1");
  await once(port, "listening");
  const address = port.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((done) => port.close(() => done()));
  const installed = await manage(
    "setup",
    "--platform",
    "codex",
    "--no-open",
    "--port",
    String(address.port),
    "--domain",
    "no",
  );
  assert.equal(installed.appReady, true);
  assert.equal(installed.plugin.code, "plugin_missing_cli");
  const base = `http://127.0.0.1:${address.port}`;
  const before = await (await fetch(`${base}/api/health`)).json();
  assert.equal((await manage("start")).running, true);
  assert.equal(
    (await (await fetch(`${base}/api/health`)).json()).pid,
    before.pid,
  );
  assert.equal((await fetch(base)).status, 200);
  const connection = await (
    await fetch(`${base}/api/installation/status`)
  ).json();
  assert.equal(connection.supported, true);
  assert.deepEqual(connection.platforms, ["codex"]);
  assert(
    (await readFile(join(paths.runtime, "dist/cli/repair-main.js"))).length > 0,
  );
  const token = await readFile(paths.mcpToken, "utf8");
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token.trim()}` } },
    }),
  );
  assert.equal(client.getServerVersion()?.version, packageInfo.version);
  await assert.rejects(client.listTools(), /Jira/);
  const bridge = new Client({
    name: "release-bridge-smoke",
    version: packageInfo.version,
  });
  try {
    await bridge.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [join(paths.runtime, "dist/cli/mcp-bridge.js")],
        env: { PATH: process.env.PATH ?? "", FAST_JIRA_HOME: paths.home },
        stderr: "pipe",
      }),
    );
    assert.equal(bridge.getServerVersion()?.version, packageInfo.version);
    assert(
      (await bridge.listTools()).tools.some(
        (tool) => tool.name === "jira_create_issue",
      ),
    );
  } finally {
    await bridge.close();
  }
  await client.close();
  assert.equal((await manage("stop")).running, false);
  assert.equal((await manage("start")).running, true);
  assert.equal((await fetch(base)).status, 200);
  console.log(
    "ZIP CLI 설치·중복 시작·종료·재시작·HTTP·MCP 검사 통과 · Jira 쓰기 없음",
  );
} finally {
  await client.close().catch(() => {});
  await stopService(paths);
  await rm(root, { recursive: true, force: true });
}
