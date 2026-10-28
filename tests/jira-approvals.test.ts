import assert from "node:assert/strict";
import { test } from "node:test";
import { callApprovedJiraTool } from "../src/server/jira-approvals.ts";
import type { ToolService } from "../src/server/mcp-server.ts";

async function execute(...args: Parameters<typeof callApprovedJiraTool>) {
  return (await callApprovedJiraTool(...args)) as {
    results: { status: string }[];
    feedback: string;
    changedKeys: string[];
  };
}
function fixture() {
  const writes: { name: string; args: unknown }[] = [];
  const tools: ToolService = {
    definitions: [
      "jira_apply_changes",
      "jira_create_issue",
      "jira_description",
      "jira_edit_issue",
      "jira_update_issues",
    ].map((name) => ({
      name,
      description: "",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    })),
    call: async (name, args) => {
      writes.push({ name, args });
      return { key: "AA-99" };
    },
  };
  return { tools, writes };
}
test("작업마다 순서대로 묻고 진행한 작업만 고정된 원본으로 실행한다", async () => {
  const f = fixture();
  let asked = 0;
  const fields = { summary: "새 작업" };
  const input = {
    actions: [
      {
        tool: "jira_create_issue",
        arguments: { project: "AA", type: "2", fields },
      },
      {
        tool: "jira_edit_issue",
        arguments: { key: "AA-1", field: "summary", value: "새 제목" },
      },
      {
        tool: "jira_description",
        arguments: {
          key: "AA-1",
          document: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "새 본문" }],
              },
            ],
          },
        },
      },
    ],
  };
  const result = await execute(
    f.tools,
    "jira_apply_changes",
    input,
    async (request) => {
      asked++;
      assert.match(request.title, /진행할까요/);
      assert.equal(request.fields.length, 1);
      fields.summary = "변경된 원본";
      return { approved: asked !== 2, values: {} };
    },
  );
  assert.equal(asked, 3);
  assert.deepEqual(
    f.writes.map((item) => item.name),
    ["jira_create_issue", "jira_description"],
  );
  const first = f.writes[0];
  assert(first);
  assert.equal(
    (first.args as { fields: { summary: string } }).fields.summary,
    "새 작업",
  );
  assert.deepEqual(
    result.results.map((item) => item.status),
    ["applied", "notApproved", "applied"],
  );
});
test("기타 의견은 실행 승인이 아니며 남은 작업도 실행하지 않고 모델에 돌려준다", async () => {
  const f = fixture();
  let asked = 0;
  const result = await execute(
    f.tools,
    "jira_apply_changes",
    {
      actions: [
        {
          tool: "jira_create_issue",
          arguments: {
            project: "AA",
            type: "2",
            fields: { summary: "새 작업" },
          },
        },
        {
          tool: "jira_edit_issue",
          arguments: { key: "AA-1", field: "summary", value: "제목" },
        },
      ],
    },
    async () => {
      asked++;
      return {
        approved: false,
        values: { feedback: "생성이 아니라 기존 이슈를 수정해주세요" },
      };
    },
  );
  assert.equal(asked, 1);
  assert.equal(f.writes.length, 0);
  assert.equal(result.feedback, "생성이 아니라 기존 이슈를 수정해주세요");
  assert.deepEqual(
    result.results.map((item) => item.status),
    ["notApproved", "notApproved"],
  );
});
test("일괄 작업은 이슈별로 쪼개지 않고 한 번 묻고 부분 실패를 구분한다", async () => {
  const f = fixture();
  let asked = 0;
  f.tools.call = async (name, args) => {
    f.writes.push({ name, args });
    return {
      issues: [{ key: "AA-1" }],
      failures: [{ key: "AA-2", error: "권한 없음" }],
    };
  };
  const result = await execute(
    f.tools,
    "jira_update_issues",
    { keys: ["AA-1", "AA-2"], field: "status", value: "Done" },
    async () => {
      asked++;
      return { approved: true, values: {} };
    },
  );
  assert.equal(asked, 1);
  assert.equal(f.writes.length, 1);
  assert.equal(result.results[0]?.status, "partiallyApplied");
  assert.deepEqual(result.changedKeys, ["AA-1"]);
});
test("잘못된 도구·재귀 묶음·초과 요청은 확인 전에 차단한다", async () => {
  const f = fixture();
  let asked = false;
  const ask = async () => {
    asked = true;
    return { approved: true, values: {} };
  };
  for (const actions of [
    [],
    [{ tool: "jira_apply_changes", arguments: {} }],
    [{ tool: "unknown", arguments: {} }],
    Array.from({ length: 51 }, () => ({
      tool: "jira_edit_issue",
      arguments: {},
    })),
  ])
    await assert.rejects(
      execute(f.tools, "jira_apply_changes", { actions }, ask),
    );
  assert.equal(asked, false);
  assert.equal(f.writes.length, 0);
});
