import assert from "node:assert/strict";
import { test } from "node:test";
import type { CodexClient, CodexMessage } from "../src/server/codex-client.ts";
import { createVoiceService } from "../src/server/voice-service.ts";

function fixture(type = "chatgpt", failure = "") {
  const listeners = new Set<(message: CodexMessage) => void>(),
    calls: { method: string; params: unknown }[] = [];
  let closed = false;
  const emit = (method: string, params: unknown) => {
    for (const listener of listeners) listener({ method, params });
  };
  const client: CodexClient = {
    async request(method, params) {
      calls.push({ method, params });
      if (method === "account/read") return { account: { type } };
      if (method === "mcpServerStatus/list")
        return { data: [{ name: "unrelated" }], nextCursor: null };
      if (method === "thread/start") return { thread: { id: "voice" } };
      if (method === "thread/realtime/start") {
        if (failure) throw new Error(failure);
        emit("thread/realtime/sdp", {
          threadId: "voice",
          sdp: "v=0\r\nanswer",
        });
        return {};
      }
      throw new Error(`Unexpected ${method}`);
    },
    respond() {},
    listen(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      closed = true;
    },
  };
  return {
    voice: createVoiceService(async () => client),
    calls,
    emit,
    get closed() {
      return closed;
    },
  };
}
test("OAuth 음성은 사용자 전사만 누적하고 서버 도구·다른 세션은 제외한다", async () => {
  const f = fixture();
  try {
    const session = await f.voice.start({ sdp: "v=0\r\noffer" });
    const events: string[] = [];
    const stop = f.voice.subscribe(session.id, (event) => {
      events.push(event.text);
    });
    assert.throws(() => f.voice.subscribe("other", () => {}), /만료/);
    f.emit("thread/realtime/transcript/delta", {
      threadId: "other",
      role: "user",
      delta: "다른 세션",
    });
    f.emit("thread/realtime/transcript/delta", {
      threadId: "voice",
      role: "assistant",
      delta: "응답",
    });
    f.emit("thread/realtime/transcript/delta", {
      threadId: "voice",
      role: "user",
      delta: "내 ",
    });
    f.emit("thread/realtime/transcript/delta", {
      threadId: "voice",
      role: "user",
      delta: "작업",
    });
    f.emit("thread/realtime/transcript/done", {
      threadId: "voice",
      role: "user",
      text: "내 작업",
    });
    assert.equal(events.at(-1), "내 작업");
    assert.ok(!events.some((x) => x.includes("다른") || x.includes("응답")));
    const start = f.calls.find((x) => x.method === "thread/start");
    assert.ok(JSON.stringify(start).includes('"enabled":false'));
    await assert.rejects(f.voice.start({ sdp: "v=0" }), /진행 중/);
    stop();
    assert.equal(f.closed, true);
    assert.throws(() => f.voice.subscribe(session.id, () => {}), /만료/);
  } finally {
    f.voice.dispose();
  }
});
test("음성은 API 키 계정을 사용하지 않고 구형 CLI 오류와 잘못된 SDP를 정리한다", async () => {
  const key = fixture("apiKey");
  await assert.rejects(key.voice.start({ sdp: "v=0" }), /ChatGPT 로그인/);
  assert.equal(key.closed, true);
  key.voice.dispose();
  const old = fixture("chatgpt", "unknown variant `v3`, expected `v1` or `v2`");
  await assert.rejects(old.voice.start({ sdp: "v=0" }), /업데이트/);
  assert.equal(old.closed, true);
  old.voice.dispose();
  const invalid = fixture();
  await assert.rejects(invalid.voice.start({ sdp: "bad" }), /연결 정보/);
  assert.equal(invalid.calls.length, 0);
  invalid.voice.dispose();
});
