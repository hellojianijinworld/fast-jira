import type {
  ConnectionSettings,
  ConnectionState,
  Credentials,
} from "../domain/connection.ts";
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
  let state: ConnectionState = credentials ? "unverified" : "waiting";
  return {
    status: () => ({ state }),
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
      state = "checking";
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
        const candidate = createJiraService({
          ...options,
          credentials: next,
          // 인증 응답과 오류는 개발자 로그에도 노출하지 않는다.
          loggingEnabled: () => !saving && (options.loggingEnabled?.() ?? true),
        });
        try {
          await candidate.authenticate();
        } catch (error) {
          if (error instanceof JiraError && error.status === 401)
            throw new JiraError(
              "이메일과 API 토큰을 확인해 주세요. 만료된 토큰은 다시 발급해 주세요.",
              401,
            );
          if (error instanceof JiraError && error.status === 403)
            throw new JiraError(
              "Jira 접근 권한이나 조직의 토큰 정책을 확인해 주세요.",
              403,
            );
          throw new JiraError(
            "Jira에 연결하지 못했어요. 사이트 주소와 네트워크를 확인해 주세요.",
            502,
          );
        }
        try {
          await (options.persist ?? saveCredentials)(next);
        } catch {
          throw new JiraError(
            "연결 정보를 이 컴퓨터에 저장하지 못했어요. 다시 시도해 주세요.",
            500,
          );
        }
        credentials = next;
        service = candidate;
        state = "connected";
        return { site: next.site, email: next.email };
      } catch (error) {
        state = "failed";
        throw error;
      } finally {
        saving = false;
      }
    },
  };
}
export type Connection = ReturnType<typeof createConnection>;
