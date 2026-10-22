import assert from "node:assert/strict";
import { test } from "node:test";
import { createRefreshLoop } from "../src/client/refresh-loop.ts";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("비활성 상태는 예약을 쉬고 오래된 화면만 복귀 시 한 번 조회한다", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  let active = true;
  let calls = 0;
  const loop = createRefreshLoop({
    active: () => active,
    refresh: async () => {
      calls++;
    },
    failed: () => assert.fail("예상하지 않은 조회 오류"),
  });
  t.after(() => loop.destroy());
  loop.update();
  t.mock.timers.tick(20000);
  active = false;
  loop.update();
  t.mock.timers.tick(180000);
  await settle();
  assert.equal(calls, 0);
  active = true;
  loop.update();
  loop.update();
  t.mock.timers.tick(0);
  await settle();
  assert.equal(calls, 1);
  active = false;
  loop.update();
  t.mock.timers.tick(1000);
  active = true;
  loop.update();
  t.mock.timers.tick(58999);
  await settle();
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  await settle();
  assert.equal(calls, 2);
});

test("포커스 이벤트가 반복되거나 조회가 늦어도 겹치지 않고 종료 후 재개하지 않는다", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  let active = true;
  let calls = 0;
  let finish: () => void = () => {};
  const reply = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const loop = createRefreshLoop({
    active: () => active,
    refresh: async () => {
      calls++;
      await reply;
    },
    failed: () => assert.fail("예상하지 않은 조회 오류"),
  });
  t.after(() => loop.destroy());
  loop.update();
  t.mock.timers.tick(60000);
  active = false;
  loop.update();
  t.mock.timers.tick(180000);
  active = true;
  loop.update();
  loop.update();
  await settle();
  assert.equal(calls, 1);
  loop.destroy();
  finish();
  await settle();
  loop.update();
  t.mock.timers.tick(180000);
  await settle();
  assert.equal(calls, 1);
});

test("조회 실패 후에도 즉시 재시도 폭주 없이 다음 주기에 재개한다", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  let calls = 0;
  const errors: unknown[] = [];
  const loop = createRefreshLoop({
    active: () => true,
    refresh: async () => {
      calls++;
      throw new Error("조회 실패");
    },
    failed: (reason) => errors.push(reason),
  });
  t.after(() => loop.destroy());
  loop.update();
  t.mock.timers.tick(60000);
  await settle();
  assert.equal(calls, 1);
  assert.equal(errors.length, 1);
  loop.update();
  t.mock.timers.tick(59999);
  await settle();
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  await settle();
  assert.equal(calls, 2);
});
