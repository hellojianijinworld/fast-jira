import { element, iconButton } from "./dom.ts";

/** 본문은 필수, 푸터는 선택이다. 모든 모달의 작업 버튼은 오른쪽에 모은다. */
export function showModal(
  dialog: HTMLDialogElement,
  options: {
    title: string;
    content: Node;
    actions?: HTMLButtonElement[];
    dismissible?: boolean;
  },
) {
  if (dialog.open) dialog.close();
  const head = element("div", "dialog-head"),
    close = iconButton("닫기", "x");
  close.hidden = options.dismissible === false;
  close.addEventListener("click", () => dialog.close());
  head.append(element("h2", "", options.title), close);
  dialog.setAttribute("aria-label", options.title);
  dialog.replaceChildren(head, options.content);
  if (options.actions?.length) {
    const footer = element("footer", "modal-footer");
    footer.append(...options.actions);
    dialog.append(footer);
  }
  dialog.showModal();
}
