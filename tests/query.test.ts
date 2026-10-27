import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyIssue } from "../src/domain/wire.ts";
import { createJiraClient } from "../src/server/jira-client.ts";
import { createJiraMetadata } from "../src/server/jira-metadata.ts";
import {
  assigneeCondition,
  type BrowseOptions,
  createJiraQuery,
  statusCondition,
} from "../src/server/jira-query.ts";

const options: BrowseOptions = {
  q: "",
  projects: "AA",
  scope: "all",
  excludeDone: false,
  statuses: "",
  assignees: "",
};
const rawIssue = (key: string, fields: object = {}) => ({
  key,
  fields: { summary: key, ...fields },
});
function setup(reply: (url: URL) => Response, fields: unknown[] = []) {
  const calls: URL[] = [];
  let fieldCalls = 0;
  const client = createJiraClient(
    { site: "example.atlassian.net", email: "test@example.com", token: "fake" },
    async (value) => {
      const url = new URL(String(value));
      if (url.pathname.endsWith("/field")) {
        fieldCalls++;
        return Response.json(fields);
      }
      calls.push(url);
      return reply(url);
    },
  );
  return {
    query: createJiraQuery(client, createJiraMetadata(client)),
    calls,
    fieldCount: () => fieldCalls,
  };
}
test("검색·필터 JQL은 입력을 검증하며 빈 선택이면 HTTP 없이 종료한다", async () => {
  const { query, calls } = setup(() => {
    throw new Error("요청하면 안 됨");
  });
  const conditions = await query.browseConditions({
    ...options,
    q: '수정 " OR status=done',
    statuses: "10,20",
    assignees: "account-1,unassigned",
    excludeDone: true,
  });
  assert.ok(conditions.includes('summary ~ "수정 OR status done"'));
  assert.ok(conditions.includes("statusCategory != Done"));
  assert.ok(
    conditions.includes('(assignee in ("account-1") OR assignee is EMPTY)'),
  );
  assert.throws(() => statusCondition("10) OR status is not EMPTY"));
  assert.throws(() => assigneeCondition('" OR project=AA'));
  await assert.rejects(query.browseConditions({ ...options, q: "!@#" }));
  await assert.rejects(
    query.browseConditions({ ...options, q: "x".repeat(101) }),
  );
  assert.equal(
    (await query.browse({ ...options, statuses: "none" })).issues.length,
    0,
  );
  assert.equal(calls.length, 0);
});
test("마감일 커서는 날짜 없는 구간을 마지막에 조회하고 Jira 토큰을 유지한다", async () => {
  const { query, calls } = setup((url) => {
    const jql = url.searchParams.get("jql") ?? "";
    if (jql.includes("duedate is not EMPTY"))
      return Response.json({ issues: [rawIssue("AA-1")] });
    return Response.json({ issues: [rawIssue("AA-2")] });
  });
  const first = await query.sortedPage(
    ["project = AA"],
    "due-desc,priority",
    "",
    30,
  );
  assert.equal(first.nextPageToken, "undated:");
  const second = await query.sortedPage(
    ["project = AA"],
    "due-desc,priority",
    first.nextPageToken ?? "",
    30,
  );
  assert.equal(second.nextPageToken, null);
  assert.ok(calls[1]?.searchParams.get("jql")?.includes("duedate is EMPTY"));
  await assert.rejects(query.sortedPage([], "due", "unknown-token", 30));
  const tokenFlow = setup((url) =>
    Response.json(
      url.searchParams.get("nextPageToken")
        ? { issues: [] }
        : { issues: [rawIssue("AA-1")], nextPageToken: "jira-page" },
    ),
  );
  assert.equal(
    (await tokenFlow.query.sortedPage([], "due", "", 30)).nextPageToken,
    "dated:jira-page",
  );
  await tokenFlow.query.sortedPage([], "due", "dated:jira-page", 30);
  assert.equal(
    tokenFlow.calls[1]?.searchParams.get("nextPageToken"),
    "jira-page",
  );
});
test("상태 순서 커서는 비어 있는 단계를 건너뛰고 미등록 상태도 마지막에 찾는다", async () => {
  const { query, calls } = setup((url) => {
    const jql = url.searchParams.get("jql") ?? "";
    return Response.json({
      issues: jql.includes("status = 20") ? [] : [rawIssue("AA-1")],
    });
  });
  const first = await query.sortedPage(["project = AA"], "status,due", "", 25, [
    "20",
    "10",
  ]);
  assert.equal(first.nextPageToken, "stage:1:undated:");
  assert.equal(calls.length, 3);
  assert.ok(calls[2]?.searchParams.get("jql")?.includes("status = 10"));
  const middle = await query.sortedPage(
    ["project = AA"],
    "status,due",
    first.nextPageToken ?? "",
    25,
    ["20", "10"],
  );
  assert.equal(middle.nextPageToken, "stage:2:");
  assert.ok(calls[3]?.searchParams.get("jql")?.includes("duedate is EMPTY"));
  const last = await query.sortedPage(
    ["project = AA"],
    "status,due",
    middle.nextPageToken ?? "",
    25,
    ["20", "10"],
  );
  assert.ok(
    calls[4]?.searchParams.get("jql")?.includes("status not in (20, 10)"),
  );
  // 마지막 상태 구간 안에서도 마감일 없는 페이지를 이어서 읽는다.
  assert.equal(last.nextPageToken, "stage:2:undated:");
  await assert.rejects(query.sortedPage([], "status", "stage:99:", 25, ["20"]));
  await assert.rejects(query.sortedPage([], "status", "foreign", 25, ["20"]));
});
test("목록의 같은 부모는 묶음으로 한 번 조회하고 다음 조상까지 보강한다", async () => {
  const { query, calls } = setup((url) => {
    const jql = url.searchParams.get("jql") ?? "";
    if (jql === "key in (AA-9)")
      return Response.json({
        issues: [rawIssue("AA-9", { parent: { key: "AA-10" } })],
      });
    if (jql === "key in (AA-10)")
      return Response.json({ issues: [rawIssue("AA-10")] });
    return Response.json({
      issues: [
        rawIssue("AA-1", {
          parent: { key: "AA-9", fields: { summary: "부모" } },
        }),
        rawIssue("AA-2", { parent: { key: "AA-9" } }),
      ],
      nextPageToken: "more",
    });
  });
  const page = await query.browse(options);
  assert.deepEqual(
    page.ancestors.map((issue) => issue.key),
    ["AA-9", "AA-10"],
  );
  assert.equal(page.nextPageToken, "more");
  assert.equal(calls.length, 3);
});
test("하위 조회는 나·미지정을 포함하며 부모 키와 필터를 검증한다", async () => {
  const { query, calls } = setup(() =>
    Response.json({ issues: [rawIssue("AA-2")], nextPageToken: "child-page" }),
  );
  const page = await query.childrenPage(
    "AA-1",
    { ...options, excludeDone: true, statuses: "10", assignees: "unassigned" },
    "mine",
    "recent",
  );
  assert.equal(page.nextPageToken, "child-page");
  const jql = calls[0]?.searchParams.get("jql");
  assert.ok(jql?.includes("parent = AA-1"));
  assert.ok(jql?.includes("(assignee = currentUser() OR assignee is EMPTY)"));
  assert.ok(jql?.includes("status in (10)"));
  assert.equal(calls[0]?.searchParams.get("maxResults"), "25");
  await assert.rejects(
    query.childrenPage("AA-1 OR key is not EMPTY", options, "mine", "recent"),
  );
});
test("관련 담당 필드는 동적 스키마에서 한 번 읽고 검색 조건에 재사용한다", async () => {
  const { query, fieldCount } = setup(
    () => Response.json({ issues: [] }),
    [
      {
        id: "customfield_12",
        name: "협업 담당",
        schema: { type: "array", items: "user" },
      },
      { id: "customfield_13", name: "협업 담당", schema: { type: "string" } },
    ],
  );
  const conditions = await query.browseConditions({
    ...options,
    scope: "related",
  });
  assert.ok(
    conditions.includes("(assignee = currentUser() OR cf[12] = currentUser())"),
  );
  await query.browseConditions({ ...options, scope: "related" });
  assert.equal(fieldCount(), 1);
});
test("최근 변경은 필터 밖 변경도 반환하고 일치 여부만 묶음 재조회한다", async () => {
  const { query, calls } = setup((url) =>
    Response.json(
      url.searchParams.get("fields") === "key"
        ? { issues: [{ key: "AA-2" }] }
        : { issues: [rawIssue("AA-1"), rawIssue("AA-2")] },
    ),
  );
  const changed = await query.recentChanges(
    { ...options, excludeDone: true },
    5,
  );
  assert.deepEqual(
    changed.issues.map((issue) => [issue.key, issue.matches]),
    [
      ["AA-1", false],
      ["AA-2", true],
    ],
  );
  assert.equal(calls.length, 2);
  assert.ok(calls[0]?.searchParams.get("jql")?.includes("updated >= -5m"));
  assert.ok(!calls[0]?.searchParams.get("jql")?.includes("statusCategory"));
  assert.ok(calls[1]?.searchParams.get("jql")?.includes("key in (AA-1, AA-2)"));
  await assert.rejects(query.recentChanges(options, 7 * 24 * 60 + 3));
  assert.equal(calls.length, 2);
});

