import type { LogEntry } from "../domain/log.ts";
import { parseIssueKey } from "../domain/validation.ts";
import { createBulkService } from "./bulk-service.ts";
import { createJiraActivity } from "./jira-activity.ts";
import { type Credentials, createJiraClient } from "./jira-client.ts";
import { createJiraContent } from "./jira-content.ts";
import { createJiraCreation } from "./jira-create.ts";
import { createJiraEdit } from "./jira-edit.ts";
import { createJiraMetadata } from "./jira-metadata.ts";
import { createParentOptions } from "./jira-parents.ts";
import { createJiraParticipants } from "./jira-participants.ts";
import { createJiraQuery } from "./jira-query.ts";
import { createJiraRead } from "./jira-read.ts";
import { createJiraSync } from "./jira-sync.ts";
import { loggedFetch } from "./network-log.ts";
export function createJiraService(options: {
  credentials: Credentials;
  fetcher?: typeof fetch;
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
  const query = createJiraQuery(client, metadata);
  const read = createJiraRead(
    client,
    metadata,
    options.credentials.site,
    query.relatedFieldIds,
    metadata.peopleFields,
  );
  const edit = createJiraEdit(client, metadata, read);
  return {
    activity: createJiraActivity(client),
    site: options.credentials.site,
    parentOptions: createParentOptions(client, metadata),
    issueKey: (input: unknown) =>
      parseIssueKey(input, options.credentials.site),
    ...metadata,
    ...read,
    ...edit,
    ...createJiraCreation(client, metadata),
    ...createJiraParticipants(
      client,
      read,
      options.credentials.site,
      metadata.filterUsers,
    ),
    ...createJiraContent(client, metadata),
    ...query,
    sync: createJiraSync(client, metadata, query),
    bulk: createBulkService({ ...read, ...edit }),
  };
}
export type JiraService = ReturnType<typeof createJiraService>;
