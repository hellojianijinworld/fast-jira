import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installationPaths } from "./config.ts";
import {
  doctor,
  removeService,
  serviceStatus,
  setupDomain,
  setupService,
  startService,
  stopService,
  withServiceLock,
} from "./service.ts";

try {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "help" || command === "--help") {
    console.log(
      "Fast Jira: doctor | setup | start | stop | status | open | update | remove\n선택: --home 개인폴더, setup --port 포트, setup --domain yes|no\nOS 자동 시작 등록 없이 백그라운드로 실행합니다. remove는 개인 인증·설정을 보존합니다.",
    );
  } else {
    let home: string | undefined;
    let port: number | undefined;
    let domain: boolean | undefined;
    for (let index = 0; index < args.length; index += 2) {
      const value = args[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error("옵션 값을 입력하세요.");
      if (args[index] === "--home") home = resolve(value);
      else if (args[index] === "--port" && command === "setup")
        port = Number(value);
      else if (
        args[index] === "--domain" &&
        command === "setup" &&
        (value === "yes" || value === "no")
      )
        domain = value === "yes";
      else throw new Error("지원하지 않는 옵션입니다.");
    }
    const paths = installationPaths(home);
    const source = fileURLToPath(new URL("../../", import.meta.url));
    if (command === "doctor") console.log(JSON.stringify(await doctor(source)));
    else {
      if (command === "status")
        console.log(JSON.stringify(await serviceStatus(paths)));
      else if (command === "open") {
        const status = await serviceStatus(paths);
        if (!status.running || !("url" in status))
          throw new Error("서비스가 실행 중이 아닙니다. start 후 다시 여세요.");
        const result = spawnSync(
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "explorer.exe"
              : "xdg-open",
          [status.url],
          {
            stdio: "ignore",
          },
        );
        if (result.status !== 0) throw new Error("브라우저를 열지 못했습니다.");
        console.log(status.url);
      } else {
        if (!["setup", "start", "stop", "update", "remove"].includes(command))
          throw new Error("지원하지 않는 명령입니다. help를 확인하세요.");
        await withServiceLock(paths, async () => {
          if (command === "setup" || command === "update")
            await setupService(source, paths, port);
          if (command === "setup" && domain !== undefined)
            console.error((await setupDomain(paths, domain)).message);
          if (command === "start") await startService(paths);
          if (command === "stop") await stopService(paths);
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
