import { workspaceEmoji } from "../domain/workspace-views.ts";
import { element, iconButton, uiIcon } from "./dom.ts";
import { popoverPosition } from "./geometry.ts";

/** 기존 Lucide 이름은 유지하고 새 이모지는 이미지 요청 없이 표시한다. */
export function workspaceIcon(name: string): HTMLSpanElement {
  const icon = element("span", "workspace-icon");
  icon.setAttribute("aria-hidden", "true");
  const emoji = workspaceEmoji(name);
  if (emoji) {
    icon.classList.add("workspace-emoji");
    icon.textContent = emoji;
  } else if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    icon.style.maskImage = `url("https://api.iconify.design/lucide/${name}.svg")`;
  }
  return icon;
}

export function workspaceIconPicker(
  initial: string,
  changed: (name: string) => void,
) {
  let selected = initial,
    alive = true,
    loading = false,
    loaded = false;
  const root = element("div", "workspace-icon-picker"),
    trigger = iconButton("뷰 아이콘 선택", "smile", { size: "sm" }),
    panel = element("div", "select-options workspace-icon-panel"),
    content = element("div", "workspace-emoji-content"),
    clear = element("button", "workspace-icon-clear", "아이콘 없애기");
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  panel.popover = "auto";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "뷰 아이콘 선택");
  clear.type = "button";
  root.append(trigger, panel);
  panel.append(content, clear);
  function sync() {
    trigger.replaceChildren(
      selected ? workspaceIcon(selected) : uiIcon("smile"),
    );
    clear.hidden = !selected;
  }
  function choose(value: string) {
    selected = value;
    changed(value);
    sync();
    panel.hidePopover();
    trigger.focus();
  }
  clear.addEventListener("click", () => choose(""));
  panel.addEventListener("toggle", () => {
    const open = panel.matches(":popover-open");
    trigger.setAttribute("aria-expanded", String(open));
    if (!open) {
      content.replaceChildren();
      loaded = false;
    }
  });
  trigger.addEventListener("click", () => {
    if (panel.matches(":popover-open")) return panel.hidePopover();
    Object.assign(
      panel.style,
      popoverPosition(trigger.getBoundingClientRect(), {
        width: 340,
        maxHeight: Math.min(440, innerHeight - 24),
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      }),
    );
    panel.showPopover();
    if (loaded || loading) return;
    loading = true;
    content.textContent = "이모지를 불러오고 있어요…";
    void import("./workspace-emoji-picker.ts")
      .then(({ createEmojiPicker }) => {
        if (!alive || !panel.matches(":popover-open")) return;
        const picker = createEmojiPicker((emoji) => choose(`emoji:${emoji}`));
        content.replaceChildren(picker);
        if (panel.matches(":popover-open")) picker.focus();
        loaded = true;
      })
      .catch(() => {
        if (alive)
          content.textContent = "이모지를 불러오지 못했어요. 다시 열어 주세요.";
      })
      .finally(() => {
        loading = false;
      });
  });
  sync();
  return {
    element: root,
    destroy() {
      alive = false;
      if (panel.matches(":popover-open")) panel.hidePopover();
      content.replaceChildren();
    },
  };
}
