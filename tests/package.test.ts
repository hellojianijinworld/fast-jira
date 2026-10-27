import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const name of await listFiles(join(root, entry.name)))
        files.push(`${entry.name}/${name}`);
    } else files.push(entry.name);
  }
  return files;
}

test("배포본은 플랫폼별 manifest와 동일한 공통 스킬만 포함하며 개발·개인 파일을 제외한다", async () => {
  const result = spawnSync(process.execPath, ["scripts/package-plugin.mjs"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const root = resolve("dist/marketplace/plugins");
  for (const platform of ["codex", "claude"]) {
    const plugin = join(root, platform, "fast-jira");
    const files = await listFiles(plugin);
    assert.ok(files.includes(`.${platform}-plugin/plugin.json`));
    assert.ok(files.includes("dist/cli/mcp-bridge.js"));
    const mcp = JSON.parse(await readFile(join(plugin, ".mcp.json"), "utf8"));
    assert.equal(mcp.mcpServers.fast_jira.command, "node");
    assert.equal(mcp.mcpServers.fast_jira.args.length, 1);
    assert.ok(
      mcp.mcpServers.fast_jira.args[0].endsWith("/dist/cli/mcp-bridge.js"),
    );
    assert.equal(mcp.mcpServers.fast_jira.env, undefined);
    assert.ok(
      files.every(
        (name) =>
          !/(^|\/)(\.env[^/]*|node_modules|src|tests|\.git|\.agent-history)(\/|$)/.test(
            name,
          ),
      ),
    );
    assert.ok(
      files.every(
        (name) =>
          !name.startsWith(
            `.${platform === "codex" ? "claude" : "codex"}-plugin/`,
          ),
      ),
    );
    const pkg = JSON.parse(
      await readFile(join(plugin, "package.json"), "utf8"),
    );
    const manifest = JSON.parse(
      await readFile(join(plugin, `.${platform}-plugin/plugin.json`), "utf8"),
    );
    assert.equal(manifest.version, pkg.version);
    assert.equal(pkg.license, "MIT");
    const notices = await readFile(
      join(plugin, "THIRD_PARTY_NOTICES.txt"),
      "utf8",
    );
    assert.match(notices, /@modelcontextprotocol\/sdk@1\.32\.2/);
    assert.match(notices, /MIT License/);
    assert.equal(manifest.license, "MIT");
    assert.equal(
      await readFile(join(plugin, "LICENSE"), "utf8"),
      await readFile("LICENSE", "utf8"),
    );
    for (const skill of ["setup", "managing", "contribute"]) {
      assert.equal(
        await readFile(join(plugin, `skills/${skill}/SKILL.md`), "utf8"),
        await readFile(`skills/${skill}/SKILL.md`, "utf8"),
      );
    }
  }
});

test("배포 서버는 node_modules와 인증 없이 실행하며 화면과 로컬 상태를 제공한다", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "fast-jira-package-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((done) => reservation.close(() => done()));
  const child = spawn(process.execPath, [resolve("dist/server/main.js")], {
    cwd: home,
    env: {
      ...process.env,
      PORT: String(address.port),
      JIRA_SITE: "",
      JIRA_EMAIL: "",
      JIRA_API_TOKEN: "",
      FAST_JIRA_INSTANCE: "package-test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "",
    errors = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    errors += String(chunk);
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, "close");
    }
  });
  const signal = AbortSignal.timeout(30000);
  while (!output.includes("Fast Jira API:"))
    await once(child.stdout, "data", { signal });
  const base = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${base}/api/health`);
  assert.deepEqual(await health.json(), {
    app: "fast-jira",
    pid: child.pid,
    instance: "package-test",
  });
  const page = await fetch(base);
  assert.equal(page.status, 200);
  const html = await page.text();
  const asset = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  assert.ok(asset);
  assert.equal((await fetch(base + asset)).status, 200);
  const settings = await fetch(`${base}/api/connection`);
  assert.equal(settings.status, 200);
  assert.deepEqual(await settings.json(), {
    site: "",
    email: "",
    tokenConfigured: false,
  });
  assert.equal(errors, "");
});
