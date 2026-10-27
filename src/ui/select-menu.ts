import { element, elementId, uiIcon } from "./dom.ts";
import { type PopoverRect, popoverPosition } from "./geometry.ts";
import type { ComponentSize } from "./theme.ts";

export interface SelectConfig {
  size?: ComponentSize;
  renderOption?: (option: HTMLOptionElement) => Node;
  beforeOpen?: () => Promise<boolean | undefined>;
  onSearch?: (query: string) => Promise<void>;
  searchLabel?: string;
}
export interface SelectMenu {
  trigger: HTMLButtonElement;
  panel: HTMLDivElement;
  sync: () => void;
  show: (rect: PopoverRect, focus?: boolean) => void;
  close: () => void;
  destroy: () => void;
}
const menus = new WeakMap<HTMLSelectElement, SelectMenu>();
export function refreshSelect(select: HTMLSelectElement): void {
  menus.get(select)?.sync();
}

/** 네이티브 select를 값·change 이벤트의 기준으로 유지하고 표시만 풍부하게 만든다. */
export function enhanceSelect(
  select: HTMLSelectElement,
  config: SelectConfig = {},
): SelectMenu {
  const existing = menus.get(select);
  if (existing) return existing;
  const controller = new AbortController();
  const signal = controller.signal;
  const wrapper = element("div", "select-menu");
  wrapper.dataset.size = config.size ?? "auto";
  const trigger = element("button", "select-trigger");
  trigger.type = "button";
  trigger.id = `${select.id || elementId("select")}-trigger`;
  const labels = Array.from(select.labels ?? []).map((label) => ({
    label,
    htmlFor: label.htmlFor,
  }));
  trigger.setAttribute("aria-haspopup", config.onSearch ? "dialog" : "listbox");
  trigger.setAttribute("aria-expanded", "false");
  const label =
    select.getAttribute("aria-label") ||
    select.labels?.[0]?.textContent ||
    "선택";
  trigger.setAttribute("aria-label", label);
  for (const { label } of labels) label.htmlFor = trigger.id;
  const value = element("span", "select-value");
  const arrow = uiIcon("chevron-right");
  arrow.classList.add("select-arrow");
  trigger.append(value, arrow);
  const panel = element("div", "select-options");
  panel.dataset.size = config.size ?? "auto";
  panel.popover = "auto";
  panel.setAttribute("role", config.onSearch ? "dialog" : "listbox");
  panel.setAttribute("aria-label", label);
  const choices = element("div");
  const error = element("p", "error");
  error.hidden = true;
  error.setAttribute("role", "alert");
  let searchInput: HTMLInputElement | undefined;
  let revision = 0,
    opening = false;
  if (config.onSearch) {
    choices.setAttribute("role", "listbox");
    choices.setAttribute("aria-label", label);
    const form = element("form", "select-search");
    const input = element("input");
    input.type = "search";
    input.placeholder = config.searchLabel ?? "이름으로 검색";
    input.setAttribute("aria-label", config.searchLabel ?? "이름으로 검색");
    searchInput = input;
    const submit = element("button", "", "검색");
    submit.type = "submit";
    form.append(input, submit);
    form.addEventListener(
      "submit",
      async (event) => {
        event.preventDefault();
        if (submit.disabled) return;
        submit.disabled = true;
        error.hidden = true;
        try {
          await config.onSearch?.(input.value.trim());
        } catch (reason) {
          showError(reason);
        } finally {
          submit.disabled = false;
        }
      },
      { signal },
    );
    panel.append(form);
  }
  panel.append(choices, error);
  const wasHidden = select.hidden;
  select.before(wrapper);
  wrapper.append(select, trigger, panel);
  select.hidden = true;
  const content = (option: HTMLOptionElement) =>
    config.renderOption?.(option) ??
    document.createTextNode(option.textContent ?? "");
  const isOpen = () => panel.matches(":popover-open");
  function close() {
    revision++;
    if (isOpen()) panel.hidePopover();
  }
  function showError(reason: unknown) {
    error.textContent =
      reason instanceof Error ? reason.message : "선택지를 불러오지 못했어요.";
    error.hidden = false;
  }
  function sync() {
    trigger.disabled = select.disabled;
    const option = select.selectedOptions[0];
    value.replaceChildren(
      option ? content(option) : document.createTextNode("선택"),
    );
    if (isOpen()) render();
  }
  function render() {
    choices.replaceChildren();
    for (const option of Array.from(select.options).filter(
      (option) => !option.hidden,
    )) {
      const choice = element("button", "select-option");
      choice.type = "button";
      choice.setAttribute("role", "option");
      choice.setAttribute("aria-selected", String(option.selected));
      choice.disabled = option.disabled;
      choice.append(content(option));
      choice.addEventListener(
        "click",
        () => {
          const changed = select.value !== option.value;
          select.value = option.value;
          close();
          sync();
          if (changed)
            select.dispatchEvent(new Event("change", { bubbles: true }));
          if (
            document.activeElement === document.body ||
            panel.contains(document.activeElement)
          )
            trigger.focus();
        },
        { signal },
      );
      choices.append(choice);
    }
  }
  function show(rect: PopoverRect, focus = true) {
    render();
    Object.assign(
      panel.style,
      popoverPosition(rect, {
        width: Math.max(rect.width, 240),
        maxHeight: 320,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      }),
    );
    if (!isOpen()) panel.showPopover();
    if (focus)
      (
        searchInput ??
        choices.querySelector<HTMLButtonElement>(
          '[aria-selected="true"]:not(:disabled)',
        ) ??
        choices.querySelector<HTMLButtonElement>("button:not(:disabled)")
      )?.focus();
    if (searchInput) panel.scrollTop = 0;
  }
  async function open() {
    if (select.disabled || opening) return;
    if (isOpen()) {
      close();
      return;
    }
    if (searchInput) searchInput.value = "";
    error.hidden = true;
    const version = ++revision;
    opening = true;
    try {
      if (config.beforeOpen) {
        trigger.setAttribute("aria-busy", "true");
        if ((await config.beforeOpen()) === false) return;
      }
      // 선택지가 도착하기 전에 화면을 닫거나 바꿨다면 이전 팝오버를 다시 열지 않는다.
      if (version !== revision || !wrapper.isConnected || select.disabled)
        return;
      show(trigger.getBoundingClientRect());
    } catch (reason) {
      if (version === revision && wrapper.isConnected) {
        show(trigger.getBoundingClientRect());
        showError(reason);
      }
    } finally {
      opening = false;
      trigger.removeAttribute("aria-busy");
    }
  }
  trigger.addEventListener(
    "click",
    () => {
      void open();
    },
    { signal },
  );
  trigger.addEventListener(
    "keydown",
    (event) => {
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        void open();
      }
    },
    { signal },
  );
  panel.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        trigger.focus();
      }
      if (event.key === "Tab") close();
      if (event.target === searchInput && ["Home", "End"].includes(event.key))
        return;
      const options = Array.from(
        choices.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
      );
      if (!options.length) return;
      const index =
        document.activeElement instanceof HTMLButtonElement
          ? options.indexOf(document.activeElement)
          : -1;
      const next: Record<string, number> = {
        ArrowDown: (index + 1) % options.length,
        ArrowUp: (index - 1 + options.length) % options.length,
        Home: 0,
        End: options.length - 1,
      };
      const target = next[event.key];
      if (target !== undefined) {
        event.preventDefault();
        options[target]?.focus();
      }
    },
    { signal },
  );
  panel.addEventListener(
    "toggle",
    () => trigger.setAttribute("aria-expanded", String(isOpen())),
    { signal },
  );
  let viewportWidth = innerWidth;
  window.addEventListener(
    "resize",
    () => {
      if (innerWidth === viewportWidth) return;
      viewportWidth = innerWidth;
      const restoreFocus = panel.contains(document.activeElement);
      close();
      if (restoreFocus && trigger.isConnected) trigger.focus();
    },
    { signal },
  );
  select.addEventListener("change", sync, { signal });
  const observer = new MutationObserver(sync);
  observer.observe(select, {
    attributes: true,
    childList: true,
    subtree: true,
  });
  const menu: SelectMenu = {
    sync,
    trigger,
    panel,
    show,
    close,
    destroy: () => {
      close();
      controller.abort();
      observer.disconnect();
      wrapper.before(select);
      select.hidden = wasHidden;
      wrapper.remove();
      for (const { label, htmlFor } of labels) label.htmlFor = htmlFor;
      menus.delete(select);
    },
  };
  menus.set(select, menu);
  sync();
  return menu;
}
