import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { isRecord, record } from "../domain/validation.ts";
import type { JiraToolDefinition } from "./jira-tools.ts";

/** 대화 중에만 열린다. Claude에는 일회용 MCP 접근권만 주고 Jira 토큰은 서버에 둔다. */
export async function createAssistantMcp(
  definitions: readonly JiraToolDefinition[],
  call: (name: string, args: unknown) => Promise<unknown>,
) {
  const token = randomUUID();
  const server = createServer(async (req, res) => {
    if (
      req.headers.origin ||
      req.headers.authorization !== `Bearer ${token}` ||
      req.url !== "/mcp"
    ) {
      res.writeHead(403).end();
      return;
    }
    if (req.method === "DELETE") {
      res.writeHead(200).end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    let size = 0,
      body = "";
    req.setEncoding("utf8");
    try {
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size > 512_000) {
          res.writeHead(413).end();
          return;
        }
        body += chunk.toString();
      }
      const input = record(JSON.parse(body));
      if (!Object.hasOwn(input, "id")) {
        res.writeHead(202).end();
        return;
      }
      if (typeof input.id !== "number" && typeof input.id !== "string") {
        res.writeHead(400).end();
        return;
      }
      const params = isRecord(input.params) ? input.params : {};
      let result: unknown;
      if (input.method === "initialize")
        result = {
          protocolVersion:
            typeof params.protocolVersion === "string"
              ? params.protocolVersion
              : "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "fast-jira", version: "0.1.0" },
        };
      else if (input.method === "ping") result = {};
      else if (input.method === "tools/list") result = { tools: definitions };
      else if (
        input.method === "tools/call" &&
        definitions.some((tool) => tool.name === params.name)
      ) {
        try {
          result = {
            content: [
              {
                type: "text",
                text:
                  JSON.stringify(
                    await call(String(params.name), params.arguments),
                  ) ?? "null",
              },
            ],
          };
        } catch (error) {
          result = {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? error.message
                    : "도구 요청에 실패했어요.",
              },
            ],
          };
        }
      } else {
        res.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: input.id,
            error: {
              code: -32601,
              message: "지원하지 않는 도구 요청입니다.",
            },
          }),
        );
        return;
      }
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ jsonrpc: "2.0", id: input.id, result }));
    } catch {
      if (!res.headersSent) res.writeHead(400);
      res.end();
    }
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
      server.closeAllConnections();
      server.close();
    },
  };
}
