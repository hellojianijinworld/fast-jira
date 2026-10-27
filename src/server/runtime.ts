import type { Credentials } from "../domain/connection.ts";
import type { LogEntry } from "../domain/log.ts";
import { createAssistantService } from "./assistant-service.ts";
import { createConnection } from "./connection.ts";
import { loadEnvironment, serverPort } from "./environment.ts";
import { createHttpServer } from "./http.ts";
export async function startApi() {
  let credentials: Credentials | null = null;
  try {
    credentials = loadEnvironment();
  } catch {
    /* 인증 미설정이어도 화면은 제공한다. */
  }
  const port = serverPort();
  const listeners = new Set<(entry: LogEntry) => void>();
  const connection = createConnection({
    credentials,
    defaults: {
      site: process.env.JIRA_SITE ?? "",
      email: process.env.JIRA_EMAIL ?? "",
    },
    ...(process.env.JIRA_RELATED_FIELDS === undefined
      ? {}
      : {
          relatedFieldNames: process.env.JIRA_RELATED_FIELDS.split(",")
            .map((name) => name.trim())
            .filter(Boolean),
        }),
    loggingEnabled: () => listeners.size > 0,
    onLog: (entry) => {
      for (const listener of listeners) listener(entry);
    },
  });
  const assistant = createAssistantService(connection.service);
  const server = createHttpServer(
    connection.service,
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    undefined,
    connection,
    assistant,
  );
  server.once("close", () => assistant.dispose());
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
