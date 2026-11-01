import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { InstallationPlatform } from "../domain/installation.ts";

export async function platformCommand(
  platform: InstallationPlatform,
  env: NodeJS.ProcessEnv = process.env,
  os = process.platform,
): Promise<{ command: string; prefix: string[] } | null> {
  const explicit =
    env[platform === "codex" ? "FAST_JIRA_CODEX_BIN" : "FAST_JIRA_CLAUDE_BIN"];
  const dirs = [
    ...new Set(
      (env.PATH ?? "").split(os === "win32" ? ";" : ":").filter(Boolean),
    ),
  ];
  const binary = platform + (os === "win32" ? ".exe" : "");
  const candidates = explicit
    ? [explicit]
    : [
        ...dirs.map((dir) => join(dir, binary)),
        join(env.HOME ?? homedir(), ".local/bin", binary),
        ...(os === "darwin" && platform === "codex"
          ? ["/Applications/Codex.app/Contents/Resources/codex"]
          : []),
        ...(os === "win32"
          ? dirs.map((dir) =>
              join(
                dir,
                "node_modules",
                platform === "codex"
                  ? "@openai/codex/bin/codex.js"
                  : "@anthropic-ai/claude-code/cli.js",
              ),
            )
          : []),
      ];
  for (const path of candidates) {
    if (!isAbsolute(path) || !(await stat(path).catch(() => null))?.isFile())
      continue;
    // npm의 확장자 없는 symlink도 전역 Node 없이 공식 JS 진입점으로 실행한다.
    const resolved = await realpath(path).catch(() => null);
    if (!resolved) continue;
    return /\.(mjs|cjs|js)$/.test(resolved)
      ? { command: process.execPath, prefix: [resolved] }
      : { command: resolved, prefix: [] };
  }
  return null;
}
