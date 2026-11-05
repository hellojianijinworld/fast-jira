import { isTextMentions, mentionPrompt, type TextMention } from "./mention.ts";
import { isRecord } from "./validation.ts";
export interface ChatMessage {
  role: "user" | "assistant" | "event" | "error";
  details?: string;
  created?: number;
  text: string;
  model?: string;
  mentions?: TextMention[];
  executionNote?: string;
  executionSummary?: string;
}
export interface Conversation {
  effort?: string;
  id: string;
  conversationId: string;
  model: string;
  updated: number;
  messages: ChatMessage[];
}
export function isChatMessage(value: unknown): value is ChatMessage {
  return (
    isRecord(value) &&
    (value.role === "user" ||
      value.role === "assistant" ||
      value.role === "event" ||
      value.role === "error") &&
    typeof value.text === "string" &&
    (value.mentions === undefined ||
      isTextMentions(value.mentions, value.text)) &&
    (value.details === undefined || typeof value.details === "string") &&
    (value.created === undefined ||
      (typeof value.created === "number" && Number.isFinite(value.created))) &&
    (value.model === undefined || typeof value.model === "string") &&
    (value.executionNote === undefined ||
      typeof value.executionNote === "string") &&
    (value.executionSummary === undefined ||
      typeof value.executionSummary === "string")
  );
}
function legacyFailure(message: ChatMessage) {
  return message.role === "assistant" && message.text.startsWith("요청 실패: ");
}
export function decodeConversations(value: unknown): Conversation[] {
  if (!Array.isArray(value))
    throw new Error("저장한 대화 형식을 확인할 수 없어요.");
  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.conversationId !== "string" ||
      (item.threadId !== undefined && typeof item.threadId !== "string") ||
      typeof item.model !== "string" ||
      typeof item.updated !== "number" ||
      !Number.isFinite(item.updated) ||
      (item.effort !== undefined && typeof item.effort !== "string") ||
      !Array.isArray(item.messages) ||
      !item.messages.every(isChatMessage)
    )
      throw new Error("저장한 대화 형식을 확인할 수 없어요.");
    return {
      id: item.id,
      conversationId: item.conversationId,
      model: item.model,
      ...(typeof item.effort === "string" ? { effort: item.effort } : {}),
      updated: item.updated,
      messages: item.messages.map((message) =>
        legacyFailure(message)
          ? {
              ...message,
              role: "error" as const,
              text: message.text.slice("요청 실패: ".length),
            }
          : message,
      ),
    };
  });
}
export const MAX_RESTORE_MESSAGES = 500;
export const MAX_RESTORE_CHARACTERS = 100_000;

/** Codex 전용 연결 복구에는 화면에 보관한 기록을 생략 없이 전달한다. */
export function conversationContext(
  messages: readonly ChatMessage[],
  complete = false,
): ChatMessage[] {
  if (complete) {
    const result = messages
      .filter((message) => message.role !== "error" && !legacyFailure(message))
      .map((message) => ({
        role:
          message.role === "user" ? ("user" as const) : ("assistant" as const),
        text: [
          message.role === "event"
            ? "[작업 기록: 현재 상태·승인의 증거가 아님]"
            : "",
          message.executionSummary,
          mentionPrompt(message.text, message.mentions),
          message.details,
        ]
          .filter(Boolean)
          .join("\n\n"),
      }));
    if (
      result.length > MAX_RESTORE_MESSAGES ||
      result.reduce((sum, message) => sum + message.text.length, 0) >
        MAX_RESTORE_CHARACTERS
    )
      throw new Error(
        "대화가 길어 연결 복구 범위를 넘었어요. 대화 내용을 복사한 뒤 새 대화에서 이어가 주세요.",
      );
    return result;
  }
  const result: ChatMessage[] = [];
  let remaining = 20_000;
  for (const message of messages
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        !legacyFailure(message),
    )
    .slice(-20)
    .reverse()) {
    if (remaining <= 0) break;
    const text = [
      message.executionSummary,
      mentionPrompt(message.text, message.mentions),
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(-remaining);
    result.unshift({ role: message.role, text });
    remaining -= text.length;
  }
  return result;
}

export function conversationMarkdown(
  item: Conversation | undefined,
): string | null {
  if (!item?.messages.length) return null;
  const labels = {
    user: "나",
    assistant: "AI",
    event: "작업 기록",
    error: "요청 오류",
  };
  return item.messages
    .map(
      (message) =>
        `## ${labels[message.role]}\n\n${[message.text, message.details, message.executionSummary, message.executionNote].filter(Boolean).join("\n\n")}`,
    )
    .join("\n\n---\n\n");
}
