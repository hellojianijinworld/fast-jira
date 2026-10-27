import assert from "node:assert/strict";
import { test } from "node:test";
import { createAppUpdateController } from "../src/client/app-update-controller.ts";
import type { AppUpdateStatus } from "../src/domain/app-update.ts";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const status = (): AppUpdateStatus => ({
  currentVersion: "0.1.0",
  supported: true,
  phase: "idle",
  checkedAt: null,
  release: null,
  message: "",
  job: null,
});
const release = {
  version: "0.1.1",
  commit: "a".repeat(40),
  notes: "작은 개선",
  url: "https://github.com/hellojianijinworld/fast-jira/releases/tag/v0.1.1",
};

test("활성 화면에서만 5분 확인하고 수동 확인은 강제 확인으로 요청한다", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  let active = true;
  const checks: boolean[] = [];
  const controller = createAppUpdateController({
    active: () => active,
    changed: () => {},
    reload: () => assert.fail("조회만으로 새로고침 금지"),
    api: {
      appUpdateStatus: async () => status(),
      checkAppUpdate: async (force = false) => {
        checks.push(force);
        return {
          ...status(),
          phase: "available",
          checkedAt: Date.now(),
          release,
        };
      },
      installAppUpdate: async () => assert.fail("조회만으로 설치 금지"),
    },
  });
  t.after(() => controller.destroy());
  await settle();
  assert.deepEqual(checks, [false]);
  t.mock.timers.tick(299999);
  await settle();
  assert.equal(checks.length, 1);
  active = false;
  controller.resume();
  t.mock.timers.tick(600000);
  await settle();
  assert.equal(checks.length, 1);
  active = true;
  controller.resume();
  t.mock.timers.tick(0);
  await settle();
  assert.deepEqual(checks, [false, false]);
  await controller.check(true);
  assert.deepEqual(checks, [false, false, true]);
});

test("업데이트 재시작 중 조회 실패를 견디고 새 버전 완료가 확인된 뒤에만 화면을 새로 연다", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  let reloads = 0,
    reads = 0;
  let installed = false;
  const controller = createAppUpdateController({
    active: () => true,
    changed: () => {},
    reload: () => {
      reloads++;
    },
    api: {
      appUpdateStatus: async () => {
        if (!installed) return status();
        if (++reads === 1) throw new Error("재시작 중");
        return {
          ...status(),
          currentVersion: "0.1.1",
          job: {
            id: "job-1",
            version: "0.1.1",
            phase: "complete",
            startedAt: 1000,
            message: "완료",
          },
        };
      },
      checkAppUpdate: async () => ({
        ...status(),
        phase: "available",
        release,
        checkedAt: Date.now(),
      }),
      installAppUpdate: async () => {
        installed = true;
        return {
          ...status(),
          phase: "available",
          release,
          job: {
            id: "job-1",
            version: "0.1.1",
            phase: "preparing",
            startedAt: 1000,
            message: "준비 중",
          },
        };
      },
    },
  });
  t.after(() => controller.destroy());
  await settle();
  await controller.install();
  assert.equal(reloads, 0);
  t.mock.timers.tick(2000);
  await settle();
  assert.equal(reloads, 0);
  t.mock.timers.tick(2000);
  await settle();
  assert.equal(reloads, 1);
  controller.destroy();
  t.mock.timers.tick(600000);
  await settle();
  assert.equal(reloads, 1);
});

test("늦게 도착한 초기 상태가 수동 확인 결과를 덮어쓰지 않는다", async () => {
  let resolveInitial!: (value: AppUpdateStatus) => void;
  const initial = new Promise<AppUpdateStatus>((resolve) => {
    resolveInitial = resolve;
  });
  const controller = createAppUpdateController({
    active: () => false,
    changed: () => {},
    reload: () => assert.fail("조회만으로 새로고침 금지"),
    api: {
      appUpdateStatus: () => initial,
      checkAppUpdate: async () => ({
        ...status(),
        phase: "available",
        release,
        checkedAt: 1000,
      }),
      installAppUpdate: async () => assert.fail("조회만으로 설치 금지"),
    },
  });
  try {
    await controller.check(true);
    resolveInitial(status());
    await settle();
    assert.equal(controller.status?.phase, "available");
    assert.equal(controller.status?.release?.version, "0.1.1");
  } finally {
    controller.destroy();
  }
});
