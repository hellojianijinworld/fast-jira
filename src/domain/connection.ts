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
