import { decodeAdfDocument } from "./adf.ts";
import type { BulkOptions, BulkResult } from "./bulk.ts";
import type { PriorityOption, ProjectOption, StatusOption } from "./catalog.ts";
import type { Comment, CommentPage, HistoryPage } from "./content.ts";
import type { IssueDetails, LookupResult } from "./details.ts";
import type { Issue, IssueType, UserOption } from "./issue.ts";
import type { LogEntry } from "./log.ts";
import { record } from "./validation.ts";

export function wireString(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("응답 문자열 형식이 올바르지 않습니다.");
  return value;
}
export function wireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean")
    throw new Error("응답 참/거짓 형식이 올바르지 않습니다.");
  return value;
}
export function wireNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("응답 숫자 형식이 올바르지 않습니다.");
  return value;
}
export function wireArray<T>(
  value: unknown,
  decode: (item: unknown) => T,
): T[] {
  if (!Array.isArray(value))
    throw new Error("응답 목록 형식이 올바르지 않습니다.");
  return value.map(decode);
}
export function emptyIssue(key: string, summary = key): Issue {
  return {
    key,
    summary,
    project: key.split("-")[0] ?? "",
    parent: "",
    parentSummary: "",
    status: "",
    statusId: "",
    statusCategory: "",
    issueType: "",
    issueTypeId: "",
    hierarchyLevel: null,
    issueTypeIcon: "",
    priority: "",
    priorityId: "",
    defaultPriorityId: "",
    priorityIcon: "",
    assignee: "",
    assigneeId: "",
    assigneeAvatar: "",
    updated: "",
    dueDate: "",
    commentCount: 0,
    hasChildren: false,
  };
}
export function decodeIssue(value: unknown): Issue {
  const item = record(value);
  const key = wireString(item.key);
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key))
    throw new Error("응답 이슈 키가 올바르지 않습니다.");
  const commentCount = wireNumber(item.commentCount);
  const hierarchyLevel =
    item.hierarchyLevel === null ? null : wireNumber(item.hierarchyLevel);
  if (
    !Number.isInteger(commentCount) ||
    commentCount < 0 ||
    (hierarchyLevel !== null && !Number.isInteger(hierarchyLevel))
  )
    throw new Error("응답 이슈 메타정보가 올바르지 않습니다.");
  return {
    key,
    summary: wireString(item.summary),
    project: wireString(item.project),
    parent: wireString(item.parent),
    parentSummary: wireString(item.parentSummary),
    status: wireString(item.status),
    statusId: wireString(item.statusId),
    statusCategory: wireString(item.statusCategory),
    issueType: wireString(item.issueType),
    issueTypeId: wireString(item.issueTypeId),
    hierarchyLevel,
    issueTypeIcon: wireString(item.issueTypeIcon),
    priority: wireString(item.priority),
    priorityId: wireString(item.priorityId),
    defaultPriorityId: wireString(item.defaultPriorityId),
    priorityIcon: wireString(item.priorityIcon),
    assignee: wireString(item.assignee),
    assigneeId: wireString(item.assigneeId),
    assigneeAvatar: wireString(item.assigneeAvatar),
    updated: wireString(item.updated),
    dueDate: wireString(item.dueDate),
    commentCount,
    hasChildren: wireBoolean(item.hasChildren),
  };
}
export interface IssuePage {
  issues: Issue[];
  nextPageToken: string | null;
}
export interface ListPage extends IssuePage {
  ancestors: Issue[];
}
export function decodeIssuePage(value: unknown): IssuePage {
  const page = record(value);
  return {
    issues: wireArray(page.issues, decodeIssue),
    nextPageToken:
      page.nextPageToken === null ? null : wireString(page.nextPageToken),
  };
}
export function decodeListPage(value: unknown): ListPage {
  return {
    ...decodeIssuePage(value),
    ancestors: wireArray(record(value).ancestors, decodeIssue),
  };
}
export interface ChangedIssue extends Issue {
  matches: boolean;
}
export interface ChangeBatch {
  issues: ChangedIssue[];
  ancestors: Issue[];
}
export function decodeChanges(value: unknown): ChangeBatch {
  const data = record(value);
  return {
    issues: wireArray(data.issues, (value) => {
      const issue = decodeIssue(value);
      if (!Number.isFinite(Date.parse(issue.updated)))
        throw new Error("변경 시각 형식이 올바르지 않습니다.");
      return { ...issue, matches: wireBoolean(record(value).matches) };
    }),
    ancestors: wireArray(data.ancestors, decodeIssue),
  };
}
export interface Bootstrap {
  site: string;
  me: { accountId: string; displayName: string };
  projects: ProjectOption[];
  priorities: PriorityOption[];
}
export function decodeBootstrap(value: unknown): Bootstrap {
  const data = record(value),
    me = record(data.me);
  return {
    site: wireString(data.site),
    me: {
      accountId: wireString(me.accountId),
      displayName: wireString(me.displayName),
    },
    projects: wireArray(data.projects, (value) => {
      const project = record(value);
      return {
        key: wireString(project.key),
        name: wireString(project.name),
        avatar: wireString(project.avatar),
      };
    }),
    priorities: decodePriorities(data.priorities),
  };
}
export function decodeStatuses(value: unknown): StatusOption[] {
  return wireArray(value, (value) => {
    const status = record(value);
    return {
      id: wireString(status.id),
      name: wireString(status.name),
      category: wireString(status.category),
      projects: wireArray(status.projects, wireString),
    };
  });
}
export function decodeUsers(value: unknown): UserOption[] {
  return wireArray(value, (value) => {
    const user = record(value);
    return {
      id: wireString(user.id),
      name: wireString(user.name),
      avatar: wireString(user.avatar),
    };
  });
}
export function decodeTypes(value: unknown): IssueType[] {
  return wireArray(value, (value) => {
    const type = record(value);
    return {
      id: wireString(type.id),
      name: wireString(type.name),
      project: wireString(type.project),
      hierarchyLevel:
        type.hierarchyLevel === null ? null : wireNumber(type.hierarchyLevel),
    };
  });
}

