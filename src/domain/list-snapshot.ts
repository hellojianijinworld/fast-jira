import type { Filters } from "./filters.ts";
import type { Issue } from "./issue.ts";
import { isRecord, record } from "./validation.ts";
import { decodeIssue, wireArray, wireBoolean, wireString } from "./wire.ts";

export interface CachedPage {
  parent: string;
  issues: Issue[];
  complete: boolean;
}
export interface ListSnapshot {
  checkedAt?: string;
  reconciledAt?: string;
  items: Issue[];
  matched: string[];
  direct: string[];
  complete: boolean;
  pages: [string, CachedPage][];
}
/** 체크 순서는 무관하지만 여러 정렬 조건의 우선순위는 보존한다. */
export function listCacheKey(filters: Filters): string {
  return JSON.stringify({
    projects: [...filters.projects].sort(),
    scope: filters.scope,
    excludeDone: filters.excludeDone,
    sort: filters.sort,
    q: filters.q,
    statuses: filters.statuses && [...filters.statuses].sort(),
    assignees: filters.assignees && [...filters.assignees].sort(),
  });
}
export function decodeListSnapshot(value: unknown): ListSnapshot {
  const data = record(value);
  const issues = (value: unknown) => wireArray(value, decodeIssue);
  const keys = (value: unknown) => wireArray(value, wireString);
  const time = (value: unknown) =>
    typeof value === "string" && Number.isFinite(Date.parse(value))
      ? value
      : undefined;
  const checkedAt = time(data.checkedAt),
    reconciledAt = time(data.reconciledAt);
  return {
    ...(checkedAt ? { checkedAt } : {}),
    ...(reconciledAt ? { reconciledAt } : {}),
    items: issues(data.items),
    matched: keys(data.matched),
    direct: keys(data.direct),
    complete: wireBoolean(data.complete),
    pages: wireArray(data.pages, (value) => {
      if (!Array.isArray(value) || value.length !== 2)
        throw new Error("하위 캐시 형식이 올바르지 않습니다.");
      const page = record(value[1]);
      return [
        wireString(value[0]),
        {
          parent: wireString(page.parent),
          issues: issues(page.issues),
          complete: wireBoolean(page.complete),
        },
      ];
    }),
  };
}

export interface ViewportAnchor {
  key: string;
  offset: number;
}
export function decodeViewportAnchors(value: unknown): ViewportAnchor[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 4)
    .flatMap((item) =>
      isRecord(item) &&
      typeof item.key === "string" &&
      /^[A-Z][A-Z0-9_]*-\d+$/.test(item.key) &&
      typeof item.offset === "number" &&
      Number.isFinite(item.offset) &&
      Math.abs(item.offset) <= 100000
        ? [{ key: item.key, offset: item.offset }]
        : [],
    );
}
