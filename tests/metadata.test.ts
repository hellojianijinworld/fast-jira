import assert from "node:assert/strict";
import { test } from "node:test";
import { createPromiseCache } from "../src/server/cache.ts";
import { createJiraClient } from "../src/server/jira-client.ts";
import { decodeIssue } from "../src/server/jira-decode.ts";
import {
  createJiraMetadata,
  projectKeys,
} from "../src/server/jira-metadata.ts";

function setup(
  reply: (url: URL) => Response | Promise<Response>,
  now?: () => number,
) {
  const paths: string[] = [];
  const client = createJiraClient(
    { site: "example.atlassian.net", email: "test@example.com", token: "fake" },
    async (value) => {
      const url = new URL(String(value));
      paths.push(url.pathname + url.search);
      return reply(url);
    },
  );
  return { metadata: createJiraMetadata(client, now), paths };
}
test("메타정보 캐시는 중복 요청을 합치고 실패·만료 후 재조회한다", async () => {
  let time = 0,
    count = 0;
  const cache = createPromiseCache<number>(() => time);
  const load = async () => ++count;
  assert.deepEqual(
    await Promise.all([cache("key", load), cache("key", load)]),
    [1, 1],
  );
  time = 300000;
  assert.equal(await cache("key", load), 2);
  await assert.rejects(
    cache("bad", async () => {
      throw new Error("실패");
    }),
  );
  assert.equal(await cache("bad", load), 3);
  let fail: ((reason: Error) => void) | undefined;
  const old = cache(
    "race",
    () =>
      new Promise<number>((_resolve, reject) => {
        fail = reject;
      }),
  );
  await Promise.resolve();
  time += 300000;
  assert.equal(await cache("race", load), 4);
  fail?.(new Error("과거 실패"));
  await assert.rejects(old);
  assert.equal(await cache("race", load), 4);
});
test("로그인 사용자를 합쳐 조회하고 인증 실패 후 재시도한다", async () => {
  let attempts = 0;
  const { metadata, paths } = setup(() =>
    ++attempts === 1
      ? Response.json({}, { status: 401 })
      : Response.json({
          accountId: "current",
          displayName: "현재 사용자",
          avatarUrls: { "24x24": "avatar" },
        }),
  );
  await assert.rejects(metadata.currentUser());
  const [a, b] = await Promise.all([
    metadata.authenticate(),
    metadata.currentUser(),
  ]);
  assert.equal(a.id, "current");
  assert.equal(b.accountId, "current");
  assert.equal(a.avatar, "avatar");
  assert.equal(paths.length, 2);
});
test("프로젝트 페이지·동적 유형·우선순위 순서와 기본값을 유지한다", async () => {
  const { metadata, paths } = setup((url) => {
    if (url.pathname === "/rest/api/3/project/search")
      return Response.json(
        url.searchParams.get("startAt") === "0"
          ? { values: [{ key: "ZZ", name: "Z" }], total: 2 }
          : { values: [{ key: "AA", name: "A" }], total: 2 },
      );
    if (url.pathname === "/rest/api/3/priority/search")
      return Response.json({
        values: [
          { id: "10", name: "긴급" },
          { id: "20", name: "보통" },
        ],
        isLast: true,
      });
    if (url.pathname.endsWith("/issuetypes"))
      return Response.json({
        issueTypes: [
          { id: "custom", name: "사용자 정의 단계", hierarchyLevel: 3 },
        ],
        isLast: true,
      });
    if (url.pathname.endsWith("/issuetypes/custom"))
      return Response.json({
        fields: [{ fieldId: "priority", defaultValue: { id: "20" } }],
        isLast: true,
      });
    throw new Error("예상 밖 요청");
  });
  assert.deepEqual(
    (await metadata.projects()).map((project) => project.key),
    ["AA", "ZZ"],
  );
  assert.equal((await metadata.projectTypes("AA"))[0]?.hierarchyLevel, 3);
  assert.deepEqual(
    (await metadata.priorities()).map((priority) => priority.id),
    ["10", "20"],
  );
  await metadata.priorities();
  const issues = [1, 2].map((n) =>
    decodeIssue({
      key: `AA-${n}`,
      fields: { issuetype: { id: "custom" }, priority: { id: "20" } },
    }),
  );
  await metadata.withDefaultPriorities(issues);
  assert.deepEqual(
    issues.map((issue) => issue.defaultPriorityId),
    ["20", "20"],
  );
  assert.equal(
    paths.filter((path) => path.includes("/issuetypes/custom")).length,
    1,
  );
  assert.equal(
    paths.filter((path) => path.startsWith("/rest/api/3/priority/search"))
      .length,
    1,
  );
});
test("상태는 보드 열 순서, 프로젝트 공유 상태는 중복 없이 합친다", async () => {
  const { metadata } = setup((url) => {
    if (url.pathname.endsWith("/statuses"))
      return Response.json([
        {
          statuses: [
            { id: "30", name: "완료", statusCategory: { key: "done" } },
            { id: "10", name: "대기", statusCategory: { key: "new" } },
            {
              id: "20",
              name: "진행",
              statusCategory: { key: "indeterminate" },
            },
          ],
        },
      ]);
    if (url.pathname === "/rest/agile/1.0/board")
      return Response.json({
        values: [
          {
            id: 7,
            location: { projectKey: url.searchParams.get("projectKeyOrId") },
          },
        ],
      });
    return Response.json({
      columnConfig: {
        columns: [
          { statuses: [{ id: "20" }, { id: "10" }] },
          { statuses: [{ id: "30" }] },
        ],
      },
    });
  });
  const statuses = await metadata.projectStatuses("AA,BB");
  assert.deepEqual(
    statuses.map((status) => status.id),
    ["20", "10", "30"],
  );
  assert.deepEqual(statuses[0]?.projects, ["AA", "BB"]);
});
test("보드·생성 메타 조회 실패에도 범주와 기본 배지 표시로 복구한다", async () => {
  const { metadata } = setup((url) =>
    url.pathname.endsWith("/statuses")
      ? Response.json([
          {
            statuses: [
              { id: "3", name: "끝", statusCategory: { key: "done" } },
              { id: "1", name: "처음", statusCategory: { key: "new" } },
            ],
          },
        ])
      : Response.json({}, { status: 403 }),
  );
  assert.deepEqual(
    (await metadata.projectStatuses("AA")).map((status) => status.id),
    ["1", "3"],
  );
  const issue = decodeIssue({
    key: "AA-1",
    fields: { issuetype: { id: "custom" }, priority: { id: "20" } },
  });
  assert.equal(
    (await metadata.withDefaultPriorities([issue]))[0]?.defaultPriorityId,
    "",
  );
});
test("이슈 선택 필드 null은 허용하지만 잘못된 응답과 프로젝트 입력은 거부한다", async () => {
  const issue = decodeIssue({
    key: "AA-1",
    fields: {
      assignee: null,
      duedate: null,
      issuetype: { id: "custom", hierarchyLevel: -1 },
      parent: { key: "AA-2", fields: { summary: "부모" } },
      comment: { total: 3 },
    },
  });
  assert.equal(issue.assigneeId, "");
  assert.equal(issue.hierarchyLevel, -1);
  assert.equal(issue.parentSummary, "부모");
  assert.equal(issue.commentCount, 3);
  assert.throws(() =>
    decodeIssue({ key: "AA-1", fields: { status: { name: 1 } } }),
  );
  assert.throws(() => projectKeys("AA) OR project is not EMPTY"));
  assert.deepEqual(projectKeys("AA,AA,BB"), ["AA", "BB"]);
  const { metadata } = setup(() =>
    Response.json([
      { accountId: "a", displayName: "A" },
      { accountId: "b", active: false },
    ]),
  );
  assert.deepEqual(
    (await metadata.projectAssignees("AA")).map((user) => user.id),
    ["a"],
  );
});

test("담당자 조회는 프로젝트 순서와 무관하게 합치고 5분 후 갱신한다", async () => {
  let time = 0;
  const { metadata, paths } = setup(
    () => Response.json([{ accountId: "a", displayName: "A" }]),
    () => time,
  );
  await Promise.all([
    metadata.projectAssignees("AA,BB"),
    metadata.projectAssignees("BB,AA"),
  ]);
  assert.equal(paths.length, 1);
  time = 300000;
  await metadata.projectAssignees("AA,BB");
  assert.equal(paths.length, 2);
});
