import type { JsonValue } from "../domain/adf.ts";
import { decodeAdfDocument, textDocument } from "../domain/adf.ts";
import {
  agentBulkFields,
  agentIssueKeys,
  changeProposal,
} from "../domain/agent.ts";
import { record } from "../domain/validation.ts";
import { projectKeys } from "./jira-metadata.ts";
import type { BrowseOptions } from "./jira-query.ts";
import type { JiraService } from "./jira-service.ts";

export type JiraToolDefinition = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, JsonValue>;
    required: string[];
    additionalProperties: false;
  };
  annotations: { readOnlyHint: boolean; destructiveHint: boolean };
};
const stringSchema = { type: "string" };
const projectsSchema = { type: "array", items: stringSchema, maxItems: 50 };
const keysSchema = {
  ...projectsSchema,
  minItems: 1,
  description:
    "명시적인 이슈 키 1~50개. 검색에 다음 페이지가 있으면 전부 찾았다고 단정하지 마세요.",
};
const changeSchema = {
  keys: keysSchema,
  field: { type: "string", enum: [...agentBulkFields] },
  value: {
    type: "string",
    description:
      "상태는 실제 전환 이름, 담당자·우선순위는 ID, 부모는 이슈 키, 마감일은 YYYY-MM-DD. 빈 값은 연결·지정 해제입니다.",
  },
};
function definition(
  name: string,
  description: string,
  properties: Record<string, JsonValue>,
  required: string[] = [],
  write = false,
): JiraToolDefinition {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
    annotations: { readOnlyHint: !write, destructiveHint: write },
  };
}
function string(
  input: Record<string, unknown>,
  name: string,
  fallback?: string,
): string {
  const value = input[name] === undefined ? fallback : input[name];
  if (typeof value !== "string" || value.length > 20000 || value.includes("\0"))
    throw new Error(`${name} 문자열을 입력하세요.`);
  return value;
}
function strings(input: Record<string, unknown>, name: string): string[] {
  const value = input[name] === undefined ? [] : input[name];
  if (
    !Array.isArray(value) ||
    value.length > 50 ||
    value.some((item) => typeof item !== "string")
  )
    throw new Error(`${name} 목록이 올바르지 않습니다.`);
  return value as string[];
}
function integer(
  input: Record<string, unknown>,
  name: string,
  fallback: number,
  max: number,
): number {
  const value = input[name] === undefined ? fallback : input[name];
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max)
    throw new Error(`${name}는 1~${max} 사이의 정수로 입력하세요.`);
  return Number(value);
}
/** 웹 에이전트와 MCP가 같은 Jira 조회·변경 서비스를 사용한다. 기본값은 쓰기를 노출하지 않는다. */
export function createJiraTools(
  service: JiraService,
  options: { allowMutations?: boolean } = {},
) {
  const definitions = [
    definition(
      "jira_catalog",
      "프로젝트·현재 사용자·우선순위를 조회합니다. projects를 지정하면 해당 프로젝트의 단계·유형도 조회합니다. 상태명과 사용자 ID를 추측하지 마세요.",
      { projects: projectsSchema },
    ),
    definition(
      "jira_search",
      "이슈 키·제목과 담당자·단계 조건으로 이슈를 검색합니다. nextPageToken이 있으면 일부 결과입니다. parent를 지정하면 직접 하위에서 찾습니다. 설명·댓글은 이슈 조회 도구로 필요할 때만 읽으세요.",
      {
        projects: projectsSchema,
        query: stringSchema,
        parent: stringSchema,
        scope: { type: "string", enum: ["all", "assigned", "related"] },
        excludeDone: { type: "boolean" },
        statusIds: projectsSchema,
        assigneeIds: projectsSchema,
        pageToken: stringSchema,
        pageSize: { type: "integer", minimum: 1, maximum: 100 },
      },
    ),
    definition(
      "jira_issue",
      "단일 이슈의 현재 필드를 조회합니다. description=true일 때만 본문과 첨부 메타정보를 읽습니다.",
      { key: stringSchema, description: { type: "boolean" } },
      ["key"],
    ),
    definition(
      "jira_members",
      "프로젝트의 작업 관계자 목록과 실제 사용자 ID를 조회합니다.",
      { projects: projectsSchema },
    ),
    definition(
      "jira_options",
      "이슈들에서 공통으로 가능한 상태·담당자·우선순위 또는 부모 후보를 조회합니다. 실제 Jira 설정과 전환 권한을 사용합니다.",
      {
        keys: keysSchema,
        field: {
          type: "string",
          enum: ["status", "assignee", "priority", "parent"],
        },
        query: stringSchema,
        pageToken: stringSchema,
      },
      ["keys", "field"],
    ),
    definition(
      "jira_propose_change",
      "일괄 변경안을 만듭니다. Jira를 수정하지 않습니다. 저장은 사용자가 변경안을 확인한 후 별도 적용 단계에서만 수행합니다.",
      changeSchema,
      ["keys", "field", "value"],
    ),
    ...(options.allowMutations
      ? [
          definition(
            "jira_update_issues",
            "사용자가 요청한 이슈 1~50개의 필드를 일괄 변경합니다. 대상·필드·값이 불명확하면 먼저 질문하세요. 부분 실패와 되돌리기 token을 반환합니다.",
            changeSchema,
            ["keys", "field", "value"],
            true,
          ),
          definition(
            "jira_undo",
            "일괄 변경 결과의 undoToken으로 되돌립니다. 다른 사람이 이후 바꾼 값은 덮어쓰지 않으며 영수증은 한 번만 사용할 수 있습니다.",
            { token: stringSchema },
            ["token"],
            true,
          ),
          definition(
            "jira_edit_issue",
            "사용자가 명시적으로 요청한 단일 이슈의 제목·상태·담당자·우선순위·마감일을 수정합니다. expected를 지정하면 그 값이 아직 유지될 때만 저장합니다.",
            {
              key: stringSchema,
              field: {
                type: "string",
                enum: ["summary", "status", "assignee", "priority", "dueDate"],
              },
              value: stringSchema,
              expected: stringSchema,
            },
            ["key", "field", "value"],
            true,
          ),
          definition(
            "jira_description",
            "사용자가 요청한 이슈 본문을 ADF 문서로 저장합니다. 기존 서식과 내용을 유지하려면 먼저 본문을 읽고 필요한 부분만 바꾸세요.",
            { key: stringSchema, document: { type: "object" } },
            ["key", "document"],
            true,
          ),
          definition(
            "jira_comment",
            "사용자가 요청한 댓글·답글을 작성하거나 본인 댓글만 편집합니다. action=edit이면 id가 필요합니다. 답글은 parentId를 지정하세요. document로 ADF 멘션을 보존할 수 있습니다.",
            {
              key: stringSchema,
              action: { type: "string", enum: ["add", "edit"] },
              text: stringSchema,
              document: { type: "object" },
              id: stringSchema,
              parentId: stringSchema,
            },
            ["key", "action"],
            true,
          ),
        ]
      : []),
  ];
  const projectInput = (input: Record<string, unknown>) =>
    projectKeys(strings(input, "projects").join(",")).join(",");
  const keysInput = (input: Record<string, unknown>) =>
    agentIssueKeys(input.keys, service.site);
  async function call(name: string, args: unknown): Promise<unknown> {
    if (!definitions.some((tool) => tool.name === name))
      throw new Error("지원하지 않는 도구입니다.");
    const input = args === undefined ? {} : record(args);
    const key = () => service.issueKey(input.key);
    switch (name) {
      case "jira_catalog": {
        const projects = projectInput(input);
        const [all, me, priorities, statuses, types] = await Promise.all([
          service.projects(),
          service.currentUser(),
          service.priorities(),
          projects ? service.projectStatuses(projects) : [],
          projects ? service.projectTypes(projects) : [],
        ]);
        return {
          projects: all,
          me: { id: me.accountId, name: me.displayName },
          priorities,
          statuses,
          types,
        };
      }
      case "jira_search": {
        const scope = string(input, "scope", "all");
        if (scope !== "all" && scope !== "assigned" && scope !== "related")
          throw new Error("검색 범위가 올바르지 않습니다.");
        if (
          input.excludeDone !== undefined &&
          typeof input.excludeDone !== "boolean"
        )
          throw new Error("완료 제외 여부를 boolean으로 입력하세요.");
        const filters: BrowseOptions = {
          projects: projectInput(input),
          q: string(input, "query", ""),
          scope,
          excludeDone: input.excludeDone === true,
          statuses: strings(input, "statusIds").join(","),
          assignees: strings(input, "assigneeIds").join(","),
        };
        const pageSize = integer(input, "pageSize", 20, 100);
        const cursor = string(input, "pageToken", "");
        return input.parent === undefined
          ? service.browse(filters, "recent", cursor, pageSize)
          : service.childrenPage(
              service.issueKey(input.parent),
              filters,
              "all",
              "recent",
              cursor,
              pageSize,
            );
      }
      case "jira_issue":
        if (
          input.description !== undefined &&
          typeof input.description !== "boolean"
        )
          throw new Error("본문 포함 여부를 boolean으로 입력하세요.");
        return input.description === true
          ? service.lookup(key())
          : service.detail(key());
      case "jira_members":
        return service.filterUsers(projectInput(input));
      case "jira_options": {
        const keys = keysInput(input);
        const field = string(input, "field");
        if (field === "parent")
          return service.parentOptions(
            keys,
            string(input, "query", ""),
            string(input, "pageToken", ""),
          );
        return service.bulk.options(keys, field);
      }
      case "jira_propose_change":
        return changeProposal(input, service.site);
      case "jira_update_issues": {
        const plan = changeProposal(input, service.site);
        return service.bulk.apply(plan.keys, plan.field, plan.value);
      }
      case "jira_undo":
        return service.bulk.undo(string(input, "token"));
      case "jira_edit_issue":
        if (
          !["summary", "status", "assignee", "priority", "dueDate"].includes(
            string(input, "field"),
          )
        )
          throw new Error("지원하는 단일 이슈 필드를 지정하세요.");
        return service.update(
          key(),
          string(input, "field"),
          string(input, "value"),
          input.expected === undefined ? undefined : string(input, "expected"),
        );
      case "jira_description":
        return service.updateDescription(
          key(),
          decodeAdfDocument(input.document),
        );
      case "jira_comment": {
        const action = string(input, "action");
        if (action !== "add" && action !== "edit")
          throw new Error("댓글 action은 add 또는 edit으로 입력하세요.");
        if (action === "edit")
          return service.editComment(
            key(),
            string(input, "id"),
            input.document === undefined
              ? textDocument(string(input, "text"))
              : decodeAdfDocument(input.document),
          );
        return service.addComment(key(), {
          ...(input.document === undefined
            ? { text: string(input, "text") }
            : { document: decodeAdfDocument(input.document) }),
          ...(input.parentId === undefined
            ? {}
            : { parentId: string(input, "parentId") }),
        });
      }
    }
    throw new Error("지원하지 않는 도구입니다.");
  }
  return { definitions, call };
}
export type JiraTools = ReturnType<typeof createJiraTools>;
