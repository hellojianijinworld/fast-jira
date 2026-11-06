import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { record } from "../domain/validation.ts";
import { platformCommand } from "./platform-command.ts";

const selector = "fast-jira@fast-jira-local";
type Platform = "codex" | "claude";
export type PluginCommand = (
  platform: Platform,
  args: string[],
  env: NodeJS.ProcessEnv,
) => Promise<string | null>;
export class PluginUpdateError extends Error {}
const execute = promisify(execFile);
export const runPluginCommand: PluginCommand = async (platform, args, env) => {
  const safeEnv = { ...env };
  for (const key of Object.keys(safeEnv))
    if (key.startsWith("JIRA_") || key === "NODE_OPTIONS") delete safeEnv[key];
  try {
    const target = await platformCommand(platform, safeEnv);
    if (!target) return null;
    const result = await execute(target.command, [...target.prefix, ...args], {
      env: safeEnv,
      cwd: env.HOME,
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return result.stdout;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new PluginUpdateError(
      `${platform} 플러그인 명령을 완료하지 못했어요.`,
    );
  }
};
function entries(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value))
    throw new PluginUpdateError("플러그인 목록을 확인하지 못했어요.");
  return value.map(record);
}
interface InstalledPlugin {
  platform: Platform;
  root: string;
  version: string;
  enabled: boolean;
}
export async function discoverPlugins(
  run: PluginCommand,
  env: NodeJS.ProcessEnv,
  platforms: readonly Platform[] = ["codex", "claude"],
) {
  const plugins: InstalledPlugin[] = [];
  for (const platform of platforms) {
    const output = await run(
      platform,
      [
        "plugin",
        "list",
        "--json",
        ...(platform === "codex" ? ["--marketplace", "fast-jira-local"] : []),
      ],
      env,
    );
    if (output === null) continue;
    const data: unknown = JSON.parse(output);
    const installed = entries(
      platform === "codex" ? record(data).installed : data,
    );
    const plugin = installed.find(
      (item) => item[platform === "codex" ? "pluginId" : "id"] === selector,
    );
    if (!plugin) continue;
    if (
      typeof plugin.version !== "string" ||
      typeof plugin.enabled !== "boolean"
    )
      throw new PluginUpdateError(
        "Fast Jira 플러그인 상태를 확인하지 못했어요.",
      );
    let root: unknown;
    if (platform === "codex") {
      // 현재 공식 add 명령은 비활성 플러그인도 활성화하므로 임의로 켜지 않는다.
      if (!plugin.enabled)
        throw new PluginUpdateError(
          "비활성 Codex 플러그인을 켠 뒤 다시 업데이트해 주세요.",
        );
      const source = record(plugin.marketplaceSource);
      if (source.sourceType === "local") root = source.source;
    } else {
      if (plugin.scope !== "user")
        throw new PluginUpdateError(
          "사용자 범위로 설치된 Fast Jira 플러그인만 함께 업데이트할 수 있어요.",
        );
      const markets = await run(
        platform,
        ["plugin", "marketplace", "list", "--json"],
        env,
      );
      const market = entries(JSON.parse(markets ?? "null")).find(
        (item) => item.name === "fast-jira-local",
      );
      if (market?.source === "directory") root = market.path;
    }
    if (typeof root !== "string" || !isAbsolute(root))
      throw new PluginUpdateError(
        "Setup으로 등록한 로컬 Fast Jira 플러그인 경로를 확인해 주세요.",
      );
    plugins.push({
      platform,
      root,
      version: plugin.version,
      enabled: plugin.enabled,
    });
  }
  return plugins;
}
async function verify(plugin: string, platform: Platform, version: string) {
  if (!(await lstat(plugin)).isDirectory())
    throw new PluginUpdateError("플러그인 원본 경로를 확인해 주세요.");
  for (const filename of ["package.json", `.${platform}-plugin/plugin.json`]) {
    const data = record(
      JSON.parse(await readFile(join(plugin, filename), "utf8")),
    );
    if (data.name !== "fast-jira" || data.version !== version)
      throw new PluginUpdateError(
        "앱과 플러그인의 배포 버전이 일치하지 않아요. 설치 경로를 확인해 주세요.",
      );
  }
}
/** 공식 CLI로 설치된 Fast Jira만 갱신하고, 앱 교체 실패까지 같은 복구 범위로 묶는다. */
async function updatePlugins(
  marketplace: string,
  version: string,
  env: NodeJS.ProcessEnv,
  install: () => Promise<void>,
  run: PluginCommand = runPluginCommand,
  platforms: readonly Platform[] = ["codex", "claude"],
) {
  const plugins = await discoverPlugins(run, env, platforms);
  const changed: { plugin: InstalledPlugin; path: string; backup: string }[] =
    [];
  async function refresh(plugin: InstalledPlugin, expected: string) {
    if (expected === plugin.version) {
      const remove =
        plugin.platform === "codex"
          ? ["plugin", "remove", selector, "--json"]
          : ["plugin", "uninstall", selector, "--scope", "user"];
      if ((await run(plugin.platform, remove, env)) === null)
        throw new PluginUpdateError(
          "기존 Fast Jira 플러그인을 다시 불러오지 못했어요.",
        );
    }
    const args =
      plugin.platform === "codex"
        ? ["plugin", "add", selector, "--json"]
        : [
            "plugin",
            expected === plugin.version ? "install" : "update",
            selector,
            "--scope",
            "user",
          ];
    if ((await run(plugin.platform, args, env)) === null)
      throw new PluginUpdateError(
        `${plugin.platform} 실행 파일을 찾지 못했어요.`,
      );
    const state = (await discoverPlugins(run, env, [plugin.platform])).find(
      (item) => item.platform === plugin.platform,
    );
    if (state?.version !== expected || state.enabled !== plugin.enabled)
      throw new PluginUpdateError(
        `${plugin.platform} 플러그인의 버전과 활성 상태를 확인하지 못했어요.`,
      );
  }
  for (const plugin of plugins) {
    await verify(
      join(plugin.root, "plugins", plugin.platform, "fast-jira"),
      plugin.platform,
      plugin.version,
    );
    await verify(
      join(marketplace, "plugins", plugin.platform, "fast-jira"),
      plugin.platform,
      version,
    );
  }
  try {
    for (const plugin of plugins) {
      const path = join(plugin.root, "plugins", plugin.platform, "fast-jira"),
        next = `${path}.next-${randomUUID()}`,
        backup = `${path}.previous-${randomUUID()}`;
      try {
        await cp(
          join(marketplace, "plugins", plugin.platform, "fast-jira"),
          next,
          { recursive: true },
        );
        await rename(path, backup);
        changed.push({ plugin, path, backup });
        await rename(next, path);
      } finally {
        await rm(next, { recursive: true, force: true });
      }
      await refresh(plugin, version);
    }
    await install();
  } catch (error) {
    let recovered = true;
    for (const { plugin, path, backup } of changed.reverse()) {
      try {
        await rm(path, { recursive: true, force: true });
        await rename(backup, path);
        await refresh(plugin, plugin.version);
      } catch {
        recovered = false;
      }
    }
    if (!recovered)
      throw new PluginUpdateError(
        "업데이트와 플러그인 복구를 완료하지 못했어요. Managing으로 설치 상태를 확인해 주세요.",
      );
    throw error;
  }
  for (const { backup } of changed)
    await rm(backup, { recursive: true, force: true });
}

export async function withPluginUpdates(
  marketplace: string,
  version: string,
  env: NodeJS.ProcessEnv,
  install: () => Promise<void>,
  run: PluginCommand = runPluginCommand,
  platforms: readonly Platform[] = ["codex", "claude"],
) {
  // 앱의 --home이 달라도 사용자 AI 플러그인은 공유되므로 함께 잠근다.
  const directory = join(env.HOME ?? homedir(), ".cache", "fast-jira");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "plugin-update.lock");
  const lock = await open(path, "wx", 0o600).catch(() => {
    throw new PluginUpdateError(
      "다른 Fast Jira 플러그인 업데이트가 진행 중이에요. 잠시 후 다시 시도해 주세요.",
    );
  });
  try {
    await lock.writeFile(String(process.pid));
    await updatePlugins(marketplace, version, env, install, run, platforms);
  } finally {
    await lock.close();
    await rm(path, { force: true });
  }
}
