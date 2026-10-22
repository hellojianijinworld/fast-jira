import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import type { Credentials } from "../domain/connection.ts";
import { credentialsFromEnv } from "./jira-client.ts";
export function loadEnvironment() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  return credentialsFromEnv(process.env);
}
export function serverPort(): number {
  const port = Number(process.env.PORT ?? 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT는 1~65535 사이의 정수로 설정하세요.");
  return port;
}

/** 다른 설정을 보존하고 인증 값만 권한 0600 파일로 원자적으로 교체한다. */
export async function saveCredentials(credentials: Credentials, path = ".env") {
  let contents = await readFile(path, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return "";
    throw error;
  });
  for (const [key, value] of Object.entries({
    JIRA_SITE: credentials.site,
    JIRA_EMAIL: credentials.email,
    JIRA_API_TOKEN: credentials.token,
  })) {
    const line = `${key}=${JSON.stringify(value)}`;
    const pattern = new RegExp(`^(?:export\\s+)?${key}\\s*=.*$`, "gm");
    contents = pattern.test(contents)
      ? contents.replace(pattern, () => line)
      : `${contents}${contents && !contents.endsWith("\n") ? "\n" : ""}${line}\n`;
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
