import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const destination = join(root, "dist/marketplace");
const stage = join(root, "dist/marketplace.next");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
await rm(stage, { recursive: true, force: true });
try {
  for (const platform of ["codex", "claude"]) {
    const manifestPath = `.${platform}-plugin/plugin.json`;
    const manifest = JSON.parse(
      await readFile(join(root, manifestPath), "utf8"),
    );
    if (manifest.name !== pkg.name || manifest.version !== pkg.version) {
      throw new Error(`${platform} 플러그인과 제품 버전이 다릅니다.`);
    }
    const plugin = join(stage, "plugins", platform, "fast-jira");
    await mkdir(plugin, { recursive: true });
    // 배포 파일을 열거해 개인 인증·소스·테스트·다른 플랫폼 설정을 제외한다.
    for (const path of [
      "dist/server",
      "dist/client",
      "dist/cli",
      "skills",
      "INSTALL.md",
      "CONTRIBUTING.md",
      "README.md",
      "LICENSE",
      manifestPath,
    ]) {
      await cp(join(root, path), join(plugin, path), { recursive: true });
    }
    await writeFile(
      join(plugin, "package.json"),
      JSON.stringify(
        {
          name: pkg.name,
          version: pkg.version,
          license: pkg.license,
          type: "module",
        },
        null,
        2,
      ),
    );
  }
  const catalogs = {
    ".agents/plugins/marketplace.json": {
      name: "fast-jira-local",
      interface: { displayName: "Fast Jira" },
      plugins: [
        {
          name: "fast-jira",
          source: { source: "local", path: "./plugins/codex/fast-jira" },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Productivity",
        },
      ],
    },
    ".claude-plugin/marketplace.json": {
      name: "fast-jira-local",
      metadata: { description: "Fast Jira 로컬 설치·관리·기여 플러그인" },
      owner: { name: "hellojianijinworld" },
      plugins: [
        {
          name: "fast-jira",
          source: "./plugins/claude/fast-jira",
          description: "Fast Jira의 설치, 관리와 기여를 돕습니다.",
        },
      ],
    },
  };
  for (const [path, catalog] of Object.entries(catalogs)) {
    await mkdir(dirname(join(stage, path)), { recursive: true });
    await writeFile(join(stage, path), JSON.stringify(catalog, null, 2));
  }
  await rm(destination, { recursive: true, force: true });
  await rename(stage, destination);
  console.log(`플러그인 배포본: ${destination}`);
} catch (error) {
  await rm(stage, { recursive: true, force: true });
  throw error;
}
