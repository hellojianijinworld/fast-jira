import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { access, mkdir, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import { isRecord, record } from "../domain/validation.ts";

export type CodexMessage = Record<string, unknown>;
export interface CodexClient {
  request(method: string, params: unknown): Promise<unknown>;
  respond(id: string | number, result: unknown): void;
  listen(listener: (message: CodexMessage) => void): () => void;
  close(): void;
}
export async function findCodex(): Promise<string> {
  const binary = process.platform === "win32" ? "codex.exe" : "codex";
  const candidates = [
    ...(process.env.FAST_JIRA_CODEX_BIN
      ? [process.env.FAST_JIRA_CODEX_BIN]
      : []),
    ...[...new Set((process.env.PATH ?? "").split(delimiter))].map((path) =>
      join(path, binary),
    ),
    join(homedir(), ".local/bin", binary),
    "/Applications/Codex.app/Contents/Resources/codex",
  ];
  for (const path of candidates) {
    try {
      await access(path);
      if ((await stat(path)).isFile()) return path;
    } catch {
      /* 다음 설치 위치를 확인한다. */
    }
  }
  throw new Error("Codex CLI를 설치하고 codex login으로 로그인해 주세요.");
}
/** stdio 프로토콜만 담당한다. Jira·화면 상태는 이 연결에 넣지 않는다. */
export async function startCodex(
  launch?: () => ChildProcessWithoutNullStreams,
  options: { binary?: string; chatgpt?: boolean } = {},
): Promise<CodexClient> {
  const cwd = join(tmpdir(), "fast-jira-agent");
  await mkdir(cwd, { recursive: true });
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith("JIRA_")) delete env[key];
  if (options.chatgpt) {
    delete env.OPENAI_API_KEY;
    delete env.CODEX_API_KEY;
  }
  const child = launch
    ? launch()
    : spawn(
        options.binary ?? (await findCodex()),
        [
          "--disable",
          "shell_tool",
          "--disable",
          "apps",
          "-c",
          'web_search="disabled"',
          ...(options.chatgpt ? ["-c", 'forced_login_method="chatgpt"'] : []),
          "app-server",
          "--stdio",
        ],
        { cwd, env, stdio: "pipe" },
      );
  child.stderr.resume();
  const listeners = new Set<(message: CodexMessage) => void>();
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let nextId = 0,
    closed = false;
  const lines = createInterface({ input: child.stdout });
  function stop(reason: string) {
    if (closed) return;
    closed = true;
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error(reason));
    }
    pending.clear();
    lines.close();
    child.kill();
    for (const listener of listeners)
      listener({ method: "connection/closed", params: { message: reason } });
    listeners.clear();
  }
  child.on("error", () =>
    stop(
      "Codex 프로세스를 시작하지 못했어요. CLI 설치와 로그인을 확인해 주세요.",
    ),
  );
  child.on("exit", () => stop("Codex 연결이 종료됐어요. 다시 요청해 주세요."));
  const send = (message: unknown) => {
    if (closed) throw new Error("Codex 연결이 종료됐어요.");
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  child.stdin.on("error", () => stop("Codex에 요청을 전달하지 못했어요."));
  lines.on("line", (line) => {
    let message: CodexMessage;
    try {
      message = record(JSON.parse(line));
    } catch {
      stop("Codex 응답 형식이 올바르지 않습니다.");
      return;
    }
    if (typeof message.id === "number" && !message.method) {
      const item = pending.get(message.id);
      if (!item) return;
      clearTimeout(item.timer);
      pending.delete(message.id);
      if (message.error)
        item.reject(
          new Error(
            isRecord(message.error) && typeof message.error.message === "string"
              ? message.error.message
              : "Codex 요청 실패",
          ),
        );
      else item.resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });
  const client: CodexClient = {
    request(method, params) {
      if (closed) return Promise.reject(new Error("Codex 연결이 종료됐어요."));
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("Codex 응답 시간이 초과됐어요."));
        }, 20000);
        pending.set(id, { resolve, reject, timer });
        try {
          send({ id, method, params });
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      });
    },
    respond(id, result) {
      send({ id, result });
    },
    listen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      stop("Codex 연결을 종료했습니다.");
    },
  };
  try {
    await client.request("initialize", {
      clientInfo: { name: "fast_jira", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    send({ method: "initialized", params: {} });
  } catch (error) {
    client.close();
    throw error;
  }
  // 모델이 요청한 파일·셸·다른 앱 권한을 웹 UI의 Jira 권한으로 오인하지 않는다.
  client.listen((message) => {
    if (
      message.id !== undefined &&
      typeof message.method === "string" &&
      message.method !== "item/tool/call"
    ) {
      if (typeof message.id === "number" || typeof message.id === "string") {
        try {
          send({
            id: message.id,
            error: {
              code: -32601,
              message:
                "Fast Jira only supports its registered Jira tools; other tool and approval requests are unavailable.",
            },
          });
        } catch {
          /* 연결 종료 시 응답은 생략한다. */
        }
      }
    }
  });
  return client;
}

/** 비활성 MCP에도 유효한 transport가 필요하다. 세션 설정에만 적용한다. */
export async function codexToolIsolation(native: CodexClient) {
  const servers: Record<string, { enabled: false; command: string }> = {};
  let cursor: string | null = null;
  do {
    const page = record(
      await native.request("mcpServerStatus/list", {
        cursor,
        limit: 100,
        detail: "toolsAndAuthOnly",
      }),
    );
    if (Array.isArray(page.data))
      for (const item of page.data) {
        if (isRecord(item) && typeof item.name === "string")
          Object.defineProperty(servers, item.name, {
            value: { enabled: false, command: process.execPath },
            enumerable: true,
          });
      }
    cursor = typeof page.nextCursor === "string" ? page.nextCursor : null;
  } while (cursor);
  return { mcp_servers: servers };
}
