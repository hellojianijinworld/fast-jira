import { type ChangeProposal, changeProposal } from "./agent.ts";
import {
  type AssistantExecution,
  decodeExecutions,
} from "./assistant-execution.ts";
import { type IssueDraft, issueDraft } from "./create-issue.ts";
import { isRecord, record, requiredString } from "./validation.ts";
export interface AssistantModel {
  id: string;
  name: string;
  isDefault: boolean;
}
export type AssistantAvailability = "ready" | "unavailable" | "unknown";

export type AssistantUnavailableReason =
  | "missing_cli"
  | "login_required"
  | "unsupported";

export interface AssistantProviderStatus {
  reason?: AssistantUnavailableReason;
  id: "codex" | "claude";
  availability?: AssistantAvailability;
  ready: boolean;
  error: string;
}
export interface AssistantStatus {
  reason?: AssistantUnavailableReason;
  availability?: AssistantAvailability;
  voice?: { ready: boolean };
  ready: boolean;
  models: AssistantModel[];
  error: string;
  providers?: AssistantProviderStatus[];
}

import type { Issue } from "./issue.ts";
import { decodeIssue, wireArray } from "./wire.ts";
export interface AssistantReply {
  issues?: Issue[];
  conversationId: string;
  threadId?: string;
  execution?: AssistantExecution[];
  answer: string;
  proposals: ChangeProposal[];
  creations?: IssueDraft[];
  reconnected?: boolean;
}
export interface AssistantContext {
  projects: readonly string[];
  issue: string;
  keys: readonly string[];
  creation?: IssueDraft;
}
export function assistantStatus(value: unknown): AssistantStatus {
  const data = record(value);
  if (
    typeof data.ready !== "boolean" ||
    !Array.isArray(data.models) ||
    typeof data.error !== "string"
  )
    throw new Error("AI 연결 응답이 올바르지 않습니다.");
  const availability = data.availability;
  if (
    availability !== undefined &&
    !["ready", "unavailable", "unknown"].includes(String(availability))
  )
    throw new Error("AI 연결 상태가 올바르지 않습니다.");
  let voice: AssistantStatus["voice"];
  if (data.voice !== undefined) {
    const value = record(data.voice);
    if (typeof value.ready !== "boolean")
      throw new Error("음성 연결 상태가 올바르지 않습니다.");
    voice = { ready: value.ready };
  }
  let providers: AssistantProviderStatus[] | undefined;
  if (data.providers !== undefined) {
    if (!Array.isArray(data.providers))
      throw new Error("AI 제공자 정보가 올바르지 않습니다.");
    providers = data.providers.map<AssistantProviderStatus>((value) => {
      const provider = record(value);
      if (
        (provider.id !== "codex" && provider.id !== "claude") ||
        typeof provider.ready !== "boolean" ||
        typeof provider.error !== "string"
      )
        throw new Error("AI 제공자 정보가 올바르지 않습니다.");
      if (
        provider.availability !== undefined &&
        !["ready", "unavailable", "unknown"].includes(
          String(provider.availability),
        )
      )
        throw new Error("AI 제공자 연결 상태가 올바르지 않습니다.");
      if (
        provider.reason !== undefined &&
        !["missing_cli", "login_required", "unsupported"].includes(
          String(provider.reason),
        )
      )
        throw new Error("AI 연결 사유가 올바르지 않습니다.");
      return {
        ...(provider.reason
          ? { reason: provider.reason as AssistantUnavailableReason }
          : {}),
        id: provider.id,
        ready: provider.ready,
        error: provider.error,
        ...(provider.availability
          ? { availability: provider.availability as AssistantAvailability }
          : {}),
      };
    });
  }
  return {
    ready: data.ready,
    error: data.error,
    ...(availability
      ? { availability: availability as AssistantAvailability }
      : {}),
    ...(voice ? { voice } : {}),
    ...(providers ? { providers } : {}),
    models: data.models.map((value) => {
      const model = record(value);
      if (typeof model.isDefault !== "boolean")
        throw new Error("AI 모델 정보가 올바르지 않습니다.");
      return {
        id: requiredString(model.id, "모델"),
        name: requiredString(model.name, "모델 이름"),
        isDefault: model.isDefault,
      };
    }),
  };
}
export function assistantReply(value: unknown): AssistantReply {
  const data = record(value);
  if (typeof data.answer !== "string" || !Array.isArray(data.proposals))
    throw new Error("AI 답변이 올바르지 않습니다.");
  return {
    conversationId: requiredString(data.conversationId, "대화"),
    ...(data.threadId === undefined
      ? {}
      : { threadId: requiredString(data.threadId, "원본 대화") }),
    ...(data.issues === undefined
      ? {}
      : { issues: wireArray(data.issues, decodeIssue) }),
    answer: data.answer,
    ...(data.execution === undefined
      ? {}
      : { execution: decodeExecutions(data.execution) }),
    proposals: data.proposals.map((value) => changeProposal(value, "")),
    reconnected: data.reconnected === true,
    ...(data.creations === undefined
      ? {}
      : {
          creations: (Array.isArray(data.creations)
            ? data.creations
            : (() => {
                throw new Error("생성안을 확인하세요.");
              })()
          ).map(issueDraft),
        }),
  };
}
export function assistantContext(value: unknown): AssistantContext {
  const data = isRecord(value) ? value : {};
  if (
    !Array.isArray(data.projects) ||
    data.projects.length > 50 ||
    !data.projects.every((item) => typeof item === "string") ||
    !Array.isArray(data.keys) ||
    data.keys.length > 50 ||
    !data.keys.every((item) => typeof item === "string") ||
    typeof data.issue !== "string"
  )
    throw new Error("AI 요청의 이슈 범위가 올바르지 않습니다.");
  return {
    projects: data.projects,
    keys: data.keys,
    issue: data.issue,
    ...(data.creation === undefined
      ? {}
      : { creation: issueDraft(data.creation) }),
  };
}

export function assistantFeatures(
  status: AssistantStatus,
  previous = { chat: false, voice: false },
) {
  if (status.ready && status.models.length > 0)
    return { chat: true, voice: status.voice?.ready === true };
  if (status.availability === "unavailable" || status.availability === "ready")
    return { chat: false, voice: false };
  return { chat: previous.chat, voice: previous.voice };
}
