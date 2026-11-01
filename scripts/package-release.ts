import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertNodeSupported } from "../src/cli/config.ts";
import { packRelease } from "../src/cli/release-artifact.ts";
import {
  artifactNames,
  BOOTSTRAP_FILES,
  releaseContext,
} from "../src/domain/release-artifact.ts";

import { bootstrapScripts } from "./bootstrap/generate.ts";

assertNodeSupported();
const pkg = JSON.parse(await readFile("package.json", "utf8"));
releaseContext(
  {
    event: process.env.GITHUB_EVENT_NAME ?? "",
    repository: process.env.GITHUB_REPOSITORY ?? "",
    actor: process.env.GITHUB_ACTOR ?? "",
    triggeringActor: process.env.GITHUB_TRIGGERING_ACTOR ?? "",
    ref: process.env.GITHUB_REF ?? "",
    commit: process.env.RELEASE_COMMIT ?? "",
  },
  pkg.version,
);
const installer = await readFile("dist/cli/download-main.js");
const packed = await packRelease(
  "dist/marketplace",
  pkg.version,
  process.env.RELEASE_COMMIT ?? "",
  installer,
);
const checksumResponse = await fetch(
  `https://nodejs.org/dist/v${pkg.engines.node}/SHASUMS256.txt`,
  { signal: AbortSignal.timeout(30000), redirect: "error" },
);
if (!checksumResponse.ok) throw new Error("공식 Node 체크섬을 받지 못했어요.");
const bootstraps = await bootstrapScripts(
  packed.manifest,
  await checksumResponse.text(),
);
packed.manifest.bootstrapSha256 = {
  sh: createHash("sha256").update(bootstraps.sh).digest("hex"),
  ps1: createHash("sha256").update(bootstraps.ps1).digest("hex"),
};
const names = artifactNames(pkg.version);
await mkdir("dist/release", { recursive: true });
await writeFile(join("dist/release", names.archive), packed.archive);
for (const kind of ["sh", "ps1"] as const)
  await writeFile(
    join("dist/release", BOOTSTRAP_FILES[kind]),
    bootstraps[kind],
    { mode: 0o700 },
  );
await writeFile(
  join("dist/release", names.manifest),
  JSON.stringify(packed.manifest, null, 2),
);
await writeFile(join("dist/release", names.installer), installer);
console.log(`배포 파일 준비: ${names.archive}`);
