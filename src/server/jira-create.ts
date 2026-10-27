import type {
  CreateField,
  CreateMetadata,
  IssueDraft,
} from "../domain/create-issue.ts";
import { issueDraft } from "../domain/create-issue.ts";
import { isRecord, parseIssueKey, record } from "../domain/validation.ts";
import { createPromiseCache } from "./cache.ts";
import {
  ensureJiraResponse,
  type JiraClient,
  JiraError,
} from "./jira-client.ts";
import { arrayValue, decodeIssue, stringValue } from "./jira-decode.ts";
import type { createJiraMetadata } from "./jira-metadata.ts";

export function createJiraCreation(
  client: JiraClient,
  catalog: ReturnType<typeof createJiraMetadata>,
) {
  const cache = createPromiseCache<CreateMetadata>();
  const typeCatalog = createPromiseCache<Record<string, unknown>[]>();
  async function creationTypes(project: string) {
    const types = await catalog.projectTypes(project);
    if (types.every((type) => type.hierarchyLevel !== null)) return types;
    const all = await typeCatalog("all", () =>
      client.json("/rest/api/3/issuetype", (value) =>
        arrayValue(value).map(record),
      ),
    );
    return types.map((type) => {
      const raw = all.find((item) => item.id === type.id);
      return {
        ...type,
        hierarchyLevel:
          type.hierarchyLevel ??
          (raw?.subtask === true
            ? -1
            : typeof raw?.hierarchyLevel === "number"
              ? raw.hierarchyLevel
              : null),
      };
    });
  }
  const receipts = new Map<
    string,
    { signature: string; result: Promise<{ key: string }> }
  >();
  async function creationMetadata(project: string, type: string) {
    issueDraft({ project, type, fields: {} });
    return cache(`${project}:${type}`, async () => {
      const found = (await creationTypes(project)).find(
        (item) => item.id === type,
      );
      if (!found)
        throw new JiraError(
          "이 프로젝트에서 생성할 수 있는 유형을 선택하세요.",
          400,
        );
      const fields: CreateField[] = [];
      let startAt = 0;
      for (;;) {
        const data = await client.json(
          `/rest/api/3/issue/createmeta/${project}/issuetypes/${type}?startAt=${startAt}&maxResults=100`,
          record,
        );
        const values = arrayValue(data.fields);
        for (const value of values) {
          const field = record(value),
            schema = record(field.schema ?? {});
          const id = stringValue(field.fieldId ?? field.key);
          if (!id || ["project", "issuetype", "parent"].includes(id)) continue;
          fields.push({
            id,
            name: stringValue(field.name) || id,
            required: field.required === true,
            type:
              id === "environment" ||
              stringValue(schema.custom).endsWith(":textarea")
                ? "textarea"
                : stringValue(schema.type) || "unknown",
            items: stringValue(schema.items),
            allowed: arrayValue(field.allowedValues ?? []).flatMap((value) => {
              const option = record(value),
                id = stringValue(option.id ?? option.accountId ?? option.value);
              return id
                ? [
                    {
                      id,
                      name:
                        stringValue(
                          option.name ?? option.displayName ?? option.value,
                        ) || id,
                    },
                  ]
                : [];
            }),
            ...(field.defaultValue === undefined
              ? {}
              : {
                  defaultValue: field.defaultValue as NonNullable<
                    CreateField["defaultValue"]
                  >,
                }),
          });
        }
        startAt += values.length;
        if (
          !values.length ||
          data.isLast === true ||
          (typeof data.total === "number" && startAt >= data.total) ||
          (data.isLast === undefined &&
            data.total === undefined &&
            values.length < 100)
        )
          break;
      }
      return { project, type, level: found.hierarchyLevel, fields };
    });
  }
  async function creationParents(
    project: string,
    type: string,
    query = "",
    token = "",
  ) {
    const meta = await creationMetadata(project, type);
    if (meta.level === null)
      throw new JiraError("Jira 유형의 계층을 확인하지 못했어요.", 400);
    if (query.length > 200 || /[\r\n]/.test(query))
      throw new JiraError("검색어를 한 줄로 입력하세요.", 400);
    const ids = (await creationTypes(project))
      .filter((item) => item.hierarchyLevel === (meta.level ?? 0) + 1)
      .map((item) => item.id);
    if (!ids.length) return { issues: [], nextPageToken: null };
    if (ids.some((id) => !/^\d{1,20}$/.test(id)))
      throw new JiraError("Jira 유형을 확인하세요.", 502);
    const term = query.trim();
    const condition = term
      ? ` AND (${/^[A-Z][A-Z0-9_]*-\d+$/i.test(term) ? `key = ${term.toUpperCase()} OR ` : ""}summary ~ ${JSON.stringify(term)})`
      : "";
    return client.json(
      `/rest/api/3/search/jql?${new URLSearchParams({ jql: `project = ${project} AND issuetype in (${ids.join(",")})${condition} ORDER BY updated DESC`, fields: "summary,project,issuetype,parent,status", maxResults: "30", ...(token ? { nextPageToken: token } : {}) })}`,
      (value) => {
        const data = record(value);
        return {
          issues: arrayValue(data.issues).map((value) => decodeIssue(value)),
          nextPageToken: stringValue(data.nextPageToken) || null,
        };
      },
    );
  }
  async function validateCreation(
    value: unknown,
    complete = false,
  ): Promise<IssueDraft> {
    let draft: IssueDraft;
    try {
      draft = issueDraft(value);
    } catch (error) {
      throw new JiraError(
        error instanceof Error ? error.message : "생성안을 확인하세요.",
        400,
      );
    }
    const meta = await creationMetadata(draft.project, draft.type);
    if (draft.parent) {
      const parent = await client.json(
        `/rest/api/3/issue/${parseIssueKey(draft.parent, "")}?fields=project,issuetype`,
        (value) => decodeIssue(value),
      );
      const level =
        parent.hierarchyLevel ??
        (await creationTypes(draft.project)).find(
          (type) => type.id === parent.issueTypeId,
        )?.hierarchyLevel;
      if (
        parent.project !== draft.project ||
        meta.level === null ||
        level !== meta.level + 1
      )
        throw new JiraError(
          "같은 프로젝트에서 바로 상위 계층의 이슈를 선택하세요.",
          400,
        );
    } else if (complete && meta.level === -1)
      throw new JiraError("서브태스크는 상위 이슈가 필요합니다.", 400);
    for (const [id, value] of Object.entries(draft.fields)) {
      const field = meta.fields.find((field) => field.id === id);
      if (!field) throw new JiraError(`생성할 수 없는 필드입니다: ${id}`, 400);
      const values = Array.isArray(value) ? value : [value];
      if (
        field.allowed.length &&
        values.some(
          (item) =>
            item !== null &&
            item !== "" &&
            !field.allowed.some(
              (option) =>
                option.id ===
                (isRecord(item)
                  ? String(item.id ?? item.accountId ?? item.value)
                  : String(item)),
            ),
        )
      )
        throw new JiraError(`${field.name}의 선택 값을 확인하세요.`, 400);
    }
    if (complete) {
      if (
        typeof draft.fields.summary !== "string" ||
        !draft.fields.summary.trim() ||
        draft.fields.summary.length > 255
      )
        throw new JiraError("제목을 1~255자 입력하세요.", 400);
      for (const field of meta.fields) {
        const value = draft.fields[field.id] ?? field.defaultValue;
        if (
          field.required &&
          (value == null ||
            value === "" ||
            (Array.isArray(value) && !value.length))
        )
          throw new JiraError(`${field.name}을(를) 입력하세요.`, 400);
      }
    }
    return draft;
  }
  function createIssue(value: unknown, requestId: string) {
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId))
      throw new JiraError("생성 요청을 확인하세요.", 400);
    const signature = JSON.stringify(value),
      previous = receipts.get(requestId);
    if (previous) {
      if (previous.signature !== signature)
        throw new JiraError(
          "이전 생성 요청과 내용이 다릅니다. 새 생성 창에서 다시 시도하세요.",
          409,
        );
      return previous.result;
    }
    if (receipts.size >= 128) {
      const oldest = receipts.keys().next().value;
      if (oldest) receipts.delete(oldest);
    }
    const result = (async () => {
      const draft = await validateCreation(value, true);
      const response = await ensureJiraResponse(
        await client.request("/rest/api/3/issue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: {
              ...draft.fields,
              project: { key: draft.project },
              issuetype: { id: draft.type },
              ...(draft.parent ? { parent: { key: draft.parent } } : {}),
            },
          }),
        }),
      );
      return { key: parseIssueKey(record(await response.json()).key, "") };
    })();
    receipts.set(requestId, { signature, result });
    // Jira가 명시적으로 거절한 요청만 재입력을 허용한다. 응답 유실은 중복 생성하지 않는다.
    void result.catch((error) => {
      if (
        error instanceof JiraError &&
        error.status >= 400 &&
        error.status < 500
      )
        receipts.delete(requestId);
    });
    return result;
  }
  async function creationUsers(project: string, type: string, id: string) {
    const field = (await creationMetadata(project, type)).fields.find(
      (field) => field.id === id,
    );
    if (!field || !(field.type === "user" || field.items === "user"))
      throw new JiraError("참여자 필드를 선택하세요.", 400);
    if (field.allowed.length)
      return field.allowed.map((item) => ({ ...item, avatar: "" }));
    return id === "assignee"
      ? catalog.projectAssignees(project)
      : catalog.filterUsers(project);
  }
  return {
    creationTypes,
    creationMetadata,
    creationParents,
    creationUsers,
    validateCreation,
    createIssue,
  };
}
