import assert from "node:assert/strict";
import { test } from "node:test";
import { createConversationStore } from "../src/client/conversation-store.ts";
import { sendsChatMessage } from "../src/domain/chat-input.ts";

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
