import { spawn, spawnSync } from "node:child_process";
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
} from "./config.ts";
import {
  configureLocalDomain,
  LOCAL_DOMAIN,
  verifyAddress,
} from "./local-domain.ts";
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
const legacyTarget = (paths: InstallationPaths) =>
  `gui/${process.getuid?.()}/${paths.label}`;
async function legacyRegistered(paths: InstallationPaths) {
  if (process.platform !== "darwin") return false;
  if (!(await readFile(paths.plist).catch(() => null))) return false;
  return Boolean(call(["print", legacyTarget(paths)], true));
}
/** 버전별 플러그인 캐시와 분리된 공통 설정 폴더로 기존 설치를 이전한다. */
export async function migrateConfiguration(paths: InstallationPaths) {
  await mkdir(dirname(paths.config), { recursive: true, mode: 0o700 });
  for (const [old, next] of [
    [join(paths.home, "service.json"), paths.config],
    [join(paths.home, ".env"), paths.credentials],
  ] as const) {
    const existing = await readFile(next).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    if (existing !== null) continue;
    const previous = await readFile(old).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    if (previous === null) continue;
    if (next === paths.config)
      parseServiceConfig(JSON.parse(previous.toString()));
    await writeFile(next, previous, { flag: "wx", mode: 0o600 });
  }
}
export async function readServiceConfig(
  paths: InstallationPaths,
): Promise<ServiceConfig | null> {
  const text = await readFile(paths.config, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT")
        return readFile(join(paths.home, "service.json"), "utf8").catch(
          (legacy: NodeJS.ErrnoException) => {
            if (legacy.code === "ENOENT") return null;
            throw legacy;
          },
        );
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
    registered: await legacyRegistered(paths),
    running: await healthy(config),
    url:
      config.publicUrl &&
      (await verifyAddress(
        join(paths.home, "config/portless"),
        config.instance,
      ).catch(() => false))
        ? config.publicUrl
        : `http://localhost:${config.port}`,
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

export async function startService(
  paths: InstallationPaths,
  restoreDomain = true,
): Promise<void> {
  const config = await readServiceConfig(paths);
  if (!config)
    throw new Error("설치된 서비스가 없습니다. 먼저 Setup을 실행하세요.");
  if (await healthy(config)) {
    if (restoreDomain && config.publicUrl)
      await configureLocalDomain(
        paths.home,
        config.port,
        true,
        config.instance,
      );
    return;
  }
  await ensurePortFree(config.port);
  const log = await open(paths.log, "a", 0o600);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(config.port),
    FAST_JIRA_HOME: paths.home,
    FAST_JIRA_INSTANCE: config.instance,
    ...(config.publicUrl ? { FAST_JIRA_ORIGIN: config.publicUrl } : {}),
  };
  for (const name of Object.keys(env))
    if (name.startsWith("JIRA_")) delete env[name];
  try {
    const child = spawn(
      config.node,
      [join(paths.runtime, "dist/server/main.js")],
      {
        cwd: paths.home,
        env,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", log.fd, log.fd],
      },
    );
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    await atomicWrite(
      paths.process,
      JSON.stringify({ pid: child.pid, instance: config.instance }),
    );
  } finally {
    await log.close();
  }
  await waitHealthy(config);
  if (restoreDomain && config.publicUrl)
    await configureLocalDomain(paths.home, config.port, true, config.instance);
}

export async function setupDomain(
  paths: InstallationPaths,
  consented: boolean,
) {
  const config = await readServiceConfig(paths);
  if (!config) throw new Error("먼저 설치를 완료하세요.");
  const { publicUrl: _previous, ...rest } = config;
  // 연결 검증 전에 새 Host/Origin을 허용하고 프록시 설정은 한 번만 실행한다.
  await stopService(paths);
  await atomicWrite(
    paths.config,
    JSON.stringify(
      {
        ...rest,
        ...(consented ? { publicUrl: LOCAL_DOMAIN } : {}),
      },
      null,
      2,
    ),
  );
  await startService(paths, false);
  const result = await configureLocalDomain(
    paths.home,
    config.port,
    consented,
    config.instance,
  );
  if (consented && result.url !== LOCAL_DOMAIN) {
    await stopService(paths);
    await atomicWrite(paths.config, JSON.stringify(rest, null, 2));
    await startService(paths, false);
  }
  return result;
}

export async function stopService(paths: InstallationPaths): Promise<void> {
  if (await legacyRegistered(paths)) call(["bootout", legacyTarget(paths)]);
  const config = await readServiceConfig(paths);
  if (!config) return;
  const data = await readFile(paths.process, "utf8").catch(() => null);
  if (!data) return;
  const saved: unknown = JSON.parse(data);
  if (
    !saved ||
    typeof saved !== "object" ||
    !("pid" in saved) ||
    !("instance" in saved) ||
    saved.instance !== config.instance ||
    !Number.isSafeInteger(saved.pid) ||
    Number(saved.pid) <= 0
  )
    throw new Error("실행 프로세스 정보를 확인하세요.");
  const pid = Number(saved.pid);
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    const current = (await response.json()) as {
      pid?: number;
      instance?: string;
    };
    if (current.pid !== pid || current.instance !== config.instance)
      throw new Error("다른 프로그램은 종료하지 않습니다.");
    process.kill(pid);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!(await healthy(config))) {
        await rm(paths.process, { force: true });
        return;
      }
      await setTimeout(100);
    }
    throw new Error("종료를 기다리고 있어요. Managing에서 상태를 확인하세요.");
  } catch (error) {
    if (!(await healthy(config))) {
      try {
        process.kill(pid, 0);
      } catch {
        await rm(paths.process, { force: true });
        return;
      }
    }
    throw error;
  }
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
  await migrateConfiguration(paths);
  const old = await readServiceConfig(paths);
  const config = parseServiceConfig({
    version: 1,
    port: port ?? old?.port ?? 4173,
    instance: old?.instance ?? randomUUID(),
    node: process.execPath,
    ...(old?.publicUrl ? { publicUrl: old.publicUrl } : {}),
  });
  const wasRunning = old ? await healthy(old) : false;
  if (!(old?.port === config.port && wasRunning))
    await ensurePortFree(config.port);
  const oldPlist =
    process.platform === "darwin"
      ? await readFile(paths.plist, "utf8").catch(() => null)
      : null;
  const stage = await stageRuntime(source, paths.home);
  const previous = join(paths.home, `.previous-${randomUUID()}`);
  let backedUp = false,
    replaced = false;
  try {
    await stopService(paths);
    if (old) {
      await rename(paths.runtime, previous);
      backedUp = true;
    }
    await rename(stage, paths.runtime);
    replaced = true;
    await atomicWrite(paths.config, JSON.stringify(config, null, 2));
    await rm(paths.plist, { force: true });
    const log = await open(paths.log, "a", 0o600);
    await log.close();
    await chmod(paths.log, 0o600);
    await startService(paths);
  } catch (error) {
    await stopService(paths);
    if (replaced) await rm(paths.runtime, { recursive: true, force: true });
    if (backedUp) await rename(previous, paths.runtime);
    if (old) {
      await atomicWrite(paths.config, JSON.stringify(old, null, 2));
      if (oldPlist) await atomicWrite(paths.plist, oldPlist);
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
  await stopService(paths);
  await rm(paths.plist, { force: true });
  await rm(paths.config, { force: true });
  await rm(join(paths.home, "service.json"), { force: true });
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
    ready: true,
    source,
  };
}
