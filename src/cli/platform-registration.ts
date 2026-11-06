import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  type InstallationPlatform,
  installationResult,
} from "../domain/installation.ts";
import { record } from "../domain/validation.ts";
import { installationTargets } from "./installation-record.ts";
import {
  discoverPlugins,
  type PluginCommand,
  runPluginCommand,
  withPluginUpdates,
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
    marketplace?: string,
  ): ReturnType<typeof installationResult>["plugin"] & {
    marketplace?: string;
  } => ({
    ...installationResult(platform, { plugin: code }).plugin,
    ...(marketplace ? { marketplace } : {}),
  });
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
    if (previous) {
      if (!previous.enabled) return result("plugin_failed");
      const target =
        options.home &&
        (await installationTargets(options.home)).find(
          (item) => item.platform === platform,
        );
      if (target && resolve(target.marketplace) === resolve(previous.root)) {
        const mcp = record(
          JSON.parse(
            await readFile(
              join(previous.root, "plugins", platform, "fast-jira/.mcp.json"),
              "utf8",
            ),
          ),
        );
        if (
          record(record(record(mcp.mcpServers).fast_jira).env)
            .FAST_JIRA_HOME !== options.home
        )
          return result("plugin_failed");
        await withPluginUpdates(
          marketplace,
          version,
          env,
          async () => {},
          run,
          [platform],
        );
        const refreshed = (await discoverPlugins(run, env, [platform]))[0];
        return result(
          (await matches(refreshed)) ? "plugin_ready" : "plugin_failed",
          previous.root,
        );
      }
      // 설치 기록이 없는 개발 원본·다른 개인 설치는 변경하지 않는다.
      return result(
        (await matches(previous)) ? "plugin_ready" : "plugin_failed",
        previous.root,
      );
    }
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
