import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { assertNodeSupported, installationPaths } from "../cli/config.ts";
import type { Credentials } from "../domain/connection.ts";
import { createAssistantService } from "./assistant-service.ts";
import { createConnection } from "./connection.ts";
import { loadEnvironment, serverPort } from "./environment.ts";
import { createHttpServer } from "./http.ts";
import { createJiraTools } from "./jira-tools.ts";
import { createMcpEndpoint } from "./mcp-server.ts";
import { createRuntimeUpdater } from "./update-runtime.ts";
export async function startApi() {
  assertNodeSupported();
  let credentials: Credentials | null = null;
  try {
    credentials = loadEnvironment();
  } catch {
    /* 인증 미설정이어도 화면은 제공한다. */
  }
  const port = serverPort();
  const connection = createConnection({
    credentials,
    defaults: {
      site: process.env.JIRA_SITE ?? "",
      email: process.env.JIRA_EMAIL ?? "",
    },
  });
  const assistant = createAssistantService(connection.service);
  const paths = installationPaths(process.env.FAST_JIRA_HOME ?? process.cwd());
  await mkdir(dirname(paths.mcpToken), { recursive: true, mode: 0o700 });
  const token = await readFile(paths.mcpToken, "utf8").catch(
    async (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      const value = randomUUID();
      try {
        await writeFile(paths.mcpToken, value, { mode: 0o600, flag: "wx" });
        return value;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        return readFile(paths.mcpToken, "utf8");
      }
    },
  );
  const mcp = createMcpEndpoint(() => {
    const service = connection.service(),
      tools = createJiraTools(service, { allowMutations: true });
    return {
      ...tools,
      call: async (name: string, args: unknown) => {
        if (connection.service() !== service)
          throw new Error(
            "Jira 연결이 바뀌었어요. 변경 내용을 다시 확인하세요.",
          );
        return tools.call(name, args);
      },
    };
  }, token);
  const server = createHttpServer(
    connection.service,
    undefined,
    connection,
    assistant,
    await createRuntimeUpdater(),
    {
      mcp,
      ...(process.env.FAST_JIRA_ORIGIN
        ? { origin: process.env.FAST_JIRA_ORIGIN }
        : {}),
    },
  );
  server.once("close", () => {
    assistant.dispose();
    void mcp.close();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  console.log(`Fast Jira API: http://127.0.0.1:${port}`);
  return server;
}
