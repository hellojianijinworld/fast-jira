import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installationPaths } from "./config.ts";
import {
  doctor,
  removeService,
  serviceStatus,
  setupService,
  startService,
  stopService,
  withServiceLock,
} from "./service.ts";

try {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "help" || command === "--help") {
    console.log(
      "Fast Jira: doctor | setup | start | stop | status | open | update | remove\n선택: --home 개인폴더, setup --port 포트\nmacOS 로그인 세션에서 서비스 실행을 지원합니다. remove는 개인 인증·설정을 보존합니다.",
    );
  } else {
    let home: string | undefined;
    let port: number | undefined;
    for (let index = 0; index < args.length; index += 2) {
      const value = args[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error("옵션 값을 입력하세요.");
      if (args[index] === "--home") home = resolve(value);
      else if (args[index] === "--port" && command === "setup")
        port = Number(value);
      else throw new Error("지원하지 않는 옵션입니다.");
    }
    const paths = installationPaths(home);
    const source = fileURLToPath(new URL("../../", import.meta.url));
    if (command === "doctor") console.log(JSON.stringify(await doctor(source)));
    else {
      if (process.platform !== "darwin")
        throw new Error(
          "상주 서비스 설치·관리는 현재 macOS만 지원합니다. 다른 OS에서는 CONTRIBUTING.md의 소스 실행 방식을 사용하세요.",
        );
      if (command === "status")
        console.log(JSON.stringify(await serviceStatus(paths)));
      else if (command === "open") {
        const status = await serviceStatus(paths);
        if (!status.running || !("url" in status))
          throw new Error("서비스가 실행 중이 아닙니다. start 후 다시 여세요.");
        const result = spawnSync("/usr/bin/open", [status.url], {
          stdio: "ignore",
        });
        if (result.status !== 0) throw new Error("브라우저를 열지 못했습니다.");
        console.log(status.url);
      } else {
        if (!["setup", "start", "stop", "update", "remove"].includes(command))
          throw new Error("지원하지 않는 명령입니다. help를 확인하세요.");
        await withServiceLock(paths, async () => {
          if (command === "setup" || command === "update")
            await setupService(source, paths, port);
          if (command === "start") await startService(paths);
          if (command === "stop") stopService(paths);
          if (command === "remove") await removeService(paths);
        });
        console.log(JSON.stringify(await serviceStatus(paths)));
      }
    }
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "서비스 관리에 실패했습니다.",
  );
  process.exitCode = 1;
}
