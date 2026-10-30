import packageInfo from "../../package.json" with { type: "json" };
import { UPDATE_REPOSITORY, versionParts } from "./app-update.ts";
import { record } from "./validation.ts";

export const MAX_ARCHIVE_BYTES = 80 * 1024 * 1024;
export interface ReleaseManifest {
  format: 1;
  version: string;
  commit: string;
  node: string;
  filename: string;
  sha256: string;
  bytes: number;
  installerSha256: string;
}
export function artifactNames(version: string) {
  versionParts(version);
  return {
    archive: `fast-jira-${version}.zip`,
    manifest: `fast-jira-${version}.json`,
    installer: "fast-jira-download.mjs",
  };
}
export function artifactUrl(
  version: string,
  kind: keyof ReturnType<typeof artifactNames>,
) {
  return `https://github.com/${UPDATE_REPOSITORY}/releases/download/v${version}/${artifactNames(version)[kind]}`;
}
export function hasReleaseArtifacts(value: unknown, version: string): boolean {
  if (!Array.isArray(value)) return false;
  return Object.values(artifactNames(version)).every((name) =>
    value.some((item) => {
      const asset = record(item);
      return (
        asset.name === name &&
        asset.state === "uploaded" &&
        typeof asset.size === "number" &&
        asset.size > 0 &&
        asset.size <= MAX_ARCHIVE_BYTES
      );
    }),
  );
}
export function decodeReleaseManifest(
  value: unknown,
  expected: { version: string; commit: string },
): ReleaseManifest {
  const data = record(value);
  if (
    data.format !== 1 ||
    data.version !== expected.version ||
    data.commit !== expected.commit ||
    !/^[a-f0-9]{40}$/.test(expected.commit) ||
    data.node !== packageInfo.engines.node ||
    data.filename !== artifactNames(expected.version).archive ||
    typeof data.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(data.sha256) ||
    typeof data.installerSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(data.installerSha256) ||
    typeof data.bytes !== "number" ||
    !Number.isSafeInteger(data.bytes) ||
    data.bytes <= 0 ||
    data.bytes > MAX_ARCHIVE_BYTES
  )
    throw new Error(
      "배포 파일의 버전·코드·Node·체크섬 정보를 확인하지 못했어요.",
    );
  return {
    format: 1,
    version: expected.version,
    commit: expected.commit,
    node: packageInfo.engines.node,
    filename: data.filename,
    sha256: data.sha256,
    bytes: data.bytes,
    installerSha256: data.installerSha256,
  };
}
export function releaseContext(
  context: {
    event: string;
    repository: string;
    actor: string;
    triggeringActor: string;
    ref: string;
    commit: string;
  },
  version: string,
) {
  versionParts(version);
  const owner = UPDATE_REPOSITORY.split("/")[0];
  if (
    context.event !== "push" ||
    context.repository !== UPDATE_REPOSITORY ||
    context.actor !== owner ||
    context.triggeringActor !== owner ||
    context.ref !== `refs/tags/v${version}` ||
    !/^[a-f0-9]{40}$/.test(context.commit)
  )
    throw new Error(
      "저장소 소유자가 게시한 현재 버전의 정식 태그만 배포할 수 있습니다.",
    );
  return { tag: `v${version}`, commit: context.commit };
}
