import { randomUUID } from "node:crypto";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function validateRuntime(source: string): Promise<void> {
  for (const name of [
    "dist/server/main.js",
    "dist/cli/main.js",
    "dist/client/index.html",
  ]) {
    await access(join(source, name)).catch(() => {
      throw new Error(
        "빌드된 실행 파일이 없습니다. 소스 저장소에서 npm ci와 npm run package:plugin을 실행하세요.",
      );
    });
  }
  const pkg: unknown = JSON.parse(
    await readFile(join(source, "package.json"), "utf8"),
  );
  if (
    !pkg ||
    typeof pkg !== "object" ||
    !("name" in pkg) ||
    pkg.name !== "fast-jira" ||
    !("version" in pkg) ||
    typeof pkg.version !== "string"
  ) {
    throw new Error("Fast Jira 배포본이 아닙니다.");
  }
}

/** 실행 자산만 복사한다. 개인 .env와 소스/개발 의존성은 가져오지 않는다. */
export async function stageRuntime(
  source: string,
  home: string,
): Promise<string> {
  await validateRuntime(source);
  const stage = join(home, `.runtime-${randomUUID()}`);
  await mkdir(stage, { recursive: true, mode: 0o700 });
  try {
    for (const name of ["server", "client", "cli"]) {
      await cp(join(source, "dist", name), join(stage, "dist", name), {
        recursive: true,
      });
    }
    await cp(join(source, "LICENSE"), join(stage, "LICENSE"));
    const pkg = JSON.parse(
      await readFile(join(source, "package.json"), "utf8"),
    ) as { version: string };
    await writeFile(
      join(stage, "package.json"),
      JSON.stringify({
        name: "fast-jira",
        version: pkg.version,
        license: "MIT",
        type: "module",
      }),
    );
    return stage;
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}
