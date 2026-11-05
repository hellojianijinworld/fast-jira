import type { MentionLoader, MentionTarget } from "../domain/mention.ts";
import { element, uiIcon } from "./dom.ts";
import type { PopoverRect } from "./geometry.ts";
import { personPill } from "./meta.ts";
import { enhanceSelect } from "./select-menu.ts";

/** 기존 셀렉트의 아바타·팝오버를 재사용하고 입력 위치에 후보만 띄운다. */
export function mentionPicker<T>(
  editor: {
    element: HTMLElement;
    mentionQuery(): {
      query: string;
      range: T;
      rect: PopoverRect & { height?: number };
    } | null;
    insertMention(target: MentionTarget, range: T): void;
  },
  loadTargets: MentionLoader,
) {
  const wrapper = element("div", "mention-picker"),
    select = element("select"),
    error = element("p", "error"),
    notice = element("p", "mention-search-status");
  select.setAttribute("aria-label", "멘션할 이슈·사람 선택");
  error.setAttribute("role", "status");
  notice.setAttribute("role", "status");
  notice.hidden = true;
  const placeholder = element("option", "", "@멘션");
  placeholder.value = "";
  placeholder.hidden = true;
  select.append(placeholder);
  wrapper.append(select, error);
  let targets = new Map<string, MentionTarget>(),
    request = 0,
    timer: ReturnType<typeof setTimeout> | undefined,
    inline: ReturnType<typeof editor.mentionQuery> = null,
    active = 0,
    composing = false,
    alive = true;
  const controller = new AbortController(),
    signal = controller.signal,
    root = editor.element;
  const menu = enhanceSelect(select, {
    side: "above",
    renderOption: (option) => {
      const target = targets.get(option.value);
      const row = element("span", "mention-option");
      const kind = element(
        "span",
        "mention-kind",
        target?.kind === "user" ? "사람" : "이슈",
      );
      kind.prepend(uiIcon(target?.kind === "user" ? "user" : "layers"));
      row.append(kind);
      if (target?.kind === "user")
        row.append(
          personPill({ name: target.label, avatar: target.avatar ?? "" }),
        );
      else {
        row.append(
          element("span", "mention-key", target?.key ?? ""),
          element("span", "mention-title", target?.label ?? ""),
        );
      }
      return row;
    },
  });
  menu.trigger.remove();
  select.remove();
  menu.panel.classList.add("inline-mention");
  menu.panel.append(notice);
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
    clearTimeout(timer);
    request++;
    inline = null;
    const context = editor.mentionQuery();
    if (!context) {
      close();
      return;
    }
    const version = request,
      query = context.query;
    timer = setTimeout(async () => {
      error.textContent = "";
      let warning = "";
      function render(items: MentionTarget[], pending: boolean) {
        // 닫거나 입력이 바뀐 뒤 도착한 로컬·원격 후보는 모두 무시한다.
        if (!alive || !wrapper.isConnected || request !== version) return;
        const current = editor.mentionQuery();
        if (document.activeElement !== root || current?.query !== query) return;
        const selected = [...targets.keys()][active];
        targets = new Map(
          items.map((item) => [`${item.kind}:${item.id}`, item]),
        );
        select.replaceChildren(placeholder);
        for (const [id, item] of targets) {
          const option = element(
            "option",
            "",
            item.kind === "issue" ? `${item.key} · ${item.label}` : item.label,
          );
          option.value = id;
          select.append(option);
        }
        inline = current;
        active = Math.max(0, [...targets.keys()].indexOf(selected ?? ""));
        notice.textContent =
          warning ||
          (pending
            ? "현재 뷰 밖의 이슈도 확인 중이에요…"
            : !targets.size
              ? "검색 결과가 없어요. 이슈 제목·번호나 이름을 확인해 주세요."
              : "");
        notice.hidden = !notice.textContent;
        menu.show(
          {
            ...root.getBoundingClientRect().toJSON(),
            width: Math.min(
              root.getBoundingClientRect().width,
              36 * Number.parseFloat(getComputedStyle(root).fontSize),
            ),
          },
          false,
        );
        root.setAttribute("aria-expanded", "true");
        highlight();
      }
      try {
        const items = await loadTargets(query, (items, message) => {
          warning = message ?? warning;
          render(items, true);
        });
        render(items, false);
      } catch (reason) {
        if (alive && request === version) {
          warning =
            reason instanceof Error
              ? reason.message
              : "멘션할 항목을 찾지 못했어요.";
          render([...targets.values()], false);
        }
      }
    }, 250);
  }
  select.addEventListener(
    "change",
    () => {
      const user = targets.get(select.value);
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
        if (inline) event.stopPropagation();
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
        event.stopImmediatePropagation();
        if (event.key === "Enter") options[active]?.click();
        else {
          active =
            (active + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
            options.length;
          highlight();
        }
      } else if (event.key === "Tab") close();
    },
    { signal, capture: true },
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
