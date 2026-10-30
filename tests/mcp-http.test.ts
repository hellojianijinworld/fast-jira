import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { APP_VERSION } from "../src/domain/product.ts";
import { createHttpServer } from "../src/server/http.ts";
import { createJiraService } from "../src/server/jira-service.ts";
import type { JiraToolDefinition } from "../src/server/jira-tools.ts";
import { createMcpEndpoint } from "../src/server/mcp-server.ts";

test("같은 웹 서버의 MCP는 인증을 요구하며 HTTP와 플러그인 중계 모두 승인을 지킨다", async (t) => {
  let calls = 0,
    terminated = 0;
  const definition: JiraToolDefinition = {
    name: "jira_comment",
    description: "모의 댓글",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  };
  const endpoint = createMcpEndpoint(
    () => ({
      definitions: [definition],
      call: async () => {
        calls++;
        return { ok: true };
      },
    }),
    "test-local-token",
  );
  const jira = createJiraService({
    credentials: {
      site: "example.atlassian.net",
      email: "fake@example.com",
      token: "fake-jira",
    },
    fetcher: async () => {
      throw new Error("Jira 호출 금지");
    },
  });
  const server = createHttpServer(
    jira,
    undefined,
    undefined,
    undefined,
    undefined,
    { mcp: endpoint, origin: "https://fast-jira.local" },
  );
  server.on("request", (request) => {
    if (request.url === "/mcp" && request.method === "DELETE") terminated++;
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const home = await mkdtemp(join(tmpdir(), "jira-mcp-http-"));
  t.after(async () => {
    await endpoint.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(home, { recursive: true, force: true });
  });
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  const healthHost = (host: string) =>
    new Promise<number | undefined>((resolve, reject) => {
      const req = get(
        `${base}/api/health`,
        { headers: { Host: host } },
        (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode));
        },
      );
      req.once("error", reject);
    });
  assert.equal(await healthHost("fast-jira.local"), 200);
  assert.equal(await healthHost("attacker.test"), 403);
  assert.equal(
    (
      await fetch(`${base}/api/unknown`, {
        method: "POST",
        headers: {
          Host: "fast-jira.local",
          Origin: "https://fast-jira.local",
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
    404,
  );
  assert.equal((await fetch(`${base}/mcp`, { method: "POST" })).status, 403);
  assert.equal(
    (
      await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-local-token",
          Origin: "https://attacker.test",
        },
      })
    ).status,
    403,
  );
  await mkdir(join(home, "config"));
  await writeFile(
    join(home, "config/service.json"),
    JSON.stringify({
      version: 1,
      port: address.port,
      node: process.execPath,
      instance: "test",
    }),
  );
  await writeFile(join(home, "config/mcp-token"), "test-local-token", {
    mode: 0o600,
  });
  for (const transport of [
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer test-local-token" } },
    }),
    new StdioClientTransport({
      command: process.execPath,
      args: [resolve("dist/cli/mcp-bridge.js")],
      env: { PATH: process.env.PATH ?? "", FAST_JIRA_HOME: home },
    }),
  ]) {
    let approve = false,
      prompts = 0;
    const client = new Client(
      { name: "test", version: "1" },
      { capabilities: { elicitation: { form: {} } } },
    );
    client.setRequestHandler(ElicitRequestSchema, async () => {
      prompts++;
      return approve
        ? { action: "accept", content: {} }
        : { action: "decline" };
    });
    try {
      await client.connect(transport);
      assert.equal(client.getServerVersion()?.version, APP_VERSION);
      assert.ok(
        (await client.listTools()).tools.some(
          (tool) => tool.name === "jira_comment",
        ),
      );
      const before = calls;
      assert.equal(
        (
          await client.callTool({
            name: "jira_comment",
            arguments: { key: "AA-1" },
          })
        ).isError,
        true,
      );
      assert.equal(calls, before);
      approve = true;
      assert.equal(
        (
          await client.callTool({
            name: "jira_comment",
            arguments: { key: "AA-1" },
          })
        ).isError,
        undefined,
      );
      assert.equal(calls, before + 1);
      assert.equal(prompts, 2);
    } finally {
      if (transport instanceof StreamableHTTPClientTransport)
        await transport.terminateSession();
      await client.close();
    }
  }
  assert.equal(
    terminated,
    2,
    "직접 연결과 플러그인 모두 종료할 때 세션을 삭제한다",
  );
  // 최대 세션 수(32)를 넘는 재접속도 종료 후 슬롯을 재사용한다.
  for (let attempt = 0; attempt < 34; attempt++) {
    const client = new Client({ name: "reconnect", version: "1" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`${base}/mcp`),
      {
        requestInit: { headers: { Authorization: "Bearer test-local-token" } },
      },
    );
    try {
      await client.connect(transport);
      assert.equal((await client.listTools()).tools.length, 1);
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  }
  assert.equal(terminated, 36);
});
