import type { JsonValue } from "../domain/adf.ts";
import { type AdfDocument, decodeAdfDocument } from "../domain/adf.ts";
import { type AppRelease, decodeUpdateStatus } from "../domain/app-update.ts";
import {
  type AssistantContext,
  assistantReply,
  assistantStatus,
} from "../domain/assistant.ts";
import { decodeApprovals } from "../domain/assistant-approval.ts";
import type { BulkField } from "../domain/bulk.ts";
import type { ConnectionSettings, Credentials } from "../domain/connection.ts";
import { createMetadata, type IssueDraft } from "../domain/create-issue.ts";
import type { Filters } from "../domain/filters.ts";
import { filterParameters, selectionParameter } from "../domain/filters.ts";
import type { BranchDefaults, EditableField } from "../domain/issue.ts";
import type { ParticipantChange } from "../domain/participants.ts";
import { decodeSync, type KnownIssue } from "../domain/sync.ts";
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
  decodeLookup,
  decodeParticipantOptions,
  decodePriorities,
  decodeStatuses,
  decodeTypes,
  decodeUsers,
  decodeWireComment,
  wireArray,
  wireBoolean,
  wireString,
} from "../domain/wire.ts";

import { parseActivityFeed } from "./activity-parser.ts";

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
    return {
      site: data.site,
      email: data.email,
      tokenConfigured: data.tokenConfigured === true,
    };
  };
  return {
    request,
    voiceStart: (sdp: string, signal: AbortSignal) =>
      request(
        "/api/assistant/voice/start",
        (value) => {
          const data = record(value);
          if (typeof data.id !== "string" || typeof data.sdp !== "string")
            throw new Error("음성 연결 응답을 확인하세요.");
          return { id: data.id, sdp: data.sdp };
        },
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sdp }),
          signal,
        },
      ),
    voiceStop: (id: string) =>
      request("/api/assistant/voice/stop", record, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      }),
    assistantStatus: () => request("/api/assistant/status", assistantStatus),
    assistantApprovals: (requestId: string, signal?: AbortSignal) =>
      request(
        `/api/assistant/approvals?${new URLSearchParams({ requestId })}`,
        decodeApprovals,
        signal ? { signal } : {},
      ),
    approveAssistant: (
      requestId: string,
      id: string,
      approved: boolean,
      values: Record<string, JsonValue>,
    ) =>
      request("/api/assistant/approve", record, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, id, approved, values }),
      }),
    assistantRun: (
      prompt: string,
      context: AssistantContext,
      conversationId: string,
      model: string,
      signal: AbortSignal,
      history: import("../domain/conversation.ts").ChatMessage[] = [],
      requestId?: string,
    ) =>
      request("/api/assistant/run", assistantReply, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          context,
          conversationId,
          model,
          history,
          ...(requestId ? { requestId } : {}),
        }),
        signal,
      }),
    activity: (projects: readonly string[]) =>
      request(
        `/api/activity?${new URLSearchParams({ projects: projects.join(",") })}`,
        (value) => parseActivityFeed(wireString(record(value).feed), projects),
      ),
    appUpdateStatus: () =>
      request("/api/app-update/status", decodeUpdateStatus),
    checkAppUpdate: (force = false) =>
      request("/api/app-update/check", decodeUpdateStatus, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      }),
    installAppUpdate: (release: AppRelease) =>
      request("/api/app-update/install", decodeUpdateStatus, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: release.version,
          commit: release.commit,
        }),
      }),
    connection: () => request("/api/connection", decodeConnection),
    saveConnection: (credentials: Credentials) =>
      request("/api/connection", decodeConnection, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      }),
    creationTypes: (project: string) =>
      request(
        `/api/create-types?${new URLSearchParams({ project })}`,
        decodeTypes,
      ),
    creationUsers: (project: string, type: string, field: string) =>
      request(
        `/api/create-users?${new URLSearchParams({ project, type, field })}`,
        decodeUsers,
      ),
    creationMetadata: (project: string, type: string) =>
      request(
        `/api/create-metadata?${new URLSearchParams({ project, type })}`,
        createMetadata,
      ),
    creationParents: (project: string, type: string, q = "", pageToken = "") =>
      request(
        `/api/create-parents?${new URLSearchParams({ project, type, q, pageToken })}`,
        decodeIssuePage,
      ),
    createIssue: (draft: IssueDraft, requestId: string) =>
      request(
        "/api/create-issue",
        (value) => ({ key: wireString(record(value).key) }),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft, requestId }),
        },
      ),
    parentOptions: (keys: string[], q = "", pageToken = "") =>
      request(
        `/api/parent-options?${new URLSearchParams({ keys: keys.join(","), q, pageToken })}`,
        decodeIssuePage,
      ),
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
    update: (
      key: string,
      field: EditableField,
      value: string,
      expected?: string,
    ) =>
      request("/api/update", decodeDetails, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, field, value, expected }),
      }),
    participantOptions: (key: string) =>
      request(
        `/api/participant-options?${new URLSearchParams({ key })}`,
        decodeParticipantOptions,
      ),
    participantUsers: (key: string, field: string, q: string) =>
      request(
        `/api/participant-users?${new URLSearchParams({ key, field, q })}`,
        decodeUsers,
      ),
    updateParticipants: (key: string, changes: ParticipantChange[]) =>
      request("/api/participants", decodeDetails, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, changes }),
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
    ancestors: (key: string) =>
      request(`/api/ancestors?key=${encodeURIComponent(key)}`, (value) =>
        wireArray(value, decodeIssue),
      ),
    lookup: (key: string) =>
      request(`/api/issue?key=${encodeURIComponent(key)}`, decodeLookup),
    sync: (filters: Filters, known: KnownIssue[], since: string) =>
      request("/api/sync", decodeSync, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: filterParameters(filters).toString(),
          since,
          known,
        }),
      }),
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
    issues: (filters: Filters, token = "", pageSize = 30) => {
      const params = filterParameters(filters);
      if (token) params.set("pageToken", token);
      if (pageSize !== 30) params.set("pageSize", String(pageSize));
      return request(`/api/issues?${params}`, decodeListPage);
    },
    children: (
      key: string,
      filters: Filters,
      settings: BranchDefaults,
      token = "",
      pageSize = 25,
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
      if (pageSize !== 25) params.set("pageSize", String(pageSize));
      return request(`/api/children?${params}`, decodeIssuePage);
    },
  };
}
export type Api = ReturnType<typeof createApi>;

export function subscribeVoice(
  id: string,
  listener: (event: import("./codex-voice.ts").VoiceSnapshot) => void,
): () => void {
  const stream = new EventSource(
    `/api/assistant/voice/events?${new URLSearchParams({ id })}`,
  );
  stream.onmessage = (event) => {
    try {
      const data = record(JSON.parse(event.data));
      if (
        typeof data.text !== "string" ||
        typeof data.error !== "string" ||
        typeof data.ended !== "boolean"
      )
        throw new Error("전사 응답 오류");
      listener({ text: data.text, error: data.error, ended: data.ended });
    } catch {
      stream.close();
      listener({
        text: "",
        error: "음성 전사 응답을 읽지 못했어요.",
        ended: true,
      });
    }
  };
  stream.onerror = () => {
    stream.close();
    listener({ text: "", error: "음성 전사 연결이 끊겼어요.", ended: true });
  };
  return () => stream.close();
}
