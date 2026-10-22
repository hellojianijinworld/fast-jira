import assert from "node:assert/strict";
import { test } from "node:test";
import { record } from "../src/domain/validation.ts";
import { createJiraClient } from "../src/server/jira-client.ts";
import { createJiraEdit } from "../src/server/jira-edit.ts";
import { createJiraMetadata } from "../src/server/jira-metadata.ts";
import { createJiraRead } from "../src/server/jira-read.ts";

function setup(reply: (url: URL, method: string, body: unknown) => Response) {
  const calls: { url: URL; method: string; body: unknown }[] = [];
  const client = createJiraClient(
    { site: "example.atlassian.net", email: "test@example.com", token: "fake" },
    async (value, options) => {
      const url = new URL(String(value)),
        method = options?.method ?? "GET";
      const body: unknown =
        typeof options?.body === "string" ? JSON.parse(options.body) : null;
      calls.push({ url, method, body });
      return reply(url, method, body);
    },
  );
  const metadata = createJiraMetadata(client);
  return {
    edit: createJiraEdit(
      client,
      metadata,
      createJiraRead(client, metadata, "example.atlassian.net"),
    ),
    calls,
  };
}
test("상태 선택은 중복 이름을 제거하지만 실제 변경은 유일한 전환만 허용한다", async () => {
  const { edit, calls } = setup((_url, method) =>
    method === "POST"
      ? new Response(null, { status: 204 })
      : Response.json({
          transitions: [
            { id: "10", to: { name: "진행" } },
            { id: "20", to: { name: "완료" } },
            { id: "21", to: { name: "완료" } },
          ],
        }),
  );
  assert.deepEqual((await edit.transitionOptions("AA-1")).statuses, [
    "진행",
    "완료",
  ]);
  await edit.applyUpdate("AA-1", "status", "진행");
  assert.deepEqual(calls.find((call) => call.method === "POST")?.body, {
    transition: { id: "10" },
  });
  await assert.rejects(edit.applyUpdate("AA-1", "status", "완료"));
  await assert.rejects(edit.applyUpdate("AA-1", "status", "없는 상태"));
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
});
test("담당자는 나·미지정·프로젝트 기본 담당자와 정확한 이메일 계정을 지원한다", async () => {
  const { edit, calls } = setup((url, method) => {
    if (method === "PUT") return new Response(null, { status: 204 });
    if (url.pathname.endsWith("/myself"))
      return Response.json({ accountId: "my-account" });
    return Response.json([
      {
        accountId: "email-account",
        emailAddress: "member@example.com",
        displayName: "동료",
      },
    ]);
  });
  for (const value of ["@me", "", "default", "member@example.com"])
    await edit.applyUpdate("AA-1", "assignee", value);
  assert.deepEqual(
    calls
      .filter((call) => call.method === "PUT")
      .map((call) => record(call.body).accountId),
    ["my-account", null, "-1", "email-account"],
  );
  await assert.rejects(edit.applyUpdate("AA-1", "assignee", "bad value"));
  const ambiguous = setup(() =>
    Response.json([
      { accountId: "a", emailAddress: "member@example.com" },
      { accountId: "b", emailAddress: "member@example.com" },
    ]),
  );
  await assert.rejects(
    ambiguous.edit.applyUpdate("AA-1", "assignee", "member@example.com"),
  );
  assert.ok(ambiguous.calls.every((call) => call.method === "GET"));
});
test("제목·마감일 검증과 값 해제는 해당 필드만 변경한다", async () => {
  const { edit, calls } = setup((url, method) =>
    method === "PUT"
      ? new Response(null, { status: 204 })
      : Response.json({
          key: url.pathname.split("/").pop(),
          fields: { summary: "제목" },
        }),
  );
  await edit.applyUpdate("AA-1", "summary", " 새 제목 ");
  await edit.applyUpdate("AA-1", "dueDate", "2028-02-29");
  await edit.applyUpdate("AA-1", "dueDate", "");
  assert.deepEqual(
    calls.map((call) => call.body),
    [
      { fields: { summary: "새 제목" } },
      { fields: { duedate: "2028-02-29" } },
      { fields: { duedate: null } },
    ],
  );
  for (const [field, value] of [
    ["summary", ""],
    ["summary", "a\nb"],
    ["summary", "x".repeat(256)],
    ["dueDate", "2027-02-29"],
    ["unknown", "x"],
  ])
    await assert.rejects(edit.applyUpdate("AA-1", field ?? "", value ?? ""));
  assert.equal(calls.length, 3);
  assert.equal(
    (await edit.update("AA-1", "dueDate", "2026-10-01")).dueDate,
    "2026-10-01",
  );
});
test("우선순위 선택지는 편집 권한·허용 목록·카탈로그 순서와 캐시를 따른다", async () => {
  const { edit, calls } = setup((url, method) => {
    if (method === "PUT") return new Response(null, { status: 204 });
    if (url.pathname.endsWith("/editmeta"))
      return Response.json({
        fields: {
          priority: {
            operations: ["set"],
            allowedValues: [
              { id: "3", name: "보통" },
              { id: "2", name: "높음" },
            ],
          },
        },
      });
    return Response.json({
      values: [
        { id: "2", name: "높음" },
        { id: "3", name: "보통" },
      ],
      isLast: true,
    });
  });
  assert.deepEqual(
    (await edit.priorityOptions("AA-1")).map((priority) => priority.id),
    ["2", "3"],
  );
  await edit.applyUpdate("AA-1", "priority", "2");
  await edit.applyUpdate("AA-1", "priority", "3");
  assert.equal(
    calls.filter((call) => call.url.pathname.endsWith("/editmeta")).length,
    1,
  );
  await assert.rejects(edit.applyUpdate("AA-1", "priority", "999"));
  const readonly = setup(() =>
    Response.json({ fields: {}, values: [], isLast: true }),
  );
  await assert.rejects(readonly.edit.priorityOptions("AA-1"));
});
test("부모 변경은 프로젝트·동적 계층·순환을 검증한 뒤 저장한다", async () => {
  const make = (project: string, level: number, parent = "") =>
    setup((url, method) => {
      if (method === "PUT") return new Response(null, { status: 204 });
      if (url.pathname.endsWith("/editmeta"))
        return Response.json({ fields: { parent: { operations: ["set"] } } });
      const source = url.pathname.endsWith("/AA-1");
      return Response.json({
        key: source ? "AA-1" : "AA-2",
        fields: {
          project: { key: source ? "AA" : project },
          issuetype: { hierarchyLevel: source ? 2 : level },
          parent: parent ? { key: parent } : null,
        },
      });
    });
  const good = make("AA", 3);
  await good.edit.applyUpdate("AA-1", "parent", "AA-2");
  assert.deepEqual(good.calls.find((call) => call.method === "PUT")?.body, {
    fields: { parent: { key: "AA-2" } },
  });
  for (const bad of [make("BB", 3), make("AA", 4), make("AA", 3, "AA-1")]) {
    await assert.rejects(bad.edit.applyUpdate("AA-1", "parent", "AA-2"));
    assert.ok(bad.calls.every((call) => call.method === "GET"));
  }
  await assert.rejects(good.edit.applyUpdate("AA-1", "parent", "AA-1"));
  await good.edit.applyUpdate("AA-1", "parent", "");
  assert.deepEqual(good.calls.at(-1)?.body, { fields: { parent: null } });
});

