import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  type InstallationPlatform,
  installationResult,
} from "../domain/installation.ts";
import { record } from "../domain/validation.ts";
import {
  discoverPlugins,
  type PluginCommand,
  runPluginCommand,
} from "./plugin-update.ts";

export async function registerPlatform(options: {
  platform: InstallationPlatform;
  marketplace: string;
  version: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  run?: PluginCommand;
}) {
  const { platform, marketplace, version } = options;
  const env = options.env ?? process.env;
  const run = options.run ?? runPluginCommand;
  const result = (
    code: NonNullable<
      NonNullable<Parameters<typeof installationResult>[1]>["plugin"]
    >,
  ) => installationResult(platform, { plugin: code }).plugin;
  async function matches(
    plugin: { version: string; root: string; enabled: boolean } | undefined,
  ) {
    if (plugin?.version !== version || !plugin.enabled) return false;
    if (!options.home) return true;
    const mcp = record(
      JSON.parse(
        await readFile(
          join(plugin.root, "plugins", platform, "fast-jira/.mcp.json"),
          "utf8",
        ),
      ),
    );
    const server = record(record(mcp.mcpServers).fast_jira);
    const home = record(server.env).FAST_JIRA_HOME;
    return (
      server.command === process.execPath &&
      typeof home === "string" &&
      resolve(home) === resolve(options.home)
    );
  }
  try {
    if (!isAbsolute(marketplace)) return result("plugin_failed");
    const pkg = record(
      JSON.parse(
        await readFile(
          join(marketplace, "plugins", platform, "fast-jira/package.json"),
          "utf8",
        ),
      ),
    );
    if (pkg.name !== "fast-jira" || pkg.version !== version)
      return result("plugin_failed");
    try {
      if ((await run(platform, ["plugin", "--help"], env)) === null)
        return result("plugin_missing_cli");
    } catch {
      return result("plugin_unsupported");
    }
    const previous = (await discoverPlugins(run, env, [platform]))[0];
    // 기존 등록·개발 원본은 일반 설치에서 교체하지 않는다.
    if (previous)
      return result(
        (await matches(previous)) ? "plugin_ready" : "plugin_failed",
      );
    const listing = await run(
      platform,
      ["plugin", "marketplace", "list", "--json"],
      env,
    );
    if (listing === null) return result("plugin_missing_cli");
    const data: unknown = JSON.parse(listing);
    const markets = platform === "codex" ? record(data).marketplaces : data;
    if (!Array.isArray(markets)) return result("plugin_failed");
    const market = markets
      .map(record)
      .find((item) => item.name === "fast-jira-local");
    if (market) {
      const path =
        platform === "codex"
          ? record(market.marketplaceSource).source
          : market.source === "directory"
            ? market.path
            : undefined;
      if (typeof path !== "string" || resolve(path) !== resolve(marketplace))
        return result("plugin_failed");
    } else if (
      (await run(
        platform,
        ["plugin", "marketplace", "add", marketplace],
        env,
      )) === null
    )
      return result("plugin_missing_cli");
    const args =
      platform === "codex"
        ? ["plugin", "add", "fast-jira@fast-jira-local", "--json"]
        : ["plugin", "install", "fast-jira@fast-jira-local", "--scope", "user"];
    if ((await run(platform, args, env)) === null)
      return result("plugin_missing_cli");
    const installed = (await discoverPlugins(run, env, [platform]))[0];
    return result(
      (await matches(installed)) ? "plugin_ready" : "plugin_failed",
    );
  } catch {
    return result("plugin_failed");
  }
}
