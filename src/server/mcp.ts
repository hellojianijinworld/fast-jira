import { createInterface } from "node:readline";
import { loadEnvironment } from "./environment.ts";
import { createJiraClient } from "./jira-client.ts";
import { createJiraService } from "./jira-service.ts";
import { createJiraTools } from "./jira-tools.ts";
import { createMcpHandler } from "./mcp-handler.ts";

const credentials = loadEnvironment();
const handler = createMcpHandler(
  createJiraClient(credentials),
  credentials.site,
  createJiraTools(createJiraService({ credentials }), {
    allowMutations: false,
  }),
);
for await (const line of createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})) {
  const response = await handler.handleLine(line);
  if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
}
