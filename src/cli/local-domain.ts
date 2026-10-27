import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { get } from "node:https";
import { dirname, join } from "node:path";

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
export async function verifyAddress(state: string, instance: string) {
  const ca = await readFile(join(state, "ca.pem"));
  return new Promise<boolean>((resolve) => {
    const req = get(
      `${LOCAL_DOMAIN}/api/health`,
      { ca, timeout: 5000 },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += String(chunk);
          if (body.length > 4000) req.destroy();
        });
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            resolve(
              res.statusCode === 200 &&
                data.app === "fast-jira" &&
                data.instance === instance,
            );
          } catch {
            resolve(false);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
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
    if (!existsSync(cli)) {
      const npm = [
        join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
        join(
          dirname(process.execPath),
          "../lib/node_modules/npm/bin/npm-cli.js",
        ),
      ].find(existsSync);
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
    await run(
      process.execPath,
      [cli, "proxy", "start", "--port", "443", "--tld", "local"],
      env,
    );
    await run(process.execPath, [cli, "alias", "fast-jira", String(port)], env);
    if (!(await (options.verify ?? verifyAddress)(state, instance)))
      throw new Error("접속 검증에 실패했어요.");
    return { url: LOCAL_DOMAIN, message: "로컬 도메인 연결을 확인했어요." };
  } catch {
    return {
      ...fallback,
      message:
        "도메인 설정이 승인되지 않았거나 연결할 수 없어 localhost로 실행했어요.",
    };
  }
}
