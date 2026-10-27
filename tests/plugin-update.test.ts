import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  type PluginCommand,
  withPluginUpdates,
} from "../src/cli/plugin-update.ts";

async function fixture(t: { after: (run: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "fast-jira-plugin-update-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source"),
    market = join(root, "market");
  for (const platform of ["codex", "claude"]) {
    for (const [base, version] of [
      [market, "0.1.0"],
      [join(source, "dist/marketplace"), "0.1.1"],
    ] as const) {
      const plugin = join(base, "plugins", platform, "fast-jira");
      await mkdir(join(plugin, `.${platform}-plugin`), { recursive: true });
      for (const name of ["package.json", `.${platform}-plugin/plugin.json`])
        await writeFile(
          join(plugin, name),
          JSON.stringify({ name: "fast-jira", version }),
        );
    }
  }
  let failClaude = false;
  const installed = { codex: "0.1.0", claude: "0.1.0" };
  const calls: string[] = [];
  const run: PluginCommand = async (platform, args) => {
    calls.push([platform, ...args].join(" "));
    if (args[1] === "list")
      return JSON.stringify(
        platform === "codex"
          ? {
              installed: [
                {
                  pluginId: "fast-jira@fast-jira-local",
                  version: installed.codex,
                  enabled: true,
                  marketplaceSource: { sourceType: "local", source: market },
                },
              ],
            }
          : [
              {
                id: "fast-jira@fast-jira-local",
                version: installed.claude,
                scope: "user",
                enabled: true,
              },
            ],
      );
    if (args[1] === "marketplace")
      return JSON.stringify([
        { name: "fast-jira-local", source: "directory", path: market },
      ]);
    if (platform === "claude" && failClaude) {
      failClaude = false;
      throw new Error("install failed");
    }
    installed[platform] = JSON.parse(
      await readFile(
        join(market, "plugins", platform, "fast-jira/package.json"),
        "utf8",
      ),
    ).version;
    return "{}";
  };
  return {
    env: { HOME: root },
    source,
    market,
    run,
    installed,
    calls,
    fail: () => {
      failClaude = true;
    },
  };
}

test("한 작업에서 설치된 두 플랫폼을 같은 버전으로 갱신한 다음 앱을 교체한다", async (t) => {
  const f = await fixture(t);
  let apps = 0;
  await withPluginUpdates(
    f.source,
    "0.1.1",
    f.env,
    async () => {
      apps++;
      assert.deepEqual(f.installed, { codex: "0.1.1", claude: "0.1.1" });
    },
    f.run,
  );
  assert.equal(apps, 1);
  assert.ok(!f.calls.some((call) => /remove|uninstall|install /.test(call)));
});

test("한 플랫폼이나 앱 교체가 실패하면 두 플러그인의 원본과 설치 버전을 복구한다", async (t) => {
  for (const failure of ["claude", "app"]) {
    const f = await fixture(t);
    if (failure === "claude") f.fail();
    await assert.rejects(
      withPluginUpdates(
        f.source,
        "0.1.1",
        f.env,
        async () => {
          throw new Error("app failed");
        },
        f.run,
      ),
    );
    assert.deepEqual(f.installed, { codex: "0.1.0", claude: "0.1.0" });
    for (const platform of ["codex", "claude"])
      assert.equal(
        JSON.parse(
          await readFile(
            join(f.market, "plugins", platform, "fast-jira/package.json"),
            "utf8",
          ),
        ).version,
        "0.1.0",
      );
  }
});

test("설치되지 않은 AI에는 새 플러그인을 등록하지 않는다", async (t) => {
  const f = await fixture(t);
  let apps = 0;
  await withPluginUpdates(
    "unused",
    "0.1.1",
    f.env,
    async () => {
      apps++;
    },
    async (_platform, args) => {
      assert.equal(args[1], "list");
      return null;
    },
  );
  assert.equal(apps, 1);
});

test("알 수 없는 설치 형식과 비활성 Codex를 변경하기 전에 중단한다", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    withPluginUpdates(
      f.source,
      "0.1.1",
      f.env,
      async () => assert.fail("앱 변경 금지"),
      async (platform, args, env) => {
        const output = await f.run(platform, args, env);
        return platform === "codex" && args[1] === "list"
          ? (output?.replace('"enabled":true', '"enabled":false') ?? null)
          : output;
      },
    ),
  );
  assert.deepEqual(f.installed, { codex: "0.1.0", claude: "0.1.0" });
});

test("서로 다른 앱 설치에서도 공유 플러그인의 교체와 복구를 동시에 실행하지 않는다", async (t) => {
  const f = await fixture(t);
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = withPluginUpdates(
    f.source,
    "0.1.1",
    f.env,
    async () => {
      started();
      await hold;
    },
    f.run,
  );
  await ready;
  try {
    await assert.rejects(
      withPluginUpdates(
        f.source,
        "0.1.1",
        f.env,
        async () => assert.fail("동시 교체 금지"),
        f.run,
      ),
      /다른 Fast Jira/,
    );
  } finally {
    release();
    await first;
  }
  assert.deepEqual(f.installed, { codex: "0.1.1", claude: "0.1.1" });
});
