import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { JiraToolDefinition } from "../src/server/jira-tools.ts";
import { createToolServer } from "../src/server/mcp-server.ts";

async function fixture(answer: "accept" | "decline" | null) {
  let writes = 0,
    prompts = 0;
  const definition = (name: string, read: boolean): JiraToolDefinition => ({
    name,
    description: name,
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: read, destructiveHint: !read },
  });
  const server = createToolServer(() => ({
    definitions: [definition("read", true), definition("write", false)],
    call: async (name) => {
      if (name === "write") writes++;
      return { ok: true };
    },
  }));
  const client = new Client(
    { name: "test", version: "1" },
    { capabilities: answer ? { elicitation: { form: {} } } : {} },
  );
  if (answer)
    client.setRequestHandler(ElicitRequestSchema, async () => {
      prompts++;
      return answer === "accept"
        ? { action: "accept", content: {} }
        : { action: "decline" };
    });
  const [one, two] = InMemoryTransport.createLinkedPair();
  await server.connect(one);
  await client.connect(two);
  return { client, server, writes: () => writes, prompts: () => prompts };
}
for (const answer of ["accept", "decline", null] as const)
  test(`MCP 변경은 사용자 승인 ${answer} 결과를 지킨다`, async (t) => {
    const f = await fixture(answer);
    t.after(async () => {
      await f.client.close();
      await f.server.close();
    });
    const result = await f.client.callTool({ name: "write", arguments: {} });
    assert.equal(f.writes(), answer === "accept" ? 1 : 0);
    assert.equal(result.isError, answer === "accept" ? undefined : true);
    assert.equal(f.prompts(), answer === null ? 0 : 1);
  });
test("조회는 승인 요청 없이 실행하고 알 수 없는 도구는 거부한다", async (t) => {
  const f = await fixture("accept");
  t.after(async () => {
    await f.client.close();
    await f.server.close();
  });
  assert.equal(
    (await f.client.callTool({ name: "read", arguments: {} })).isError,
    undefined,
  );
  assert.equal(f.prompts(), 0);
  assert.equal(f.writes(), 0);
  assert.equal(
    (await f.client.callTool({ name: "unknown", arguments: {} })).isError,
    true,
  );
});

test("표준 MCP도 한 작업씩 묻고 건너뛴 작업을 실행하지 않는다", async (t) => {
  const calls: unknown[] = [];
  let prompts = 0;
  const definitions = [
    "jira_apply_changes",
    "jira_edit_issue",
    "jira_create_issue",
  ].map((name) => ({
    name,
    description: name,
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
      additionalProperties: false as const,
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  }));
  const server = createToolServer(() => ({
    definitions,
    call: async (name, args) => {
      calls.push({ name, args });
      return { key: "AA-2" };
    },
  }));
  const client = new Client(
    { name: "test", version: "1" },
    { capabilities: { elicitation: { form: {} } } },
  );
  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    prompts++;
    assert(request.params.mode === "form");
    assert("feedback" in request.params.requestedSchema.properties);
    return prompts === 1
      ? { action: "decline" }
      : { action: "accept", content: {} };
  });
  const [one, two] = InMemoryTransport.createLinkedPair();
  await server.connect(one);
  await client.connect(two);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  const result = await client.callTool({
    name: "jira_apply_changes",
    arguments: {
      actions: [
        {
          tool: "jira_edit_issue",
          arguments: { key: "AA-1", field: "summary", value: "새 제목" },
        },
        {
          tool: "jira_create_issue",
          arguments: {
            project: "AA",
            type: "2",
            fields: { summary: "후속 작업" },
          },
        },
      ],
    },
  });
  assert.equal(prompts, 2);
  assert.equal(calls.length, 1);
  assert.equal((calls[0] as { name: string }).name, "jira_create_issue");
  assert.match(JSON.stringify(result), /notApproved/);
});