test("최근 변경의 새 부모는 같은 키를 중복 조회하지 않고 묶음으로 보강한다", async () => {
  const { query, calls } = setup((url) => {
    const jql = url.searchParams.get("jql") ?? "";
    if (url.searchParams.get("fields") === "key")
      return Response.json({ issues: [{ key: "AA-1" }, { key: "AA-2" }] });
    if (jql.startsWith("key in"))
      return Response.json({
        issues: [rawIssue("AA-10", { summary: "상위 계획" })],
      });
    return Response.json({
      issues: [
        rawIssue("AA-1", { parent: { key: "AA-10" } }),
        rawIssue("AA-2", { parent: { key: "AA-10" } }),
      ],
    });
  });
  const batch = await query.recentChanges(options, 5);
  assert.deepEqual(
    batch.ancestors.map((issue) => issue.key),
    ["AA-10"],
  );
  assert.equal(calls.length, 3);
  assert.equal(calls[2]?.searchParams.get("jql"), "key in (AA-10)");
});

test("일괄 변경 필터 판정은 선택한 키만 묶어서 조회하고 새 부모를 보강한다", async () => {
  const { query, calls } = setup((url) => {
    const jql = url.searchParams.get("jql") ?? "";
    if (jql === "key in (AA-9)")
      return Response.json({ issues: [rawIssue("AA-9")], isLast: true });
    return Response.json({ issues: [rawIssue("AA-1")], isLast: true });
  });
  const data = await query.matchesIssues(["AA-1", "AA-2"], options, ["AA-9"]);
  assert.deepEqual(data.keys, ["AA-1"]);
  assert.equal(data.ancestors[0]?.key, "AA-9");
  assert.equal(calls.length, 2);
  assert.ok(calls[1]?.searchParams.get("jql")?.includes("key in (AA-1, AA-2)"));
  await assert.rejects(query.matchesIssues([], options));
  await assert.rejects(query.matchesIssues(["AA-1) OR project=BB"], options));
  assert.equal(calls.length, 2);
});

