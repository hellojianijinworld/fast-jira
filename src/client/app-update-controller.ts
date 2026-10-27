import {
  type AppUpdateStatus,
  UPDATE_INTERVAL,
  updating,
} from "../domain/app-update.ts";
import type { Api } from "./api.ts";
import { createRefreshLoop } from "./refresh-loop.ts";

/** 일반 확인과 설치 작업의 재시작 대기를 분리한다. 조회만으로 설치하지 않는다. */
export function createAppUpdateController(options: {
  api: Pick<Api, "appUpdateStatus" | "checkAppUpdate" | "installAppUpdate">;
  active: () => boolean;
  changed: () => void;
  reload: () => void;
}) {
  let status: AppUpdateStatus | null = null;
  let alive = true,
    checking = false,
    loading = false,
    lost = false;
  let revision = 0;
  let trackedJob = "",
    failures = 0,
    reloaded = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const running = () => updating(status?.job ?? null) && !lost;
  const loop = createRefreshLoop({
    intervalMs: UPDATE_INTERVAL,
    active: () => alive && options.active() && !running(),
    refresh: () => check(false),
    failed: () => {},
  });
  function notify() {
    if (alive) options.changed();
  }
  function schedule() {
    clearTimeout(timer);
    timer = undefined;
    loop.update();
    if (alive && options.active() && running())
      timer = setTimeout(() => void load(), 2000);
  }
  function apply(next: AppUpdateStatus) {
    if (!alive) return;
    status = next;
    lost = false;
    failures = 0;
    if (updating(next.job)) trackedJob = next.job?.id ?? "";
    if (
      !reloaded &&
      trackedJob &&
      next.job?.id === trackedJob &&
      next.job.phase === "complete" &&
      next.currentVersion === next.job.version
    ) {
      reloaded = true;
      options.reload();
    }
    notify();
    schedule();
  }
  async function load() {
    if (!alive || loading) return;
    loading = true;
    const request = ++revision;
    try {
      const next = await options.api.appUpdateStatus();
      if (request === revision) apply(next);
    } catch {
      if (!alive || request !== revision) return;
      failures++;
      if (status && trackedJob) {
        lost = failures >= 30;
        status = {
          ...status,
          message: lost
            ? "업데이트 상태를 확인하지 못했어요. 잠시 후 직접 다시 확인해 주세요."
            : "앱을 다시 시작하고 있어요. 잠시 기다려 주세요…",
        };
      } else if (!status)
        status = {
          currentVersion: "unknown",
          supported: false,
          phase: "error",
          checkedAt: Date.now(),
          release: null,
          job: null,
          message: "업데이트 상태를 불러오지 못했어요.",
        };
      notify();
      schedule();
    } finally {
      loading = false;
    }
  }
  async function check(force = true) {
    if (!alive || checking) return;
    if (updating(status?.job ?? null)) {
      lost = false;
      await load();
      return;
    }
    checking = true;
    const request = ++revision;
    notify();
    try {
      const next = await options.api.checkAppUpdate(force);
      if (request === revision) apply(next);
    } catch {
      if (status && alive && request === revision)
        status = {
          ...status,
          phase: "error",
          checkedAt: Date.now(),
          message: "업데이트를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
        };
    } finally {
      checking = false;
      notify();
      schedule();
    }
  }
  async function install() {
    if (
      !alive ||
      checking ||
      running() ||
      !status?.release ||
      !status.supported ||
      status.phase !== "available"
    )
      return;
    checking = true;
    const request = ++revision;
    notify();
    try {
      const next = await options.api.installAppUpdate(status.release);
      if (request === revision) apply(next);
    } catch (error) {
      await load();
      if (status && !running() && alive)
        status = {
          ...status,
          message:
            error instanceof Error
              ? error.message
              : "업데이트를 시작하지 못했어요.",
        };
    } finally {
      checking = false;
      notify();
      schedule();
    }
  }
  function resume() {
    schedule();
    if (
      alive &&
      options.active() &&
      status?.checkedAt === null &&
      !checking &&
      !running()
    )
      void check(false);
  }
  void load().then(resume);
  return {
    get status() {
      return status;
    },
    get checking() {
      return checking;
    },
    get running() {
      return running();
    },
    get disconnected() {
      return lost;
    },
    check,
    install,
    resume,
    destroy() {
      alive = false;
      clearTimeout(timer);
      loop.destroy();
    },
  };
}
