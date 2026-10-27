import assert from "node:assert/strict";
import { test } from "node:test";
import { createConversationStore } from "../src/client/conversation-store.ts";
import {
  commandForShortcut,
  matchingCommands,
  shortcutAria,
  shortcutLabel,
} from "../src/domain/commands.ts";
import {
  conversationContext,
  decodeConversations,
} from "../src/domain/conversation.ts";

const chat = {
  id: "local-1",
  conversationId: "native-1",
  model: "test",
  updated: 100,
  messages: [{ role: "user" as const, text: "내 작업 찾아줘" }],
};
test("명령 검색은 이름·검색어로 찾고 OS별 단축키를 표시한다", () => {
  assert.deepEqual(
    matchingCommands("AI").map((x) => x.id),
    ["ai"],
  );
  assert.deepEqual(
    matchingCommands("> 찾기").map((x) => x.id),
    ["search"],
  );
  assert.equal(matchingCommands("없는 명령").length, 0);
  assert.equal(shortcutLabel("MacIntel", "palette"), "⌘⇧P");
  assert.equal(shortcutLabel("Win32"), "Ctrl+K");
  assert.equal(shortcutLabel("MacIntel", "ai"), "⌃⌘I");
  assert.equal(shortcutLabel("Win32", "ai"), "Ctrl+Alt+I");
  assert.equal(shortcutAria("MacIntel", "ai"), "Control+Meta+i");
  assert.equal(shortcutAria("Linux", "ai"), "Control+Alt+i");
});
test("AI 단축키는 OS별 조합과 한글 물리 키를 인식하고 개발자 도구·AltGr 입력은 가로채지 않는다", () => {
  const key = {
    key: "ㅑ",
    code: "KeyI",
    metaKey: true,
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    repeat: false,
    getModifierState: () => false,
  };
  assert.equal(commandForShortcut(key, "MacIntel"), "ai");
  assert.equal(
    commandForShortcut({ ...key, ctrlKey: false }, "MacIntel"),
    null,
  );
  assert.equal(
    commandForShortcut({ ...key, ctrlKey: false, altKey: true }, "MacIntel"),
    null,
  );
  assert.equal(
    commandForShortcut({ ...key, metaKey: false, altKey: true }, "Win32"),
    "ai",
  );
  assert.equal(
    commandForShortcut(
      { ...key, metaKey: false, altKey: true, getModifierState: () => true },
      "Win32",
    ),
    null,
  );
  assert.equal(
    commandForShortcut({ ...key, shiftKey: true }, "MacIntel"),
    null,
  );
  assert.equal(commandForShortcut({ ...key, repeat: true }, "MacIntel"), null);
  assert.equal(
    commandForShortcut(
      { ...key, key: "k", code: "KeyK", ctrlKey: false },
      "MacIntel",
    ),
    "search",
  );
  assert.equal(
    commandForShortcut(
      { ...key, key: "P", code: "KeyP", ctrlKey: false, shiftKey: true },
      "MacIntel",
    ),
    "palette",
  );
});
test("대화는 Jira 계정별로 복원·직접 삭제하며 읽기 실패 시 기존 기록을 보존한다", () => {
  const data = new Map<string, string>(),
    storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
  const first = createConversationStore(storage, "site:a"),
    second = createConversationStore(storage, "site:b");
  first.write([chat]);
  assert.deepEqual(createConversationStore(storage, "site:a").read(), [chat]);
  assert.deepEqual(second.read(), []);
  first.write([]);
  assert.deepEqual(first.read(), []);
  storage.setItem("fastJira:conversations:site:a", "broken");
  assert.throws(() => first.read(), /덮어쓰지/);
  assert.throws(() => first.write([chat]));
  assert.equal(storage.getItem("fastJira:conversations:site:a"), "broken");
});
test("연결 복구에는 최근 20개·2만 자만 전달하며 원래 기록은 유지한다", () => {
  const messages = Array.from({ length: 30 }, (_, i) => ({
    role: "user" as const,
    text: `${i}:${"가".repeat(1200)}`,
  }));
  const context = conversationContext(messages);
  assert.ok(context.length <= 20);
  assert.equal(
    context.reduce((sum, x) => sum + x.text.length, 0),
    20000,
  );
  assert.deepEqual(context.at(-1), messages.at(-1));
  assert.equal(messages.length, 30);
  assert.throws(() =>
    decodeConversations([
      { ...chat, messages: [{ role: "system", text: "unsafe" }] },
    ]),
  );
  const store = createConversationStore(
    {
      getItem: () => null,
      setItem: () => {
        throw Error("quota");
      },
    },
    "site:a",
  );
  assert.throws(() => store.write([chat]), /저장하지 못/);
});
test("대화별 모델과 새 대화 기본 모델은 계정별로 각각 복원한다", () => {
  const data = new Map<string, string>(),
    storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
  const store = createConversationStore(storage, "site:a");
  store.setDefaultModel("second");
  store.upsert({ ...chat, model: "first" });
  const restored = createConversationStore(storage, "site:a");
  assert.equal(restored.defaultModel(), "second");
  assert.equal(restored.read()[0]?.model, "first");
  assert.equal(createConversationStore(storage, "site:b").defaultModel(), "");
});
