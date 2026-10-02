export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("응답 객체 형식이 올바르지 않습니다.");
  return value;
}
export function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value)
    throw new Error(`${name} 값이 올바르지 않습니다.`);
  return value;
}
export function normalizeSite(value: string): string {
  return value.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
export function parseIssueKey(input: unknown, site: string): string {
  let value = requiredString(input, "이슈 키 또는 URL").trim();
  if (value.includes("://")) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("이슈 URL이 올바르지 않습니다.");
    }
    if (url.protocol !== "https:" || url.hostname !== site)
      throw new Error("설정한 Jira 사이트의 URL을 입력하세요.");
    value = url.pathname.match(/^\/browse\/([^/]+)$/)?.[1] ?? "";
  }
  value = value.toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(value))
    throw new Error("이슈 키 또는 Jira 이슈 URL을 입력하세요.");
  return value;
}
