import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { JsonValue } from "../domain/adf.ts";
import type { ApprovalHandler } from "../domain/assistant-approval.ts";
import { isRecord } from "../domain/validation.ts";
import { callApprovedJiraTool } from "./jira-approvals.ts";
import type { JiraToolDefinition } from "./jira-tools.ts";

export interface ToolService {
  definitions: readonly JiraToolDefinition[];
  call(name: string, args: unknown): Promise<unknown>;
  describeChange?(name: string, args: unknown): unknown;
}
/** 승인 응답은 MCP 클라이언트가 제공한다. 모델이 보낸 승인 플래그는 사용하지 않는다. */
export function createToolServer(
  tools: () => ToolService,
  approve?: ApprovalHandler,
) {
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
      const ask: ApprovalHandler =
        approve ??
        (async (confirmation) => {
          if (!server.getClientCapabilities()?.elicitation)
            throw new Error(
              "이 MCP 클라이언트는 사용자 확인을 지원하지 않아 변경을 실행할 수 없어요.",
            );
          const response = await server.elicitInput({
            mode: "form",
            _meta: { "fast-jira/confirmation": true },
            message: `${confirmation.title}\n${confirmation.description}\n${confirmation.details}`,
            requestedSchema: {
              type: "object",
              properties: {
                feedback: {
                  type: "string",
                  title:
                    "기타 의견 (의견을 적으면 실행하지 않고 다시 제안합니다)",
                },
              },
              required: [],
            },
          });
          return {
            approved:
              response.action === "accept" && !response.content?.feedback,
            values: (response.content ?? {}) as Record<string, JsonValue>,
          };
        });
      const result = await callApprovedJiraTool(
        current,
        request.params.name,
        request.params.arguments,
        ask,
      );
      return {
        ...(!definition.annotations.readOnlyHint &&
        isRecord(result) &&
        Array.isArray(result.results) &&
        result.results.every(
          (item) => isRecord(item) && item.status !== "applied",
        )
          ? { isError: true }
          : {}),
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result) ?? "null",
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
export function createMcpEndpoint(
  tools: () => ToolService,
  token: string,
  approve?: ApprovalHandler,
) {
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
          const server = createToolServer(tools, approve);
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
