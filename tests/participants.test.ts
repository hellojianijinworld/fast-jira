import assert from "node:assert/strict";
import { test } from "node:test";
import { createApi } from "../src/client/api.ts";
import {
  issueParticipantFields,
  participantUsers,
} from "../src/domain/participants.ts";
import { knownIssues, withParticipantHydration } from "../src/domain/sync.ts";
import { decodeDetails } from "../src/domain/wire.ts";
import { createHttpServer } from "../src/server/http.ts";
import { createJiraService } from "../src/server/jira-service.ts";

const member = (id: string) => ({
  accountId: id,
  displayName: id,
  avatarUrls: {},
});
const definitions = [
  { id: "assignee", name: "담당자", schema: { type: "user" } },
  {
    id: "customfield_121",
    name: "개발",
    searchable: false,
    schema: { type: "user" },
  },
  {
    id: "customfield_987",
    name: "협업",
    schema: { type: "array", items: "user" },
  },
  { id: "customfield_333", name: "기획", schema: { type: "user" } },
  { id: "customfield_444", name: "다른 프로젝트", schema: { type: "user" } },
  { id: "customfield_555", name: "숫자", schema: { type: "number" } },
];
function setup(includeAssignee = false) {
  const calls: { path: string; body?: unknown }[] = [];
  let fields: Record<string, unknown> = {
    ...(includeAssignee ? { assignee: member("member-assignee") } : {}),
    summary: "테스트",
    project: { key: "AA" },
    customfield_121: member("member-a"),
    customfield_987: [member("member-a"), member("member-b")],
    customfield_333: null,
  };
  let editable = true;
  const service = createJiraService({
    credentials: {
      site: "example.atlassian.net",
      email: "fake@example.com",
      token: "fake",
    },
    fetcher: async (input, init) => {
      const url = new URL(String(input));
      const body: unknown = init?.body
        ? JSON.parse(String(init.body))
        : undefined;
      calls.push({ path: url.pathname + url.search, body });
      if (url.pathname.endsWith("/field")) return Response.json(definitions);
      if (url.pathname.endsWith("/editmeta"))
        return Response.json({
          fields: {
            ...(includeAssignee
              ? {
                  assignee: {
                    ...definitions[0],
                    required: false,
                    operations: ["set"],
                  },
                }
              : {}),
            customfield_121: {
              ...definitions[1],
              required: true,
              operations: editable ? ["set"] : [],
            },
            customfield_987: {
              ...definitions[2],
              operations: ["set"],
              autoCompleteUrl:
                "https://example.atlassian.net/rest/api/1.0/users/picker?fieldId=customfield_987",
            },
            customfield_333: { ...definitions[3], operations: [] },
          },
        });
      if (url.pathname.endsWith("/users/search"))
        return Response.json(
          url.searchParams.get("startAt") === "0"
            ? [
                member("member-c"),
                { ...member("app-user"), accountType: "app" },
              ]
            : [],
        );
      if (url.pathname.endsWith("/user/assignable/search"))
        return Response.json([member("member-c")]);
      if (url.pathname.endsWith("/search/jql"))
        return Response.json({ issues: [{ key: "AA-1", fields }] });
      if (url.pathname.endsWith("/users/picker"))
        return Response.json(
          url.searchParams.get("query") === "nobody"
            ? { total: 0, footer: "일치하는 사용자 없음" }
            : { users: [member("member-c")] },
        );
      if (url.pathname.endsWith("/issue/AA-1")) {
        if (init?.method === "PUT") {
          fields = { ...fields, ...(body as { fields: object }).fields };
          return new Response(null, { status: 204 });
        }
        return Response.json({ key: "AA-1", fields });
      }
      throw new Error(`예상하지 않은 요청: ${url.pathname}`);
    },
  });
  return {
    service,
    calls,
    revoke: () => {
      editable = false;
    },
  };
}

test("상세는 검색 불가능한 사람 필드도 실제 필드별로 보존하고 기본 필드는 제외한다", async () => {
  const { service, calls } = setup();
  const issue = await service.detail("AA-1");
  assert.deepEqual(
    issue.participantFields?.map((field) => [
      field.id,
      field.multiple,
      field.users.map((user) => user.id),
    ]),
    [
      ["customfield_121", false, ["member-a"]],
      ["customfield_987", true, ["member-a", "member-b"]],
      ["customfield_333", false, []],
    ],
  );
  await service.detail("AA-1");
  assert.equal(calls.filter((call) => call.path.endsWith("/field")).length, 1);
  assert.equal(
    calls.filter((call) => call.path.includes("editmeta")).length,
    0,
  );
});

