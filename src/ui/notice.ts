import { element, iconButton } from "./dom.ts";

export type UndoAction = () => void | Promise<void>;
/** 일반 안내는 3초, 되돌리기는 5초다. 읽거나 키보드로 조작하는 동안에는 닫지 않는다. */
export function createNotice(notice: HTMLElement) {
  const controller = new AbortController();
  const signal = controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let duration = 3000;
  notice.classList.add("notice");
  notice.setAttribute("role", "status");
  notice.hidden = true;
  function close() {
    clearTimeout(timer);
    notice.hidden = true;
  }
  function schedule() {
    clearTimeout(timer);
    if (
      !notice.hidden &&
      !notice.matches(":hover") &&
      !notice.contains(document.activeElement)
    )
      timer = setTimeout(close, duration);
  }
  notice.addEventListener("pointerenter", () => clearTimeout(timer), {
    signal,
  });
  notice.addEventListener("pointerleave", schedule, { signal });
  notice.addEventListener("focusin", () => clearTimeout(timer), { signal });
  notice.addEventListener("focusout", () => queueMicrotask(schedule), {
    signal,
  });
  function show(text: string, undo?: UndoAction) {
    clearTimeout(timer);
    duration = undo ? 5000 : 3000;
    notice.replaceChildren(element("span", "", text));
    if (undo) {
      const button = element("button", "secondary", "되돌리기");
      button.type = "button";
      button.addEventListener(
        "click",
        async () => {
          close();
          button.disabled = true;
          try {
            await undo();
          } catch (reason) {
            show(
              reason instanceof Error ? reason.message : "되돌리지 못했어요.",
            );
          }
        },
        { signal },
      );
      notice.append(button);
    }
    const dismiss = iconButton("알림 닫기", "x");
    dismiss.addEventListener("click", close, { signal });
    notice.append(dismiss);
    notice.hidden = false;
    schedule();
  }
  return {
    show,
    close,
    destroy: () => {
      close();
      controller.abort();
      notice.replaceChildren();
    },
  };
}
