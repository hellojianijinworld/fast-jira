/** 두 리사이저가 포인터 캡처·취소·리스너 정리를 공유한다. 키보드 값은 각 영역이 정한다. */
export function dragHandle(
  handle: HTMLElement,
  move: (event: PointerEvent) => void,
  key: (event: KeyboardEvent) => void,
  end: () => void = () => {},
) {
  const controller = new AbortController(),
    options = { signal: controller.signal };
  handle.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0) return;
      handle.setPointerCapture(event.pointerId);
      move(event);
    },
    options,
  );
  handle.addEventListener(
    "pointermove",
    (event) => {
      if (handle.hasPointerCapture(event.pointerId)) move(event);
    },
    options,
  );
  handle.addEventListener(
    "pointerup",
    (event) => {
      if (handle.hasPointerCapture(event.pointerId))
        handle.releasePointerCapture(event.pointerId);
    },
    options,
  );
  handle.addEventListener("lostpointercapture", end, options);
  handle.addEventListener("keydown", key, options);
  return () => controller.abort();
}
