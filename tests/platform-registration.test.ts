import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { registerPlatform } from "../src/cli/platform-registration.ts";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "jira platform-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const market = join(root, "market");
  for (const platform of ["codex", "claude"]) {
    const plugin = join(market, "plugins", platform, "fast-jira");
    await mkdir(plugin, { recursive: true });
    await writeFile(
      join(plugin, "package.json"),
      JSON.stringify({ name: "fast-jira", version: "0.1.1" }),
    );
  }
  return { root, market };
}

test("지정한 플랫폼만 공식 명령으로 등록하고 등록 후 목록을 확인한다", async (t) => {
  const f = await fixture(t);
  for (const platform of ["codex", "claude"] as const) {
    const calls: string[][] = [];
    let installed = false;
    const result = await registerPlatform({
      platform,
      marketplace: f.market,
      version: "0.1.1",
      env: { HOME: f.root },
      run: async (name, args) => {
        assert.equal(name, platform);
        calls.push(args);
        if (args[0] === "plugin" && args[1] === "list")
          return JSON.stringify(
            platform === "codex"
              ? {
                  installed: installed
                    ? [
                        {
                          pluginId: "fast-jira@fast-jira-local",
                          version: "0.1.1",
                          enabled: true,
                          marketplaceSource: {
                            sourceType: "local",
                            source: f.market,
                          },
                        },
                      ]
                    : [],
                }
              : installed
                ? [
                    {
                      id: "fast-jira@fast-jira-local",
                      version: "0.1.1",
                      enabled: true,
                      scope: "user",
                    },
                  ]
                : [],
          );
        if (args[1] === "marketplace" && args[2] === "list")
          return JSON.stringify(
            platform === "codex"
              ? { marketplaces: [] }
              : installed
                ? [
                    {
                      name: "fast-jira-local",
                      source: "directory",
                      path: f.market,
                    },
                  ]
                : [],
          );
        if (args[0] === "plugin" && ["add", "install"].includes(args[1] ?? ""))
          installed = true;
        return "{}";
      },
    });
    assert.equal(result.code, "plugin_ready");
    assert.equal(
      calls.some(
        (args) =>
          args[1] === "marketplace" &&
          args[2] === "add" &&
          args[3] === f.market,
      ),
      true,
    );
    assert.equal(calls.filter((args) => args[1] === "list").length, 2);
  }
});

test("CLI가 없거나 등록이 실패해도 안전한 오류 코드만 반환한다", async (t) => {
  const f = await fixture(t);
  const options = {
    platform: "codex" as const,
    marketplace: f.market,
    version: "0.1.1",
    env: { HOME: f.root },
  };
  assert.equal(
    (await registerPlatform({ ...options, run: async () => null })).code,
    "plugin_missing_cli",
  );
  const failure = await registerPlatform({
    ...options,
    run: async (_name, args) => {
      if (args.includes("--help")) return "{}";
      throw new Error("SECRET=do-not-expose");
    },
  });
  assert.equal(failure.code, "plugin_failed");
  assert(!JSON.stringify(failure).includes("SECRET"));
});

test("이미 설치한 다른 원본·버전이나 비활성 플러그인은 덮어쓰지 않는다", async (t) => {
  const f = await fixture(t);
  for (const patch of [
    { enabled: false },
    { version: "9.0.0" },
    { marketplaceSource: { sourceType: "git", source: "elsewhere" } },
  ]) {
    let mutations = 0;
    const result = await registerPlatform({
      platform: "codex",
      marketplace: f.market,
      version: "0.1.1",
      env: { HOME: f.root },
      run: async (_name, args) => {
        if (args[1] === "list")
          return JSON.stringify({
            installed: [
              {
                pluginId: "fast-jira@fast-jira-local",
                enabled: true,
                version: "0.1.1",
                marketplaceSource: { sourceType: "local", source: f.market },
                ...patch,
              },
            ],
          });
        if (!args.includes("--help")) mutations++;
        return "{}";
      },
    });
    assert.equal(result.code, "plugin_failed");
    assert.equal(mutations, 0);
  }
});

