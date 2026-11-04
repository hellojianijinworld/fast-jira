import { element, iconButton } from "./dom.ts";
import { createMenu } from "./menu.ts";

export function createAppMenu(
  items: (HTMLButtonElement | HTMLAnchorElement | null)[],
) {
  const root = element("div", "app-menu"),
    trigger = iconButton("메뉴", "menu"),
    menu = createMenu({ label: "Fast Jira 메뉴", className: "app-menu-panel" }),
    panel = menu.element;
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-controls", panel.id);
  trigger.setAttribute("aria-expanded", "false");
  for (const item of items) {
    if (!item) {
      const separator = element("hr");
      separator.setAttribute("role", "separator");
      panel.append(separator);
    } else {
      item.setAttribute("role", "menuitem");
      panel.append(item);
    }
  }
  root.append(trigger, panel);
  trigger.addEventListener("click", () =>
    panel.matches(":popover-open") ? menu.close() : menu.open(trigger),
  );
  trigger.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    menu.open(trigger, { last: event.key === "ArrowUp" });
  });
  return {
    element: root,
    trigger,
    close: menu.close,
    destroy() {
      menu.destroy();
      root.remove();
    },
  };
}
