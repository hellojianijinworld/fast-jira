import { element, elementId } from "./dom.ts";
import { popoverPosition } from "./geometry.ts";

/** 메뉴 내용과 동작은 호출자가, 배치·닫기·키보드·포커스는 공통 메뉴가 맡는다. */
export function createMenu(options: {
  label: string;
  className?: string;
  width?: number;
  maxHeight?: number;
}) {
  const panel = element(
    "div",
    `select-options ui-menu ${options.className ?? ""}`,
  );
  panel.id = elementId("menu");
  panel.popover = "auto";
  panel.setAttribute("role", "menu");
  panel.setAttribute("aria-label", options.label);
  const abort = new AbortController(),
    { signal } = abort;
  let trigger: HTMLElement | undefined;
  const choices = () =>
    [
      ...panel.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]',
      ),
    ].filter(
      (item) =>
        !item.hasAttribute("disabled") &&
        item.getAttribute("aria-disabled") !== "true" &&
        item.getClientRects().length > 0,
    );
  function close(focus = true) {
    if (panel.matches(":popover-open")) panel.hidePopover();
    if (trigger?.getAttribute("aria-controls") === panel.id)
      trigger.setAttribute("aria-expanded", "false");
    if (focus && trigger?.isConnected) trigger.focus({ preventScroll: true });
  }
  function open(
    anchor: HTMLElement,
    position: {
      x?: number;
      y?: number;
      last?: boolean;
      focus?: HTMLElement | null;
    } = {},
  ) {
    close(false);
    trigger = anchor;
    anchor.setAttribute("aria-controls", panel.id);
    anchor.setAttribute("aria-expanded", "true");
    const rect =
      position.x === undefined
        ? anchor.getBoundingClientRect()
        : {
            left: position.x,
            top: position.y ?? 0,
            bottom: position.y ?? 0,
            width: 0,
          };
    if (options.width === undefined) panel.style.removeProperty("width");
    else panel.style.width = `${options.width}px`;
    panel.style.maxHeight = `${options.maxHeight ?? 440}px`;
    panel.showPopover();
    const width = options.width ?? panel.getBoundingClientRect().width;
    const place = (maxHeight: number) => {
      const { width: boundedWidth, ...placement } = popoverPosition(rect, {
        width,
        maxHeight,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      });
      Object.assign(panel.style, placement);
      if (options.width !== undefined) panel.style.width = boundedWidth;
    };
    place(options.maxHeight ?? 440);
    place(
      Math.min(options.maxHeight ?? 440, panel.getBoundingClientRect().height),
    );
    const items = choices();
    for (const item of items) item.tabIndex = -1;
    (position.focus ?? (position.last ? items.at(-1) : items[0]))?.focus({
      preventScroll: true,
    });
  }
  panel.addEventListener(
    "click",
    (event) => {
      const item =
        event.target instanceof Element
          ? event.target.closest(
              '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]',
            )
          : null;
      if (item?.getAttribute("aria-disabled") === "true") {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (
        item &&
        !item.hasAttribute("disabled") &&
        item.getAttribute("aria-disabled") !== "true"
      )
        close(false);
    },
    { signal, capture: true },
  );
  panel.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" || event.key === "Tab") {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
        }
        close();
        return;
      }
      const items = choices(),
        index = items.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === "ArrowDown"
          ? (index + 1) % items.length
          : event.key === "ArrowUp"
            ? (index + items.length - 1) % items.length
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : -1;
      if (next >= 0) {
        event.preventDefault();
        items[next]?.focus();
      }
    },
    { signal },
  );
  panel.addEventListener(
    "toggle",
    () => {
      if (trigger?.getAttribute("aria-controls") === panel.id)
        trigger.setAttribute(
          "aria-expanded",
          String(panel.matches(":popover-open")),
        );
    },
    { signal },
  );
  window.addEventListener("resize", () => close(false), { signal });
  document.addEventListener(
    "scroll",
    (event) => {
      if (
        event.target instanceof Node &&
        trigger &&
        event.target.contains(trigger) &&
        !panel.contains(event.target)
      )
        close(false);
    },
    { signal, capture: true },
  );
  return {
    element: panel,
    open,
    close,
    destroy() {
      close(false);
      abort.abort();
      panel.remove();
    },
  };
}