test("상위 경로는 5단계 넘는 실제 부모 연결도 끝까지 조회하며 입력을 검증한다", async () => {
  const { query, calls } = setup((url) => {
    const key = (url.searchParams.get("jql") ?? "").match(/AA-\d+/)?.[0];
    assert.ok(key);
    const number = Number(key.split("-")[1]);
    return Response.json({
      issues: [
        rawIssue(
          key,
          number > 1 ? { parent: { key: `AA-${number - 1}` } } : {},
        ),
      ],
    });
  });
  const path = await query.ancestorPath("AA-8");
  assert.deepEqual(
    path.map((issue) => issue.key),
    ["AA-8", "AA-7", "AA-6", "AA-5", "AA-4", "AA-3", "AA-2", "AA-1"],
  );
  assert.equal(calls.length, 8);
  await assert.rejects(query.ancestorPath("AA-2 OR project=BB"));
  assert.equal(calls.length, 8);
});

test("선택한 작업 관계자는 동적 사용자 필드의 계정으로 조회하고 본인 조건을 겹치지 않는다", async () => {
  const { query } = setup(
    () => Response.json({ issues: [] }),
    [
      {
        id: "customfield_12",
        name: "협업 담당",
        schema: { type: "array", items: "user" },
      },
    ],
  );
  const conditions = await query.browseConditions({
    ...options,
    scope: "related",
    assignees: "account-other",
  });
  assert(
    conditions.some((condition) =>
      condition.includes('cf[12] in ("account-other")'),
    ),
  );
  assert(!conditions.some((condition) => condition.includes("currentUser()")));
  const assigned = await query.browseConditions({
    ...options,
    scope: "assigned",
    assignees: "account-other",
  });
  assert(assigned.includes('(assignee in ("account-other"))'));
  assert(!assigned.some((condition) => condition.includes("currentUser()")));
});

