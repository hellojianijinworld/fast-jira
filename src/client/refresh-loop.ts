/** 비활성 화면의 예약을 멈추고, 복귀 시 남은 갱신 주기를 이어간다. */
export function createRefreshLoop(options: {
  active: () => boolean;
  refresh: () => Promise<void>;
  failed: (reason: unknown) => void;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastCheck = Date.now(),
    busy = false,
    alive = true;
  function update() {
    clearTimeout(timer);
    timer = undefined;
    if (!alive || busy || !options.active()) return;
    timer = setTimeout(
      () => void check(),
      Math.max(0, 60000 - (Date.now() - lastCheck)),
    );
  }
  async function check() {
    timer = undefined;
    if (!alive || busy || !options.active()) return;
    busy = true;
    try {
      await options.refresh();
    } catch (reason) {
      if (alive) options.failed(reason);
    } finally {
      lastCheck = Date.now();
      busy = false;
      update();
    }
  }
  return {
    update,
    destroy() {
      alive = false;
      clearTimeout(timer);
    },
  };
}
