import type { StatusOption } from "./catalog.ts";
import type { BranchDefaults, SelectionFilter } from "./issue.ts";

export interface Filters {
  projects: string[];
  scope: "all" | "assigned" | "related";
  excludeDone: boolean;
  sort: string;
  statuses: SelectionFilter;
  assignees: SelectionFilter;
  q: string;
}
export function selectionParameter(value: SelectionFilter): string {
  return value === null ? "" : value.join(",") || "none";
}
export function filterParameters(filters: Filters): URLSearchParams {
  return new URLSearchParams({
    q: filters.q,
    projects: filters.projects.join(","),
    scope: filters.scope,
    excludeDone: String(filters.excludeDone),
    sort: filters.sort,
    statuses: selectionParameter(filters.statuses),
    assignees: selectionParameter(filters.assignees),
  });
}
export function branchDefaults(filters: Filters): BranchDefaults {
  return {
    sort: filters.sort,
    people:
      filters.assignees !== null || filters.scope === "all" ? "all" : "mine",
    excludeDone: filters.excludeDone,
    statuses: filters.statuses,
    assignees: filters.assignees,
  };
}
export function cloneFilters(filters: Filters): Filters {
  return {
    ...filters,
    projects: [...filters.projects],
    statuses: filters.statuses === null ? null : [...filters.statuses],
    assignees: filters.assignees === null ? null : [...filters.assignees],
  };
}

/** 이전 완료 제외 옵션을 체크박스 선택으로 옮긴다. 명시적으로 선택한 비완료 단계는 보존한다. */
export function withoutDone(
  selected: SelectionFilter,
  statuses: readonly StatusOption[],
): string[] {
  const done = new Set(
    statuses
      .filter((status) => status.category === "done")
      .map((status) => status.id),
  );
  return (selected ?? statuses.map((status) => status.id)).filter(
    (id) => !done.has(id),
  );
}
