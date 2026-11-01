import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  installationPlatform,
  installationResult,
} from "../domain/installation.ts";
import { record } from "../domain/validation.ts";
import { installationPaths } from "./config.ts";
import { installationTargets } from "./installation-record.ts";
import { registerPlatform } from "./platform-registration.ts";
import type { PluginCommand } from "./plugin-update.ts";
import {
  atomicWrite,
  doctor,
  readServiceConfig,
  serviceStatus,
  setupDomain,
  setupService,
  startService,
  withServiceLock,
} from "./service.ts";

const execute = promisify(execFile);
async function localMcp(home: string, port: number) {
  const client = new Client({ name: "fast-jira-install", version: "1.0.0" });
  let transport: StreamableHTTPClientTransport | undefined;
  try {
    const token = (
      await readFile(installationPaths(home).mcpToken, "utf8")
    ).trim();
    transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        },
      },
    );
    await client.connect(transport);
    return client.getServerVersion()?.name === "fast-jira";
  } catch {
    return false;
  } finally {
    await transport?.terminateSession().catch(() => {});
    await client.close().catch(() => {});
  }
}
async function assistantReady(port: number) {
  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/assistant/status`,
      { signal: AbortSignal.timeout(20000) },
    );
    if (!response.ok) return false;
    const data = record(await response.json());
    return (
      data.ready === true &&
      Array.isArray(data.models) &&
      data.models.length > 0
    );
  } catch {
    return false;
  }
}
export async function openInstallation(url: string) {
  const parsed = new URL(url);
  if (
    !(
      (parsed.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(parsed.hostname)) ||
      (parsed.protocol === "https:" && parsed.hostname === "fast-jira.local")
    ) ||
    parsed.username ||
    parsed.password
  )
    throw new Error("앱 주소를 확인해 주세요.");
  await execute(
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer.exe"
        : "xdg-open",
    [url],
    { timeout: 10000, windowsHide: true },
  );
}
export async function setupInstallation(options: {
  platform: unknown;
  source: string;
  marketplace?: string;
  home?: string;
  port?: number;
  domainConsent: boolean;
  open?: boolean;
  run?: PluginCommand;
  checkAssistant?: () => Promise<boolean>;
}) {
  const platform = installationPlatform(options.platform);
  const paths = installationPaths(options.home);
  const checked = await doctor(options.source);
  if (!checked.ready)
    return {
      ...installationResult(platform, {
        runtime: checked.result.runtime.code,
      }),
      url: "",
      opened: false,
    };
  const codes: NonNullable<Parameters<typeof installationResult>[1]> = {
    runtime: "runtime_ready",
  };
  let url = "";
  await withServiceLock(paths, async () => {
    const pkg = record(
      JSON.parse(await readFile(join(options.source, "package.json"), "utf8")),
    );
    const version = String(pkg.version);
    try {
      const config = await readServiceConfig(paths);
      const current = await readFile(
        join(paths.runtime, "package.json"),
        "utf8",
      )
        .then((text) => record(JSON.parse(text)))
        .catch(() => null);
      if (
        config &&
        current?.version === version &&
        config.node === process.execPath &&
        (options.port === undefined || options.port === config.port)
      )
        await startService(paths, false);
      else await setupService(options.source, paths, options.port);
      const status = await serviceStatus(paths);
      if (!status.running) throw new Error("Web unavailable");
      codes.web = "web_ready";
      url = "url" in status ? status.url : "";
    } catch {
      codes.web = "web_failed";
      return;
    }
    const targets = await installationTargets(paths.home).catch(() => []);
    const marketplace = resolve(
      options.marketplace ??
        targets.find((item) => item.platform === platform)?.marketplace ??
        resolve(options.source, "../../.."),
    );
    const registration = await registerPlatform({
      platform,
      marketplace,
      version,
      home: paths.home,
      ...(options.run ? { run: options.run } : {}),
    });
    codes.plugin = registration.code;
    const config = await readServiceConfig(paths);
    if (!config) {
      codes.web = "web_failed";
      return;
    }
    codes.mcp = (await localMcp(paths.home, config.port))
      ? "mcp_host_pending"
      : "mcp_failed";
    codes.assistant = (await (
      options.checkAssistant ?? (() => assistantReady(config.port))
    )())
      ? "assistant_ready"
      : "assistant_unavailable";
    // 인증 입력 화면을 열기 전에 비식별 상태만 확인한다.
    try {
      const response = await fetch(
        `http://127.0.0.1:${config.port}/api/connection/status`,
        { signal: AbortSignal.timeout(3000) },
      );
      if (response.ok && record(await response.json()).state === "connected")
        codes.jira = "jira_ready";
    } catch {
      /* 설치와 Jira 인증의 성공 여부를 구분한다. */
    }
    if (options.domainConsent) {
      const domain = await setupDomain(paths, true);
      codes.domain =
        domain.url === "https://fast-jira.local"
          ? "domain_ready"
          : "domain_failed";
      // 도메인 실패 후에도 실제 기본 앱 응답을 확인한다.
      const status = await serviceStatus(paths);
      if (!status.running) codes.web = "web_failed";
      url = "url" in status ? status.url : "";
    } else if (url === "https://fast-jira.local") codes.domain = "domain_ready";
    const target = { platform, marketplace };
    const receipt = join(paths.home, "config/installation.json");
    await atomicWrite(
      receipt,
      JSON.stringify({
        version: 1,
        targets: [
          ...targets.filter((item) => item.platform !== platform),
          target,
        ],
      }),
    );
  });
  const result = installationResult(platform, codes);
  let opened = false;
  if (result.appReady && url && options.open !== false) {
    try {
      await openInstallation(url);
      opened = true;
    } catch {
      /* 반환한 실제 주소로 다시 열 수 있다. */
    }
  }
  return { ...result, url, opened };
}
