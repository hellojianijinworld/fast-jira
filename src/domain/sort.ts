export const sortChoices = {
  recent: { field: "updated", label: "수정일 · 최신순", jql: "updated DESC" },
  oldest: { field: "updated", label: "수정일 · 오래된순", jql: "updated ASC" },
  due: { field: "duedate", label: "마감일 · 빠른순", jql: "duedate ASC" },
  "due-desc": {
    field: "duedate",
    label: "마감일 · 늦은순",
    jql: "duedate DESC",
  },
  status: { field: "status", label: "상태 · Jira 순서", jql: "status ASC" },
  "status-desc": {
    field: "status",
    label: "상태 · Jira 역순",
    jql: "status DESC",
  },
  priority: {
    field: "priority",
    label: "우선순위 · 높은순",
    jql: "priority DESC",
  },
  "priority-asc": {
    field: "priority",
    label: "우선순위 · 낮은순",
    jql: "priority ASC",
  },
} as const;
export type SortRule = keyof typeof sortChoices;
const isSortRule = (rule: string): rule is SortRule =>
  Object.hasOwn(sortChoices, rule);

export function sortRules(value: unknown): [SortRule, ...SortRule[]] {
  if (typeof value !== "string")
    throw new Error("정렬 조건이 올바르지 않습니다.");
  const rules = value.split(",");
  if (
    rules.length > 3 ||
    !rules.every(isSortRule) ||
    new Set(rules.map((rule) => sortChoices[rule].field)).size !== rules.length
  )
    throw new Error("정렬 조건이 올바르지 않습니다.");
  const [first, ...rest] = rules;
  if (first === undefined) throw new Error("정렬 기준을 선택하세요.");
  return [first, ...rest];
}
export function validSort(value: unknown): value is string {
  try {
    sortRules(value);
    return true;
  } catch {
    return false;
  }
}
export function sortLabel(value: string): string {
  return value === "inherit"
    ? "글로벌 필터 적용"
    : sortRules(value)
        .map((rule) => sortChoices[rule].label)
        .join(" → ");
}
export function orderStatusNames(
  names: readonly string[],
  catalog: readonly string[],
): string[] {
  const positions = new Map(catalog.map((name, index) => [name, index]));
  return [...new Set(names)].sort(
    (a, b) => (positions.get(a) ?? Infinity) - (positions.get(b) ?? Infinity),
  );
}
export function sortOrder(value: unknown): string {
  const rules = sortRules(value);
  // 커서 페이지 간에도 같은 순서를 보장하도록 마지막 기준에 키를 추가한다.
  return [
    ...rules.map((rule) => sortChoices[rule].jql),
    ...(rules.some((rule) => sortChoices[rule].field === "updated")
      ? []
      : ["updated DESC"]),
    "key ASC",
  ].join(", ");
}
