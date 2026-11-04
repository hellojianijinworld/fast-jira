import type { Api } from "../client/api.ts";
import type { ViewController } from "../client/view-controller.ts";
import { createViewDraft } from "../client/view-editor-controller.ts";
import { createViewOptions } from "../client/view-options.ts";
import type { TreeCatalog } from "../domain/catalog.ts";
import type { Filters } from "../domain/filters.ts";
import { FOLLOW_GLOBAL_VIEW } from "../domain/view-labels.ts";
import { actionButton, element, iconButton } from "./dom.ts";
import { createViewEditor } from "./view-editor.ts";

export interface FilterCallbacks {
  filters: () => Filters;
  catalog: () => TreeCatalog;
  views: ViewController;
  catalogProjects?: () => readonly string[];
  onCatalog?: (catalog: TreeCatalog, projects: readonly string[]) => void;
}
/** 하위 목록의 개별 조건과 현재 탭 필터 상속만 편집한다. */
export function createFilterPanel(
  api: Pick<Api, "statuses" | "users" | "types">,
  me: { accountId: string; displayName: string },
  callbacks: FilterCallbacks,
) {
  const views = callbacks.views;
  const panel = element("div", "filter-panel view-panel");
  panel.popover = "auto";
  const head = element("div", "view-panel-head"),
    heading = element("div", "view-panel-heading"),
    title = element("h2", "", "하위 목록 필터"),
    scope = element("p", "view-help view-panel-scope"),
    dismiss = iconButton("닫기", "x");
  heading.append(title, scope);
  head.append(heading, dismiss);
  const body = element("div", "view-panel-body"),
    inheritance = element("label", "filter-check"),
    follow = element("input"),
    editHost = element("div"),
    peekHost = element("div", "view-peek"),
    error = element("p", "error view-error");
  follow.type = "checkbox";
  follow.setAttribute("aria-label", FOLLOW_GLOBAL_VIEW);
  inheritance.append(follow, document.createTextNode(FOLLOW_GLOBAL_VIEW));
  error.setAttribute("role", "alert");
  body.append(inheritance, editHost, peekHost);
  panel.append(head, body, error);
  document.body.append(panel);
  let target: { kind: "branch"; key: string } = { kind: "branch", key: "" },
    draft = createViewDraft(views.resolve(target, false)),
    projects = [...callbacks.filters().projects],
    catalog = callbacks.catalog(),
    anchor: HTMLElement | null = null,
    editor: ReturnType<typeof createViewEditor> | null = null;
  let revision = 0,
    alive = true;
  const options = createViewOptions(api, () => ({
    projects: callbacks.catalogProjects?.() ?? callbacks.filters().projects,
    catalog: callbacks.catalog(),
  }));
  const inherited = () => follow.checked;
  function hints() {
    error.hidden = !error.textContent;
    editHost.hidden = inherited();
  }
  function close() {
    revision++;
    if (panel.matches(":popover-open")) panel.hidePopover();
    if (anchor?.isConnected) anchor.focus();
  }
  panel.addEventListener("beforetoggle", (event) => {
    if ((event as ToggleEvent).newState === "closed") revision++;
  });
  dismiss.addEventListener("click", close);
  function renderPeek() {
    peekHost.replaceChildren();
    const key = target.key;
    peekHost.append(
      element(
        "small",
        "view-help view-peek-caption",
        "이번 화면에서만 넓혀 보기",
      ),
    );
    for (const [field, label] of [
      ["done", "완료도 보기"],
      ["people", "다른 사람도 보기"],
    ] as const) {
      const choice = element("label", "filter-check"),
        check = element("input");
      check.type = "checkbox";
      check.checked = Boolean(views.temporary(key)[field]);
      check.setAttribute("aria-label", label);
      check.addEventListener("change", () => {
        try {
          views.peek(key, { ...views.temporary(key), [field]: check.checked });
        } catch (reason) {
          error.textContent = messageOf(reason);
          hints();
        }
        renderPeek();
      });
      choice.append(check, document.createTextNode(label));
      peekHost.append(choice);
    }
    const temporary = views.temporary(key);
    if (temporary.done || temporary.people) {
      const reset = actionButton("원래 필터로", "undo-2");
      reset.addEventListener("click", () => {
        try {
          views.clearPeek(key);
        } catch (reason) {
          error.textContent = messageOf(reason);
          hints();
        }
        renderPeek();
      });
      peekHost.append(reset);
    }
  }
  async function startEditing() {
    const generation = ++revision;
    error.textContent = "";
    editor?.destroy();
    editor = null;
    editHost.replaceChildren(
      element("p", "view-help", "선택지를 불러오는 중…"),
    );
    hints();
    try {
      const choices = await options.load(projects);
      if (generation !== revision || !alive || !panel.matches(":popover-open"))
        return;
      catalog = {
        ...catalog,
        statuses: choices.statuses,
        types: choices.types,
      };
      callbacks.onCatalog?.(catalog, projects);
      editor = createViewEditor(draft, choices, me, () => {
        try {
          views.apply(target, draft.value);
          error.textContent = "";
          renderPeek();
        } catch (reason) {
          error.textContent = messageOf(reason);
        }
        hints();
      });
      editHost.replaceChildren(editor.element);
      if (document.activeElement === anchor)
        editor.element
          .querySelector<HTMLButtonElement>(".select-trigger")
          ?.focus();
    } catch (reason) {
      if (generation !== revision || !alive) return;
      error.textContent = messageOf(reason);
      const retry = actionButton("다시 불러오기", "search");
      retry.addEventListener("click", () => void startEditing());
      editHost.replaceChildren(retry);
    }
    hints();
  }
  follow.addEventListener("change", () => {
    try {
      if (inherited()) views.select(target, { kind: "default" });
      else views.apply(target, draft.value);
      draft = createViewDraft(views.resolve(target, false));
      error.textContent = "";
      renderPeek();
      if (inherited()) {
        revision++;
        editor?.destroy();
        editor = null;
        editHost.replaceChildren();
        hints();
      } else void startEditing();
    } catch (reason) {
      follow.checked = views.binding(target).kind === "default";
      error.textContent = messageOf(reason);
      hints();
    }
  });
  function open(nextAnchor: HTMLElement, key: string) {
    close();
    editor?.destroy();
    editor = null;
    target = { kind: "branch", key };
    anchor = nextAnchor;
    draft = createViewDraft(views.resolve(target, false));
    projects = [...callbacks.filters().projects];
    catalog = callbacks.catalog();
    error.textContent = "";
    editHost.replaceChildren();
    follow.checked = views.binding(target).kind === "default";
    panel.setAttribute("aria-label", title.textContent);
    scope.textContent = `${key}의 하위 목록에 적용`;
    renderPeek();
    hints();
    const rect = nextAnchor.getBoundingClientRect(),
      top = Math.max(12, Math.min(rect.bottom + 6, 64)),
      width = Math.min(960, innerWidth - 24);
    Object.assign(panel.style, {
      width: `${width}px`,
      left: `${Math.max(12, Math.min(rect.right - width, innerWidth - width - 12))}px`,
      top: `${top}px`,
      maxHeight: `calc(100dvh - ${top + 12}px)`,
    });
    panel.showPopover();
    body.scrollTop = 0;
    if (inherited()) follow.focus();
    else void startEditing();
  }
  return {
    element: panel,
    open,
    close,
    destroy() {
      alive = false;
      close();
      editor?.destroy();
      panel.remove();
    },
  };
}
const messageOf = (reason: unknown) =>
  reason instanceof Error ? reason.message : "필터를 적용하지 못했어요.";
