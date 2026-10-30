import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import packageInfo from "../package.json" with { type: "json" };
import { installationPaths } from "../src/cli/config.ts";
import { extractRelease } from "../src/cli/release-artifact.ts";
import { setupService, stopService } from "../src/cli/service.ts";
import {
  artifactNames,
  decodeReleaseManifest,
} from "../src/domain/release-artifact.ts";

for (const key of Object.keys(process.env))
  if (key.startsWith("JIRA_")) delete process.env[key];

const root = await mkdtemp(join(tmpdir(), "fast-jira-release-smoke-"));
const paths = installationPaths(join(root, "home"));
const names = artifactNames(packageInfo.version);
const manifest = decodeReleaseManifest(
  JSON.parse(await readFile(join("dist/release", names.manifest), "utf8")),
  { version: packageInfo.version, commit: process.env.RELEASE_COMMIT ?? "" },
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
  const port = createServer();
  port.listen(0, "127.0.0.1");
  await once(port, "listening");
  const address = port.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((done) => port.close(() => done()));
  await setupService(
    join(root, "unpacked/dist/marketplace/plugins/codex/fast-jira"),
    paths,
    address.port,
  );
  const base = `http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(base)).status, 200);
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
  console.log("ZIP 실행본 HTTP·MCP 검사 통과 · Jira 쓰기 없음");
} finally {
  await client.close().catch(() => {});
  await stopService(paths);
  await rm(root, { recursive: true, force: true });
}
