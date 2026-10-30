import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Unzip, UnzipInflate, zipSync } from "fflate";
import packageInfo from "../../package.json" with { type: "json" };
import {
  artifactNames,
  artifactUrl,
  decodeReleaseManifest,
  type ReleaseManifest,
} from "../domain/release-artifact.ts";
import { record } from "../domain/validation.ts";
import { assertNodeSupported } from "./config.ts";

const MAX_EXPANDED_BYTES = 200 * 1024 * 1024;
const sha256 = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
function safePath(name: string) {
  const path = name.replace(/\/$/, "");
  if (
    !path.startsWith("dist/marketplace/") ||
    path.length > 1024 ||
    /[\\:]/.test(path) ||
    [...path].some((character) => character.charCodeAt(0) < 32) ||
    path
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part),
      )
  )
    throw new Error("배포 ZIP의 파일 경로가 올바르지 않습니다.");
  return path;
}
export async function packRelease(
  marketplace: string,
  version: string,
  commit: string,
  installer: Uint8Array,
) {
  const files: Record<string, Uint8Array> = Object.create(null);
  let bytes = 0;
  async function visit(directory: string, prefix: string) {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = safePath(`${prefix}/${entry.name}`);
      if (entry.isDirectory()) await visit(join(directory, entry.name), name);
      else if (entry.isFile()) {
        const content = await readFile(join(directory, entry.name));
        bytes += content.length;
        if (bytes > MAX_EXPANDED_BYTES)
          throw new Error("배포 파일이 너무 큽니다.");
        files[name] = content;
      } else
        throw new Error("배포 파일에 링크나 특수 파일을 넣을 수 없습니다.");
    }
  }
  await visit(marketplace, "dist/marketplace");
  const archive = zipSync(files, { level: 6 });
  const manifest = decodeReleaseManifest(
    {
      format: 1,
      version,
      commit,
      node: packageInfo.engines.node,
      filename: artifactNames(version).archive,
      sha256: sha256(archive),
      bytes: archive.length,
      installerSha256: sha256(installer),
    },
    { version, commit },
  );
  return { archive, manifest };
}
export async function extractRelease(
  archive: Uint8Array,
  destination: string,
  limit = MAX_EXPANDED_BYTES,
) {
  const files = new Map<string, Buffer[]>();
  const seen = new Set<string>();
  const pending = new Set<string>();
  let bytes = 0;
  const unzip = new Unzip((file) => {
    const name = safePath(file.name);
    const normalized = name.toLowerCase();
    if (seen.has(normalized) || seen.size >= 2048)
      throw new Error("배포 ZIP에 중복되거나 너무 많은 파일이 있습니다.");
    seen.add(normalized);
    if (file.originalSize !== undefined && file.originalSize > limit)
      throw new Error("배포 ZIP의 확장 크기가 너무 큽니다.");
    if (file.name.endsWith("/")) return;
    const chunks: Buffer[] = [];
    files.set(name, chunks);
    pending.add(name);
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      bytes += chunk.length;
      if (bytes > limit) {
        file.terminate();
        throw new Error("배포 ZIP의 확장 크기가 너무 큽니다.");
      }
      chunks.push(Buffer.from(chunk));
      if (final) pending.delete(name);
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < archive.length; offset += 1024)
    unzip.push(
      archive.subarray(offset, offset + 1024),
      offset + 1024 >= archive.length,
    );
  if (pending.size || files.size === 0)
    throw new Error("배포 ZIP을 끝까지 읽지 못했습니다.");
  // 새 디렉터리만 허용해 기존 파일·심볼릭 링크를 따라가지 않는다.
  await mkdir(destination, { mode: 0o700 });
  for (const [name, chunks] of files) {
    const path = join(destination, name);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, Buffer.concat(chunks), { flag: "wx", mode: 0o600 });
  }
}
async function fetchBytes(url: string, maximum: number, fetcher: typeof fetch) {
  for (let redirects = 0; redirects <= 4; redirects++) {
    const target = new URL(url);
    if (
      target.protocol !== "https:" ||
      target.port ||
      target.username ||
      target.password ||
      ![
        "github.com",
        "release-assets.githubusercontent.com",
        "objects.githubusercontent.com",
      ].includes(target.hostname)
    )
      throw new Error("공식 GitHub 배포 주소만 사용할 수 있습니다.");
    const response = await fetcher(target.href, {
      redirect: "manual",
      signal: AbortSignal.timeout(60000),
    });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("Location");
      await response.body?.cancel();
      if (!next) throw new Error("배포 파일의 이동 주소가 없습니다.");
      url = new URL(next, target).href;
      continue;
    }
    if (!response.ok || !response.body)
      throw new Error("공개된 배포 파일을 내려받지 못했어요.");
    if (Number(response.headers.get("Content-Length")) > maximum) {
      await response.body.cancel();
      throw new Error("배포 파일이 너무 큽니다.");
    }
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > maximum) throw new Error("배포 파일이 너무 큽니다.");
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel();
    }
    return Buffer.concat(chunks);
  }
  throw new Error("배포 파일의 이동 횟수가 너무 많습니다.");
}
export async function downloadRelease(
  target: { version: string; commit: string },
  destination: string,
  fetcher: typeof fetch = fetch,
): Promise<ReleaseManifest> {
  const metadata = await fetchBytes(
    artifactUrl(target.version, "manifest"),
    16384,
    fetcher,
  );
  const manifest = decodeReleaseManifest(
    JSON.parse(metadata.toString("utf8")),
    target,
  );
  const archive = await fetchBytes(
    artifactUrl(target.version, "archive"),
    manifest.bytes,
    fetcher,
  );
  if (archive.length !== manifest.bytes || sha256(archive) !== manifest.sha256)
    throw new Error("내려받은 배포 파일의 체크섬이 일치하지 않습니다.");
  await extractRelease(archive, destination);
  for (const platform of ["codex", "claude"]) {
    const plugin = join(
      destination,
      "dist/marketplace/plugins",
      platform,
      "fast-jira",
    );
    const pkg = JSON.parse(
      await readFile(join(plugin, "package.json"), "utf8"),
    );
    if (
      pkg.name !== "fast-jira" ||
      pkg.version !== manifest.version ||
      pkg.engines?.node !== manifest.node
    )
      throw new Error("압축파일의 실행 버전이 배포 정보와 다릅니다.");
  }
  return manifest;
}

export async function bindMarketplace(marketplace: string, home: string) {
  assertNodeSupported();
  for (const platform of ["codex", "claude"]) {
    const path = join(marketplace, "plugins", platform, "fast-jira/.mcp.json");
    const data = record(JSON.parse(await readFile(path, "utf8")));
    const server = record(record(data.mcpServers).fast_jira);
    if (typeof server.command !== "string" || !Array.isArray(server.args))
      throw new Error("배포 플러그인의 MCP 실행 정보를 확인하지 못했어요.");
    server.command = process.execPath;
    server.env = { FAST_JIRA_HOME: resolve(home) };
    await writeFile(path, JSON.stringify(data, null, 2), { mode: 0o600 });
  }
}
