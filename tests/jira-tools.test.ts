import assert from "node:assert/strict";
import { test } from "node:test";
import { record } from "../src/domain/validation.ts";
import { createJiraClient } from "../src/server/jira-client.ts";
import { createJiraService } from "../src/server/jira-service.ts";
import { createJiraTools } from "../src/server/jira-tools.ts";
import { createMcpHandler } from "../src/server/mcp-handler.ts";

function setup(allowMutations = false, failKey = "") {
  const requests: { path: string; method: string; body: unknown }[] = [];
  const dates = new Map<string, string>();
  const service = createJiraService({
    credentials: {
      site: "example.atlassian.net",
      email: "test@example.com",
      token: "fake-token",
    },
    fetcher: async (input, init) => {
      const url = new URL(String(input));
      const path = url.pathname;
      const method = init?.method ?? "GET";
      requests.push({
        path: path + url.search,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (method === "PUT" || method === "POST") {
        if (failKey && path.endsWith(`/${failKey}`))
          return Response.json(
            { errorMessages: ["권한 없음"] },
            { status: 403 },
          );
        const fields = record(
          record(JSON.parse(String(init?.body))).fields ?? {},
        );
        if (Object.hasOwn(fields, "duedate"))
          dates.set(path, String(fields.duedate ?? ""));
        return new Response(null, { status: 204 });
      }
      if (path.endsWith("/myself"))
        return Response.json({ accountId: "test-me", displayName: "나" });
      if (path.endsWith("/field")) return Response.json([]);
      if (path.endsWith("/project/search"))
        return Response.json({
          values: [{ key: "AA", name: "모의 프로젝트" }],
          isLast: true,
        });
      if (path.endsWith("/search/jql"))
        return Response.json({
          issues: [
            {
              key: "AA-1",
              fields: { summary: "모의 이슈", status: { name: "대기" } },
            },
          ],
          isLast: true,
        });
      if (path.endsWith("/transitions"))
        return Response.json({
          transitions: [{ id: "23", to: { name: "팀에서 정한 진행 단계" } }],
        });
      if (path.includes("/user/assignable/search"))
        return Response.json([
          { accountId: "test-user", displayName: "모의 사용자" },
        ]);
      if (path.endsWith("/priority/search"))
        return Response.json({
          values: [{ id: "9", name: "사용자 우선순위" }],
          isLast: true,
        });
      if (path.endsWith("/editmeta"))
        return Response.json({
          fields: {
            priority: {
              operations: ["set"],
              allowedValues: [{ id: "9", name: "사용자 우선순위" }],
            },
          },
        });
      if (path.endsWith("/comment/12"))
        return Response.json({
          id: "12",
          author: { accountId: "someone-else" },
          created: "2026-10-24T00:00:00Z",
          updated: "2026-10-24T00:00:00Z",
          body: { type: "doc", version: 1, content: [] },
        });
      return Response.json({
        key: path.match(/\/issue\/([^/]+)/)?.[1] ?? "AA-1",
        fields: {
          summary: "모의 이슈",
          status: { name: "대기" },
          duedate: dates.get(path) ?? "",
        },
      });
    },
  });
  return {
    tools: createJiraTools(service, { allowMutations }),
    requests,
    dates,
  };
}

test("에이전트 도구는 기본 읽기 전용이며 제안 단계에서는 Jira를 변경하지 않는다", async () => {
  const { tools, requests } = setup();
  assert.ok(tools.definitions.every((tool) => tool.annotations.readOnlyHint));
  const plan = record(
    await tools.call("jira_propose_change", {
      keys: ["aa-1", "AA-1"],
      field: "assignee",
      value: "test-user",
    }),
  );
  assert.deepEqual(plan.keys, ["AA-1"]);
  assert.equal(plan.field, "assignee");
  assert.equal(requests.length, 0);
  await assert.rejects(
    tools.call("jira_update_issues", {
      keys: ["AA-1"],
      field: "assignee",
      value: "test-user",
    }),
    /지원하지 않는 도구/,
  );
  assert.equal(requests.length, 0);
});

test("검색은 기존 필터 검증과 커서를 사용하고 외부 URL·잘못된 입력은 쓰기 전에 거부한다", async () => {
  const { tools, requests } = setup(true);
  const page = record(
    await tools.call("jira_search", {
      projects: ["AA"],
      query: "분량",
      scope: "assigned",
      pageSize: 10,
    }),
  );
  assert.equal(Array.isArray(page.issues), true);
  const search = requests.find((call) => call.path.includes("/search/jql"));
  assert.ok(search);
  const jql =
    new URL(`https://example.test${search.path}`).searchParams.get("jql") ?? "";
  assert.ok(jql.includes("AA"));
  assert.ok(jql.includes("currentUser()"));
  assert.ok(jql.includes("분량"));
  const before = requests.length;
  await assert.rejects(
    tools.call("jira_search", { projects: ["AA) OR project is not EMPTY"] }),
  );
  await assert.rejects(tools.call("jira_search", { pageSize: 1000 }));
  await assert.rejects(tools.call("jira_search", { excludeDone: "yes" }));
  await assert.rejects(
    tools.call("jira_update_issues", {
      keys: ["https://other.atlassian.net/browse/AA-1"],
      field: "assignee",
      value: "test-user",
    }),
  );
  await assert.rejects(
    tools.call("jira_propose_change", {
      keys: ["AA-1"],
      field: "unknown",
      value: "x",
    }),
  );
  assert.equal(requests.length, before);
});

test("상태·담당자·우선순위는 하드코딩 없이 기존 동적 선택지를 공유한다", async () => {
  const { tools } = setup();
  const statuses = record(
    await tools.call("jira_options", { keys: ["AA-1"], field: "status" }),
  );
  assert.deepEqual(statuses.statuses, ["팀에서 정한 진행 단계"]);
  const users = record(
    await tools.call("jira_options", { keys: ["AA-1"], field: "assignee" }),
  );
  assert.equal(record((users.users as unknown[])[0]).id, "test-user");
  const priorities = record(
    await tools.call("jira_options", { keys: ["AA-1"], field: "priority" }),
  );
  assert.equal(record((priorities.priorities as unknown[])[0]).id, "9");
});

test("MCP 쓰기는 공통 일괄 변경을 사용하고 되돌리기 영수증을 보존한다", async () => {
  const { tools, requests } = setup(true);
  const mutation = tools.definitions.find(
    (tool) => tool.name === "jira_update_issues",
  );
  assert.equal(mutation?.annotations.readOnlyHint, false);
  const result = record(
    await tools.call("jira_update_issues", {
      keys: ["AA-1", "AA-2"],
      field: "dueDate",
      value: "2026-11-01",
    }),
  );
  assert.equal(typeof result.undoToken, "string");
  assert.ok(String(result.undoToken).length > 0);
  assert.equal((result.issues as unknown[]).length, 2);
  const writes = requests.filter((call) => call.method === "PUT");
  assert.equal(writes.length, 2);
  assert.deepEqual(record(writes[0]?.body).fields, { duedate: "2026-11-01" });
  const undone = record(
    await tools.call("jira_undo", { token: result.undoToken }),
  );
  assert.equal((undone.failures as unknown[]).length, 0);
  assert.equal(requests.filter((call) => call.method === "PUT").length, 4);
  await assert.rejects(
    tools.call("jira_undo", { token: result.undoToken }),
    /이미 처리/,
  );
});

test("댓글 편집은 기존 작성자 권한 검사를 우회하지 않는다", async () => {
  const { tools, requests } = setup(true);
  await assert.rejects(
    tools.call("jira_comment", {
      key: "AA-1",
      action: "edit",
      id: "12",
      text: "수정",
    }),
    /내가 작성한 댓글/,
  );
  assert.ok(requests.every((call) => call.method === "GET"));
});

test("일괄 도구는 성공한 이슈와 권한 실패를 각각 반환한다", async () => {
  const { tools } = setup(true, "AA-2");
  const result = record(
    await tools.call("jira_update_issues", {
      keys: ["AA-1", "AA-2"],
      field: "dueDate",
      value: "2026-11-01",
    }),
  );
  assert.deepEqual(
    (result.issues as unknown[]).map((issue) => record(issue).key),
    ["AA-1"],
  );
  assert.deepEqual(
    (result.failures as unknown[]).map((issue) => record(issue).key),
    ["AA-2"],
  );
  assert.ok(result.undoToken);
});

test("되돌리기 도구는 이후에 바뀐 값을 덮어쓰지 않는다", async () => {
  const { tools, requests, dates } = setup(true);
  const result = record(
    await tools.call("jira_update_issues", {
      keys: ["AA-1"],
      field: "dueDate",
      value: "2026-11-01",
    }),
  );
  dates.set("/rest/api/3/issue/AA-1", "2026-12-01");
  const undo = record(
    await tools.call("jira_undo", { token: result.undoToken }),
  );
  assert.equal((undo.failures as unknown[]).length, 1);
  assert.equal(dates.get("/rest/api/3/issue/AA-1"), "2026-12-01");
  assert.equal(requests.filter((call) => call.method === "PUT").length, 1);
});

test("확장 MCP는 도구 메타정보와 제안·실행 결과를 같은 프로토콜로 반환한다", async () => {
  const { tools, requests } = setup(true);
  const client = createJiraClient(
    {
      site: "example.atlassian.net",
      email: "test@example.com",
      token: "fake-token",
    },
    async () => {
      throw new Error("레거시 조회는 실행하면 안 됩니다.");
    },
  );
  const handler = createMcpHandler(client, "example.atlassian.net", tools);
  const list = await handler.handleLine(
    JSON.stringify({ id: 1, method: "tools/list" }),
  );
  const catalog = record(list?.result).tools as unknown[];
  assert.ok(catalog.some((item) => record(item).name === "jira_context"));
  assert.ok(
    catalog.some(
      (item) =>
        record(item).name === "jira_update_issues" &&
        record(record(item).annotations).readOnlyHint === false,
    ),
  );
  const proposed = await handler.handleLine(
    JSON.stringify({
      id: 2,
      method: "tools/call",
      params: {
        name: "jira_propose_change",
        arguments: { keys: ["AA-1"], field: "dueDate", value: "2026-11-01" },
      },
    }),
  );
  const content = record((record(proposed?.result).content as unknown[])[0]);
  assert.equal(record(JSON.parse(String(content.text))).field, "dueDate");
  assert.equal(requests.length, 0);
  const applied = await handler.handleLine(
    JSON.stringify({
      id: 3,
      method: "tools/call",
      params: {
        name: "jira_update_issues",
        arguments: { keys: ["AA-1"], field: "dueDate", value: "2026-11-01" },
      },
    }),
  );
  assert.equal(record(applied?.result).isError, undefined);
  assert.equal(requests.filter((call) => call.method === "PUT").length, 1);
  const invalid = await handler.handleLine(
    JSON.stringify({
      id: 4,
      method: "tools/call",
      params: {
        name: "jira_update_issues",
        arguments: { keys: [], field: "dueDate", value: "x" },
      },
    }),
  );
  assert.equal(record(invalid?.result).isError, true);
});

test("도구 목록은 자격 증명을 포함하지 않고 카탈로그도 필요한 사용자 정보만 반환한다", async () => {
  const { tools, requests } = setup();
  const catalog = record(await tools.call("jira_catalog", undefined));
  assert.deepEqual(catalog.me, { id: "test-me", name: "나" });
  assert.equal(JSON.stringify(catalog).includes("test@example.com"), false);
  assert.equal(JSON.stringify(tools.definitions).includes("fake-token"), false);
  const before = requests.length;
  await assert.rejects(tools.call("jira_search", { projects: null }));
  await assert.rejects(tools.call("jira_search", { scope: null }));
  assert.equal(requests.length, before);
});
