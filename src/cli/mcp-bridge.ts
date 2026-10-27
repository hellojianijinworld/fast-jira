import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ElicitRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createJiraTools } from "../server/jira-tools.ts";
import { installationPaths } from "./config.ts";
import { readServiceConfig } from "./service.ts";

const server = new Server(
  { name: "fast-jira", version: "0.2.0" },
  { capabilities: { tools: {} } },
);
type Connection = { remote: Client; transport: StreamableHTTPClientTransport };
let pending: Promise<Connection> | undefined;
async function disconnect() {
  const previous = pending;
  pending = undefined;
  const connection = await previous?.catch(() => undefined);
  if (!connection) return;
  await connection.transport.terminateSession().catch(() => {});
  await connection.remote.close();
}
async function client() {
  if (pending) return pending;
  pending = (async () => {
    const paths = installationPaths(),
      config = await readServiceConfig(paths);
    if (!config) throw new Error("먼저 Fast Jira Setup을 완료하세요.");
    const token = await readFile(paths.mcpToken, "utf8");
    const supportsApproval = Boolean(
      server.getClientCapabilities()?.elicitation,
    );
    const remote = new Client(
      { name: "fast-jira-plugin", version: "0.2.0" },
      { capabilities: supportsApproval ? { elicitation: { form: {} } } : {} },
    );
    if (supportsApproval)
      remote.setRequestHandler(ElicitRequestSchema, (request) =>
        server.elicitInput(request.params),
      );
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${config.port}/mcp`),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
    );
    try {
      await remote.connect(transport);
    } catch (error) {
      await transport.terminateSession().catch(() => {});
      await remote.close();
      throw error;
    }
    return { remote, transport };
  })().catch(() => {
    pending = undefined;
    throw new Error("Fast Jira가 실행 중인지 Managing으로 확인하세요.");
  });
  return pending;
}
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: createJiraTools(
    () => {
      throw new Error("Managing으로 서비스를 실행하세요.");
    },
    { allowMutations: true },
  ).definitions,
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    return await (await client()).remote.callTool(request.params);
  } catch (error) {
    await disconnect();
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            error instanceof Error ? error.message : "MCP 연결을 확인하세요.",
        },
      ],
    };
  }
});
server.onclose = () => {
  void disconnect().catch(() => {});
};
await server.connect(new StdioServerTransport());

async function shutdown() {
  await disconnect();
  await server.close();
}
process.stdin.once("end", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
