import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import packageInfo from "../../package.json" with { type: "json" };

export interface ServiceConfig {
  version: 1;
  port: number;
  instance: string;
  node: string;
  publicUrl?: string;
}

export const REQUIRED_NODE_VERSION = packageInfo.engines.node;

export function nodeSupported(version: string): boolean {
  return version === REQUIRED_NODE_VERSION;
}
export function assertNodeSupported(version = process.versions.node): void {
  if (!nodeSupported(version))
    throw new Error(
      `Node.js ${REQUIRED_NODE_VERSION} 버전으로 다시 실행해 주세요. 현재 ${version}입니다.`,
    );
}

export function defaultHome() {
  if (process.platform === "darwin")
    return join(homedir(), "Library/Application Support/Fast Jira");
  if (process.platform === "win32")
    return join(process.env.LOCALAPPDATA ?? homedir(), "Fast Jira");
  return join(
    process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"),
    "fast-jira",
  );
}
export function installationPaths(
  home = process.env.FAST_JIRA_HOME ?? defaultHome(),
  userHome = homedir(),
) {
  home = resolve(home);
  const id = createHash("sha256").update(home).digest("hex").slice(0, 12);
  const label = `com.hellojianijinworld.fast-jira.${id}`;
  return {
    home,
    label,
    runtime: join(home, "runtime"),
    config: join(home, "config/service.json"),
    credentials: join(home, "config/connection.env"),
    process: join(home, "config/process.json"),
    mcpToken: join(home, "config/mcp-token"),
    log: join(home, "service.log"),
    lock: join(home, "service.lock"),
    plist: join(userHome, "Library/LaunchAgents", `${label}.plist`),
  };
}
export type InstallationPaths = ReturnType<typeof installationPaths>;

export function parseServiceConfig(value: unknown): ServiceConfig {
  if (!value || typeof value !== "object")
    throw new Error("설치 설정 형식이 올바르지 않습니다.");
  const data = value as Record<string, unknown>;
  if (
    data.version !== 1 ||
    typeof data.port !== "number" ||
    !Number.isInteger(data.port) ||
    data.port < 1 ||
    data.port > 65535 ||
    typeof data.instance !== "string" ||
    !/^[a-zA-Z0-9-]{1,80}$/.test(data.instance) ||
    typeof data.node !== "string" ||
    !isAbsolute(data.node) ||
    /[\r\n\0]/.test(data.node)
  )
    throw new Error(
      "설치 설정 형식이 올바르지 않습니다. 기존 service.json을 보존하고 설정을 확인하세요.",
    );
  if (
    data.publicUrl !== undefined &&
    data.publicUrl !== "https://fast-jira.local"
  )
    throw new Error("기본 도메인 설정이 올바르지 않습니다.");
  return {
    version: 1,
    port: data.port,
    instance: data.instance,
    node: data.node,
    ...(typeof data.publicUrl === "string"
      ? { publicUrl: data.publicUrl }
      : {}),
  };
}

const xml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
export function servicePlist(
  paths: InstallationPaths,
  config: ServiceConfig,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${paths.label}</string>
<key>ProgramArguments</key><array><string>${xml(config.node)}</string><string>${xml(join(paths.runtime, "dist/server/main.js"))}</string></array>
<key>WorkingDirectory</key><string>${xml(paths.home)}</string>
<key>EnvironmentVariables</key><dict>
<key>PORT</key><string>${config.port}</string>
<key>FAST_JIRA_INSTANCE</key><string>${config.instance}</string>
</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(paths.log)}</string>
<key>StandardErrorPath</key><string>${xml(paths.log)}</string>
</dict></plist>
`;
}
