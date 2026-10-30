import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { zipSync } from "fflate";
import {
  bindMarketplace,
  downloadRelease,
  extractRelease,
  packRelease,
} from "../src/cli/release-artifact.ts";
import { releaseContext } from "../src/domain/release-artifact.ts";

const commit = "a".repeat(40);
const context = {
  event: "push",
  repository: "hellojianijinworld/fast-jira",
  actor: "hellojianijinworld",
  triggeringActor: "hellojianijinworld",
  ref: "refs/tags/v0.1.0",
  commit,
};
test("소유자의 정식 버전 태그만 배포 대상으로 인정한다", () => {
  assert.deepEqual(releaseContext(context, "0.1.0"), { tag: "v0.1.0", commit });
  for (const patch of [
    { actor: "other" },
    { triggeringActor: "other" },
    { event: "pull_request" },
    { repository: "other/fast-jira" },
    { ref: "refs/heads/main" },
    { ref: "refs/tags/v0.1.1" },
    { ref: "refs/tags/v0.1.0-beta" },
  ])
    assert.throws(() => releaseContext({ ...context, ...patch }, "0.1.0"));
});
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "fast-jira-artifact-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const market = join(root, "market");
  for (const platform of ["codex", "claude"]) {
    const plugin = join(market, "plugins", platform, "fast-jira");
    for (const name of [
      "dist/server/main.js",
      "dist/client/index.html",
      "dist/cli/main.js",
      "package.json",
    ]) {
      await mkdir(join(plugin, name, ".."), { recursive: true });
      await writeFile(
        join(plugin, name),
        name === "package.json"
          ? JSON.stringify({
              name: "fast-jira",
              version: "0.1.0",
              engines: { node: "24.22.2" },
            })
          : "fixture",
      );
    }
  }
  return { root, market };
}
test("같은 ZIP으로 두 플랫폼을 내려받고 버전·커밋·체크섬을 확인한 뒤 해제한다", async (t) => {
  const f = await fixture(t);
  const packed = await packRelease(
    f.market,
    "0.1.0",
    commit,
    new TextEncoder().encode("installer"),
  );
  let requests = 0;
  const target = join(f.root, "download");
  const manifest = await downloadRelease(
    { version: "0.1.0", commit },
    target,
    async (input, init) => {
      requests++;
      assert.equal(new Headers(init?.headers).get("Authorization"), null);
      const url = new URL(String(input));
      assert.equal(url.hostname, "github.com");
      return url.pathname.endsWith(".json")
        ? Response.json(packed.manifest)
        : new Response(packed.archive);
    },
  );
  assert.equal(requests, 2);
  assert.equal(manifest.node, "24.22.2");
  assert.equal(manifest.commit, commit);
  for (const platform of ["codex", "claude"])
    assert.equal(
      await readFile(
        join(
          target,
          "dist/marketplace/plugins",
          platform,
          "fast-jira/dist/server/main.js",
        ),
        "utf8",
      ),
      "fixture",
    );
});
test("해시·커밋·Node·다운로드 호스트가 다르면 파일을 설치하지 않는다", async (t) => {
  const f = await fixture(t);
  const packed = await packRelease(
    f.market,
    "0.1.0",
    commit,
    new Uint8Array([1]),
  );
  for (const [i, patch] of [
    { sha256: "b".repeat(64) },
    { commit: "b".repeat(40) },
    { node: "24.0.0" },
  ].entries()) {
    const target = join(f.root, String(i));
    await assert.rejects(
      downloadRelease({ version: "0.1.0", commit }, target, async (input) =>
        String(input).endsWith(".json")
          ? Response.json({ ...packed.manifest, ...patch })
          : new Response(packed.archive),
      ),
    );
    await assert.rejects(
      readFile(
        join(target, "dist/marketplace/plugins/codex/fast-jira/package.json"),
      ),
    );
  }
  await assert.rejects(
    downloadRelease(
      { version: "0.1.0", commit },
      join(f.root, "redirect"),
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://evil.example/archive.zip" },
        }),
    ),
  );
});
test("ZIP 경로 탈출·Windows 별칭·경로 중복·큰 확장 데이터를 거부한다", async (t) => {
  const f = await fixture(t);
  const data = new TextEncoder().encode("bad");
  for (const [i, entries] of [
    { "../escape": data },
    { "dist/marketplace/../escape": data },
    { "dist/marketplace/C:/evil": data },
    { "dist/marketplace/NUL": data },
    { "dist/marketplace/A": data, "dist/marketplace/a": data },
    { "dist/marketplace/file": new Uint8Array(1025) },
  ].entries())
    await assert.rejects(
      extractRelease(zipSync(entries), join(f.root, `bad-${i}`), 1024),
    );
});

// biome-ignore lint/suspicious/noTemplateCurlyInString: 플러그인 경로 치환 문자열을 보존하는 검사
const bridgePath = "${CLAUDE_PLUGIN_ROOT}/dist/cli/mcp-bridge.js";

test("설치한 Node와 공통 home을 플러그인 MCP에 연결하고 인증은 포함하지 않는다", async (t) => {
  const f = await fixture(t),
    home = join(f.root, "개인 설정");
  for (const platform of ["codex", "claude"])
    await writeFile(
      join(f.market, "plugins", platform, "fast-jira/.mcp.json"),
      JSON.stringify({
        mcpServers: { fast_jira: { command: "node", args: [bridgePath] } },
      }),
    );
  await bindMarketplace(f.market, home);
  for (const platform of ["codex", "claude"]) {
    const data = JSON.parse(
      await readFile(
        join(f.market, "plugins", platform, "fast-jira/.mcp.json"),
        "utf8",
      ),
    );
    assert.equal(data.mcpServers.fast_jira.command, process.execPath);
    assert.deepEqual(data.mcpServers.fast_jira.env, { FAST_JIRA_HOME: home });
    assert.deepEqual(data.mcpServers.fast_jira.args, [bridgePath]);
  }
});
