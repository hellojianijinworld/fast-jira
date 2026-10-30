import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertNodeSupported } from "../src/cli/config.ts";
import { packRelease } from "../src/cli/release-artifact.ts";
import {
  artifactNames,
  releaseContext,
} from "../src/domain/release-artifact.ts";

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
const names = artifactNames(pkg.version);
await mkdir("dist/release", { recursive: true });
await writeFile(join("dist/release", names.archive), packed.archive);
await writeFile(
  join("dist/release", names.manifest),
  JSON.stringify(packed.manifest, null, 2),
);
await writeFile(join("dist/release", names.installer), installer);
console.log(`배포 파일 준비: ${names.archive}`);