test("공식 CLI의 JS 진입점도 shell 없이 실행하고 Jira 환경값은 전달하지 않는다", async (t) => {
  const f = await fixture(t);
  const script = join(f.root, "AI 명령.mjs");
  await writeFile(
    script,
    "console.log(JSON.stringify({args:process.argv.slice(2),jira:process.env.JIRA_TOKEN??null}));",
  );
  const { runPluginCommand } = await import("../src/cli/plugin-update.ts");
  const value = await runPluginCommand(
    "codex",
    ["plugin", "--help", "literal; no-shell"],
    {
      PATH: "",
      HOME: f.root,
      FAST_JIRA_CODEX_BIN: script,
      JIRA_TOKEN: "do-not-forward",
    },
  );
  assert.deepEqual(JSON.parse(value ?? "null"), {
    args: ["plugin", "--help", "literal; no-shell"],
    jira: null,
  });
});

test("같은 버전이어도 다른 개인 폴더를 가리키는 MCP 등록을 성공으로 간주하지 않는다", async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.market, "plugins/codex/fast-jira/.mcp.json"),
    JSON.stringify({
      mcpServers: {
        fast_jira: {
          command: process.execPath,
          env: { FAST_JIRA_HOME: join(f.root, "other") },
        },
      },
    }),
  );
  const result = await registerPlatform({
    platform: "codex",
    marketplace: f.market,
    version: "0.1.1",
    home: join(f.root, "mine"),
    env: { HOME: f.root },
    run: async (_name, args) =>
      args.includes("--help")
        ? "help"
        : JSON.stringify({
            installed: [
              {
                pluginId: "fast-jira@fast-jira-local",
                enabled: true,
                version: "0.1.1",
                marketplaceSource: { sourceType: "local", source: f.market },
              },
            ],
          }),
  });
  assert.equal(result.code, "plugin_failed");
});

test("Unix npm CLI 심볼릭 링크는 전역 Node 없이 전용 Node로 실행한다", {
  skip: process.platform === "win32",
}, async (t) => {
  const f = await fixture(t),
    bin = join(f.root, "bin");
  await mkdir(bin);
  const { runPluginCommand } = await import("../src/cli/plugin-update.ts");
  for (const platform of ["codex", "claude"] as const) {
    const script = join(f.root, `${platform} CLI.mjs`);
    await writeFile(
      script,
      "#!/usr/bin/env node\nconsole.log(JSON.stringify({node:process.execPath,args:process.argv.slice(2)}));",
    );
    await chmod(script, 0o700);
    await symlink(script, join(bin, platform));
    const observed = JSON.parse(
      (await runPluginCommand(platform, ["plugin", "--help"], {
        HOME: f.root,
        PATH: bin,
      })) ?? "null",
    );
    assert.deepEqual(observed, {
      node: process.execPath,
      args: ["plugin", "--help"],
    });
  }
});

test("꺼진 Claude 플러그인은 성공으로 보고하거나 자동 활성화하지 않는다", async (t) => {
  const f = await fixture(t);
  let mutations = 0;
  await writeFile(
    join(f.market, "plugins/claude/fast-jira/.mcp.json"),
    JSON.stringify({
      mcpServers: {
        fast_jira: {
          command: process.execPath,
          env: { FAST_JIRA_HOME: f.root },
        },
      },
    }),
  );
  const result = await registerPlatform({
    platform: "claude",
    marketplace: f.market,
    version: "0.1.1",
    home: f.root,
    run: async (_platform, args) => {
      if (args.includes("--help")) return "help";
      if (args[1] === "list")
        return JSON.stringify([
          {
            id: "fast-jira@fast-jira-local",
            version: "0.1.1",
            enabled: false,
            scope: "user",
          },
        ]);
      if (args[1] === "marketplace" && args[2] === "list")
        return JSON.stringify([
          { name: "fast-jira-local", source: "directory", path: f.market },
        ]);
      mutations++;
      return "{}";
    },
  });
  assert.notEqual(result.code, "plugin_ready");
  assert.equal(mutations, 0);
});
