import { element, iconButton, uiIcon } from "./dom.ts";
import { popoverPosition } from "./geometry.ts";

const endpoint = "https://api.iconify.design";
let collection: Promise<string[]> | undefined;

function loadIcons(): Promise<string[]> {
  if (!collection)
    collection = fetch(`${endpoint}/collection?prefix=lucide`)
      .then(async (response) => {
        if (!response.ok) throw new Error("아이콘을 불러오지 못했어요.");
        const data: unknown = await response.json();
        if (!data || typeof data !== "object")
          throw new Error("아이콘을 불러오지 못했어요.");
        const result = data as {
          uncategorized?: unknown;
          categories?: unknown;
        };
        const groups = [
          result.uncategorized,
          ...(result.categories && typeof result.categories === "object"
            ? Object.values(result.categories)
            : []),
        ];
        const names = [
          ...new Set(
            groups.flatMap((group) =>
              Array.isArray(group)
                ? group.filter(
                    (name): name is string =>
                      typeof name === "string" &&
                      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name),
                  )
                : [],
            ),
          ),
        ].sort();
        if (!names.length) throw new Error("아이콘을 불러오지 못했어요.");
        return names;
      })
      .catch((error: unknown) => {
        collection = undefined;
        throw error;
      });
  return collection;
}

/** 아이콘 이름만 보관하며, 웹에서 받은 SVG를 문서에 삽입하지 않는다. */
export function workspaceIcon(name: string): HTMLSpanElement {
  const icon = element("span", "workspace-icon");
  icon.setAttribute("aria-hidden", "true");
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
    icon.style.maskImage = `url("${endpoint}/lucide/${name}.svg")`;
  return icon;
}

export function workspaceIconPicker(
  initial: string,
  changed: (name: string) => void,
) {
  let selected = initial,
    names: string[] = [],
    limit = 80,
    alive = true;
  const root = element("div", "workspace-icon-picker"),
    trigger = iconButton("뷰 아이콘 선택", "plus", { size: "sm" }),
    panel = element("div", "select-options workspace-icon-panel"),
    search = element("input"),
    message = element("p", "view-help"),
    grid = element("div", "workspace-icon-grid"),
    more = element("button", "workspace-icon-more", "더 보기"),
    clear = element("button", "workspace-icon-clear", "아이콘 없애기");
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  panel.popover = "auto";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "뷰 아이콘 선택");
  search.type = "search";
  search.placeholder = "아이콘 검색 (영어)";
  search.setAttribute("aria-label", "아이콘 검색");
  more.type = clear.type = "button";
  more.hidden = true;
  root.append(trigger, panel);
  panel.append(search, message, grid, more, clear);
  function sync() {
    trigger.replaceChildren(
      selected ? workspaceIcon(selected) : uiIcon("plus"),
    );
    trigger.title = selected ? `뷰 아이콘: ${selected}` : "뷰 아이콘 선택";
    clear.hidden = !selected;
  }
  function render() {
    const matching = names.filter((name) =>
      name.includes(search.value.trim().toLowerCase()),
    );
    grid.replaceChildren(
      ...matching.slice(0, limit).map((name) => {
        const button = element("button", "workspace-icon-choice");
        button.type = "button";
        button.setAttribute("aria-label", name);
        button.title = name;
        button.setAttribute("aria-pressed", String(selected === name));
        button.append(workspaceIcon(name));
        button.addEventListener("click", () => {
          selected = name;
          changed(name);
          sync();
          panel.hidePopover();
          trigger.focus();
        });
        return button;
      }),
    );
    more.hidden = matching.length <= limit;
    message.textContent = matching.length
      ? `${matching.length}개 아이콘`
      : "검색 결과가 없어요.";
  }
  search.addEventListener("input", () => {
    limit = 80;
    render();
  });
  more.addEventListener("click", () => {
    limit += 80;
    render();
  });
  clear.addEventListener("click", () => {
    selected = "";
    changed("");
    sync();
    panel.hidePopover();
    trigger.focus();
  });
  panel.addEventListener("toggle", () =>
    trigger.setAttribute(
      "aria-expanded",
      String(panel.matches(":popover-open")),
    ),
  );
  trigger.addEventListener("click", () => {
    if (panel.matches(":popover-open")) {
      panel.hidePopover();
      return;
    }
    Object.assign(
      panel.style,
      popoverPosition(trigger.getBoundingClientRect(), {
        width: 320,
        maxHeight: Math.min(400, innerHeight - 24),
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      }),
    );
    panel.showPopover();
    search.focus();
    if (names.length) return render();
    message.textContent = "아이콘을 불러오고 있어요…";
    void loadIcons()
      .then((items) => {
        if (!alive) return;
        names = items;
        render();
      })
      .catch(() => {
        if (alive)
          message.textContent = "아이콘을 불러오지 못했어요. 다시 열어 주세요.";
      });
  });
  sync();
  return {
    element: root,
    destroy() {
      alive = false;
      if (panel.matches(":popover-open")) panel.hidePopover();
    },
  };
}