test("참여자 편집은 이슈의 실제 필드 권한과 사용자 자동완성 정보를 사용한다", async () => {
  const { service, calls } = setup();
  const options = await service.participantOptions("AA-1");
  assert.deepEqual(
    options.map((field) => [field.id, field.required]),
    [
      ["customfield_121", true],
      ["customfield_987", false],
    ],
  );
  const users = await service.participantUsers(
    "AA-1",
    "customfield_987",
    "member",
  );
  assert.equal(users[0]?.id, "member-c");
  assert.ok(
    calls.some(
      (call) =>
        call.path.includes("fieldId=customfield_987") &&
        call.path.includes("query=member"),
    ),
  );
  await assert.rejects(service.participantUsers("AA-1", "assignee", "a"));
});

test("참여자 저장은 단일·복수 형식으로 변경한 실제 필드만 한 번에 수정한다", async () => {
  const { service, calls } = setup();
  const issue = await service.updateParticipants("AA-1", [
    { id: "customfield_121", userIds: ["member-c"] },
    { id: "customfield_987", userIds: [] },
  ]);
  assert.deepEqual(calls.find((call) => call.body)?.body, {
    fields: {
      customfield_121: { accountId: "member-c" },
      customfield_987: [],
    },
  });
  assert.equal(issue.participantFields?.[0]?.users[0]?.id, "member-c");
  assert.equal(calls.filter((call) => call.body).length, 1);
});

test("임의 필드·단일 필드 복수 지정·필수 해제·중복 변경은 쓰기 전 거부한다", async () => {
  for (const changes of [
    [{ id: "summary", userIds: ["member-c"] }],
    [{ id: "customfield_333", userIds: ["member-c"] }],
    [{ id: "customfield_121", userIds: ["member-a", "member-b"] }],
    [{ id: "customfield_121", userIds: [] }],
    [{ id: "customfield_987", userIds: ["member-a", "member-a"] }],
    [
      { id: "customfield_987", userIds: ["member-a"] },
      { id: "customfield_987", userIds: [] },
    ],
  ]) {
    const { service, calls } = setup();
    await assert.rejects(service.updateParticipants("AA-1", changes));
    assert.ok(!calls.some((call) => call.body));
  }
  const { service, revoke, calls } = setup();
  await service.participantOptions("AA-1");
  revoke();
  await assert.rejects(
    service.updateParticipants("AA-1", [
      { id: "customfield_121", userIds: ["member-c"] },
    ]),
  );
  assert.ok(!calls.some((call) => call.body));
});

test("표시는 사용자 중복을 합치지만 응답을 왕복해도 실제 필드 지정은 보존된다", async () => {
  const { service } = setup();
  const issue = decodeDetails(await service.detail("AA-1"));
  assert.deepEqual(
    participantUsers(issue.participantFields ?? []).map((user) => user.id),
    ["member-a", "member-b"],
  );
  assert.equal(issue.participantFields?.length, 3);
  assert.throws(() =>
    decodeDetails({
      ...issue,
      participantFields: [
        { id: "customfield_121", name: "개발", multiple: "no", users: [] },
      ],
    }),
  );
});

test("클라이언트와 HTTP 경계에서 실제 필드 선택·검색·저장이 왕복한다", async (t) => {
  const { service, calls } = setup();
  const server = createHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const api = createApi((path, init) =>
    fetch(new URL(String(path), base), {
      ...init,
      headers: { ...init?.headers, Origin: base },
    }),
  );
  const options = await api.participantOptions("AA-1");
  assert.equal(options[1]?.multiple, true);
  assert.equal(
    (await api.participantUsers("AA-1", "customfield_987", "c"))[0]?.id,
    "member-c",
  );
  const updated = await api.updateParticipants("AA-1", [
    { id: "customfield_987", userIds: ["member-c"] },
  ]);
  assert.equal(updated.participantFields?.[1]?.users[0]?.id, "member-c");
  assert.equal(calls.filter((call) => call.body).length, 1);
});

test("담당자도 같은 참여자 편집에서 실제 담당자 후보와 필드로 지정한다", async () => {
  const { service, calls } = setup(true);
  assert.ok(
    (await service.participantOptions("AA-1")).some(
      (field) => field.id === "assignee" && !field.multiple,
    ),
  );
  assert.equal(
    (await service.participantUsers("AA-1", "assignee", "c"))[0]?.id,
    "member-c",
  );
  assert.ok(
    calls.some(
      (call) =>
        call.path.includes("/user/assignable/search?") &&
        call.path.includes("issueKey=AA-1"),
    ),
  );
  const changed = await service.updateParticipants("AA-1", [
    { id: "assignee", userIds: ["member-c"] },
  ]);
  assert.equal(changed.assigneeId, "member-c");
  assert.deepEqual(calls.find((call) => call.body)?.body, {
    fields: { assignee: { accountId: "member-c" } },
  });
});

