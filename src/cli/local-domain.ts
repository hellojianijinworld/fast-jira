import { execFile, spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import {
  trustLocalCertificate,
  verifyLocalCertificate,
} from "./certificate-trust.ts";

import { startWindowsDomain, windowsTool } from "./windows-domain.ts";

export const LOCAL_DOMAIN = "https://fast-jira.local";
const PORTLESS_VERSION = "0.15.11";
type Run = (
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
) => Promise<void>;
const execute: Run = async (command, args, env) => {
  const result = spawnSync(command, args, {
    env,
    stdio: ["inherit", 2, 2],
    timeout: 180000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0)
    throw new Error("로컬 도메인 설정을 완료하지 못했어요.");
};
export function npmScript(node: string) {
  const bin = dirname(node);
  for (const candidate of [
    join(bin, "node_modules/npm/bin/npm-cli.js"),
    join(bin, "../lib/node_modules/npm/bin/npm-cli.js"),
    join(bin, "npm"),
  ]) {
    try {
      const target = realpathSync(candidate);
      if (target.endsWith(".js")) return target;
    } catch {
      /* 설치 방식에 따라 없는 경로는 다음 후보를 확인한다. */
    }
  }
}
const curl = promisify(execFile);
async function readDomainHealth(state: string) {
  const { stdout } = await curl(
    process.platform === "win32" ? windowsTool("curl.exe") : "/usr/bin/curl",
    [
      "--disable",
      "--silent",
      "--fail",
      "--noproxy",
      "fast-jira.local",
      "--cacert",
      join(state, "ca.pem"),
      "--max-time",
      "10",
      `${LOCAL_DOMAIN}/api/health`,
    ],
    { encoding: "utf8", timeout: 15000, maxBuffer: 4096, windowsHide: true },
  );
  return stdout;
}
export async function verifyAddress(
  state: string,
  instance: string,
  request = readDomainHealth,
) {
  try {
    const data = JSON.parse(await request(state));
    return data?.app === "fast-jira" && data.instance === instance;
  } catch {
    return false;
  }
}
/** 시스템 변경은 명시적으로 도메인 설정에 동의한 설치에서만 시도한다. */
export async function configureLocalDomain(
  home: string,
  port: number,
  consented: boolean,
  instance: string,
  options: {
    run?: Run;
    verify?: (state: string, instance: string) => Promise<boolean>;
    major?: number;
    platform?: NodeJS.Platform;
    trust?: (state: string) => Promise<void>;
  } = {},
) {
  const fallback = { url: `http://localhost:${port}`, message: "" };
  if (!consented) return fallback;
  if ((options.major ?? Number(process.versions.node.split(".")[0])) < 24)
    return {
      ...fallback,
      message:
        "로컬 도메인은 Node.js 24 이상에서 설정할 수 있어요. localhost로 실행했어요.",
    };
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "win32")
    return {
      ...fallback,
      message:
        "이 OS의 로컬 도메인 자동 설정은 아직 지원하지 않아 localhost로 실행했어요.",
    };
  const run = options.run ?? execute,
    prefix = join(home, "tools"),
    state = join(home, "config/portless"),
    cli = join(prefix, "node_modules/portless/dist/cli.js");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORTLESS_STATE_DIR: state,
    PORTLESS_LAN: "0",
    PORTLESS_TLD: "local",
    PORTLESS_PORT: "443",
    PORTLESS_HTTPS: "1",
    PORTLESS_SYNC_HOSTS: "1",
  };
  for (const key of Object.keys(env))
    if (key.startsWith("JIRA_") || key === "NODE_OPTIONS") delete env[key];
  try {
    if (platform === "win32") await mkdir(state, { recursive: true });
    if (!existsSync(cli)) {
      const npm = npmScript(process.execPath);
      if (!npm && !options.run) throw new Error("npm을 찾지 못했어요.");
      await run(
        process.execPath,
        [
          npm ?? "npm-cli.js",
          "install",
          "--prefix",
          prefix,
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          `portless@${PORTLESS_VERSION}`,
        ],
        env,
      );
    }
    if (platform === "win32") {
      let connected = false;
      if (existsSync(join(state, "proxy.pid"))) {
        try {
          await run(
            process.execPath,
            [cli, "alias", "fast-jira", String(port)],
            env,
          );
          connected = await (options.verify ?? verifyAddress)(state, instance);
        } catch {
          /* 처음 설정하거나 hosts 연결을 복구할 때만 승인을 요청한다. */
        }
      }
      if (!connected) await startWindowsDomain(cli, port, env, run);
      if (!(await (options.verify ?? verifyAddress)(state, instance)))
        throw new Error("접속 검증에 실패했어요.");
      await run(
        windowsTool("certutil.exe"),
        [
          "-user",
          "-addstore",
          "Root",
          join(state, "host-certs/fast-jira_local.pem"),
        ],
        env,
      );
      await run(
        windowsTool("curl.exe"),
        [
          "--disable",
          "--fail",
          "--silent",
          "--show-error",
          "--noproxy",
          "fast-jira.local",
          "--max-time",
          "10",
          "--output",
          "NUL",
          `${LOCAL_DOMAIN}/api/health`,
        ],
        env,
      );
      return { url: LOCAL_DOMAIN, message: "로컬 도메인 연결을 확인했어요." };
    }
    // OS 인증창만 사용한다. 앱 서버·npm 설치는 일반 사용자 권한을 유지한다.
    const user = userInfo();
    const privilegedEnv = {
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
      HOME: user.homedir,
      SUDO_USER: user.username,
      SUDO_UID: String(user.uid),
      SUDO_GID: String(user.gid),
      PORTLESS_STATE_DIR: state,
      PORTLESS_LAN: "0",
      PORTLESS_TLD: "local",
      PORTLESS_PORT: "443",
      PORTLESS_HTTPS: "1",
      PORTLESS_SYNC_HOSTS: "1",
    };
    const quote = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;
    const command = (args: string[]) =>
      `/usr/bin/env -i ${[
        ...Object.entries(privilegedEnv).map(
          ([key, value]) => `${key}=${value}`,
        ),
        process.execPath,
        cli,
        ...args,
      ]
        .map(quote)
        .join(" ")}`;
    let connected = false;
    if (existsSync(join(state, "proxy.pid"))) {
      try {
        await run(
          process.execPath,
          [cli, "alias", "fast-jira", String(port)],
          env,
        );
        connected = await (options.verify ?? verifyAddress)(state, instance);
      } catch {
        /* 실행 중이지 않으면 시스템 승인 후 시작한다. */
      }
    }
    if (!connected) {
      await run(
        "/usr/bin/osascript",
        [
          "-e",
          "on run argv\n do shell script (item 1 of argv) with prompt (item 2 of argv) with administrator privileges\nend run",
          `(${command(["proxy", "start", "--port", "443", "--tld", "local", "--skip-trust"])} || ${command(["proxy", "start", "--port", "443", "--tld", "local", "--skip-trust"])}) && (${command(["alias", "fast-jira", String(port)])} || { ${command(["proxy", "stop", "--port", "443"])}; exit 1; })`,
          "Fast Jira를 fast-jira.local 주소로 사용하도록 허용하시겠어요?\n이 컴퓨터에서 해당 주소로 접속할 수 있도록 설정합니다.",
        ],
        env,
      );
    }
    if (!(await (options.verify ?? verifyAddress)(state, instance)))
      throw new Error("접속 검증에 실패했어요.");
    await (
      options.trust ??
      ((state) =>
        trustLocalCertificate(state, (command, args) =>
          run(command, args, env),
        ))
    )(state);
    await verifyLocalCertificate(state, (command, args) =>
      run(command, args, env),
    );
    return { url: LOCAL_DOMAIN, message: "로컬 도메인 연결을 확인했어요." };
  } catch {
    return {
      ...fallback,
      message:
        "도메인 설정이 승인되지 않았거나 연결할 수 없어 localhost로 실행했어요.",
    };
  }
}
