import type {
  BranchDefaults,
  BranchOverrides,
  ChildPage,
  Issue,
  IssueType,
} from "./issue.ts";

export interface CollapseState {
  collapsed?: boolean;
  openedAt?: number;
  resetAt?: number;
}
export function branchState(
  states: ReadonlyMap<string, CollapseState>,
  key: string,
  ancestorReset = 0,
): { collapsed: boolean; childReset: number } {
  const state = states.get(key);
  // 부모를 접으면 관심 범위가 끝난다. 다시 펼쳐도 이전 하위 펼침은 복원하지 않는다.
  return {
    collapsed: Boolean(
      state?.collapsed || ancestorReset > (state?.openedAt ?? 0),
    ),
    childReset: Math.max(ancestorReset, state?.resetAt ?? 0),
  };
}
export function setBranchState(
  states: Map<string, CollapseState>,
  key: string,
  collapsed: boolean,
  version: number,
): void {
  const state = states.get(key) ?? {};
  states.set(
    key,
    collapsed
      ? { ...state, collapsed: true, resetAt: version }
      : { ...state, collapsed: false, openedAt: version },
  );
}
export function resolveBranchSettings(
  setting: BranchOverrides | undefined,
  defaults: BranchDefaults,
): BranchDefaults {
  // null은 전체 선택, []는 선택 없음, inherit/미지정은 글로벌 필터 사용이다.
  return {
    sort:
      setting?.sort && setting.sort !== "inherit"
        ? setting.sort
        : defaults.sort,
    people:
      setting?.people && setting.people !== "inherit"
        ? setting.people
        : defaults.people,
    excludeDone:
      setting?.done && setting.done !== "inherit"
        ? setting.done === "exclude"
        : defaults.excludeDone,
    statuses:
      setting?.statuses !== undefined && setting.statuses !== "inherit"
        ? setting.statuses
        : defaults.statuses,
    assignees:
      setting?.assignees !== undefined && setting.assignees !== "inherit"
        ? setting.assignees
        : defaults.assignees,
  };
}
export function updateListedIssue(
  items: Map<string, Issue>,
  pages: ReadonlyMap<string, ChildPage>,
  key: string,
  changes: Partial<Issue>,
): void {
  const issue = items.get(key);
  if (issue) Object.assign(issue, changes);
  for (const page of pages.values()) {
    const child = page.issues.get(key);
    if (child) Object.assign(child, changes);
  }
}
export function hierarchyDepth(
  issue: Pick<Issue, "project" | "issueTypeId" | "hierarchyLevel">,
  types: readonly IssueType[],
  fallback = 0,
): number {
  const projectTypes = types.filter(
    (type) => type.project === issue.project && type.hierarchyLevel !== null,
  );
  const level =
    issue.hierarchyLevel ??
    projectTypes.find((type) => type.id === issue.issueTypeId)?.hierarchyLevel;
  if (level == null || !projectTypes.length) return fallback;
  // 이슈 이름(에픽/스토리)을 하드코딩하지 않고 프로젝트의 실제 계층 값을 사용한다.
  return Math.max(
    0,
    Math.max(...projectTypes.map((type) => type.hierarchyLevel ?? 0)) - level,
  );
}

export function groupIssues(
  items: ReadonlyMap<string, Issue>,
): Map<string, Issue[]> {
  const groups = new Map<string, Issue[]>();
  for (const issue of items.values()) {
    const parent =
      issue.parent && issue.parent !== issue.key && items.has(issue.parent)
        ? issue.parent
        : "";
    const group = groups.get(parent) ?? [];
    group.push(issue);
    groups.set(parent, group);
  }
  return groups;
}
export function searchAncestors(
  items: ReadonlyMap<string, Issue>,
  matches: ReadonlySet<string>,
): Set<string> {
  const ancestors = new Set<string>();
  for (const key of matches) {
    let parent = items.get(key)?.parent;
    while (parent && items.has(parent) && !ancestors.has(parent)) {
      ancestors.add(parent);
      parent = items.get(parent)?.parent;
    }
  }
  return ancestors;
}
