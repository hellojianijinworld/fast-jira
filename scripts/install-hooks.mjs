import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";

const root = spawnSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
});
// 배포 패키지를 다른 저장소에 설치해도 그 저장소의 훅을 바꾸지 않는다.
if (
  root.status === 0 &&
  realpathSync(root.stdout.trim()) === realpathSync(".")
) {
  const result = spawnSync(
    "git",
    ["config", "--local", "core.hooksPath", ".githooks"],
    {
      stdio: "inherit",
    },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
