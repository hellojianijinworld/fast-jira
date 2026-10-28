import { element } from "./dom.ts";

/** 카드·상세·댓글·일괄 링크 복사는 같은 성공/실패 안내를 사용한다. */
export async function copyText(
  text: string,
  notify: (message: string) => void = () => {},
  success = "링크를 복사했어요.",
  failure = "링크를 복사하지 못했어요.",
): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      // LAN의 HTTP 화면에서는 Clipboard API가 없어 기존 복사 명령을 사용한다.
      const input = document.createElement("textarea");
      input.className = "clipboard-copy";
      input.value = text;
      input.readOnly = true;
      input.style.cssText =
        "position:fixed;top:0;left:0;opacity:0;pointer-events:none;font-size:16px";
      const active = document.activeElement;
      const selection = window.getSelection();
      const range = selection?.rangeCount
        ? selection.getRangeAt(0).cloneRange()
        : null;
      (active?.closest("dialog[open]") ?? document.body).append(input);
      try {
        input.focus({ preventScroll: true });
        input.select();
        input.setSelectionRange(0, text.length);
        if (!document.execCommand("copy")) throw new Error("복사 실패");
      } finally {
        input.remove();
        if (active instanceof HTMLElement)
          active.focus({ preventScroll: true });
        if (selection && range) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    }
    notify(success);
  } catch {
    notify(failure);
  }
}

/** 목록과 상세의 키는 같은 복사 동작과 공통 툴팁을 사용한다. */
export function issueKeyCopy(
  key: string,
  url: string | null,
  notify?: (message: string) => void,
) {
  const button = element("button", "key card-copy", key);
  button.type = "button";
  button.setAttribute("aria-label", `${key} 이슈 링크 복사`);
  button.dataset.tooltip = "링크 복사";
  button.disabled = !url;
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (url) await copyText(url, notify);
  });
  return button;
}
