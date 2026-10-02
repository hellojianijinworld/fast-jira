import type { LogEntry } from "../domain/log.ts";
import { parseIssueKey } from "../domain/validation.ts";
import { createBulkService } from "./bulk-service.ts";
import { type Credentials, createJiraClient } from "./jira-client.ts";
import { createJiraContent } from "./jira-content.ts";
import { createJiraEdit } from "./jira-edit.ts";
import { createJiraMetadata } from "./jira-metadata.ts";
import { createJiraQuery } from "./jira-query.ts";
import { createJiraRead } from "./jira-read.ts";
import { loggedFetch } from "./network-log.ts";
export function createJiraService(options: {
  credentials: Credentials;
  fetcher?: typeof fetch;
  relatedFieldNames?: readonly string[];
  onLog?: (entry: LogEntry) => void;
  loggingEnabled?: () => boolean;
}) {
  const fetcher = options.fetcher ?? fetch;
  const client = createJiraClient(
    options.credentials,
    options.onLog
      ? loggedFetch(fetcher, options.onLog, options.loggingEnabled)
      : fetcher,
  );
  const metadata = createJiraMetadata(client);
  const read = createJiraRead(client, metadata, options.credentials.site);
  const edit = createJiraEdit(client, metadata, read);
  return {
    site: options.credentials.site,
    issueKey: (input: unknown) =>
      parseIssueKey(input, options.credentials.site),
    ...metadata,
    ...read,
    ...edit,
    ...createJiraContent(client, metadata),
    ...createJiraQuery(
      client,
      metadata,
      options.relatedFieldNames ?? [
        "디자인 담당자",
        "보조 디자인 담당자",
        "프론트엔드 개발 담당자",
        "백엔드 개발 담당자",
      ],
    ),
    bulk: createBulkService({ ...read, ...edit }),
  };
}
export type JiraService = ReturnType<typeof createJiraService>;
