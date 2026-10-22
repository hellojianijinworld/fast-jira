import type { UserOption } from "../domain/issue.ts";
import type { AdfEditor } from "./adf-editor.ts";
import { element } from "./dom.ts";
import { personPill } from "./meta.ts";
import { enhanceSelect } from "./select-menu.ts";

/** 기존 셀렉트의 아바타·팝오버를 재사용하고 입력 위치에 후보만 띄운다. */
export function mentionPicker(
  editor: AdfEditor,
  loadUsers: (query: string) => Promise<UserOption[]>,
) {
  const wrapper = element("div", "mention-picker"),
    select = element("select"),
    error = element("p", "error");
  select.setAttribute("aria-label", "멘션할 사람 선택");
  error.setAttribute("role", "status");
  const placeholder = element("option", "", "@멘션");
  placeholder.value = "";
  placeholder.hidden = true;
  select.append(placeholder);
  wrapper.append(select, error);
  let users = new Map<string, UserOption>(),
    request = 0,
    timer: ReturnType<typeof setTimeout> | undefined,
    inline: ReturnType<AdfEditor["mentionQuery"]> = null,
    active = 0,
    composing = false,
    alive = true;
  const controller = new AbortController(),
    signal = controller.signal,
    root = editor.element;
  const menu = enhanceSelect(select, {
    renderOption: (option) =>
      personPill({
        name: option.textContent ?? "",
        avatar: users.get(option.value)?.avatar ?? "",
      }),
  });
  menu.trigger.remove();
  menu.panel.classList.add("inline-mention");
  menu.panel.id = `${menu.trigger.id}-panel`;
  root.setAttribute("aria-autocomplete", "list");
  root.setAttribute("aria-controls", menu.panel.id);
  root.setAttribute("aria-expanded", "false");
  function close() {
    clearTimeout(timer);
    request++;
    inline = null;
    menu.close();
    root.removeAttribute("aria-activedescendant");
    root.setAttribute("aria-expanded", "false");
  }
  function highlight() {
    const options = [
      ...menu.panel.querySelectorAll<HTMLButtonElement>(".select-option"),
    ];
    for (const [index, option] of options.entries()) {
      option.id = `${menu.trigger.id}-option-${index}`;
      option.classList.toggle("keyboard-selected", index === active);
      option.setAttribute("aria-selected", String(index === active));
    }
    const option = options[active];
    if (option) {
      root.setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView({ block: "nearest" });
    }
  }
  function suggest() {
    if (composing || !alive) return;
    close();
    const context = editor.mentionQuery();
    if (!context) return;
    const version = request;
    timer = setTimeout(async () => {
      error.textContent = "";
      try {
        const items = await loadUsers(context.query);
        // 빠르게 바뀐 입력이나 닫힌 편집기에 늦은 검색 결과를 보여주지 않는다.
        if (!alive || !wrapper.isConnected || request !== version) return;
        const current = editor.mentionQuery();
        if (document.activeElement !== root || current?.query !== context.query)
          return;
        users = new Map(items.map((user) => [user.id, user]));
        select.replaceChildren(placeholder);
        for (const user of users.values()) {
          const option = element("option", "", user.name);
          option.value = user.id;
          select.append(option);
        }
        if (!users.size) {
          error.textContent =
            "검색 결과가 없어요. 이름이나 사용자 조회 권한을 확인해 주세요.";
          return;
        }
        inline = current;
        active = 0;
        menu.show(
          current.rect.width || current.rect.height
            ? current.rect
            : root.getBoundingClientRect(),
          false,
        );
        root.setAttribute("aria-expanded", "true");
        highlight();
      } catch (reason) {
        if (alive && request === version)
          error.textContent =
            reason instanceof Error
              ? reason.message
              : "멘션할 사람을 찾지 못했어요.";
      }
    }, 250);
  }
  select.addEventListener(
    "change",
    () => {
      const user = users.get(select.value);
      if (user && inline) editor.insertMention(user, inline.range);
      close();
      select.value = "";
      menu.sync();
    },
    { signal },
  );
  root.addEventListener(
    "input",
    (event) => {
      if (!(event instanceof InputEvent) || !event.isComposing) suggest();
    },
    { signal },
  );
  root.addEventListener(
    "compositionstart",
    () => {
      composing = true;
      close();
    },
    { signal },
  );
  root.addEventListener(
    "compositionend",
    () => {
      composing = false;
      suggest();
    },
    { signal },
  );
  root.addEventListener("mouseup", suggest, { signal });
  root.addEventListener(
    "keyup",
    (event) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        suggest();
    },
    { signal },
  );
  root.addEventListener(
    "focusout",
    (event) => {
      if (
        !(event.relatedTarget instanceof Node) ||
        !menu.panel.contains(event.relatedTarget)
      )
        close();
    },
    { signal },
  );
  root.addEventListener(
    "keydown",
    (event) => {
      if (event.isComposing || composing) return;
      if (event.key === "Escape") {
        if (inline && menu.panel.matches(":popover-open"))
          event.preventDefault();
        close();
        return;
      }
      if (!inline || !menu.panel.matches(":popover-open")) return;
      const options = [
        ...menu.panel.querySelectorAll<HTMLButtonElement>(".select-option"),
      ];
      if (
        ["ArrowDown", "ArrowUp", "Enter"].includes(event.key) &&
        options.length
      ) {
        event.preventDefault();
        if (event.key === "Enter") options[active]?.click();
        else {
          active =
            (active + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
            options.length;
          highlight();
        }
      } else if (event.key === "Tab") close();
    },
    { signal },
  );
  return {
    element: wrapper,
    destroy() {
      alive = false;
      close();
      controller.abort();
      menu.destroy();
      wrapper.remove();
    },
  };
}
