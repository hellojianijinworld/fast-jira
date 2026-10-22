import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const snapshot = mkdtempSync(join(tmpdir(), "fast-jira-commit-"));
let status = 0;
function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
  });
  return result.status ?? 1;
}
try {
  // 작업 파일 대신 실제 커밋할 인덱스를 검사해 부분 스테이징의 누락도 차단한다.
  status = run(
    "git",
    ["checkout-index", "--all", `--prefix=${snapshot.replaceAll("\\", "/")}/`],
    process.cwd(),
  );
  if (status === 0) {
    symlinkSync(
      resolve("node_modules"),
      join(snapshot, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const npm = process.env.npm_execpath;
    if (!npm) throw new Error("npm run check:commit으로 실행하세요.");
    for (const script of ["typecheck", "lint"]) {
      status = run(process.execPath, [npm, "run", script], snapshot);
      if (status !== 0) break;
    }
  }
} finally {
  rmSync(snapshot, { recursive: true, force: true });
}
process.exitCode = status;
