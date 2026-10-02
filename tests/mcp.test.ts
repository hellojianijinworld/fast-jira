import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import type { AdfDocument } from "../src/domain/adf.ts";
import { adfMarkdown } from "../src/domain/adf-markdown.ts";
import { record } from "../src/domain/validation.ts";
import { createJiraClient } from "../src/server/jira-client.ts";
import { createMcpHandler } from "../src/server/mcp-handler.ts";

const doc: AdfDocument = {
  type: "doc",
  version: 1,
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "요약" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "강조", marks: [{ type: "strong" }] },
        { type: "mention", attrs: { text: "@동료" } },
      ],
    },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "항목" }],
                },
              ],
            },
          ],
        },
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "값|내용" }],
                },
              ],
            },
          ],
        },
      ],
    },
    { type: "blockCard", attrs: { url: "https://www.figma.com/example" } },
  ],
};
function setup() {
  const calls: { url: URL; method: string }[] = [];
  const client = createJiraClient(
    { site: "example.atlassian.net", email: "test@example.com", token: "fake" },
    async (value, options) => {
      const url = new URL(String(value));
      calls.push({ url, method: options?.method ?? "GET" });
      if (url.pathname.endsWith("/search/jql"))
        return Response.json(
          url.searchParams.has("nextPageToken")
            ? {
                issues: [
                  {
                    id: "2",
                    key: "AA-3",
                    fields: { summary: "먼저", description: doc },
                  },
                ],
              }
            : {
                issues: [{ id: "4", key: "AA-2", fields: { summary: "나중" } }],
                nextPageToken: "more",
              },
        );
      return Response.json({
        key: "AA-1",
        fields: { summary: "부모", description: doc, status: { name: "진행" } },
      });
    },
  );
  return { handler: createMcpHandler(client, "example.atlassian.net"), calls };
}
test("AI 문맥은 표·서식·스마트 링크를 간결한 Markdown으로 보존한다", () => {
  const text = adfMarkdown(doc);
  assert.ok(text.includes("## 요약"));
  assert.ok(text.includes("**강조**@동료"));
  assert.ok(text.includes("| 항목 |"));
  assert.ok(text.includes("| --- |"));
  assert.ok(text.includes("값\\|내용"));
  assert.ok(text.includes("https://www.figma.com/example"));
});
test("이슈와 직접 하위는 페이지 묶음으로 읽으며 개별 하위 조회·쓰기는 없다", async () => {
  const { handler, calls } = setup();
  const context = await handler.getContext({ issue: "AA-1" });
  assert.ok(context.includes("# AA-1 부모"));
  assert.ok(context.includes("하위 이슈 2개"));
  assert.ok(context.indexOf("AA-3 먼저") < context.indexOf("AA-2 나중"));
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.method === "GET"));
  const only = setup();
  await only.handler.getContext({
    issue: "https://example.atlassian.net/browse/AA-1",
    children: false,
  });
  assert.equal(only.calls.length, 1);
});
test("MCP 초기화·목록·오류·알림 처리는 조회 없이 동작한다", async () => {
  const { handler, calls } = setup();
  const init = await handler.handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    }),
  );
  assert.ok(init);
  assert.equal(record(init.result).protocolVersion, "2025-06-18");
  const list = await handler.handleLine(
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  );
  assert.ok(list);
  const tools = record(list.result).tools;
  assert.ok(Array.isArray(tools));
  assert.equal(record(record(tools[0]).annotations).readOnlyHint, true);
  assert.equal((await handler.handleLine("invalid JSON"))?.error?.code, -32700);
  assert.equal(
    await handler.handleLine(
      JSON.stringify({ method: "notifications/initialized" }),
    ),
    null,
  );
  assert.equal(
    (await handler.handleLine(JSON.stringify({ id: 3, method: "unsupported" })))
      ?.error?.code,
    -32601,
  );
  assert.equal(calls.length, 0);
});
test("잘못된 도구 입력은 isError로 반환하고 외부 사이트 요청을 하지 않는다", async () => {
  const { handler, calls } = setup();
  const response = await handler.handleLine(
    JSON.stringify({
      id: 1,
      method: "tools/call",
      params: {
        name: "jira_context",
        arguments: { issue: "https://other.atlassian.net/browse/AA-1" },
      },
    }),
  );
  assert.ok(response);
  assert.equal(record(response.result).isError, true);
  assert.equal(calls.length, 0);
});

test("MCP stdio 실행은 초기화·목록 응답만 출력한다", () => {
  const input = `${[
    { jsonrpc: "2.0", id: 1, method: "initialize" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ]
    .map((value) => JSON.stringify(value))
    .join("\n")}\n`;
  const run = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/server/mcp.ts"],
    {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
      input,
      timeout: 5000,
      env: {
        ...process.env,
        JIRA_SITE: "example.atlassian.net",
        JIRA_EMAIL: "test@example.com",
        JIRA_API_TOKEN: "fake-token",
      },
    },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, "");
  const lines = run.stdout
    .trim()
    .split("\n")
    .map((line) => {
      const value: unknown = JSON.parse(line);
      return record(value);
    });
  assert.deepEqual(
    lines.map((line) => line.id),
    [1, 2],
  );
  assert.ok(!run.stdout.includes("fake-token"));
});
