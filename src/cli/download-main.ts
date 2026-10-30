import { resolve } from "node:path";
import { assertNodeSupported, installationPaths } from "./config.ts";
import { bindMarketplace, downloadRelease } from "./release-artifact.ts";

try {
  assertNodeSupported();
  const [version, commit, destination, home] = process.argv.slice(2);
  if (!version || !commit || !destination)
    throw new Error(
      "사용법: node fast-jira-download.mjs 버전 커밋SHA 새설치경로 [개인home]",
    );
  const root = resolve(destination);
  await downloadRelease({ version, commit }, root);
  const paths = installationPaths(home);
  await bindMarketplace(resolve(root, "dist/marketplace"), paths.home);
  console.log(
    JSON.stringify({
      version,
      marketplace: resolve(root, "dist/marketplace"),
      home: paths.home,
      node: process.execPath,
    }),
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "배포 파일을 받지 못했어요.",
  );
  process.exitCode = 1;
}
