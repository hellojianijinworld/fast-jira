import { element, elementId } from "./dom.ts";

export const TOOLTIP_DELAY_MS = 120;

/** 브라우저 기본 title도 공통 지연·배치로 표시하고, 떠 있는 동안만 기본 툴팁을 막는다. */
export function startTooltips() {
  const controller = new AbortController();
  const { signal } = controller;
  const tip = element("div", "ui-tooltip");
  tip.id = elementId("tooltip");
  tip.popover = "manual";
  tip.setAttribute("role", "tooltip");
  document.body.append(tip);
  let target: HTMLElement | SVGElement | null = null;
  let titles: { node: Element; text: string }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  function hide() {
    clearTimeout(timer);
    if (target) {
      const descriptions = (target.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .filter((id) => id && id !== tip.id);
      if (descriptions.length)
        target.setAttribute("aria-describedby", descriptions.join(" "));
      else target.removeAttribute("aria-describedby");
    }
    for (const { node, text } of titles)
      if (!node.hasAttribute("title")) node.setAttribute("title", text);
    titles = [];
    target = null;
    if (tip.matches(":popover-open")) tip.hidePopover();
  }
  function enter(event: Event) {
    if (event instanceof PointerEvent && event.pointerType === "touch") return;
    if (!(event.target instanceof Element)) return;
    const next = event.target.closest<HTMLElement | SVGElement>(
      "[title], [data-tooltip]",
    );
    if (target?.contains(event.target) && (!next || next === target)) return;
    hide();
    if (!next || next.closest(":disabled")) return;
    const text = next.getAttribute("title") || next.dataset.tooltip;
    if (!text) return;
    target = next;
    for (let node: Element | null = next; node; node = node.parentElement) {
      const text = node.getAttribute("title");
      if (text !== null) {
        titles.push({ node, text });
        node.removeAttribute("title");
      }
    }
    timer = setTimeout(() => {
      if (!next.isConnected) return hide();
      tip.textContent = text;
      tip.showPopover();
      const rect = next.getBoundingClientRect();
      const width = tip.offsetWidth;
      const height = tip.offsetHeight;
      tip.style.left = `${Math.max(8, Math.min(rect.left + (rect.width - width) / 2, window.innerWidth - width - 8))}px`;
      tip.style.top = `${Math.max(8, Math.min(rect.top >= height + 12 ? rect.top - height - 6 : rect.bottom + 6, window.innerHeight - height - 8))}px`;
      next.setAttribute(
        "aria-describedby",
        [next.getAttribute("aria-describedby"), tip.id]
          .filter(Boolean)
          .join(" "),
      );
    }, TOOLTIP_DELAY_MS);
  }
  function leave(event: Event) {
    if (
      event instanceof MouseEvent &&
      event.relatedTarget instanceof Node &&
      target?.contains(event.relatedTarget)
    )
      return;
    hide();
  }
  document.addEventListener("pointerover", enter, { signal });
  document.addEventListener("focusin", enter, { signal });
  document.addEventListener("pointerout", leave, { signal });
  document.addEventListener("focusout", leave, { signal });
  document.addEventListener("click", hide, { signal, capture: true });
  document.addEventListener("scroll", hide, { signal, capture: true });
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") hide();
    },
    { signal },
  );
  window.addEventListener("resize", hide, { signal });
  window.addEventListener("blur", hide, { signal });
  return () => {
    hide();
    controller.abort();
    tip.remove();
  };
}
