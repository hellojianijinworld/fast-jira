import type { LogEntry } from "../domain/log.ts";
import { loadEnvironment, serverPort } from "./environment.ts";
import { createHttpServer } from "./http.ts";
import { createJiraService } from "./jira-service.ts";
export async function startApi() {
  const credentials = loadEnvironment(),
    port = serverPort();
  const listeners = new Set<(entry: LogEntry) => void>();
  const service = createJiraService({
    credentials,
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
  await service.authenticate();
  const server = createHttpServer(service, (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
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
