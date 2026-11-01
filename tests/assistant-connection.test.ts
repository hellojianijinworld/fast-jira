import assert from "node:assert/strict";
import { test } from "node:test";
import { createAssistantConnection } from "../src/client/assistant-connection.ts";
import { assistantFeatures } from "../src/domain/assistant.ts";

const model = { id: "available", name: "사용 가능", isDefault: true };

test("AI 대화와 음성은 개별 지원 상태를 따르고 확실한 미연결일 때만 숨긴다", () => {
  assert.deepEqual(
    assistantFeatures({ ready: true, models: [model], error: "" }),
    { chat: true, voice: false },
  );
  assert.deepEqual(
    assistantFeatures({
      ready: true,
      models: [model],
      error: "",
      voice: { ready: true },
    }),
    { chat: true, voice: true },
  );
  assert.deepEqual(
    assistantFeatures(
      { ready: false, models: [], error: "", availability: "unavailable" },
      { chat: true, voice: true },
    ),
    { chat: false, voice: false },
  );
  assert.deepEqual(
    assistantFeatures(
      { ready: false, models: [], error: "", availability: "unknown" },
      { chat: true, voice: false },
    ),
    { chat: true, voice: false },
  );
  assert.deepEqual(
    assistantFeatures({
      ready: true,
      models: [],
      error: "",
      availability: "unavailable",
    }),
    { chat: false, voice: false },
  );
});

test("여러 UI의 동시 상태 확인은 한 요청을 공유하고 수동 확인만 캐시를 건너뛴다", async () => {
  let calls = 0;
  let complete!: () => void;
  const gate = new Promise<void>((resolve) => {
    complete = resolve;
  });
  let time = 0;
  const connection = createAssistantConnection(
    async () => {
      calls++;
      await gate;
      return { ready: true, models: [model], error: "", availability: "ready" };
    },
    () => time,
  );
  const first = connection.refresh();
  const second = connection.refresh();
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(connection.snapshot.chat, false);
  complete();
  await Promise.all([first, second]);
  assert.equal(connection.snapshot.chat, true);
  await connection.refresh();
  assert.equal(calls, 1);
  time = 61000;
  await connection.refresh();
  assert.equal(calls, 2);
  await connection.refresh(true);
  assert.equal(calls, 3);
  connection.destroy();
});

test("일시적 통신 실패는 정상 AI 기능과 작성 중인 화면을 없애는 근거가 되지 않는다", async () => {
  let fail = false;
  const connection = createAssistantConnection(async () => {
    if (fail) throw new Error("TOKEN=do-not-show");
    return { ready: true, models: [model], error: "", availability: "ready" };
  });
  await connection.refresh();
  fail = true;
  await connection.refresh(true);
  assert.equal(connection.snapshot.chat, true);
  assert.equal(connection.snapshot.status?.availability, "unknown");
  assert(!connection.snapshot.error.includes("TOKEN"));
  connection.destroy();
});

test("로그인 안내는 오류 문구 대신 검증된 사유 코드로 구분한다", async () => {
  const { assistantStatus } = await import("../src/domain/assistant.ts");
  const { assistantFailure, AssistantUnavailableError } = await import(
    "../src/server/assistant-errors.ts"
  );
  const failure = assistantFailure(
    new AssistantUnavailableError("login_required", "안내"),
  );
  const status = assistantStatus({
    ready: false,
    models: [],
    error: "",
    providers: [{ id: "codex", ready: false, ...failure }],
  });
  assert.equal(status.providers?.[0]?.reason, "login_required");
  assert.throws(() =>
    assistantStatus({
      ready: false,
      models: [],
      error: "",
      providers: [
        { id: "codex", ready: false, error: "", reason: "execute-anything" },
      ],
    }),
  );
});
