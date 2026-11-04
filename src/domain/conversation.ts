import { isRecord } from "./validation.ts";
export interface ChatMessage {
  role: "user" | "assistant" | "event" | "error";
  details?: string;
  created?: number;
  text: string;
  model?: string;
  executionNote?: string;
  executionSummary?: string;
}
export interface Conversation {
  id: string;
  conversationId: string;
  threadId?: string;
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
      !Array.isArray(item.messages) ||
      !item.messages.every(isChatMessage)
    )
      throw new Error("저장한 대화 형식을 확인할 수 없어요.");
    return {
      id: item.id,
      conversationId: item.conversationId,
      ...(item.threadId ? { threadId: item.threadId } : {}),
      model: item.model,
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
/** 연결이 만료됐을 때만 최근 대화를 전달한다. 화면의 전체 기록은 삭제하지 않는다. */
export function conversationContext(
  messages: readonly ChatMessage[],
): ChatMessage[] {
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
    const text = [message.executionSummary, message.text]
      .filter(Boolean)
      .join("\n\n")
      .slice(-remaining);
    result.unshift({ role: message.role, text });
    remaining -= text.length;
  }
  return result;
}

/** 표시용 기록 ID·Claude ID를 Codex 원본 링크로 오인하지 않는다. */
export function conversationLink(
  item: Conversation | undefined,
): string | null {
  return item?.threadId &&
    !item.model.startsWith("claude:") &&
    /^[a-zA-Z0-9_-]{1,100}$/.test(item.threadId)
    ? `codex://threads/${item.threadId}`
    : null;
}
