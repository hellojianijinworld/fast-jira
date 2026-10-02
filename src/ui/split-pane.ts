import type { LocalStore } from "../client/preferences.ts";
import { dragHandle } from "./drag-handle.ts";
import { splitDimensions } from "./geometry.ts";

export function createSplitPane(
  workspace: HTMLElement,
  handle: HTMLElement,
  mobile: MediaQueryList,
  storage: LocalStore,
) {
  let ratio = 0.5;
  try {
    const value = Number(storage.getItem("fastJira:splitRatio"));
    if (value > 0 && value < 1) ratio = value;
  } catch {
    /* 저장소를 쓸 수 없어도 현재 폭은 조절한다. */
  }
  handle.tabIndex = 0;
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", "목록과 상세 영역 너비");
  function apply(next = ratio) {
    if (mobile.matches) {
      workspace.style.removeProperty("grid-template-columns");
      return;
    }
    const available = workspace.clientWidth - handle.offsetWidth;
    if (available <= 0) return;
    const result = splitDimensions(
      available,
      parseFloat(getComputedStyle(document.documentElement).fontSize),
      next,
    );
    ratio = result.ratio;
    workspace.style.gridTemplateColumns = `${result.width}px ${handle.offsetWidth}px minmax(0,1fr)`;
    handle.setAttribute(
      "aria-valuemin",
      String(Math.round((result.minimum / available) * 100)),
    );
    handle.setAttribute(
      "aria-valuemax",
      String(Math.round((result.maximum / available) * 100)),
    );
    handle.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
  }
  function save() {
    try {
      storage.setItem("fastJira:splitRatio", String(ratio));
    } catch {
      /* 현재 폭은 유지한다. */
    }
  }
  const stop = dragHandle(
    handle,
    (event) => {
      if (!mobile.matches)
        apply(
          (event.clientX -
            workspace.getBoundingClientRect().left -
            handle.offsetWidth / 2) /
            (workspace.clientWidth - handle.offsetWidth),
        );
    },
    (event) => {
      if (
        mobile.matches ||
        !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
      )
        return;
      event.preventDefault();
      const available = workspace.clientWidth - handle.offsetWidth;
      if (available <= 0) return;
      const step =
        (2 * parseFloat(getComputedStyle(document.documentElement).fontSize)) /
        available;
      apply(
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? 1
            : ratio + (event.key === "ArrowRight" ? step : -step),
      );
      save();
    },
    save,
  );
  const reset = () => {
    apply(0.5);
    save();
  };
  handle.addEventListener("dblclick", reset);
  const resize = new ResizeObserver(() => apply());
  resize.observe(workspace);
  const update = () => apply();
  mobile.addEventListener("change", update);
  apply();
  return {
    destroy() {
      stop();
      resize.disconnect();
      handle.removeEventListener("dblclick", reset);
      mobile.removeEventListener("change", update);
      workspace.style.removeProperty("grid-template-columns");
    },
  };
}