test("관계자 필드는 이름을 고정하지 않고 사용자 스키마를 읽어 묶음 응답에 포함한다", async () => {
  let fieldCalls = 0;
  const searches: URL[] = [];
  const client = createJiraClient(
    { site: "example.atlassian.net", email: "test@example.com", token: "fake" },
    async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/field")) {
        fieldCalls++;
        return Response.json([
          {
            id: "customfield_42",
            name: "프로젝트에서 정한 역할",
            schema: { type: "user" },
          },
          {
            id: "customfield_43",
            name: "다른 역할",
            schema: { type: "array", items: "user" },
          },
          {
            id: "customfield_44",
            name: "검색 불가 역할",
            searchable: false,
            schema: { type: "user" },
          },
          { id: "customfield_45", name: "텍스트", schema: { type: "string" } },
        ]);
      }
      searches.push(url);
      return Response.json({
        issues: [
          rawIssue("AA-2", {
            assignee: { accountId: "owner-id" },
            customfield_42: { accountId: "member-id" },
            customfield_43: [
              { accountId: "another-id" },
              { accountId: "member-id" },
            ],
          }),
        ],
      });
    },
  );
  const query = createJiraQuery(client, createJiraMetadata(client));
  const page = await query.childrenPage("AA-1", options, "related", "recent");
  assert.deepEqual(page.issues[0]?.relatedUserIds, [
    "owner-id",
    "member-id",
    "another-id",
  ]);
  assert(searches[0]?.searchParams.get("fields")?.includes("customfield_42"));
  assert(searches[0]?.searchParams.get("fields")?.includes("customfield_44"));
  assert(!searches[0]?.searchParams.get("jql")?.includes("cf[44]"));
  await query.childrenPage("AA-1", options, "related", "recent");
  assert.equal(fieldCalls, 1);
});

test("미지정 작업 조회는 담당자 또는 모든 동적 관계자 필드의 비어 있음을 검색한다", async () => {
  const { query, fieldCount } = setup(
    () => Response.json({ issues: [] }),
    [
      { id: "customfield_12", name: "협업 담당", schema: { type: "user" } },
      {
        id: "customfield_14",
        name: "협업 담당",
        schema: { type: "array", items: "user" },
      },
    ],
  );
  const assigned = await query.browseConditions({
    ...options,
    scope: "assigned",
    assignees: "unassigned",
    statuses: "10",
  });
  assert(assigned.includes("(assignee is EMPTY)"));
  assert(assigned.includes("status in (10)"));
  const related = await query.browseConditions({
    ...options,
    scope: "related",
    assignees: "unassigned",
    statuses: "10",
  });
  assert(
    related.includes(
      "((assignee is EMPTY AND cf[12] is EMPTY AND cf[14] is EMPTY))",
    ),
  );
  assert(
    !related.some(
      (condition) =>
        condition.includes("currentUser()") || condition.includes(" OR "),
    ),
  );
  await query.browseConditions({
    ...options,
    scope: "related",
    assignees: "unassigned",
  });
  assert.equal(fieldCount(), 1);
});

test("새로고침 묶음 조회는 최대 100개이며 일반 하위 페이지는 25개를 유지한다", async () => {
  const { query, calls } = setup(() => Response.json({ issues: [] }));
  await query.childrenPage("AA-1", options, "all", "recent");
  await query.childrenPage("AA-1", options, "all", "recent", "", 100);
  await query.browse(options, "recent", "", 100);
  assert.deepEqual(
    calls.map((url) => url.searchParams.get("maxResults")),
    ["25", "100", "100"],
  );
  await assert.rejects(
    query.childrenPage("AA-1", options, "all", "recent", "", 101),
  );
  await assert.rejects(query.browse(options, "recent", "", Number.NaN));
});

