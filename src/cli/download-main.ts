import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { installationPlatform } from "../domain/installation.ts";
import { assertNodeSupported, installationPaths } from "./config.ts";
import { bindMarketplace, downloadRelease } from "./release-artifact.ts";

try {
  assertNodeSupported();
  const [version, commit, destination, home, ...options] =
    process.argv.slice(2);
  let platform: "codex" | "claude" | undefined;
  let domain = "no";
  let noOpen = false;
  for (let i = 0; i < options.length; i++) {
    if (options[i] === "--no-open") {
      noOpen = true;
      continue;
    }
    const value = options[++i];
    if (options[i - 1] === "--platform") platform = installationPlatform(value);
    else if (
      options[i - 1] === "--domain" &&
      (value === "yes" || value === "no")
    )
      domain = value;
    else throw new Error("지원하지 않는 설치 옵션이에요.");
  }
  if (!version || !commit || !destination)
    throw new Error(
      "사용법: node fast-jira-download.mjs 버전 커밋SHA 새설치경로 [개인home]",
    );
  const root = resolve(destination);
  await downloadRelease({ version, commit }, root);
  const paths = installationPaths(home);
  await bindMarketplace(resolve(root, "dist/marketplace"), paths.home);
  if (platform) {
    const child = spawn(
      process.execPath,
      [
        resolve(
          root,
          "dist/marketplace/plugins",
          platform,
          "fast-jira/dist/cli/main.js",
        ),
        "setup",
        "--home",
        paths.home,
        "--marketplace",
        resolve(root, "dist/marketplace"),
        "--platform",
        platform,
        "--domain",
        domain,
        ...(noOpen ? ["--no-open"] : []),
      ],
      { stdio: "inherit", windowsHide: true },
    );
    process.exitCode = await new Promise<number>((done, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => done(code ?? 1));
    });
  } else
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
