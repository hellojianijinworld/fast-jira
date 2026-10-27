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
        ? { action: "accept", content: { approve: true } }
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
