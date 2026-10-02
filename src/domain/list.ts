import type { ChildPage, ChildSettings, Issue } from "./issue.ts";
import { sortRules } from "./sort.ts";

export function passesChild(
  issue: Issue,
  settings: ChildSettings,
  accountId: string,
): boolean {
  return (
    (!settings.projects.length || settings.projects.includes(issue.project)) &&
    (!settings.excludeDone || issue.statusCategory !== "done") &&
    (settings.statuses === null ||
      settings.statuses.includes(issue.statusId)) &&
    (settings.people === "all" ||
      !issue.assigneeId ||
      issue.assigneeId === accountId) &&
    (settings.assignees === null ||
      settings.assignees.includes(issue.assigneeId || "unassigned"))
  );
}
export function compareIssues(
  a: Issue,
  b: Issue,
  sort: string,
  statuses: ReadonlyMap<string, number>,
  priorities: ReadonlyMap<string, number> = new Map(),
): number {
  for (const rule of sortRules(sort)) {
    let difference = 0;
    if (rule.startsWith("due")) {
      // 역순에서도 마감일 없는 항목은 마지막이다. 방향만 뒤집으면 앞에 오므로 별도 처리한다.
      if (Boolean(a.dueDate) !== Boolean(b.dueDate)) return a.dueDate ? -1 : 1;
      difference = (Date.parse(a.dueDate) || 0) - (Date.parse(b.dueDate) || 0);
      if (rule === "due-desc") difference = -difference;
    } else if (rule.startsWith("status")) {
      difference =
        (statuses.get(a.statusId) ?? Number.MAX_SAFE_INTEGER) -
        (statuses.get(b.statusId) ?? Number.MAX_SAFE_INTEGER);
      if (rule === "status-desc") difference = -difference;
    } else if (rule.startsWith("priority")) {
      const left = priorities.get(a.priorityId),
        right = priorities.get(b.priorityId);
      if ((left === undefined) !== (right === undefined))
        return left === undefined ? 1 : -1;
      difference = (left ?? 0) - (right ?? 0);
      if (rule === "priority-asc") difference = -difference;
    } else {
      difference = (Date.parse(b.updated) || 0) - (Date.parse(a.updated) || 0);
      if (rule === "oldest") difference = -difference;
    }
    if (difference) return difference;
  }
  return (
    (Date.parse(b.updated) || 0) - (Date.parse(a.updated) || 0) ||
    a.key.localeCompare(b.key, undefined, { numeric: true })
  );
}
export interface ListMembership {
  items: Map<string, Issue>;
  direct: Set<string>;
  matched: Set<string>;
  pages: ReadonlyMap<string, ChildPage>;
}
export function setMembership(
  issue: Issue,
  matches: boolean,
  state: ListMembership,
  childPasses: (issue: Issue) => boolean,
): void {
  const { items, direct, matched, pages } = state;
  if (matches) direct.add(issue.key);
  else direct.delete(issue.key);
  const parentVisible =
    issue.parent &&
    (items.has(issue.parent) ||
      [...pages.values()].some((page) => page.issues.has(issue.parent)));
  if (matches || (parentVisible && childPasses(issue))) {
    matched.add(issue.key);
    items.set(issue.key, issue);
  } else {
    matched.delete(issue.key);
    // 자신이 필터에서 제외되어도 일치하는 하위가 있다면 연결용 부모는 남긴다.
    const children = [
      ...items.values(),
      ...[...pages.values()].flatMap((page) => [...page.issues.values()]),
    ].filter((child) => child.parent === issue.key && childPasses(child));
    for (const child of children) matched.add(child.key);
    if (children.length) items.set(issue.key, issue);
    else items.delete(issue.key);
  }
}
