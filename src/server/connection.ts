import type { ConnectionSettings, Credentials } from "../domain/connection.ts";
import type { LogEntry } from "../domain/log.ts";
import { record } from "../domain/validation.ts";
import { saveCredentials } from "./environment.ts";
import { credentialsFromEnv, JiraError } from "./jira-client.ts";
import { createJiraService } from "./jira-service.ts";

export function createConnection(options: {
  credentials: Credentials | null;
  defaults: ConnectionSettings;
  fetcher?: typeof fetch;
  relatedFieldNames?: readonly string[];
  onLog?: (entry: LogEntry) => void;
  loggingEnabled?: () => boolean;
  persist?: (credentials: Credentials) => Promise<void>;
}) {
  const create = (credentials: Credentials) =>
    createJiraService({ ...options, credentials });
  let credentials = options.credentials;
  let service = credentials ? create(credentials) : null;
  let saving = false;
  return {
    settings: (): ConnectionSettings => ({
      site: credentials?.site ?? options.defaults.site,
      email: credentials?.email ?? options.defaults.email,
      tokenConfigured: Boolean(credentials?.token),
    }),
    service() {
      if (!service)
        throw new JiraError(
          "설정에서 Jira 사이트·이메일·API 토큰을 입력하세요.",
          401,
        );
      return service;
    },
    async save(input: unknown) {
      if (saving)
        throw new JiraError(
          "연결 정보를 확인하고 있어요. 잠시 후 다시 시도하세요.",
          409,
        );
      saving = true;
      try {
        const data = record(input);
        for (const name of ["site", "email", "token"]) {
          if (typeof data[name] !== "string" || /[\r\n\0]/.test(data[name]))
            throw new JiraError(
              "사이트·이메일·토큰을 한 줄로 입력하세요.",
              400,
            );
        }
        let next: Credentials;
        try {
          next = credentialsFromEnv({
            JIRA_SITE: String(data.site),
            JIRA_EMAIL: String(data.email),
            JIRA_API_TOKEN: String(data.token),
          });
        } catch {
          throw new JiraError(
            "올바른 Jira 사이트·이메일·API 토큰을 입력하세요.",
            400,
          );
        }
        const candidate = create(next);
        await candidate.authenticate();
        await (options.persist ?? saveCredentials)(next);
        credentials = next;
        service = candidate;
        return { site: next.site, email: next.email };
      } finally {
        saving = false;
      }
    },
  };
}
export type Connection = ReturnType<typeof createConnection>;
