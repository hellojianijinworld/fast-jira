import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { access, mkdir, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export interface ClaudeCommand {
  args: string[];
  input?: string;
  signal?: AbortSignal;
}
export function claudeEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (
      key.startsWith("JIRA_") ||
      [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_BASE_URL",
        "CLAUDECODE",
      ].includes(key)
    )
      delete env[key];
  return env;
}
async function findClaude() {
  const binary = process.platform === "win32" ? "claude.exe" : "claude";
  const paths = [
    ...(process.env.FAST_JIRA_CLAUDE_BIN
      ? [process.env.FAST_JIRA_CLAUDE_BIN]
      : []),
    ...[...new Set((process.env.PATH ?? "").split(delimiter))].map((path) =>
      join(path, binary),
    ),
    join(homedir(), ".local/bin", binary),
  ];
  for (const path of paths) {
    try {
      await access(path);
      if ((await stat(path)).isFile()) return path;
    } catch {
      /* 다음 설치 위치 확인 */
    }
  }
  throw new Error(
    "Claude Code를 설치하고 claude auth login으로 로그인해 주세요.",
  );
}
/** 키는 CLI가 직접 관리한다. Jira 인증값과 API 키를 자식 프로세스에 전달하지 않는다. */
export async function runClaudeCommand(
  command: ClaudeCommand,
  launch?: () => ChildProcessWithoutNullStreams,
): Promise<unknown> {
  if (command.signal?.aborted) throw new Error("AI 요청을 취소했어요.");
  const cwd = join(tmpdir(), "fast-jira-claude");
  await mkdir(cwd, { recursive: true });
  const binary = launch ? "" : await findClaude();
  if (command.signal?.aborted) throw new Error("AI 요청을 취소했어요.");
  return new Promise((resolve, reject) => {
    const child = launch
      ? launch()
      : spawn(binary, command.args, {
          cwd,
          env: claudeEnvironment(),
          stdio: "pipe",
        });
    let output = "",
      ended = false;
    let failure: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      command.signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else {
        try {
          resolve(JSON.parse(output));
        } catch {
          reject(new Error("Claude 응답 형식이 올바르지 않습니다."));
        }
      }
    };
    const stop = (error: Error) => {
      if (ended || failure) return;
      failure = error;
      clearTimeout(timer);
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 250);
    };
    const abort = () => stop(new Error("AI 요청을 취소했어요."));
    const timer = setTimeout(
      () => stop(new Error("Claude 응답 시간이 초과됐어요.")),
      command.args[0] === "auth" ? 15_000 : 600_000,
    );
    child.stderr.resume();
    child.on("error", () =>
      stop(
        new Error(
          "Claude Code를 실행하지 못했어요. 설치와 로그인을 확인해 주세요.",
        ),
      ),
    );
    child.stdin.on("error", () =>
      stop(new Error("Claude에 요청을 전달하지 못했어요.")),
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (text: string) => {
      if (failure) return;
      output += text;
      if (output.length > 2_000_000)
        stop(new Error("Claude 응답이 너무 큽니다. 요청 범위를 줄여 주세요."));
    });
    child.on("close", (code) => {
      if (failure) {
        finish(failure);
        return;
      }
      if (code !== 0 && !output.trim())
        finish(
          new Error(
            "Claude 요청에 실패했어요. claude auth login으로 로그인 상태를 확인해 주세요.",
          ),
        );
      else finish();
    });
    command.signal?.addEventListener("abort", abort, { once: true });
    if (command.signal?.aborted) {
      abort();
      return;
    }
    child.stdin.end(command.input ?? "");
  });
}
