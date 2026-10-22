export interface ConnectionSettings {
  site: string;
  email: string;
  tokenConfigured?: boolean;
}
export interface Credentials extends ConnectionSettings {
  token: string;
}
