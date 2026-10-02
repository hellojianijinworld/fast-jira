import type { JsonValue } from "../domain/adf.ts";
import type { PriorityOption } from "../domain/catalog.ts";
import type { IssueDetails } from "../domain/details.ts";
import { parseIssueKey, record, requiredString } from "../domain/validation.ts";
import { createPromiseCache } from "./cache.ts";
import {
  ensureJiraResponse,
  type JiraClient,
  JiraError,
} from "./jira-client.ts";
import {
  arrayValue,
  decodeIssue,
  decodePriority,
  decodeUsers,
  optionalRecord,
  stringValue,
} from "./jira-decode.ts";
import type { createJiraMetadata } from "./jira-metadata.ts";
import type { createJiraRead } from "./jira-read.ts";

function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
const invalid = (message: string) => new JiraError(message, 400);
export function createJiraEdit(
  client: JiraClient,
  metadata: ReturnType<typeof createJiraMetadata>,
  read: ReturnType<typeof createJiraRead>,
) {
  const cachePriorities = createPromiseCache<PriorityOption[]>();
  const pathFor = (key: string) =>
    `/rest/api/3/issue/${parseIssueKey(key, "")}`;
  function transitions(key: string) {
    return client.json(`${pathFor(key)}/transitions`, (value) =>
      arrayValue(record(value).transitions).map((value) => {
        const transition = record(value);
        return {
          id: requiredString(transition.id, "전환 ID"),
          name: stringValue(optionalRecord(transition.to).name),
        };
      }),
    );
  }
  async function transitionOptions(key: string) {
    return {
      statuses: [
        ...new Set(
          (await transitions(key))
            .map((transition) => transition.name)
            .filter(Boolean),
        ),
      ],
    };
  }
  function assigneeOptions(key: string) {
    return client.json(
      `/rest/api/3/user/assignable/search?${new URLSearchParams({ issueKey: parseIssueKey(key, ""), maxResults: "1000" })}`,
      decodeUsers,
    );
  }
  async function editOptions(key: string) {
    const [transitions, users] = await Promise.all([
      transitionOptions(key),
      assigneeOptions(key),
    ]);
    return { ...transitions, users };
  }
  function priorityOptions(key: string) {
    key = parseIssueKey(key, "");
    return cachePriorities(key, async () => {
      const [data, catalog] = await Promise.all([
        client.json(`${pathFor(key)}/editmeta`, record),
        metadata.priorities(),
      ]);
      const field = optionalRecord(optionalRecord(data.fields).priority);
      if (
        field.operations == null ||
        !arrayValue(field.operations).includes("set")
      )
        throw invalid("이 이슈의 우선순위를 변경할 수 없습니다.");
      const positions = new Map(
        catalog.map((priority, index) => [priority.id, index]),
      );
      return (
        field.allowedValues == null ? [] : arrayValue(field.allowedValues)
      )
        .map(decodePriority)
        .sort(
          (a, b) =>
            (positions.get(a.id) ?? Infinity) -
            (positions.get(b.id) ?? Infinity),
        );
    });
  }
  async function write(
    path: string,
    method: "PUT" | "POST",
    body: JsonValue,
  ): Promise<void> {
    await ensureJiraResponse(
      await client.request(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }
  async function applyUpdate(
    key: string,
    field: string,
    value: string,
  ): Promise<void> {
    key = parseIssueKey(key, "");
    if (typeof value !== "string") throw invalid("값을 입력하세요.");
    const path = pathFor(key);
    if (field === "assignee") {
      if (
        value &&
        !["@me", "default"].includes(value) &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) &&
        !/^[A-Za-z0-9:-]{5,128}$/.test(value)
      )
        throw invalid("담당자 이메일, 계정 ID 또는 @me를 입력하세요.");
      let accountId: string | null = value || null;
      if (value === "@me") accountId = (await metadata.currentUser()).accountId;
      else if (value === "default") accountId = "-1";
      else if (value.includes("@")) {
        const params = new URLSearchParams({
          issueKey: key,
          query: value,
          maxResults: "1000",
        });
        const matches = await client.json(
          `/rest/api/3/user/assignable/search?${params}`,
          (data) =>
            arrayValue(data)
              .map(record)
              .filter(
                (user) =>
                  user.active !== false &&
                  stringValue(user.emailAddress).toLowerCase() ===
                    value.toLowerCase(),
              ),
        );
        if (matches.length !== 1 || !matches[0])
          throw invalid(
            "이 이메일의 담당자를 확인할 수 없습니다. 담당자 목록에서 선택하세요.",
          );
        accountId = requiredString(matches[0].accountId, "담당자 ID");
      }
      return write(`${path}/assignee`, "PUT", { accountId });
    }
    if (field === "status") {
      if (!value.trim() || value.length > 100 || /[\r\n]/.test(value))
        throw invalid("변경할 상태 이름을 입력하세요.");
      const matches = (await transitions(key)).filter(
        (transition) => transition.name === value.trim(),
      );
      const chosen = matches[0];
      // 이름만 같은 여러 전환 중 하나를 임의로 고르면 워크플로 조건이 달라질 수 있다.
      if (matches.length !== 1 || !chosen)
        throw invalid(
          matches.length
            ? "이 상태로 가는 전환이 여러 개여서 자동으로 선택할 수 없습니다."
            : "현재 이슈에서 이 상태로 변경할 수 없습니다.",
        );
      return write(`${path}/transitions`, "POST", {
        transition: { id: chosen.id },
      });
    }
    if (field === "parent") {
      const parentKey = value ? parseIssueKey(value, "") : "";
      if (parentKey === key)
        throw invalid("자기 자신을 부모로 지정할 수 없습니다.");
      const editable = await client.json(`${path}/editmeta`, (value) =>
        optionalRecord(optionalRecord(record(value).fields).parent),
      );
      if (
        editable.operations == null ||
        !arrayValue(editable.operations).includes("set")
      )
        throw invalid("이 이슈에서는 부모 변경이 지원되지 않습니다.");
      if (parentKey) {
        const source = await read.detail(key);
        let ancestor = parentKey;
        const visited = new Set([key]);
        // 유형 이름 대신 Jira의 실제 계층 값을 비교하고, 조상 순환도 저장 전에 차단한다.
        for (let depth = 0; ancestor; depth++) {
          if (depth >= 20 || visited.has(ancestor))
            throw invalid("부모 연결에 순환이 생길 수 있습니다.");
          visited.add(ancestor);
          const target = await client.json(
            `${pathFor(ancestor)}?fields=parent,project,issuetype`,
            decodeIssue,
          );
          if (
            depth === 0 &&
            (source.project !== target.project ||
              (source.hierarchyLevel !== null &&
                target.hierarchyLevel !== null &&
                Number.isInteger(source.hierarchyLevel) &&
                Number.isInteger(target.hierarchyLevel) &&
                target.hierarchyLevel !== source.hierarchyLevel + 1))
          )
            throw invalid("같은 프로젝트의 바로 상위 단계 이슈를 선택하세요.");
          ancestor = target.parent ? parseIssueKey(target.parent, "") : "";
        }
      }
      return write(path, "PUT", {
        fields: { parent: parentKey ? { key: parentKey } : null },
      });
    }
    if (field === "summary") {
      const summary = value.trim();
      if (!summary || summary.length > 255 || /[\r\n]/.test(summary))
        throw invalid("제목은 줄바꿈 없이 1~255자로 입력하세요.");
      return write(path, "PUT", { fields: { summary } });
    }
    if (field === "priority") {
      if (!/^\d{1,20}$/.test(value))
        throw invalid("올바른 우선순위 ID를 선택하세요.");
      if (
        !(await priorityOptions(key)).some((priority) => priority.id === value)
      )
        throw invalid("이 이슈에서 선택할 수 없는 우선순위입니다.");
      return write(path, "PUT", { fields: { priority: { id: value } } });
    }
    if (field === "dueDate") {
      if (value && !validDate(value))
        throw invalid("마감일을 YYYY-MM-DD 형식으로 입력하세요.");
      return write(path, "PUT", { fields: { duedate: value || null } });
    }
    throw invalid("지원하지 않는 필드입니다.");
  }
  async function update(
    key: string,
    field: string,
    value: string,
  ): Promise<IssueDetails> {
    await applyUpdate(key, field, value);
    const changed = await read.detail(key);
    if (field === "dueDate") changed.dueDate = value;
    return changed;
  }
  return {
    transitionOptions,
    assigneeOptions,
    editOptions,
    priorityOptions,
    applyUpdate,
    update,
  };
}
