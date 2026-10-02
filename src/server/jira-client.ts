import {
  isRecord,
  normalizeSite,
  requiredString,
} from "../domain/validation.ts";

export class JiraError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "JiraError";
  }
}
export interface Credentials {
  site: string;
  email: string;
  token: string;
}
export interface JiraClient {
  request(path: string, options?: RequestInit): Promise<Response>;
  json<T>(path: string, decode: (value: unknown) => T): Promise<T>;
}

export async function ensureJiraResponse(
  response: Response,
): Promise<Response> {
  if (response.ok) return response;
  const value: unknown = await response.json().catch(() => null);
  const data = isRecord(value) ? value : {};
  const messages = Array.isArray(data.errorMessages)
    ? data.errorMessages.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const fields = isRecord(data.errors)
    ? Object.values(data.errors).filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const detail = [...messages, ...fields].join(" ");
  throw new JiraError(
    `Jira 요청에 실패했습니다. (${response.status})${detail ? `: ${detail}` : ""}`,
    response.status,
  );
}
export function credentialsFromEnv(env: NodeJS.ProcessEnv): Credentials {
  const site = normalizeSite(requiredString(env.JIRA_SITE, "JIRA_SITE"));
  if (!/^[a-z0-9-]+\.atlassian\.net$/.test(site))
    throw new Error("JIRA_SITE를 example.atlassian.net 형식으로 설정하세요.");
  return {
    site,
    email: requiredString(env.JIRA_EMAIL, "JIRA_EMAIL"),
    token: requiredString(env.JIRA_API_TOKEN, "JIRA_API_TOKEN"),
  };
}
export function createJiraClient(
  credentials: Credentials,
  fetcher: typeof fetch = fetch,
): JiraClient {
  const { site, email, token } = credentials;
  if (!/^[a-z0-9-]+\.atlassian\.net$/.test(site) || !email || !token)
    throw new Error("Jira 사이트·이메일·토큰을 설정하세요.");
  const authorization = `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
  const request = (
    path: string,
    options: RequestInit = {},
  ): Promise<Response> => {
    // 경로를 외부 주소로 바꿔 토큰이 다른 서버로 전달되는 것을 막는다.
    if (!path.startsWith("/") || path.startsWith("//"))
      throw new Error("Jira 요청 경로가 올바르지 않습니다.");
    const headers = new Headers(options.headers);
    headers.set("Authorization", authorization);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    // Jira 리다이렉트 대상에 인증정보를 넘기는 정책은 별도 이미지 경로에서 명시적으로 다룬다.
    return fetcher(`https://${site}${path}`, {
      ...options,
      headers,
      redirect: "error",
      signal: options.signal ?? AbortSignal.timeout(30000),
    });
  };
  return {
    request,
    async json(path, decode) {
      const response = await ensureJiraResponse(await request(path));
      const value: unknown = await response.json();
      return decode(value);
    },
  };
}
