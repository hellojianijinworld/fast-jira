import type {
  CurrentUser,
  PriorityOption,
  ProjectOption,
} from "../domain/catalog.ts";
import type { Issue, IssueType, UserOption } from "../domain/issue.ts";
import type {
  ParticipantDefinition,
  ParticipantField,
} from "../domain/participants.ts";
import { parseIssueKey, record, requiredString } from "../domain/validation.ts";

// 요청한 선택 필드는 없거나 null일 수 있다. 존재하는 잘못된 타입은 묵인하지 않는다.
export function optionalRecord(value: unknown): Record<string, unknown> {
  return value == null ? {} : record(value);
}
export function stringValue(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  if (typeof value !== "string")
    throw new Error("응답 문자열 형식이 올바르지 않습니다.");
  return value;
}
export function numberValue(value: unknown, fallback = 0): number {
  if (value == null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("응답 숫자 형식이 올바르지 않습니다.");
  return value;
}
export function arrayValue(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new Error("응답 목록 형식이 올바르지 않습니다.");
  return value;
}
export function avatarValue(value: unknown): string {
  return stringValue(optionalRecord(value)["24x24"]);
}
export function decodeUser(value: unknown): UserOption {
  const user = record(value);
  const id = requiredString(user.accountId, "계정 ID");
  return {
    id,
    name: stringValue(user.displayName, id),
    avatar: avatarValue(user.avatarUrls),
  };
}
export function decodeCurrentUser(value: unknown): CurrentUser {
  const user = record(value);
  const option = decodeUser(user);
  return {
    ...option,
    accountId: option.id,
    displayName: option.name,
    emailAddress: stringValue(user.emailAddress),
  };
}
export function decodeUsers(value: unknown): UserOption[] {
  return arrayValue(value)
    .filter((value) => {
      const user = record(value);
      return user.accountId != null && user.active !== false;
    })
    .map(decodeUser);
}
export function decodeProject(value: unknown): ProjectOption {
  const project = record(value);
  return {
    key: requiredString(project.key, "프로젝트 키"),
    name: requiredString(project.name, "프로젝트 이름"),
    avatar: avatarValue(project.avatarUrls),
  };
}
export function decodePriority(value: unknown): PriorityOption {
  const priority = record(value);
  return {
    id: requiredString(priority.id, "우선순위 ID"),
    name: requiredString(priority.name, "우선순위 이름"),
    icon: stringValue(priority.iconUrl),
  };
}
export function decodeIssueType(value: unknown, project: string): IssueType {
  const type = record(value);
  return {
    id: requiredString(type.id, "이슈 유형 ID"),
    name: requiredString(type.name, "이슈 유형 이름"),
    project,
    hierarchyLevel:
      type.hierarchyLevel == null ? null : numberValue(type.hierarchyLevel),
  };
}
export function decodePage<T>(
  value: unknown,
  field: string,
  decode: (value: unknown) => T,
) {
  const page = record(value);
  if (page.isLast != null && typeof page.isLast !== "boolean")
    throw new Error("페이지 종료 정보가 올바르지 않습니다.");
  return {
    values: arrayValue(page[field]).map(decode),
    total: numberValue(page.total, Infinity),
    isLast: page.isLast === true,
  };
}

/** 목록·하위·최근 변경에서 같은 필드 정규화를 사용한다. 상세는 여기에 본문을 더한다. */
export function decodeIssue(
  value: unknown,
  relatedFields?: readonly string[],
  participantDefinitions?: readonly ParticipantDefinition[],
): Issue {
  const issue = record(value);
  const key = parseIssueKey(issue.key, "");
  const fields = record(issue.fields);
  const status = optionalRecord(fields.status);
  const type = optionalRecord(fields.issuetype);
  const priority = optionalRecord(fields.priority);
  const assignee = optionalRecord(fields.assignee);
  const parent = optionalRecord(fields.parent);
  const hierarchyLevel =
    type.hierarchyLevel == null ? null : numberValue(type.hierarchyLevel);
  const subtasks = fields.subtasks == null ? [] : arrayValue(fields.subtasks);
  return {
    id: stringValue(issue.id),
    key,
    summary: stringValue(fields.summary),
    project: stringValue(optionalRecord(fields.project).key, key.split("-")[0]),
    status: stringValue(status.name),
    statusId: stringValue(status.id),
    statusCategory: stringValue(optionalRecord(status.statusCategory).key),
    issueType: stringValue(type.name),
    issueTypeId: stringValue(type.id),
    hierarchyLevel,
    issueTypeIcon: stringValue(type.iconUrl),
    priority: stringValue(priority.name),
    priorityId: stringValue(priority.id),
    priorityIcon: stringValue(priority.iconUrl),
    defaultPriorityId: "",
    assignee: stringValue(assignee.displayName),
    assigneeId: stringValue(assignee.accountId),
    ...(relatedFields === undefined
      ? {}
      : {
          relatedUserIds: [
            ...new Set(
              [
                stringValue(assignee.accountId),
                ...relatedFields.flatMap((id) => {
                  const value = fields[id];
                  return (
                    value == null ? [] : Array.isArray(value) ? value : [value]
                  ).map((user) => stringValue(optionalRecord(user).accountId));
                }),
              ].filter(Boolean),
            ),
          ],
        }),
    ...(participantDefinitions === undefined
      ? {}
      : {
          participantFields: decodeParticipantFields(
            fields,
            participantDefinitions,
          ),
        }),
    assigneeAvatar: avatarValue(assignee.avatarUrls),
    updated: stringValue(fields.updated),
    dueDate: stringValue(fields.duedate),
    commentCount: numberValue(optionalRecord(fields.comment).total),
    parent: stringValue(parent.key),
    parentSummary: stringValue(optionalRecord(parent.fields).summary),
    hasChildren:
      subtasks.length > 0 || (hierarchyLevel !== null && hierarchyLevel > 0),
  };
}

export function decodeParticipantDefinition(
  id: string,
  value: unknown,
): ParticipantDefinition | null {
  const field = record(value),
    schema = optionalRecord(field.schema);
  if (
    !/^customfield_\d+$/.test(id) ||
    (schema.type !== "user" &&
      !(schema.type === "array" && schema.items === "user"))
  )
    return null;
  return {
    id,
    name: stringValue(field.name, id),
    multiple: schema.type === "array",
  };
}

export function decodeParticipantFields(
  fields: Record<string, unknown>,
  definitions: readonly ParticipantDefinition[],
): ParticipantField[] {
  return definitions
    .filter((field) => Object.hasOwn(fields, field.id))
    .map((field) => ({
      id: field.id,
      name: field.name,
      multiple: field.multiple,
      users: (fields[field.id] == null
        ? []
        : field.multiple
          ? arrayValue(fields[field.id])
          : [fields[field.id]]
      ).map(decodeUser),
    }));
}
