import { type AdfDocument, decodeAdfDocument } from "../domain/adf.ts";
import type { BulkField } from "../domain/bulk.ts";
import type { ConnectionSettings, Credentials } from "../domain/connection.ts";
import type { Filters } from "../domain/filters.ts";
import { filterParameters, selectionParameter } from "../domain/filters.ts";
import type { BranchDefaults, EditableField } from "../domain/issue.ts";
import type { LogEntry } from "../domain/log.ts";
import { isRecord, record } from "../domain/validation.ts";
import {
  decodeBootstrap,
  decodeBulkOptions,
  decodeBulkResult,
  decodeChanges,
  decodeCommentPage,
  decodeDetails,
  decodeHistory,
  decodeIssue,
  decodeIssuePage,
  decodeListPage,
  decodeLogEntry,
  decodeLookup,
  decodePriorities,
  decodeStatuses,
  decodeTypes,
  decodeUsers,
  decodeWireComment,
  wireArray,
  wireBoolean,
} from "../domain/wire.ts";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export function createApi(fetcher: typeof fetch = fetch) {
  async function request<T>(
    path: string,
    decode: (value: unknown) => T,
    init?: RequestInit,
  ): Promise<T> {
    const response = await fetcher(path, init);
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new ApiError(
        `응답을 읽지 못했습니다 (${response.status}).`,
        response.status,
      );
    }
    if (!response.ok)
      throw new ApiError(
        isRecord(value) && typeof value.error === "string"
          ? value.error
          : `요청에 실패했습니다 (${response.status}).`,
        response.status,
      );
    return decode(value);
  }
  const decodeConnection = (value: unknown): ConnectionSettings => {
    const data = record(value);
    if (typeof data.site !== "string" || typeof data.email !== "string")
      throw new Error("연결 설정 응답이 올바르지 않습니다.");
    return { site: data.site, email: data.email };
  };
  return {
    request,
    connection: () => request("/api/connection", decodeConnection),
    saveConnection: (credentials: Credentials) =>
      request("/api/connection", decodeConnection, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      }),
    bulkOptions: (keys: string[], field: "status" | "assignee" | "priority") =>
      request("/api/bulk-options", decodeBulkOptions, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys, field }),
      }),
    bulkUpdate: (keys: string[], field: BulkField, value: string) =>
      request("/api/bulk-update", decodeBulkResult, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys, field, value }),
      }),
    bulkUndo: (token: string) =>
      request("/api/bulk-undo", decodeBulkResult, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      }),
    directChildren: (key: string) =>
      request(`/api/issue-children?key=${encodeURIComponent(key)}`, (value) =>
        wireArray(value, decodeIssue),
      ),
    detail: (key: string) =>
      request(`/api/detail?key=${encodeURIComponent(key)}`, decodeDetails),
    update: (key: string, field: EditableField, value: string) =>
      request("/api/update", decodeDetails, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, field, value }),
      }),
    priorities: (key: string) =>
      request(
        `/api/priority-options?key=${encodeURIComponent(key)}`,
        decodePriorities,
      ),
    matchesMany: (keys: string[], filters: Filters, parents: string[] = []) => {
      const params = filterParameters(filters);
      params.set("keys", keys.join(","));
      if (parents.length) params.set("parents", parents.join(","));
      return request(`/api/matches?${params}`, (value) => {
        const keys = record(value).keys;
        if (
          !Array.isArray(keys) ||
          !keys.every((key): key is string => typeof key === "string")
        )
          throw new Error("필터 판정 응답이 올바르지 않습니다.");
        return {
          keys: new Set(keys),
          ancestors: wireArray(record(value).ancestors, decodeIssue),
        };
      });
    },
    matches: (key: string, filters: Filters) => {
      const params = filterParameters(filters);
      params.set("key", key);
      return request(`/api/matches?${params}`, (value) =>
        wireBoolean(record(value).matches),
      );
    },
    history: (key: string, before: number | null = null) => {
      const params = new URLSearchParams({ key });
      if (before !== null) params.set("before", String(before));
      return request(`/api/history?${params}`, decodeHistory);
    },
    comments: (key: string, startAt = 0) =>
      request(
        `/api/comments?${new URLSearchParams({ key, startAt: String(startAt) })}`,
        decodeCommentPage,
      ),
    mentionUsers: (key: string, query: string) =>
      request(
        `/api/mention-users?${new URLSearchParams({ key, q: query })}`,
        decodeUsers,
      ),
    addComment: (key: string, document: AdfDocument, parentId?: string) =>
      request("/api/comment", decodeWireComment, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          document,
          ...(parentId ? { parentId } : {}),
        }),
      }),
    editComment: (key: string, id: string, document: AdfDocument) =>
      request("/api/comment-edit", decodeWireComment, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, id, document }),
      }),
    description: (key: string, description: AdfDocument) =>
      request(
        "/api/description",
        (value) => decodeAdfDocument(record(value).description),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, description }),
        },
      ),
    lookup: (key: string) =>
      request(`/api/issue?key=${encodeURIComponent(key)}`, decodeLookup),
    bootstrap: () => request("/api/projects", decodeBootstrap),
    statuses: (projects: readonly string[]) =>
      request(
        `/api/statuses?projects=${encodeURIComponent(projects.join(","))}`,
        decodeStatuses,
      ),
    users: (projects: readonly string[]) =>
      request(
        `/api/assignees?projects=${encodeURIComponent(projects.join(","))}`,
        decodeUsers,
      ),
    types: (projects: readonly string[]) =>
      request(
        `/api/issue-types?projects=${encodeURIComponent(projects.join(","))}`,
        decodeTypes,
      ),
    changes: (filters: Filters, lookback: number) => {
      const params = filterParameters(filters);
      params.set("lookback", String(lookback));
      return request(`/api/changes?${params}`, decodeChanges);
    },
    issues: (filters: Filters, token = "") => {
      const params = filterParameters(filters);
      if (token) params.set("pageToken", token);
      return request(`/api/issues?${params}`, decodeListPage);
    },
    children: (
      key: string,
      filters: Filters,
      settings: BranchDefaults,
      token = "",
    ) => {
      const params = filterParameters(filters);
      params.delete("q");
      params.delete("scope");
      params.set("key", key);
      params.set("sort", settings.sort);
      params.set("people", settings.people);
      params.set("excludeDone", String(settings.excludeDone));
      params.set("statuses", selectionParameter(settings.statuses));
      params.set("assignees", selectionParameter(settings.assignees));
      if (token) params.set("pageToken", token);
      return request(`/api/children?${params}`, decodeIssuePage);
    },
  };
}
export type Api = ReturnType<typeof createApi>;

/** 패널을 연 동안만 수신한다. 인증 정보나 로그를 저장소에 쓰지 않는다. */
export function subscribeLogs(listener: (entry: LogEntry) => void): () => void {
  const stream = new EventSource("/api/debug");
  stream.addEventListener("command", (event) => {
    try {
      const value: unknown = JSON.parse(event.data);
      listener(decodeLogEntry(value));
    } catch {
      /* 잘못된 이벤트는 표시하지 않고 다음 정상 이벤트를 기다린다. */
    }
  });
  return () => stream.close();
}