test("변경분이 제한을 넘으면 필터 일치·조상 보강 전에 범위 재검증을 요청한다", async () => {
  const { query, calls } = setup((url) => {
    const offset = Number(url.searchParams.get("nextPageToken") ?? 0);
    const size = offset === 1000 ? 1 : 100;
    return Response.json({
      issues: Array.from({ length: size }, (_, index) =>
        rawIssue(`AA-${offset + index + 1}`),
      ),
      ...(offset < 1000 ? { nextPageToken: String(offset + 100) } : {}),
    });
  });
  await assert.rejects(
    query.recentChanges(options, 5, 1000),
    (reason: unknown) =>
      reason instanceof Error && "status" in reason && reason.status === 409,
  );
  assert.equal(calls.length, 11);
});

for (const [name, run] of [
  [
    "전체 하위",
    (query: ReturnType<typeof createJiraQuery>) => query.directChildren("AA-1"),
  ],
  [
    "필터 일치",
    (query: ReturnType<typeof createJiraQuery>) =>
      query.matchesIssues(["AA-1"], options),
  ],
  [
    "최근 변경",
    (query: ReturnType<typeof createJiraQuery>) =>
      query.recentChanges(options, 5),
  ],
] as const)
  for (const [cycle, tokens, requests] of [
    ["같은 커서", ["A", "A", null], 2],
    ["순환 커서", ["A", "B", "A", null], 3],
  ] as const)
    test(`${name} 조회의 ${cycle}는 부분 결과 대신 오류로 끝난다`, async () => {
      let index = 0;
      const { query, calls } = setup(() =>
        Response.json({
          issues: [rawIssue("AA-1")],
          nextPageToken: tokens[index++] ?? null,
        }),
      );
      await assert.rejects(
        run(query),
        (error: unknown) =>
          error instanceof Error &&
          "status" in error &&
          error.status === 502 &&
          /커서/.test(error.message),
      );
      assert.equal(calls.length, requests);
    });

test("조상 조회의 반복 커서는 요청을 멈추고 기존 키·제목 표시로 복구한다", async () => {
  let index = 0;
  const { query, calls } = setup(() =>
    Response.json({
      issues: [],
      nextPageToken: ["A", "B", "A", null][index++] ?? null,
    }),
  );
  const ancestors = await query.ancestors([
    { ...emptyIssue("AA-1"), parent: "AA-9", parentSummary: "알려진 부모" },
  ]);
  assert.equal(calls.length, 3);
  assert.deepEqual(
    ancestors.map((issue) => [issue.key, issue.summary, issue.id]),
    [["AA-9", "알려진 부모", ""]],
  );
});

test("조상 조회의 서로 다른 묶음에서는 같은 커서를 정상적으로 재사용한다", async () => {
  const { query, calls } = setup((url) =>
    Response.json(
      url.searchParams.get("nextPageToken")
        ? {
            issues: (url.searchParams.get("jql")?.match(/AA-\d+/g) ?? []).map(
              (key) => rawIssue(key),
            ),
          }
        : { issues: [], nextPageToken: "shared-cursor" },
    ),
  );
  const children = Array.from({ length: 101 }, (_, i) => ({
    ...emptyIssue(`AA-${i + 1}`),
    parent: `AA-${i + 1000}`,
  }));
  const ancestors = await query.ancestors(children, 1);
  assert.equal(ancestors.length, 101);
  assert.equal(calls.length, 4);
  assert.deepEqual(
    calls.map((url) => url.searchParams.get("nextPageToken")),
    [null, "shared-cursor", null, "shared-cursor"],
  );
});

test("작업참여자 조회는 역할 이름 제한 없이 검색 가능한 모든 사람 필드를 쓴다", async () => {
  const { query } = setup(
    () => Response.json({ issues: [] }),
    [
      { id: "customfield_91", name: "동적 역할 A", schema: { type: "user" } },
      {
        id: "customfield_92",
        name: "동적 역할 B",
        schema: { type: "array", items: "user" },
      },
      {
        id: "customfield_93",
        name: "검색 불가",
        searchable: false,
        schema: { type: "user" },
      },
    ],
  );
  const conditions = (
    await query.browseConditions({ ...options, scope: "related" })
  ).join(" AND ");
  assert(conditions.includes("assignee = currentUser()"));
  assert(conditions.includes("cf[91] = currentUser()"));
  assert(conditions.includes("cf[92] = currentUser()"));
  assert(!conditions.includes("cf[93]"));
});
