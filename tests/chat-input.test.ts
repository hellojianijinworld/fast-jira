import assert from "node:assert/strict";
import { test } from "node:test";
import { createConversationStore } from "../src/client/conversation-store.ts";
import {
  chatKeyboardAction,
  chatShortcutHints,
  sendsChatMessage,
} from "../src/domain/chat-input.ts";

const enter = {
  key: "Enter",
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  isComposing: false,
};
test("Enter 보내기와 줄바꿈 모드를 구분하고 두 OS의 명시적 보내기를 지원한다", () => {
  assert.equal(sendsChatMessage("enter", enter), true);
  assert.equal(sendsChatMessage("shortcut", enter), false);
  for (const mode of ["enter", "shortcut"] as const) {
    assert.equal(sendsChatMessage(mode, { ...enter, metaKey: true }), true);
    assert.equal(sendsChatMessage(mode, { ...enter, ctrlKey: true }), true);
    assert.equal(sendsChatMessage(mode, { ...enter, shiftKey: true }), false);
    assert.equal(sendsChatMessage(mode, { ...enter, altKey: true }), false);
  }
});
test("한글 조합 Enter와 조합 종료 코드로 요청을 보내지 않는다", () => {
  for (const mode of ["enter", "shortcut"] as const) {
    assert.equal(
      sendsChatMessage(mode, { ...enter, isComposing: true, metaKey: true }),
      false,
    );
    assert.equal(sendsChatMessage(mode, { ...enter, keyCode: 229 }), false);
    assert.equal(sendsChatMessage(mode, { ...enter, key: "a" }), false);
  }
});
test("AI 보내기 방식은 브라우저 계정별로 기억하며 잘못된 값은 기본값을 사용한다", () => {
  const values = new Map<string, string>(),
    storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
  const one = createConversationStore(storage, "site:one");
  assert.equal(one.sendMode(), "enter");
  one.setSendMode("shortcut");
  assert.equal(
    createConversationStore(storage, "site:one").sendMode(),
    "shortcut",
  );
  assert.equal(
    createConversationStore(storage, "site:two").sendMode(),
    "enter",
  );
  values.set("fastJira:assistant-send-mode:site:one", "invalid");
  assert.equal(one.sendMode(), "enter");
});

test("추가 요청의 기본·반대 동작을 두 전송 모드와 OS에서 구분한다", () => {
  for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
    assert.equal(chatKeyboardAction("enter", "queue", true, enter), "queue");
    assert.equal(
      chatKeyboardAction("enter", "queue", true, { ...enter, ...modifier }),
      "steer",
    );
    assert.equal(
      chatKeyboardAction("enter", "steer", true, { ...enter, ...modifier }),
      "queue",
    );
    assert.equal(chatKeyboardAction("shortcut", "queue", true, enter), null);
    assert.equal(
      chatKeyboardAction("shortcut", "queue", true, { ...enter, ...modifier }),
      "queue",
    );
    assert.equal(
      chatKeyboardAction("shortcut", "queue", true, {
        ...enter,
        ...modifier,
        shiftKey: true,
      }),
      "steer",
    );
    assert.equal(
      chatKeyboardAction("shortcut", "steer", true, {
        ...enter,
        ...modifier,
        shiftKey: true,
      }),
      "queue",
    );
    assert.equal(
      chatKeyboardAction("shortcut", "queue", false, { ...enter, ...modifier }),
      "send",
    );
    assert.equal(
      chatKeyboardAction("shortcut", "queue", true, {
        ...enter,
        ...modifier,
        shiftKey: true,
        isComposing: true,
      }),
      null,
    );
  }
});
test("단축키 안내는 전송 설정·OS·진행 상태와 일치한다", () => {
  assert.equal(
    chatShortcutHints("enter", "queue", true, true).composer,
    "Enter 대기열 · ⌘Enter 즉시 전달 · Shift+Enter 줄바꿈",
  );
  assert.equal(
    chatShortcutHints("shortcut", "steer", true, false).composer,
    "Ctrl+Enter 즉시 전달 · Ctrl+Shift+Enter 대기열 · Enter 줄바꿈",
  );
  assert.equal(
    chatShortcutHints("shortcut", "queue", false, true).composer,
    "⌘Enter 전송 · Enter 줄바꿈",
  );
});
