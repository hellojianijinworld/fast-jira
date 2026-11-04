export interface ConnectionSettings {
  site: string;
  email: string;
  tokenConfigured?: boolean;
}
export interface Credentials extends ConnectionSettings {
  token: string;
}

/** 저장된 토큰은 이 프로세스에서 확인하기 전까지 연결 성공으로 간주하지 않는다. */
export type ConnectionState =
  | "waiting"
  | "unverified"
  | "checking"
  | "connected"
  | "failed";

export const JIRA_CLOUD_SUFFIX = ".atlassian.net";
export const JIRA_SITE_NAME_PATTERN =
  "[a-zA-Z0-9](?:[a-zA-Z0-9\\-]{0,61}[a-zA-Z0-9])?";

/** 저장된 호스트나 사이트 URL에서 편집할 사이트 이름만 추출한다. */
export function jiraSiteName(value: string): string {
  const input = value.trim().toLowerCase();
  const full =
    /^(?:https?:\/\/)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.atlassian\.net(?:[/?#].*)?$/.exec(
      input,
    );
  return full?.[1] ?? input;
}
