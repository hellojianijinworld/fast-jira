import type {
  CurrentUser,
  PriorityOption,
  StatusOption,
} from "../domain/catalog.ts";
import type { Issue, IssueType, UserOption } from "../domain/issue.ts";
import { record, requiredString } from "../domain/validation.ts";
import { createPromiseCache } from "./cache.ts";
import { type JiraClient, JiraError } from "./jira-client.ts";
import {
  arrayValue,
  decodeCurrentUser,
  decodeIssueType,
  decodePage,
  decodePriority,
  decodeProject,
  decodeUsers,
  numberValue,
  optionalRecord,
  stringValue,
} from "./jira-decode.ts";

export function projectKeys(value: string): string[] {
  const keys = value ? value.split(",") : [];
  if (keys.length > 50 || keys.some((key) => !/^[A-Z][A-Z0-9_]*$/.test(key)))
    throw new JiraError("프로젝트 키가 올바르지 않습니다.", 400);
  return [...new Set(keys)];
}
export function createJiraMetadata(
  client: JiraClient,
  now: () => number = Date.now,
) {
  const cachePriorities = createPromiseCache<PriorityOption[]>(now);
  const cacheAssignees = createPromiseCache<UserOption[]>(now);
  const cacheTypes = createPromiseCache<IssueType[]>(now);
  const cacheDefaults = createPromiseCache<string>(now);
  const cacheStatuses = createPromiseCache<StatusOption[]>(now);
  let selfPromise: Promise<CurrentUser> | undefined;
  function currentUser(): Promise<CurrentUser> {
    selfPromise ??= client
      .json("/rest/api/3/myself", decodeCurrentUser)
      .catch((error) => {
        selfPromise = undefined;
        throw error;
      });
    return selfPromise;
  }
  async function pages<T>(
    path: string,
    field: string,
    decode: (value: unknown) => T,
  ): Promise<T[]> {
    const values: T[] = [];
    let startAt = 0;
    while (true) {
      const page = await client.json(
        `${path}${path.includes("?") ? "&" : "?"}maxResults=100&startAt=${startAt}`,
        (value) => decodePage(value, field, decode),
      );
      values.push(...page.values);
      startAt += page.values.length;
      if (!page.values.length || page.isLast || startAt >= page.total)
        return values;
    }
  }
  async function projects() {
    return (
      await pages("/rest/api/3/project/search", "values", decodeProject)
    ).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }
  function priorities() {
    return cachePriorities("all", () =>
      pages("/rest/api/3/priority/search", "values", decodePriority),
    );
  }
  async function projectTypes(value: string) {
    return (
      await Promise.all(
        projectKeys(value).map((project) =>
          cacheTypes(project, () =>
            pages(
              `/rest/api/3/issue/createmeta/${project}/issuetypes`,
              "issueTypes",
              (value) => decodeIssueType(value, project),
            ),
          ),
        ),
      )
    ).flat();
  }
  async function withDefaultPriorities<T extends Issue>(
    issues: T[],
  ): Promise<T[]> {
    await Promise.all(
      issues.map(async (issue) => {
        issue.defaultPriorityId = "";
        if (!issue.issueTypeId || !issue.priorityId) return;
        issue.defaultPriorityId = await cacheDefaults(
          `${issue.project}:${issue.issueTypeId}`,
          async () => {
            try {
              const fields = await pages(
                `/rest/api/3/issue/createmeta/${encodeURIComponent(issue.project)}/issuetypes/${encodeURIComponent(issue.issueTypeId)}`,
                "fields",
                record,
              );
              const priority = fields.find(
                (field) => field.fieldId === "priority",
              );
              return stringValue(optionalRecord(priority?.defaultValue).id);
            } catch {
              // 생성 메타정보는 선택 기능이다. 조회 실패 시 기본 우선순위를 숨기지 않고 표시한다.
              return "";
            }
          },
        );
      }),
    );
    return issues;
  }
  async function projectAssignees(value: string) {
    const keys = projectKeys(value);
    if (!keys.length) return [];
    const params = new URLSearchParams({
      projectKeys: keys.join(","),
      maxResults: "1000",
    });
    return cacheAssignees([...keys].sort().join(","), async () =>
      (
        await client.json(
          `/rest/api/3/user/assignable/multiProjectSearch?${params}`,
          decodeUsers,
        )
      ).sort((a, b) => a.name.localeCompare(b.name, "ko")),
    );
  }
  function projectStatuses(value: string) {
    const keys = projectKeys(value);
    if (!keys.length) return Promise.resolve<StatusOption[]>([]);
    return cacheStatuses(keys.join(","), async () => {
      const groups = await Promise.all(
        keys.map(async (key) => ({
          key,
          types: await client.json(
            `/rest/api/3/project/${key}/statuses`,
            arrayValue,
          ),
        })),
      );
      const statuses = new Map<string, StatusOption>();
      for (const { key, types } of groups)
        for (const rawType of types)
          for (const rawStatus of arrayValue(record(rawType).statuses)) {
            const status = record(rawStatus);
            const id = requiredString(status.id, "상태 ID");
            let found = statuses.get(id);
            if (!found) {
              found = {
                id,
                name: requiredString(status.name, "상태 이름"),
                category: stringValue(
                  optionalRecord(status.statusCategory).key,
                ),
                projects: [],
              };
              statuses.set(id, found);
            }
            if (!found.projects.includes(key)) found.projects.push(key);
          }
      const order = new Map<string, number>();
      for (const key of keys) {
        try {
          const params = new URLSearchParams({
            projectKeyOrId: key,
            type: "kanban",
            maxResults: "50",
          });
          const boards = await client.json(
            `/rest/agile/1.0/board?${params}`,
            (value) => arrayValue(record(value).values).map(record),
          );
          const board =
            boards.find(
              (board) => optionalRecord(board.location).projectKey === key,
            ) ?? boards[0];
          if (!board) continue;
          const id = numberValue(board.id);
          const columns = await client.json(
            `/rest/agile/1.0/board/${id}/configuration`,
            (value) => arrayValue(record(record(value).columnConfig).columns),
          );
          for (const column of columns)
            for (const status of arrayValue(record(column).statuses)) {
              const id = requiredString(record(status).id, "보드 상태 ID");
              if (!order.has(id)) order.set(id, order.size);
            }
        } catch {
          // 보드 정보는 선택 기능이다. 조회할 수 없으면 실제 Jira 범주 순서로 표시한다.
        }
      }
      const categoryOrder = (category: string) =>
        category === "new" ? 0 : category === "done" ? 2 : 1;
      return [...statuses.values()].sort(
        (a, b) =>
          (order.get(a.id) ?? 10000 + categoryOrder(a.category)) -
          (order.get(b.id) ?? 10000 + categoryOrder(b.category)),
      );
    });
  }
  return {
    currentUser,
    authenticate: currentUser,
    projects,
    priorities,
    projectTypes,
    withDefaultPriorities,
    projectAssignees,
    projectStatuses,
  };
}