test("단건 되돌리기는 같은 필드의 원격 후속 변경을 확인하면 쓰지 않는다", async () => {
  for (const [field, expected, previous] of [
    ["summary", "내 제목", "원래 제목"],
    ["status", "내 상태", "원래 상태"],
    ["assignee", "my-account", "previous-account"],
    ["priority", "2", "3"],
    ["dueDate", "2026-10-01", ""],
  ] as const) {
    const { edit, calls } = setup(() =>
      Response.json({
        key: "AA-1",
        fields: {
          summary: "동료 제목",
          status: { name: "동료 상태" },
          assignee: { accountId: "other-account" },
          priority: { id: "9" },
          duedate: "2026-10-10",
        },
      }),
    );
    await assert.rejects(
      edit.update("AA-1", field ?? "", previous ?? "", expected),
      { status: 409 },
    );
    assert.equal(
      calls.filter((call) => call.method !== "GET").length,
      0,
      field,
    );
  }
});

test("되돌리기는 일치한 최신값만 복원하고 일반 저장에는 사전 조회가 없다", async () => {
  let summary = "내 제목";
  const { edit, calls } = setup((_url, method, body) => {
    if (method === "PUT") {
      summary = String(record(record(body).fields).summary);
      return new Response(null, { status: 204 });
    }
    return Response.json({
      key: "AA-1",
      fields: { summary, status: { name: "다른 필드 변경" } },
    });
  });
  await edit.update("AA-1", "summary", "원래 제목", "내 제목");
  assert.equal(summary, "원래 제목");
  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET", "PUT", "GET"],
  );
  calls.length = 0;
  await edit.update("AA-1", "summary", "일반 저장");
  assert.deepEqual(
    calls.map((call) => call.method),
    ["PUT", "GET"],
  );
});

test("되돌리기의 현재값이 비어 있어도 비교하며 최신 조회 실패는 쓰지 않는다", async () => {
  let accountId: string | null = null;
  const { edit, calls } = setup((_url, method, body) => {
    if (method === "PUT") {
      accountId = String(record(body).accountId);
      return new Response(null, { status: 204 });
    }
    return Response.json({
      key: "AA-1",
      fields: { assignee: accountId ? { accountId } : null },
    });
  });
  await edit.update("AA-1", "assignee", "previous-account", "");
  assert.equal(accountId, "previous-account");
  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET", "PUT", "GET"],
  );
  const failed = setup(() =>
    Response.json({ errorMessages: ["조회 실패"] }, { status: 503 }),
  );
  await assert.rejects(
    failed.edit.update("AA-1", "summary", "원래 제목", "내 제목"),
    { status: 503 },
  );
  assert.equal(failed.calls.filter((call) => call.method !== "GET").length, 0);
});