export function decodeDetails(value: unknown): IssueDetails {
  const item = record(value);
  return {
    ...decodeIssue(value),
    reporter: wireString(item.reporter),
    reporterAvatar: wireString(item.reporterAvatar),
    created: wireString(item.created),
    url: wireString(item.url),
    description:
      item.description === null ? null : decodeAdfDocument(item.description),
    attachments: wireArray(item.attachments, (value) => {
      const file = record(value),
        size = wireNumber(file.size);
      if (size < 0) throw new Error("첨부 크기가 올바르지 않습니다.");
      return {
        id: wireString(file.id),
        name: wireString(file.name),
        mimeType: wireString(file.mimeType),
        size,
        url: wireString(file.url),
      };
    }),
  };
}
export function decodeLookup(value: unknown): LookupResult {
  const result = record(value);
  return {
    parent: decodeDetails(result.parent),
    children: wireArray(result.children, decodeIssue),
    deferredChildren: wireBoolean(result.deferredChildren),
    dateEditing: wireBoolean(result.dateEditing),
    imageEnabled: wireBoolean(result.imageEnabled),
  };
}

export function decodePriorities(value: unknown): PriorityOption[] {
  return wireArray(value, (value) => {
    const priority = record(value);
    return {
      id: wireString(priority.id),
      name: wireString(priority.name),
      icon: wireString(priority.icon),
    };
  });
}
export function decodeEditOptions(value: unknown): {
  statuses: string[];
  users?: UserOption[];
} {
  const data = record(value);
  return {
    statuses: wireArray(data.statuses, wireString),
    ...(data.users === undefined ? {} : { users: decodeUsers(data.users) }),
  };
}
export function decodeHistory(value: unknown): HistoryPage {
  const data = record(value),
    before = data.before === null ? null : wireNumber(data.before);
  if (before !== null && (!Number.isInteger(before) || before < 0))
    throw new Error("기록 페이지 위치가 올바르지 않습니다.");
  return {
    before,
    entries: wireArray(data.entries, (value) => {
      const entry = record(value);
      return {
        id: wireString(entry.id),
        author: wireString(entry.author),
        avatar: wireString(entry.avatar),
        created: wireString(entry.created),
        changes: wireArray(entry.changes, (value) => {
          const change = record(value);
          return {
            field: wireString(change.field),
            from: wireString(change.from),
            to: wireString(change.to),
          };
        }),
      };
    }),
  };
}

export function decodeWireComment(value: unknown): Comment {
  const item = record(value);
  return {
    id: wireString(item.id),
    parentId: wireString(item.parentId),
    authorId: wireString(item.authorId),
    author: wireString(item.author),
    avatar: wireString(item.avatar),
    created: wireString(item.created),
    updated: wireString(item.updated),
    body: decodeAdfDocument(item.body),
  };
}
export function decodeCommentPage(value: unknown): CommentPage {
  const page = record(value),
    total = wireNumber(page.total),
    startAt = wireNumber(page.startAt);
  if (
    !Number.isInteger(total) ||
    total < 0 ||
    !Number.isInteger(startAt) ||
    startAt < 0
  )
    throw new Error("댓글 페이지 위치가 올바르지 않습니다.");
  return {
    total,
    startAt,
    comments: wireArray(page.comments, decodeWireComment),
  };
}

export function decodeBulkOptions(value: unknown): BulkOptions {
  const data = record(value);
  return {
    priorities: decodePriorities(data.priorities ?? []),
    statuses: wireArray(data.statuses, wireString),
    users: decodeUsers(data.users),
  };
}
export function decodeBulkResult(value: unknown): BulkResult {
  const data = record(value);
  const failures = (value: unknown) =>
    wireArray(value, (value) => {
      const item = record(value);
      return { key: wireString(item.key), error: wireString(item.error) };
    });
  return {
    issues: wireArray(data.issues, decodeIssue),
    failures: failures(data.failures),
    warnings: failures(data.warnings),
    undoToken: wireString(data.undoToken),
  };
}

export function decodeLogEntry(value: unknown): LogEntry {
  const data = record(value),
    id = wireNumber(data.id);
  if (!Number.isSafeInteger(id) || id < 1 || data.source !== "API")
    throw new Error("로그 형식이 올바르지 않습니다.");
  return {
    id,
    source: "API",
    ...(typeof data.response === "string" ? { response: data.response } : {}),
    command: wireString(data.command),
    result: wireString(data.result),
    time: wireString(data.time),
  };
}
