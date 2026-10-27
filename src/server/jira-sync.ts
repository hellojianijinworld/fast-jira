import type { KnownIssue, SyncBatch } from "../domain/sync.ts";
import { parseIssueKey, record, requiredString } from "../domain/validation.ts";
import type { ChangedIssue } from "../domain/wire.ts";
import {
  ensureJiraResponse,
  type JiraClient,
  JiraError,
} from "./jira-client.ts";
import {
  arrayValue,
  decodeIssue,
  optionalRecord,
  stringValue,
} from "./jira-decode.ts";
import { type createJiraMetadata, projectKeys } from "./jira-metadata.ts";
import {
  type BrowseOptions,
  type createJiraQuery,
  listFields,
} from "./jira-query.ts";

export function createJiraSync(
  client: JiraClient,
  metadata: ReturnType<typeof createJiraMetadata>,
  query: ReturnType<typeof createJiraQuery>,
) {
  async function fetchIssues(ids: string[], fields: string[]) {
    const response = await ensureJiraResponse(
      await client.request("/rest/api/3/issue/bulkfetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueIdsOrKeys: ids, fields }),
      }),
    );
    const data = record(await response.json());
    // 누락은 삭제·열람 불가지만 issueErrors는 재시도 가능한 실패이므로 일괄 반영하지 않는다.
    if (arrayValue(data.issueErrors ?? []).length)
      throw new JiraError(
        "묶음 조회 일부가 실패해 기존 목록을 유지합니다.",
        502,
      );
    const issues = arrayValue(data.issues);
    const returned = issues.map((issue) =>
      requiredString(record(issue).id, "이슈 ID"),
    );
    if (
      new Set(returned).size !== returned.length ||
      returned.some((id) => !ids.includes(id))
    )
      throw new JiraError("묶음 응답 ID가 올바르지 않습니다.", 502);
    return issues;
  }
  return async (options: BrowseOptions, input: unknown): Promise<SyncBatch> => {
    let known: KnownIssue[], since: number;
    const started = Date.now();
    try {
      const data = record(input);
      since = Date.parse(requiredString(data.since, "확인 시각"));
      if (
        !Number.isFinite(since) ||
        since > started ||
        started - since > 7 * 86400000
      )
        throw new Error();
      const values = arrayValue(data.known);
      if (values.length > 10000) throw new Error();
      known = values.map((value) => {
        const issue = record(value),
          id = requiredString(issue.id, "이슈 ID");
        if (!/^\d{1,20}$/.test(id)) throw new Error();
        const updated = requiredString(issue.updated, "수정 시각");
        if (
          !Number.isFinite(Date.parse(updated)) ||
          (issue.needsParticipants !== undefined &&
            typeof issue.needsParticipants !== "boolean")
        )
          throw new Error();
        return {
          id,
          key: parseIssueKey(issue.key, ""),
          updated,
          ...(issue.needsParticipants === true
            ? { needsParticipants: true }
            : {}),
          parent:
            issue.parent === undefined
              ? ""
              : issue.parent === ""
                ? ""
                : parseIssueKey(issue.parent, ""),
          project:
            issue.project === undefined
              ? ""
              : requiredString(issue.project, "프로젝트"),
        };
      });
      if (new Set(known.map((issue) => issue.id)).size !== known.length)
        throw new Error();
    } catch {
      throw new JiraError(
        "동기화 시각 또는 이슈 목록이 올바르지 않습니다.",
        400,
      );
    }
    const projects = projectKeys(options.projects);
    const batch = await query.recentChanges(
      options,
      Math.max(1, Math.ceil((started - since) / 60000) + 2),
      1000,
    );
    const byId = new Map(batch.issues.map((issue) => [issue.id, issue]));
    const removed: string[] = [],
      changed: string[] = [];
    for (let offset = 0; offset < known.length; offset += 1000) {
      const group = known.slice(offset, offset + 1000);
      const raw = await fetchIssues(
        group.map((issue) => issue.id),
        ["updated", "parent", "project"],
      );
      const present = new Map(
        raw.map((value) => {
          const data = record(value),
            fields = record(data.fields);
          const id = requiredString(data.id, "이슈 ID"),
            key = parseIssueKey(data.key, "");
          if (!group.some((issue) => issue.id === id))
            throw new JiraError("묶음 응답 ID가 올바르지 않습니다.", 502);
          const updated = requiredString(fields.updated, "수정 시각");
          if (!Number.isFinite(Date.parse(updated)))
            throw new JiraError("묶음 수정 시각이 올바르지 않습니다.", 502);
          return [
            id,
            {
              key,
              updated,
              parent: stringValue(optionalRecord(fields.parent).key),
              project: stringValue(optionalRecord(fields.project).key),
            },
          ];
        }),
      );
      for (const before of group) {
        const current = present.get(before.id);
        if (!current) {
          removed.push(before.key);
          byId.delete(before.id);
          continue;
        }
        if (current.key !== before.key) removed.push(before.key);
        const delta = byId.get(before.id);
        if (
          (before.needsParticipants &&
            delta?.participantFields === undefined) ||
          ((current.updated !== before.updated ||
            current.key !== before.key ||
            current.parent !== before.parent ||
            current.project !== before.project) &&
            (!delta ||
              Date.parse(delta.updated) < Date.parse(current.updated) ||
              delta.key !== current.key ||
              delta.parent !== current.parent ||
              delta.project !== current.project))
        )
          changed.push(before.id);
      }
    }
    const [related, definitions] = await Promise.all([
      query.relatedFieldIds(),
      metadata.peopleFields(),
    ]);
    for (let offset = 0; offset < changed.length; offset += 100) {
      const raw = await fetchIssues(changed.slice(offset, offset + 100), [
        ...listFields.split(","),
        ...definitions.map((field) => field.id),
      ]);
      const issues = raw.map((value) =>
        decodeIssue(value, related, definitions),
      );
      const matches = new Set<string>();
      for (let index = 0; index < issues.length; index += 50) {
        const result = await query.matchesIssues(
          issues.slice(index, index + 50).map((issue) => issue.key),
          options,
        );
        for (const key of result.keys) matches.add(key);
      }
      for (const issue of issues)
        byId.set(issue.id, {
          ...issue,
          matches: projects.includes(issue.project) && matches.has(issue.key),
        });
      if (issues.length !== changed.slice(offset, offset + 100).length)
        throw new JiraError(
          "묶음 재확인 중 목록이 바뀌어 다시 확인해야 합니다.",
          502,
        );
    }
    const issues: ChangedIssue[] = await metadata.withDefaultPriorities([
      ...byId.values(),
    ]);
    return {
      issues,
      removed,
      checkedAt: new Date(started).toISOString(),
      ancestors: await query.ancestors(issues.filter((issue) => issue.matches)),
    };
  };
}
