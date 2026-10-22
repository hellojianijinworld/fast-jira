import type { Api } from "../client/api.ts";
import type { ViewController } from "../client/view-controller.ts";
import { createViewDraft } from "../client/view-editor-controller.ts";
import { createViewOptions } from "../client/view-options.ts";
import type { TreeCatalog } from "../domain/catalog.ts";
import { cloneFilters, type Filters } from "../domain/filters.ts";
import { resolveBinding, type ViewTarget } from "../domain/views.ts";
import { actionButton, element, elementId, iconButton } from "./dom.ts";
import { createViewEditor, viewSummary } from "./view-editor.ts";
import { createViewManager } from "./view-manager.ts";
import { createViewPicker } from "./view-picker.ts";

export interface FilterCallbacks {
  filters: () => Filters;
  catalog: () => TreeCatalog;
  views: ViewController;
  catalogProjects?: () => readonly string[];
  onApply: (filters: Filters, catalog: TreeCatalog, commit: () => void) => void;
  onCatalog?: (catalog: TreeCatalog, projects: readonly string[]) => void;
}
/** 뷰 선택·초안·등록을 조립한다. 실제 조건은 공통 편집기에서만 편집한다. */
export function createFilterPanel(
  api: Pick<Api, "statuses" | "users" | "types">,
  me: { accountId: string; displayName: string },
  callbacks: FilterCallbacks,
) {
  const views = callbacks.views;
  const panel = element("div", "filter-panel view-panel");
  panel.popover = "auto";
  panel.setAttribute("aria-label", "필터 및 뷰");
  const head = element("div", "view-panel-head"),
    heading = element("div", "view-panel-heading"),
    title = element("h2", "", "필터 및 뷰"),
    scope = element("p", "view-help view-panel-scope");
  heading.append(title, scope);
  const manage = actionButton("뷰 관리", "layers"),
    dismiss = iconButton("닫기", "x");
  const headActions = element("div", "view-head-actions");
  headActions.append(manage, dismiss);
  head.append(heading, headActions);
  const body = element("div", "view-panel-body"),
    pickerHost = element("div"),
    summary = element("p", "view-help view-current-summary");
  const editToggle = actionButton("조건 편집", "square-pen"),
    editHost = element("div", "view-editor-host");
  const match = element("p", "view-match");
  match.setAttribute("role", "status");
  const registration = actionButton("내 뷰로 저장", "user"),
    saveHelp = element(
      "p",
      "view-help",
      "이 브라우저에만 저장돼요. 다른 기기나 팀원에게 공유되지 않아요.",
    ),
    nameRow = element("label", "view-name-field", "뷰 이름"),
    name = element("input");
  name.maxLength = 80;
  name.placeholder = "예: QA 확인";
  name.setAttribute("aria-label", "뷰 이름");
  nameRow.append(name);
  saveHelp.id = elementId("view-save-help");
  registration.setAttribute("aria-describedby", saveHelp.id);
  const peekHost = element("div", "view-peek");
  const error = element("p", "error view-error");
  error.setAttribute("role", "alert");
  const footer = element("div", "filter-footer"),
    cancel = actionButton("취소", "x"),
    apply = actionButton("적용", "check", "");
  const footerActions = element("div", "view-footer-actions");
  footerActions.append(cancel, apply);
  footer.append(registration, footerActions);
  const viewHost = element("section", "view-settings");
  viewHost.append(
    element("h3", "view-section-label", "적용할 뷰"),
    pickerHost,
    summary,
    editToggle,
    peekHost,
    editHost,
    match,
    saveHelp,
    nameRow,
  );
  body.append(viewHost);
  panel.append(head, body, error, footer);
  document.body.append(panel);
  let target: ViewTarget = { kind: "global" },
    picked = views.binding(target),
    draft = createViewDraft(views.resolve(target, false));
  let originalBinding = picked;
  let projects = [...callbacks.filters().projects],
    catalog = callbacks.catalog(),
    anchor: HTMLElement | null = null;
  let revision = 0,
    editing = false,
    registering = false,
    loading = false,
    metadataFailed = false,
    alive = true,
    restoring = false;
  let editor: ReturnType<typeof createViewEditor> | null = null,
    picker: ReturnType<typeof createViewPicker> | null = null;
  const options = createViewOptions(api, () => ({
    projects: callbacks.catalogProjects?.() ?? callbacks.filters().projects,
    catalog: callbacks.catalog(),
  }));
  const manager = createViewManager(
    views,
    () => options.load(projects),
    me,
    () => {
      if (!alive || !restoring) return;
      if (anchor && !anchor.isConnected) {
        const label = anchor.getAttribute("aria-label");
        anchor =
          [...document.querySelectorAll<HTMLButtonElement>("button")].find(
            (button) => button.getAttribute("aria-label") === label,
          ) ?? null;
      }
      if (!anchor?.isConnected) return;
      restoring = false;
      if (!draft.dirty) {
        if (JSON.stringify(picked) === JSON.stringify(originalBinding)) {
          picked = views.binding(target);
          draft = createViewDraft(views.resolve(target, false));
        } else if (
          picked.kind === "saved" &&
          !views.state.saved.some(
            (view) =>
              view.id === (picked.kind === "saved" ? picked.viewId : ""),
          )
        ) {
          picked = { kind: "inline", definition: draft.value };
        } else draft = createViewDraft(resolveBinding(views.state, picked));
      }
      renderPicker();
      hints();
      panel.showPopover();
      if (editing) void startEditing();
      else
        picker?.element
          .querySelector<HTMLButtonElement>(".select-trigger")
          ?.focus();
    },
  );
  function close() {
    revision++;
    if (panel.matches(":popover-open")) panel.hidePopover();
    if (anchor?.isConnected) anchor.focus();
  }
  panel.addEventListener("beforetoggle", (event) => {
    if ((event as ToggleEvent).newState === "closed") {
      revision++;
    }
  });
  dismiss.addEventListener("click", close);
  cancel.addEventListener("click", close);
  manage.addEventListener("click", () => {
    restoring = true;
    close();
    manager.open();
  });
  function hints() {
    const found = views.match(
      draft.value,
      picked.kind === "saved" ? picked.viewId : undefined,
    );
    summary.textContent = viewSummary(draft.value);
    match.textContent =
      editing && found
        ? `‘${found.name}’과 같은 조건입니다. 적용하면 기존 뷰를 참조합니다.`
        : "";
    match.hidden = !match.textContent;
    registration.hidden = !editing;
    saveHelp.hidden = !editing;
    registration.disabled = Boolean(found) || loading || metadataFailed;
    nameRow.hidden = !editing || !registering || Boolean(found);
    name.disabled = loading;
    const applyLabel = apply.querySelector("span");
    if (applyLabel)
      applyLabel.textContent = registering && !found ? "저장하고 적용" : "적용";
    apply.disabled =
      projects.length === 0 || (editing && (loading || metadataFailed));
    error.hidden = !error.textContent;
    editHost.hidden = !editing;
    editToggle.hidden = picked.kind !== "inline";
    editToggle.setAttribute("aria-expanded", String(editing));
    const editLabel = editToggle.querySelector("span");
    if (editLabel) editLabel.textContent = editing ? "조건 접기" : "조건 편집";
  }
  function renderPicker() {
    picker?.destroy();
    picker = createViewPicker(
      views.state,
      target,
      picked,
      () => draft.value,
      (binding) => {
        revision++;
        loading = false;
        metadataFailed = false;
        picked = binding;
        const definition = resolveBinding(views.state, binding);
        draft = createViewDraft(definition);
        registering = false;
        error.textContent = "";
        editor?.destroy();
        editor = null;
        editing = false;
        editHost.replaceChildren();
        hints();
        if (binding.kind === "inline") void startEditing();
      },
    );
    pickerHost.replaceChildren(picker.element);
  }
  function renderPeek() {
    peekHost.replaceChildren();
    peekHost.hidden = target.kind === "global";
    if (target.kind !== "branch") return;
    const key = target.key,
      current = views.temporary(key);
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
      check.checked = Boolean(current[field]);
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
    if (current.done || current.people) {
      const reset = actionButton("원래 뷰로", "undo-2");
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
    if (picked.kind !== "inline") return;
    editing = true;
    metadataFailed = false;
    error.textContent = "";
    loading = true;
    editor?.destroy();
    editor = null;
    editHost.replaceChildren(
      element("p", "view-help", "선택지를 불러오는 중…"),
    );
    hints();
    const generation = ++revision;
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
        if (draft.dirty) {
          picked = { kind: "inline", definition: draft.value };
          picker?.set(picked);
        }
        hints();
      });
      editHost.replaceChildren(editor.element);
    } catch (reason) {
      if (generation === revision) {
        metadataFailed = true;
        error.textContent = messageOf(reason);
        editHost.replaceChildren();
      }
    } finally {
      if (generation === revision) {
        loading = false;
        hints();
      }
    }
  }
  editToggle.addEventListener("click", () => {
    if (!editing) void startEditing();
    else {
      revision++;
      editing = false;
      loading = false;
      editor?.destroy();
      editor = null;
      editHost.replaceChildren();
      hints();
    }
  });
  registration.addEventListener("click", () => {
    registering = !registering;
    hints();
    if (registering) name.focus();
  });
  apply.addEventListener("click", () => {
    const found = views.match(
      draft.value,
      picked.kind === "saved" ? picked.viewId : undefined,
    );
    const commit = () => {
      if (registering && !found)
        views.register(target, draft.value, name.value);
      else if (!draft.dirty && picked.kind !== "inline")
        views.select(target, picked);
      else views.apply(target, draft.value);
    };
    try {
      if (target.kind === "global")
        callbacks.onApply(
          { ...cloneFilters(callbacks.filters()), ...draft.value },
          catalog,
          commit,
        );
      else commit();
      close();
    } catch (reason) {
      error.textContent = messageOf(reason);
      hints();
    }
  });
  function open(nextAnchor: HTMLElement, key = "") {
    restoring = false;
    close();
    editor?.destroy();
    editor = null;
    target = key ? { kind: "branch", key } : { kind: "global" };
    anchor = nextAnchor;
    picked = views.binding(target);
    originalBinding = picked;
    draft = createViewDraft(views.resolve(target, false));
    projects = [...callbacks.filters().projects];
    catalog = callbacks.catalog();
    editing = false;
    registering = false;
    loading = false;
    metadataFailed = false;
    name.value = "";
    error.textContent = "";
    editHost.replaceChildren();
    scope.textContent = key ? `${key}의 하위 목록에 적용` : "전체 목록에 적용";
    renderPicker();
    renderPeek();
    hints();
    const rect = nextAnchor.getBoundingClientRect();
    const top = Math.max(12, Math.min(rect.bottom + 6, 64));
    const width = Math.min(960, innerWidth - 24);
    Object.assign(panel.style, {
      width: `${width}px`,
      left: `${Math.max(12, Math.min(rect.right - width, innerWidth - width - 12))}px`,
      top: `${top}px`,
      maxHeight: `calc(100dvh - ${top + 12}px)`,
    });
    panel.showPopover();
    picker?.element
      .querySelector<HTMLButtonElement>(".select-trigger")
      ?.focus();
    body.scrollTop = 0;
    if (picked.kind === "inline") void startEditing();
  }
  return {
    element: panel,
    open,
    close,
    destroy() {
      alive = false;
      restoring = false;
      close();
      editor?.destroy();
      picker?.destroy();
      manager.destroy();
      panel.remove();
    },
  };
}
const messageOf = (reason: unknown) =>
  reason instanceof Error ? reason.message : "뷰를 적용하지 못했어요.";
