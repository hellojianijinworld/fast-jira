import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { JiraToolDefinition } from "./jira-tools.ts";

export interface ToolService {
  definitions: readonly JiraToolDefinition[];
  call(name: string, args: unknown): Promise<unknown>;
  describeChange?(name: string, args: unknown): unknown;
}
/** 승인 응답은 MCP 클라이언트가 제공한다. 모델이 보낸 승인 플래그는 사용하지 않는다. */
export function createToolServer(tools: () => ToolService) {
  const server = new Server(
    { name: "fast-jira", version: "0.2.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...tools().definitions],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const current = tools(),
        definition = current.definitions.find(
          (tool) => tool.name === request.params.name,
        );
      if (!definition) throw new Error("지원하지 않는 도구입니다.");
      if (!definition.annotations.readOnlyHint) {
        if (!server.getClientCapabilities()?.elicitation)
          throw new Error(
            "이 MCP 클라이언트는 사용자 확인을 지원하지 않아 변경을 실행할 수 없어요.",
          );
        const change = JSON.stringify(
          current.describeChange
            ? current.describeChange(
                request.params.name,
                request.params.arguments,
              )
            : (request.params.arguments ?? {}),
          null,
          2,
        );
        if (change.length > 30000)
          throw new Error(
            "확인할 변경 내용이 너무 길어요. 요청을 나눠 주세요.",
          );
        const approval = await server.elicitInput({
          mode: "form",
          message: `Jira 변경 요청: ${definition.name}\n${change}\n이 변경을 실행할까요?`,
          requestedSchema: {
            type: "object",
            properties: {
              approve: { type: "boolean", title: "이 변경 실행 승인" },
            },
            required: ["approve"],
          },
        });
        if (approval.action !== "accept" || approval.content?.approve !== true)
          throw new Error("승인하지 않아 Jira를 변경하지 않았어요.");
      }
      return {
        content: [
          {
            type: "text" as const,
            text:
              JSON.stringify(
                await current.call(
                  request.params.name,
                  request.params.arguments,
                ),
              ) ?? "null",
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text:
              error instanceof Error ? error.message : "MCP 요청에 실패했어요.",
          },
        ],
      };
    }
  });
  return server;
}

/** 웹 서버와 대화용 연결이 같은 표준 전송·도구 처리기를 사용한다. */
export function createMcpEndpoint(tools: () => ToolService, token: string) {
  const sessions = new Map<
    string,
    { transport: StreamableHTTPServerTransport; server: Server; used: number }
  >();
  const equal = (value: string) => {
    const left = Buffer.from(value),
      right = Buffer.from(`Bearer ${token}`);
    return left.length === right.length && timingSafeEqual(left, right);
  };
  return {
    async handle(req: IncomingMessage, res: ServerResponse) {
      if (req.headers.origin || !equal(req.headers.authorization ?? "")) {
        res.writeHead(403).end();
        return;
      }
      try {
        const id = req.headers["mcp-session-id"];
        let session = typeof id === "string" ? sessions.get(id) : undefined;
        if (!session) {
          if (id || req.method !== "POST") {
            res.writeHead(id ? 404 : 405).end();
            return;
          }
          for (const [key, item] of sessions)
            if (Date.now() - item.used > 30 * 60_000) {
              sessions.delete(key);
              void item.server.close();
            }
          if (sessions.size >= 32) {
            res.writeHead(503).end();
            return;
          }
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: true,
          });
          const server = createToolServer(tools);
          session = { transport, server, used: Date.now() };
          const current = session;
          transport.onclose = () => {
            if (transport.sessionId) sessions.delete(transport.sessionId);
          };
          await server.connect(transport);
          await transport.handleRequest(req, res);
          if (transport.sessionId) sessions.set(transport.sessionId, current);
          else await server.close();
        } else {
          session.used = Date.now();
          await session.transport.handleRequest(req, res);
        }
      } catch {
        if (!res.headersSent) res.writeHead(400);
        res.end();
      }
    },
    async close() {
      await Promise.all(
        [...sessions.values()].map((item) => item.server.close()),
      );
      sessions.clear();
    },
  };
}
