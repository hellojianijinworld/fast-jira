import { isRecord } from "./validation.ts";
export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  model?: string;
}
export interface Conversation {
  id: string;
  conversationId: string;
  model: string;
  updated: number;
  messages: ChatMessage[];
}
export function isChatMessage(value: unknown): value is ChatMessage {
  return (
    isRecord(value) &&
    (value.role === "user" || value.role === "assistant") &&
    typeof value.text === "string" &&
    (value.model === undefined || typeof value.model === "string")
  );
}
export function decodeConversations(value: unknown): Conversation[] {
  if (!Array.isArray(value))
    throw new Error("저장한 대화 형식을 확인할 수 없어요.");
  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.conversationId !== "string" ||
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
      model: item.model,
      updated: item.updated,
      messages: item.messages,
    };
  });
}
/** 연결이 만료됐을 때만 최근 대화를 전달한다. 화면의 전체 기록은 삭제하지 않는다. */
export function conversationContext(
  messages: readonly ChatMessage[],
): ChatMessage[] {
  const result: ChatMessage[] = [];
  let remaining = 20_000;
  for (const message of messages.slice(-20).reverse()) {
    if (remaining <= 0) break;
    const text = message.text.slice(-remaining);
    result.unshift({ role: message.role, text });
    remaining -= text.length;
  }
  return result;
}