test("목록에도 검색 가능 여부와 별개로 모든 커스텀 사람 지정값을 포함한다", async () => {
  const { service, calls } = setup(true);
  const page = await service.browse(
    {
      q: "",
      projects: "AA",
      scope: "all",
      excludeDone: false,
      statuses: "",
      assignees: "",
    },
    "recent",
    "",
    30,
  );
  assert.deepEqual(
    page.issues[0]?.participantFields?.map((field) => field.id),
    ["customfield_121", "customfield_987", "customfield_333"],
  );
  const fields = new URL(
    "https://example.atlassian.net" +
      calls.find((call) => call.path.includes("/search/jql"))?.path,
  ).searchParams.get("fields");
  assert.ok(fields?.includes("customfield_121"));
});

test("담당자와 커스텀 필드의 사람을 합치고 내 계정은 원본 변경 없이 맨 앞에 둔다", async () => {
  const { service } = setup(true);
  const issue = await service.detail("AA-1");
  const fields = issueParticipantFields(issue);
  const original = JSON.stringify(fields);
  assert.deepEqual(
    participantUsers(fields, "member-b").map((user) => user.id),
    ["member-b", "member-assignee", "member-a"],
  );
  assert.equal(JSON.stringify(fields), original);
  assert.equal(
    knownIssues([{ ...issue, participantFields: [] }])[0]?.needsParticipants,
    undefined,
  );
  const { participantFields: _fields, ...legacy } = issue;
  assert.equal(knownIssues([legacy])[0]?.needsParticipants, true);
});

test("목록 밖의 저장 카드도 참여자 정보를 보강하고 목록의 최신 기준은 유지한다", async () => {
  const { service } = setup();
  const issue = {
    ...(await service.detail("AA-1")),
    id: "101",
    updated: "2026-10-01T00:00:00.000Z",
  };
  const { participantFields: _fields, ...legacy } = issue;
  const known = knownIssues([issue]);
  const result = withParticipantHydration(known, [
    { ...legacy, updated: "2026-09-01T00:00:00.000Z" },
    { ...legacy, id: "102", key: "AA-2" },
    { ...issue, id: "103", key: "AA-3" },
    { ...legacy, id: "invalid" },
    { ...legacy, id: "104", updated: "" },
  ]);
  assert.deepEqual(result, [
    ...known,
    {
      id: "102",
      key: "AA-2",
      updated: issue.updated,
      parent: issue.parent,
      project: issue.project,
      needsParticipants: true,
    },
  ]);
  assert.equal(known.length, 1);
});

test("검색어 없이 선택기를 열어도 기본 사용자 후보를 조회할 수 있다", async () => {
  const { service, calls } = setup(true);
  const users = await service.participantUsers("AA-1", "customfield_121", "");
  assert.deepEqual(
    users.map((user) => user.id),
    ["member-c"],
  );
  assert(
    calls.some(
      (call) =>
        call.path.includes("/users/search?") && !call.path.includes("query="),
    ),
  );
  assert.equal(
    (await service.participantUsers("AA-1", "assignee", ""))[0]?.id,
    "member-c",
  );
});

test("자동완성 경로가 있어도 빈 검색은 후보 목록을 쓰고 실제 빈 자동완성 응답은 빈 목록으로 읽는다", async () => {
  const { service, calls } = setup();
  assert.equal(
    (await service.participantUsers("AA-1", "customfield_987", "")).length,
    1,
  );
  assert(!calls.some((call) => call.path.includes("/users/picker")));
  assert.deepEqual(
    await service.participantUsers("AA-1", "customfield_987", "nobody"),
    [],
  );
});

test("여러 커스텀 필드의 기본 후보는 기존 멤버 캐시를 공유한다", async () => {
  const { service, calls } = setup();
  await service.participantUsers("AA-1", "customfield_121", "");
  const count = calls.filter((call) =>
    call.path.includes("/users/search?"),
  ).length;
  await service.participantUsers("AA-1", "customfield_987", "");
  assert.equal(
    calls.filter((call) => call.path.includes("/users/search?")).length,
    count,
  );
});
