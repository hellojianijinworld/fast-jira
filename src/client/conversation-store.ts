import type { ChatFollowupMode, ChatSendMode } from "../domain/chat-input.ts";
import {
  type Conversation,
  decodeConversations,
} from "../domain/conversation.ts";
import { isRecord } from "../domain/validation.ts";
import type { LocalStore } from "./preferences.ts";
/** Jira 사이트·계정별 브라우저 보관. 저장 실패 시 기존 기록을 덮어쓰지 않는다. */
export function createConversationStore(storage: LocalStore, scope: string) {
  const key = `fastJira:conversations:${scope}`;
  let readable = true;
  const modelKey = `fastJira:assistant-model:${scope}`;
  const sendModeKey = `fastJira:assistant-send-mode:${scope}`;
  const followupKey = `fastJira:assistant-followup-mode:${scope}`;
  const effortKey = `fastJira:assistant-efforts:${scope}`;
  function efforts(): Record<string, unknown> {
    try {
      const value: unknown = JSON.parse(storage.getItem(effortKey) ?? "{}");
      return isRecord(value) ? value : {};
    } catch {
      return {};
    }
  }
  const store = {
    defaultEffort(model: string): string {
      const value = efforts()[model];
      return typeof value === "string" ? value : "";
    },
    setDefaultEffort(model: string, effort: string) {
      try {
        storage.setItem(
          effortKey,
          JSON.stringify({ ...efforts(), [model]: effort }),
        );
      } catch {
        throw new Error("추론 강도를 브라우저에 저장하지 못했어요.");
      }
    },
    followupMode(): ChatFollowupMode {
      try {
        return storage.getItem(followupKey) === "steer" ? "steer" : "queue";
      } catch {
        return "queue";
      }
    },
    setFollowupMode(mode: ChatFollowupMode) {
      storage.setItem(followupKey, mode);
    },
    sendMode(): ChatSendMode {
      try {
        return storage.getItem(sendModeKey) === "shortcut"
          ? "shortcut"
          : "enter";
      } catch {
        return "enter";
      }
    },
    setSendMode(mode: ChatSendMode) {
      try {
        storage.setItem(sendModeKey, mode);
      } catch {
        throw new Error("보내기 설정을 브라우저에 저장하지 못했어요.");
      }
    },
    defaultModel(): string {
      try {
        return storage.getItem(modelKey) ?? "";
      } catch {
        return "";
      }
    },
    setDefaultModel(model: string) {
      try {
        storage.setItem(modelKey, model);
      } catch {
        throw new Error("기본 모델을 브라우저에 저장하지 못했어요.");
      }
    },
    read(): Conversation[] {
      try {
        const value = storage.getItem(key);
        return value ? decodeConversations(JSON.parse(value)) : [];
      } catch {
        readable = false;
        throw new Error(
          "저장한 대화를 읽지 못했어요. 기존 기록은 덮어쓰지 않습니다.",
        );
      }
    },
    write(value: Conversation[]) {
      if (!readable)
        throw new Error("저장한 대화를 읽지 못해 새 기록을 저장할 수 없어요.");
      try {
        storage.setItem(key, JSON.stringify(value));
      } catch {
        throw new Error(
          "브라우저에 대화를 저장하지 못했어요. 창을 닫기 전에 내용을 복사해 주세요.",
        );
      }
    },
    upsert(value: Conversation) {
      const next = [
        value,
        ...store.read().filter((item) => item.id !== value.id),
      ];
      store.write(next);
      return next;
    },
    remove(id: string) {
      const next = store.read().filter((item) => item.id !== id);
      store.write(next);
      return next;
    },
  };
  return store;
}
export type ConversationStore = ReturnType<typeof createConversationStore>;
