import assert from "node:assert/strict";
import { test } from "node:test";
import { createChatQueue } from "../src/client/chat-queue.ts";
import { createConversationStore } from "../src/client/conversation-store.ts";

test("대기 요청은 순서대로 꺼내고 중단 시 보존하며 대화별로 분리한다", () => {
  const queue = createChatQueue();
  const first = queue.add("a", "첫 요청");
  const second = queue.add("a", "다음 요청");
  queue.add("b", "다른 대화");
  queue.pause("a");
  assert.equal(queue.take("a"), undefined);
  assert.equal(queue.list("a").length, 2);
  queue.resume("a");
  assert.deepEqual(queue.take("a"), first);
  queue.remove("a", second.id);
  assert.equal(queue.take("a"), undefined);
  assert.equal(queue.take("b")?.text, "다른 대화");
});
test("추가 전송 방식은 계정별로 보관하고 손상 값은 대기열로 복구한다", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
  };
  const store = createConversationStore(storage, "a");
  assert.equal(store.followupMode(), "queue");
  store.setFollowupMode("steer");
  assert.equal(createConversationStore(storage, "a").followupMode(), "steer");
  assert.equal(createConversationStore(storage, "b").followupMode(), "queue");
});
