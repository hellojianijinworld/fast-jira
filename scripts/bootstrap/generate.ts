import { readFile } from "node:fs/promises";

const platforms = [
  "darwin-x64",
  "darwin-arm64",
  "linux-x64",
  "linux-arm64",
  "win-x64",
  "win-arm64",
] as const;
export function nodeArchiveNames(node: string) {
  if (!/^\d+\.\d+\.\d+$/.test(node)) throw new Error("Node 버전을 확인하세요.");
  return platforms.map(
    (platform) =>
      `node-v${node}-${platform}.${platform.startsWith("win-") ? "zip" : "tar.gz"}`,
  );
}
export async function bootstrapScripts(
  metadata: {
    version: string;
    commit: string;
    node: string;
    installerSha256: string;
  },
  checksums: string,
) {
  if (
    !/^\d+\.\d+\.\d+$/.test(metadata.version) ||
    !/^[a-f0-9]{40}$/.test(metadata.commit)
  )
    throw new Error("배포 버전과 커밋을 확인하세요.");
  if (!/^[a-f0-9]{64}$/.test(metadata.installerSha256))
    throw new Error("설치기 체크섬을 확인하세요.");
  const names = nodeArchiveNames(metadata.node);
  const values: Record<string, string> = {
    NODE: metadata.node,
    VERSION: metadata.version,
    COMMIT: metadata.commit,
    INSTALLER_SHA: metadata.installerSha256,
  };
  for (const [index, platform] of platforms.entries()) {
    const matches = checksums
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/))
      .filter((line) => line[1] === names[index]);
    if (matches.length !== 1 || !/^[a-f0-9]{64}$/.test(matches[0]?.[0] ?? ""))
      throw new Error(`공식 Node 체크섬이 없거나 중복돼요: ${platform}`);
    values[`SHA_${platform.toUpperCase().replaceAll("-", "_")}`] =
      matches[0]?.[0] ?? "";
  }
  const render = async (file: string) =>
    (await readFile(new URL(file, import.meta.url), "utf8")).replace(
      /__([A-Z0-9_]+)__/g,
      (_match, key: string) => {
        const value = values[key];
        if (!value) throw new Error("설치기 생성 값을 확인하세요.");
        return value;
      },
    );
  return {
    sh: await render("install.sh"),
    ps1: `\uFEFF${await render("install.ps1")}`,
  };
}
