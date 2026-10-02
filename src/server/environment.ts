import { existsSync } from "node:fs";
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
