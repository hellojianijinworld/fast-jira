import { element, elementId, iconButton } from "./dom.ts";
import { popoverPosition } from "./geometry.ts";

/** 항목의 동작은 호출자가 소유하고 메뉴는 표시·키보드·포커스만 담당한다. */
export function createAppMenu(
  items: (HTMLButtonElement | HTMLAnchorElement | null)[],
) {
  const root = element("div", "app-menu");
  const trigger = iconButton("메뉴", "menu");
  const panel = element("div", "select-options app-menu-panel");
  const abort = new AbortController(),
    signal = abort.signal;
  panel.id = elementId("app-menu");
  panel.popover = "auto";
  panel.setAttribute("role", "menu");
  panel.setAttribute("aria-label", "Fast Jira 메뉴");
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-controls", panel.id);
  trigger.setAttribute("aria-expanded", "false");
  for (const item of items) {
    if (!item) {
      const separator = element("hr");
      separator.setAttribute("role", "separator");
      panel.append(separator);
      continue;
    }
    item.setAttribute("role", "menuitem");
    item.addEventListener("click", () => close(false), { signal });
    panel.append(item);
  }
  root.append(trigger, panel);
  const choices = () =>
    [
      ...panel.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>(
        '[role="menuitem"]',
      ),
    ].filter((item) => !item.hasAttribute("disabled"));
  function close(focus = true) {
    if (panel.matches(":popover-open")) panel.hidePopover();
    if (trigger.getAttribute("aria-controls") === panel.id)
      trigger.setAttribute("aria-expanded", "false");
    if (focus && trigger.isConnected) trigger.focus();
  }
  function open(last = false) {
    trigger.setAttribute("aria-controls", panel.id);
    Object.assign(
      panel.style,
      popoverPosition(trigger.getBoundingClientRect(), {
        width: 252,
        maxHeight: Math.min(440, innerHeight - 24),
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      }),
    );
    panel.showPopover();
    Object.assign(
      panel.style,
      popoverPosition(trigger.getBoundingClientRect(), {
        width: 252,
        maxHeight: Math.min(440, panel.getBoundingClientRect().height),
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      }),
    );
    trigger.setAttribute("aria-expanded", "true");
    (last ? choices().at(-1) : choices()[0])?.focus();
  }
  trigger.addEventListener(
    "click",
    () => (panel.matches(":popover-open") ? close() : open()),
    { signal },
  );
  trigger.addEventListener(
    "keydown",
    (event) => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault();
      open(event.key === "ArrowUp");
    },
    { signal },
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
        index = items.indexOf(document.activeElement as HTMLButtonElement);
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
      if (trigger.getAttribute("aria-controls") === panel.id)
        trigger.setAttribute(
          "aria-expanded",
          String(panel.matches(":popover-open")),
        );
    },
    { signal },
  );
  window.addEventListener("resize", () => close(false), { signal });
  return {
    element: root,
    trigger,
    close,
    destroy() {
      close(false);
      abort.abort();
      root.remove();
    },
  };
}
