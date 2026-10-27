import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import {
  type InstallationPaths,
  nodeSupported,
  parseServiceConfig,
  type ServiceConfig,
  servicePlist,
} from "./config.ts";
import { stageRuntime, validateRuntime } from "./runtime.ts";

function call(args: string[], allowMissing = false): string {
  const result = spawnSync("/bin/launchctl", args, {
    encoding: "utf8",
    timeout: 10000,
  });
  if (result.status !== 0 && !allowMissing)
    throw new Error(
      `서비스 관리에 실패했습니다: ${result.stderr?.trim() || result.error?.message || args[0]}`,
    );
  return result.status === 0 ? result.stdout : "";
}
const domain = () => `gui/${process.getuid?.()}`;
const target = (paths: InstallationPaths) => `${domain()}/${paths.label}`;
const registered = (paths: InstallationPaths) =>
  Boolean(call(["print", target(paths)], true));

export async function readServiceConfig(
  paths: InstallationPaths,
): Promise<ServiceConfig | null> {
  const text = await readFile(paths.config, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    },
  );
  return text === null ? null : parseServiceConfig(JSON.parse(text));
}

async function healthy(config: ServiceConfig): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    const data = (await response.json()) as { app?: string; instance?: string };
    return (
      response.ok &&
      data.app === "fast-jira" &&
      data.instance === config.instance
    );
  } catch {
    return false;
  }
}

export async function serviceStatus(paths: InstallationPaths) {
  const config = await readServiceConfig(paths);
  if (!config)
    return {
      installed: false,
      running: false,
      registered: false,
      home: paths.home,
    };
  return {
    installed: true,
    registered: registered(paths),
    running: await healthy(config),
    url: `http://127.0.0.1:${config.port}`,
    home: paths.home,
  };
}

async function waitHealthy(config: ServiceConfig): Promise<void> {
  for (let count = 0; count < 200; count++) {
    if (await healthy(config)) return;
    await setTimeout(150);
  }
  throw new Error(
    "서비스가 정상 응답하지 않습니다. 개인 폴더의 service.log를 확인하세요. 로그의 인증 정보는 공유하지 마세요.",
  );
}

async function ensurePortFree(port: number): Promise<void> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", () =>
      reject(
        new Error(
          `${port} 포트를 다른 서비스가 사용 중입니다. 기존 프로세스를 종료하지 말고 setup --port 다른포트를 사용하세요.`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", () => server.close(() => resolve()));
  });
}

export async function startService(paths: InstallationPaths): Promise<void> {
  const config = await readServiceConfig(paths);
  if (!config)
    throw new Error("설치된 서비스가 없습니다. 먼저 Setup을 실행하세요.");
  if (registered(paths) && (await healthy(config))) return;
  await ensurePortFree(config.port);
  if (!registered(paths)) call(["bootstrap", domain(), paths.plist]);
  else call(["kickstart", "-k", target(paths)]);
  await waitHealthy(config);
}

export function stopService(paths: InstallationPaths): void {
  if (registered(paths)) call(["bootout", target(paths)]);
}

async function atomicWrite(path: string, text: string) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function setupService(
  source: string,
  paths: InstallationPaths,
  port?: number,
): Promise<void> {
  if (!nodeSupported(process.versions.node))
    throw new Error("Node.js 22.12 이상이 필요합니다.");
  const old = await readServiceConfig(paths);
  const config = parseServiceConfig({
    version: 1,
    port: port ?? old?.port ?? 4173,
    instance: old?.instance ?? randomUUID(),
    node: process.execPath,
  });
  const wasRunning = old ? await healthy(old) : false;
  if (!(old?.port === config.port && wasRunning))
    await ensurePortFree(config.port);
  const oldPlist = old ? await readFile(paths.plist, "utf8") : null;
  const stage = await stageRuntime(source, paths.home);
  const previous = join(paths.home, `.previous-${randomUUID()}`);
  let backedUp = false,
    replaced = false;
  try {
    stopService(paths);
    if (old) {
      await rename(paths.runtime, previous);
      backedUp = true;
    }
    await rename(stage, paths.runtime);
    replaced = true;
    await atomicWrite(paths.config, JSON.stringify(config, null, 2));
    await mkdir(dirname(paths.plist), { recursive: true });
    await atomicWrite(paths.plist, servicePlist(paths, config));
    const log = await open(paths.log, "a", 0o600);
    await log.close();
    await chmod(paths.log, 0o600);
    await startService(paths);
  } catch (error) {
    stopService(paths);
    if (replaced) await rm(paths.runtime, { recursive: true, force: true });
    if (backedUp) await rename(previous, paths.runtime);
    if (old && oldPlist) {
      await atomicWrite(paths.config, JSON.stringify(old, null, 2));
      await atomicWrite(paths.plist, oldPlist);
      if (wasRunning) await startService(paths);
    } else {
      await rm(paths.config, { force: true });
      await rm(paths.plist, { force: true });
    }
    throw error;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  await rm(previous, { recursive: true, force: true });
}

export async function removeService(paths: InstallationPaths): Promise<void> {
  if (!(await readServiceConfig(paths))) return;
  stopService(paths);
  await rm(paths.plist, { force: true });
  await rm(paths.config, { force: true });
  await rm(paths.runtime, { recursive: true, force: true });
}

export async function withServiceLock<T>(
  paths: InstallationPaths,
  work: () => Promise<T>,
): Promise<T> {
  await mkdir(paths.home, { recursive: true, mode: 0o700 });
  const lock = await open(paths.lock, "wx", 0o600).catch(() => {
    throw new Error(
      "다른 서비스 관리 작업이 진행 중입니다. 종료된 작업이라면 service.lock을 확인하세요.",
    );
  });
  try {
    await lock.writeFile(String(process.pid));
    return await work();
  } finally {
    await lock.close();
    await rm(paths.lock, { force: true });
  }
}

export async function doctor(source: string) {
  await validateRuntime(source);
  if (!nodeSupported(process.versions.node))
    throw new Error("Node.js 22.12 이상이 필요합니다.");
  return {
    platform: process.platform,
    node: process.versions.node,
    ready: process.platform === "darwin",
    source,
  };
}
