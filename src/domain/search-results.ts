import type { PriorityOption, StatusOption } from "./catalog.ts";
import type { Filters } from "./filters.ts";
import type { Issue } from "./issue.ts";
import { compareIssues, passesChild } from "./list.ts";
import { localSearch } from "./local-search.ts";

export const searchSortChoices = {
  recommended: "추천순",
  recent: "최근 수정순",
  oldest: "오래된 수정순",
  due: "마감일 빠른순",
  priority: "우선순위 높은순",
} as const;
export type SearchSort = keyof typeof searchSortChoices;
export function defaultSearchFilters(): Filters {
  return {
    projects: [],
    scope: "all",
    excludeDone: false,
    sort: "recent",
    statuses: null,
    assignees: null,
    q: "",
  };
}
export function matchesSearchFilters(
  issue: Issue,
  filters: Filters,
  me: string,
) {
  return passesChild(issue, { ...filters, people: filters.scope }, me);
}
/** 후보 수를 제한하기 전에 같은 조건을 적용한다. 서버 결과와 동일한 필드·정렬 규칙을 쓴다. */
export function searchLocalIssues(
  issues: readonly Issue[],
  query: string,
  filters: Filters,
  sort: SearchSort,
  me: string,
  favorite: (issue: Issue) => boolean,
  recent: readonly Issue[],
  statuses: readonly StatusOption[],
  priorities: readonly PriorityOption[],
): Issue[] {
  const candidates = issues.filter((issue) =>
    matchesSearchFilters(issue, filters, me),
  );
  const matches = query
    ? localSearch(candidates, query, [], favorite, recent, Infinity)
    : [...new Map(candidates.map((issue) => [issue.key, issue])).values()];
  if (sort !== "recommended" || !query) {
    const statusOrder = new Map(
      statuses.map((status, index) => [status.id, index]),
    );
    const priorityOrder = new Map(
      priorities.map((priority, index) => [priority.id, index]),
    );
    matches.sort((a, b) =>
      compareIssues(
        a,
        b,
        sort === "recommended" ? "recent" : sort,
        statusOrder,
        priorityOrder,
      ),
    );
  }
  return matches.slice(0, sort === "recommended" ? 8 : 20);
}
