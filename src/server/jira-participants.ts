import type { JsonValue } from "../domain/adf.ts";
import type { UserOption } from "../domain/issue.ts";
import type { ParticipantOption } from "../domain/participants.ts";
import { parseIssueKey, record } from "../domain/validation.ts";
import {
  ensureJiraResponse,
  type JiraClient,
  JiraError,
} from "./jira-client.ts";
import {
  arrayValue,
  decodeParticipantDefinition,
  decodeUsers,
  optionalRecord,
  stringValue,
} from "./jira-decode.ts";
import type { createJiraRead } from "./jira-read.ts";

const invalid = (text: string) => new JiraError(text, 400);
export function createJiraParticipants(
  client: JiraClient,
  read: ReturnType<typeof createJiraRead>,
  site: string,
  listUsers: (project: string) => Promise<UserOption[]>,
) {
  const pathFor = (key: string) =>
    `/rest/api/3/issue/${parseIssueKey(key, "")}`;
  async function editableFields(key: string) {
    const fields = await client.json(`${pathFor(key)}/editmeta`, (value) =>
      record(record(value).fields),
    );
    return Object.entries(fields).flatMap(([id, value]) => {
      const raw = record(value),
        definition =
          id === "assignee"
            ? { id, name: stringValue(raw.name, "담당자"), multiple: false }
            : decodeParticipantDefinition(id, raw);
      if (
        !definition ||
        !Array.isArray(raw.operations) ||
        !raw.operations.includes("set")
      )
        return [];
      return [{ ...definition, required: raw.required === true, raw }];
    });
  }
  async function participantOptions(key: string): Promise<ParticipantOption[]> {
    return (await editableFields(key)).map(({ raw: _raw, ...field }) => field);
  }
  async function participantUsers(key: string, fieldId: string, query: string) {
    if (query.length > 100) throw invalid("검색어가 너무 깁니다.");
    const field = (await editableFields(key)).find(
      (field) => field.id === fieldId,
    );
    if (!field) throw invalid("이 작업참여자 필드를 변경할 수 없습니다.");
    if (field.id === "assignee")
      return client.json(
        `/rest/api/3/user/assignable/search?${new URLSearchParams({ issueKey: parseIssueKey(key, ""), query, maxResults: query ? "50" : "1000" })}`,
        (value) =>
          decodeUsers(
            query
              ? value
              : arrayValue(value).filter(
                  (user) => optionalRecord(user).accountType !== "app",
                ),
          ),
      );
    if (Array.isArray(field.raw.allowedValues))
      return decodeUsers(field.raw.allowedValues).filter((user) =>
        user.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      );
    if (!query) return listUsers(parseIssueKey(key, "").split("-")[0] ?? "");
    const autocomplete = stringValue(field.raw.autoCompleteUrl);
    if (autocomplete) {
      const url = new URL(autocomplete, `https://${site}`);
      if (
        url.origin !== `https://${site}` ||
        !/^\/rest\/api\/(?:1\.0|2|3)\/users?\/(?:picker|search)$/.test(
          url.pathname,
        )
      )
        throw invalid("사용자 검색 경로를 확인할 수 없습니다.");
      url.searchParams.set("query", query);
      return client.json(url.pathname + url.search, (value) =>
        decodeUsers(
          Array.isArray(value)
            ? value
            : arrayValue(optionalRecord(value).users ?? []),
        ),
      );
    }
    return client.json(
      `/rest/api/3/user/search?${new URLSearchParams({ query, maxResults: "50" })}`,
      decodeUsers,
    );
  }
  async function updateParticipants(key: string, input: unknown) {
    key = parseIssueKey(key, "");
    if (!Array.isArray(input) || !input.length || input.length > 100)
      throw invalid("변경할 작업참여자 필드를 선택하세요.");
    // 저장 직전에 권한과 필수 여부를 다시 확인한다. 화면에서 임의의 필드 ID를 보낼 수 없다.
    const available = await editableFields(key);
    const fields: Record<string, JsonValue> = {};
    for (const value of input) {
      const change = record(value),
        id = stringValue(change.id);
      const field = available.find((field) => field.id === id),
        ids = change.userIds;
      if (!field || Object.hasOwn(fields, id))
        throw invalid("변경할 작업참여자 필드가 올바르지 않습니다.");
      if (
        !Array.isArray(ids) ||
        ids.length > 100 ||
        ids.some(
          (id) => typeof id !== "string" || !/^[A-Za-z0-9:-]{5,128}$/.test(id),
        ) ||
        new Set(ids).size !== ids.length ||
        (!field.multiple && ids.length > 1) ||
        (field.required && !ids.length)
      )
        throw invalid(`${field.name} 지정값을 확인하세요.`);
      fields[id] = field.multiple
        ? ids.map((accountId) => ({ accountId }))
        : ids.length
          ? { accountId: ids[0] }
          : null;
    }
    await ensureJiraResponse(
      await client.request(pathFor(key), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      }),
    );
    return read.detail(key);
  }
  return { participantOptions, participantUsers, updateParticipants };
}
