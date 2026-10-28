import { MAX_FILTER_SELECTION } from "../domain/filters.ts";
import type { Issue, PeopleFilter } from "../domain/issue.ts";
import type { ParticipantDefinition } from "../domain/participants.ts";
import { sortOrder, sortRules, validSort } from "../domain/sort.ts";
import { parseIssueKey, record } from "../domain/validation.ts";
import { createPromiseCache } from "./cache.ts";
import { type JiraClient, JiraError } from "./jira-client.ts";
import { arrayValue, decodeIssue, stringValue } from "./jira-decode.ts";
import { type createJiraMetadata, projectKeys } from "./jira-metadata.ts";

export interface BrowseOptions {
  q: string;
  projects: string;
  scope: "all" | "assigned" | "related";
  excludeDone: boolean;
  statuses: string;
  assignees: string;
}
export interface IssuePage {
  issues: Issue[];
  nextPageToken: string | null;
}
export const listFields =
  "summary,status,assignee,updated,duedate,comment,project,parent,issuetype,priority,subtasks";
const invalid = (message: string) => new JiraError(message, 400);
function trackCursor(seen: Set<string>, token: string): void {
  if (seen.has(token))
    throw new JiraError("페이지 커서가 반복되어 조회를 멈췄어요.", 502);
  seen.add(token);
}
export function projectCondition(value: string): string {
  const keys = projectKeys(value);
  return keys.length
    ? `project in (${keys.join(", ")})`
    : "project is not EMPTY";
}
export function statusCondition(value: string): string {
  if (!value) return "";
  if (value === "none") return "project is EMPTY";
  const ids = value.split(",");
  if (
    ids.length > MAX_FILTER_SELECTION ||
    ids.some((id) => !/^\d{1,20}$/.test(id))
  )
    throw invalid("단계 필터가 올바르지 않습니다.");
  return `status in (${ids.join(", ")})`;
}
export function assigneeCondition(
  value: string,
  fields: readonly string[] = ["assignee"],
): string {
  if (!value) return "";
  if (value === "none") return "project is EMPTY";
  const ids = value.split(",");
  if (
    ids.length > MAX_FILTER_SELECTION ||
    ids.some((id) => id !== "unassigned" && !/^[A-Za-z0-9:-]{5,128}$/.test(id))
  )
    throw invalid("담당자 필터가 올바르지 않습니다.");
  const accounts = ids.filter((id) => id !== "unassigned");
  return (
    "(" +
    [
      accounts.length
        ? fields
            .map(
              (field) =>
                `${field} in (${accounts.map((id) => JSON.stringify(id)).join(", ")})`,
            )
            .join(" OR ")
        : "",
      ids.includes("unassigned")
        ? fields.length === 1
          ? `${fields[0]} is EMPTY`
          : `(${fields.map((field) => `${field} is EMPTY`).join(" AND ")})`
        : "",
    ]
      .filter(Boolean)
      .join(" OR ") +
    ")"
  );
}
function decodeIssuePage(
  value: unknown,
  fields: readonly string[],
  definitions: readonly ParticipantDefinition[],
): IssuePage {
  const page = record(value);
  return {
    issues: arrayValue(page.issues).map((issue) =>
      decodeIssue(issue, fields, definitions),
    ),
    nextPageToken: stringValue(page.nextPageToken) || null,
  };
}
export function createJiraQuery(
  client: JiraClient,
  metadata: ReturnType<typeof createJiraMetadata>,
) {
  const fieldCache = createPromiseCache<string[]>();
  function relatedFields(): Promise<string[]> {
    return fieldCache("people-fields", async () =>
      (await metadata.peopleFields())
        .filter((field) => field.searchable)
        .map((field) => field.id),
    );
  }

  async function browseConditions(options: BrowseOptions): Promise<string[]> {
    const { q, projects, scope, excludeDone, statuses, assignees } = options;
    if (q.length > 100) throw invalid("검색어가 너무 깁니다.");
    if (
      !["all", "assigned", "related"].includes(scope) ||
      typeof excludeDone !== "boolean"
    )
      throw invalid("필터가 올바르지 않습니다.");
    const conditions = [projectCondition(projects)];
    const fields =
      scope === "related"
        ? [
            "assignee",
            ...(await relatedFields()).map((id) => `cf[${id.slice(12)}]`),
          ]
        : ["assignee"];
    if (assignees) conditions.push(assigneeCondition(assignees, fields));
    else if (scope !== "all")
      conditions.push(
        `(${fields.map((field) => `${field} = currentUser()`).join(" OR ")})`,
      );
    if (excludeDone) conditions.push("statusCategory != Done");
    if (statuses) conditions.push(statusCondition(statuses));
    if (q) {
      if (/^[A-Z][A-Z0-9_]*-\d+$/i.test(q))
        conditions.push(`key = ${q.toUpperCase()}`);
      else {
        const words = q.match(/[\p{L}\p{N}]+/gu)?.join(" ");
        if (!words) throw invalid("검색어에 글자나 숫자를 입력하세요.");
        conditions.push(`summary ~ "${words}"`);
      }
    }
    return conditions;
  }
  async function search(
    jql: string,
    token = "",
    maxResults = 100,
  ): Promise<IssuePage> {
    const [fields, definitions] = await Promise.all([
      relatedFields(),
      metadata.peopleFields(),
    ]);
    const params = new URLSearchParams({
      jql,
      fields: [listFields, ...definitions.map((field) => field.id)].join(","),
      maxResults: String(maxResults),
    });
    if (token) params.set("nextPageToken", token);
    return client.json(`/rest/api/3/search/jql?${params}`, (value) =>
      decodeIssuePage(value, fields, definitions),
    );
  }
  async function sortedPage(
    conditions: string[],
    sort: string,
    pageToken: string,
    maxResults: number,
    statusIds: readonly string[] = [],
  ): Promise<IssuePage> {
    if (!validSort(sort) || pageToken.length > 1000)
      throw invalid("정렬·페이지 조건이 올바르지 않습니다.");
    if (conditions.includes("project is EMPTY"))
      return { issues: [], nextPageToken: null };
    const rules = sortRules(sort);
    const first = rules[0];
    const query = (extra: string, token: string) =>
      search(
        [...conditions, extra].filter(Boolean).join(" AND ") +
          " ORDER BY " +
          sortOrder(sort),
        token,
        maxResults,
      );
    if (first.startsWith("status") && statusIds.length) {
      const ids =
        first === "status-desc" ? [...statusIds].reverse() : statusIds;
      const cursor = pageToken ? pageToken.match(/^stage:(\d+):(.*)$/) : null;
      if (pageToken && !cursor)
        throw invalid("상태 페이지 정보가 올바르지 않습니다.");
      let index = cursor ? Number(cursor[1]) : 0;
      if (!Number.isSafeInteger(index) || index > ids.length)
        throw invalid("상태 페이지 정보가 올바르지 않습니다.");
      let token = cursor?.[2] ?? "";
      // Jira의 이름순 정렬 대신 보드 단계별 커서를 감싼다. 미등록 상태도 마지막 구간에서 조회한다.
      while (index <= ids.length) {
        const condition =
          index < ids.length
            ? `status = ${ids[index]}`
            : `status not in (${ids.join(", ")})`;
        const page = await sortedPage(
          [...conditions, condition],
          rules.slice(1).join(",") || "recent",
          token,
          maxResults,
        );
        if (page.issues.length || page.nextPageToken)
          return {
            ...page,
            nextPageToken: page.nextPageToken
              ? `stage:${index}:${page.nextPageToken}`
              : index < ids.length
                ? `stage:${index + 1}:`
                : null,
          };
        index++;
        token = "";
      }
      return { issues: [], nextPageToken: null };
    }
    if (!first.startsWith("due")) return query("", pageToken);
    if (pageToken && !/^(dated|undated):/.test(pageToken))
      throw invalid("페이지 정보가 올바르지 않습니다.");
    // 날짜 없는 항목은 오름/내림 정렬 모두 끝에 둔다. 현재 조회 구간을 커서에 보존한다.
    if (!pageToken.startsWith("undated:")) {
      const page = await query(
        "duedate is not EMPTY",
        pageToken.slice("dated:".length),
      );
      if (page.issues.length || page.nextPageToken)
        return {
          ...page,
          nextPageToken: page.nextPageToken
            ? `dated:${page.nextPageToken}`
            : "undated:",
        };
    }
    const page = await query(
      "duedate is EMPTY",
      pageToken.startsWith("undated:")
        ? pageToken.slice("undated:".length)
        : "",
    );
    return {
      ...page,
      nextPageToken: page.nextPageToken
        ? `undated:${page.nextPageToken}`
        : null,
    };
  }
  async function orderedStatusIds(
    projects: string,
    sort: string,
    selected: string,
    excludeDone: boolean,
  ): Promise<string[]> {
    if (!validSort(sort)) throw invalid("정렬 조건이 올바르지 않습니다.");
    if (!sortRules(sort)[0].startsWith("status") || selected === "none")
      return [];
    const allowed = selected ? new Set(selected.split(",")) : null;
    return (await metadata.projectStatuses(projects))
      .filter(
        (status) =>
          (!allowed || allowed.has(status.id)) &&
          (!excludeDone || status.category !== "done"),
      )
      .map((status) => status.id);
  }
  async function ancestors(
    issues: readonly Issue[],
    maxDepth = 5,
  ): Promise<Issue[]> {
    const known = new Map(issues.map((issue) => [issue.key, issue]));
    const added: Issue[] = [];
    // 목록은 5단계까지, 상세 경로는 연결이 끝날 때까지 보강한다. 같은 부모는 다시 조회하지 않는다.
    for (let depth = 0; depth < maxDepth; depth++) {
      const missing = new Map<string, string>();
      for (const issue of known.values())
        if (issue.parent && !known.has(issue.parent))
          missing.set(parseIssueKey(issue.parent, ""), issue.parentSummary);
      if (!missing.size) break;
      const found = new Map<string, Issue>();
      try {
        const keys = [...missing.keys()];
        for (let offset = 0; offset < keys.length; offset += 100) {
          const seen = new Set<string>();
          let token = "";
          do {
            trackCursor(seen, token);
            const page = await search(
              `key in (${keys.slice(offset, offset + 100).join(", ")})`,
              token,
            );
            for (const issue of page.issues) found.set(issue.key, issue);
            token = page.nextPageToken ?? "";
          } while (token);
        }
      } catch {
        /* 부모 조회가 실패해도 알려진 키와 제목으로 현재 트리를 표시한다. */
      }
      for (const [key, summary] of missing) {
        const issue =
          found.get(key) ??
          decodeIssue({ key, fields: { summary: summary || key } });
        known.set(key, issue);
        added.push(issue);
      }
    }
    return metadata.withDefaultPriorities(added);
  }
  async function browse(
    options: BrowseOptions,
    sort = "recent",
    pageToken = "",
    pageSize = 30,
  ) {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
      throw invalid("페이지 크기가 올바르지 않습니다.");
    const conditions = await browseConditions(options);
    const page = await sortedPage(
      conditions,
      sort,
      pageToken,
      pageSize,
      await orderedStatusIds(
        options.projects,
        sort,
        options.statuses,
        options.excludeDone,
      ),
    );
    const issues = await metadata.withDefaultPriorities(page.issues);
    return {
      issues,
      ancestors: await ancestors(issues),
      nextPageToken: page.nextPageToken,
    };
  }
  async function childrenPage(
    key: string,
    options: BrowseOptions,
    people: PeopleFilter,
    sort: string,
    pageToken = "",
    pageSize = 25,
  ): Promise<IssuePage> {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
      throw invalid("페이지 크기가 올바르지 않습니다.");
    key = parseIssueKey(key, "");
    if (
      !["all", "mine", "assigned", "related"].includes(people) ||
      typeof options.excludeDone !== "boolean"
    )
      throw invalid("하위 조회 조건이 올바르지 않습니다.");
    const conditions = [
      `parent = ${key}`,
      ...(await browseConditions({
        ...options,
        q: "",
        scope: people === "assigned" || people === "related" ? people : "all",
      })),
    ];
    if (people === "mine")
      conditions.push("(assignee = currentUser() OR assignee is EMPTY)");
    const page = await sortedPage(
      conditions,
      sort,
      pageToken,
      pageSize,
      await orderedStatusIds(
        options.projects,
        sort,
        options.statuses,
        options.excludeDone,
      ),
    );
    return {
      ...page,
      issues: await metadata.withDefaultPriorities(page.issues),
    };
  }
  async function directChildren(key: string): Promise<Issue[]> {
    key = parseIssueKey(key, "");
    const issues: Issue[] = [];
    const seen = new Set<string>();
    let token = "";
    do {
      trackCursor(seen, token);
      const page = await search(`parent = ${key} ORDER BY created ASC`, token);
      issues.push(...page.issues);
      token = page.nextPageToken ?? "";
    } while (token);
    return metadata.withDefaultPriorities(issues);
  }
  async function matchingKeys(jql: string): Promise<string[]> {
    const keys: string[] = [];
    const params = new URLSearchParams({
      jql,
      fields: "key",
      maxResults: "100",
    });
    const seen = new Set<string>();
    let token = "";
    do {
      trackCursor(seen, token);
      if (token) params.set("nextPageToken", token);
      const page = await client.json(
        `/rest/api/3/search/jql?${params}`,
        (value) => {
          const page = record(value);
          return {
            keys: arrayValue(page.issues).map((issue) =>
              parseIssueKey(record(issue).key, ""),
            ),
            token: stringValue(page.nextPageToken),
          };
        },
      );
      keys.push(...page.keys);
      token = page.token;
    } while (token);
    return keys;
  }
  async function matchesIssues(
    input: string[],
    options: BrowseOptions,
    parents: string[] = [],
  ) {
    if (!input.length || input.length > 50)
      throw invalid("이슈를 1~50개 선택하세요.");
    const keys = [...new Set(input.map((key) => parseIssueKey(key, "")))];
    if (parents.length > 50)
      throw invalid("상위 이슈는 최대 50개까지 조회합니다.");
    const parentKeys = [
      ...new Set(parents.map((key) => parseIssueKey(key, ""))),
    ];
    const parentIssues = parentKeys.length
      ? (await search(`key in (${parentKeys.join(", ")})`)).issues
      : [];
    return {
      keys: await matchingKeys(
        `${(await browseConditions(options)).join(" AND ")} AND key in (${keys.join(", ")})`,
      ),
      ancestors: [...parentIssues, ...(await ancestors(parentIssues))],
    };
  }

  async function matchesIssue(key: string, options: BrowseOptions) {
    key = parseIssueKey(key, "");
    return {
      matches: (
        await matchingKeys(
          `${(await browseConditions(options)).join(" AND ")} AND key = ${key}`,
        )
      ).includes(key),
    };
  }
  async function recentChanges(
    options: BrowseOptions,
    lookback: number,
    limit = Number.POSITIVE_INFINITY,
  ) {
    if (
      !Number.isInteger(lookback) ||
      lookback < 1 ||
      lookback > 7 * 24 * 60 + 2
    )
      throw invalid("변경 조회 범위가 올바르지 않습니다.");
    const conditions = await browseConditions(options);
    const changed: Issue[] = [];
    const seen = new Set<string>();
    let token = "";
    do {
      trackCursor(seen, token);
      const page = await search(
        `${projectCondition(options.projects)} AND updated >= -${lookback}m ORDER BY updated DESC`,
        token,
      );
      changed.push(...page.issues);
      if (changed.length > limit)
        throw new JiraError(
          "변경량이 많아 목록 범위를 다시 확인해야 합니다.",
          409,
        );
      token = page.nextPageToken ?? "";
    } while (token);
    const matches = new Set<string>();
    // 필터에서 빠진 변경도 알아야 기존 카드를 제거할 수 있다. 변경 묶음과 필터 일치 여부를 따로 조회한다.
    for (let offset = 0; offset < changed.length; offset += 100) {
      const keys = changed
        .slice(offset, offset + 100)
        .map((issue) => issue.key);
      for (const key of await matchingKeys(
        `${conditions.join(" AND ")} AND key in (${keys.join(", ")})`,
      ))
        matches.add(key);
    }
    return {
      // 새 일치 항목의 부모도 묶음으로 보강한다. 개별 카드의 추가 요청은 만들지 않는다.
      ancestors: await ancestors(
        changed.filter((issue) => matches.has(issue.key)),
      ),
      issues: await metadata.withDefaultPriorities(
        changed.map((issue) => ({ ...issue, matches: matches.has(issue.key) })),
      ),
    };
  }
  return {
    async issuesByKeys(input: readonly string[]) {
      const keys = [...new Set(input.map((key) => parseIssueKey(key, "")))];
      const issues: Issue[] = [];
      for (let offset = 0; offset < keys.length; offset += 100) {
        let cursor = "";
        do {
          const page = await search(
            `key in (${keys.slice(offset, offset + 100).join(", ")})`,
            cursor,
          );
          issues.push(...page.issues);
          cursor = page.nextPageToken ?? "";
        } while (cursor);
      }
      return metadata.withDefaultPriorities(issues);
    },
    relatedFieldIds: relatedFields,
    browseConditions,
    sortedPage,
    browse,
    childrenPage,
    directChildren,
    ancestors,
    ancestorPath: async (input: string) => {
      const key = parseIssueKey(input, "");
      const page = await search(`key = ${key}`);
      return [...page.issues, ...(await ancestors(page.issues, Infinity))];
    },
    matchesIssue,
    matchesIssues,
    recentChanges,
  };
}
