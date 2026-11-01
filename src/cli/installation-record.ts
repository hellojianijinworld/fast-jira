import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type InstallationPlatform,
  installationPlatform,
} from "../domain/installation.ts";
import { record } from "../domain/validation.ts";

export async function installationTargets(
  home: string,
): Promise<{ platform: InstallationPlatform; marketplace: string }[]> {
  const text = await readFile(
    join(home, "config/installation.json"),
    "utf8",
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!text) return [];
  const data = record(JSON.parse(text));
  if (data.version !== 1 || !Array.isArray(data.targets))
    throw new Error("설치 기록을 확인해 주세요.");
  return data.targets.map((value) => {
    const target = record(value);
    if (typeof target.marketplace !== "string")
      throw new Error("설치 기록을 확인해 주세요.");
    return {
      platform: installationPlatform(target.platform),
      marketplace: target.marketplace,
    };
  });
}
