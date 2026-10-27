import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import type { JiraToolDefinition } from "./jira-tools.ts";
import { createMcpEndpoint } from "./mcp-server.ts";

/** 대화 중에만 열린다. Jira 인증 대신 일회용 로컬 MCP 접근권을 전달한다. */
export async function createAssistantMcp(
  definitions: readonly JiraToolDefinition[],
  call: (name: string, args: unknown) => Promise<unknown>,
) {
  const token = randomUUID(),
    endpoint = createMcpEndpoint(() => ({ definitions, call }), token);
  const server = createServer((req, res) => {
    if (req.url !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    void endpoint.handle(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Claude 도구 연결을 열지 못했어요.");
  return {
    config: {
      type: "http" as const,
      url: `http://127.0.0.1:${address.port}/mcp`,
      headers: { Authorization: `Bearer ${token}` },
    },
    close() {
      void endpoint.close();
      server.closeAllConnections();
      server.close();
    },
  };
}
