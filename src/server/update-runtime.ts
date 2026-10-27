import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installationPaths } from "../cli/config.ts";
import { launchReleaseUpdate, readUpdateJob } from "../cli/release-update.ts";
import { readServiceConfig } from "../cli/service.ts";
import { record } from "../domain/validation.ts";
import { createAppUpdater } from "./app-update.ts";

export async function createRuntimeUpdater() {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const home = process.cwd(),
    paths = installationPaths(home);
  const pkg = record(
    JSON.parse(await readFile(resolve(root, "package.json"), "utf8")),
  );
  const config = await readServiceConfig(paths).catch(() => null);
  return createAppUpdater({
    currentVersion: typeof pkg.version === "string" ? pkg.version : "unknown",
    supported:
      process.platform === "darwin" &&
      resolve(root) === resolve(paths.runtime) &&
      config?.instance === process.env.FAST_JIRA_INSTANCE,
    readJob: () => readUpdateJob(home),
    start: (release) => launchReleaseUpdate(home, release),
  });
}
