import { createViewDraft } from "../client/view-editor-controller.ts";
import type { ViewOptions } from "../client/view-options.ts";
import type { ProjectOption } from "../domain/catalog.ts";
import {
  applyView,
  decodeViews,
  initialViews,
  resolveView,
} from "../domain/views.ts";
import type {
  WorkspaceView,
  WorkspaceViews,
} from "../domain/workspace-views.ts";
import { actionButton, element, elementId, iconButton, uiIcon } from "./dom.ts";
import { popoverPosition } from "./geometry.ts";
import { showModal } from "./modal.ts";
import { projectChecklist } from "./project-checklist.ts";
import { createViewEditor } from "./view-editor.ts";
import { workspaceIcon, workspaceIconPicker } from "./workspace-icons.ts";

/** 탭의 표현과 편집 초안만 담당한다. 저장·조회 전환은 앱에서 수행한다. */
export function createWorkspaceNavigation(options: {
  state: () => WorkspaceViews;
  projects: readonly ProjectOption[];
  me: { accountId: string; displayName: string };
  load: (projects: readonly string[]) => Promise<ViewOptions>;
  select: (id: string) => void;
  save: (tab: WorkspaceView) => void;
  remove: (id: string) => void;
  error: (message: string) => void;
}) {
  const root = element("nav", "workspace-views"),
    tabs = element("div", "workspace-tabs"),
    add = iconButton("뷰 만들기", "plus"),
    menu = element("div", "select-options workspace-tab-menu"),
    dialog = element("dialog", "settings-modal workspace-view-modal");
  root.setAttribute("aria-label", "작업 뷰");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "작업 뷰");
  root.append(tabs, add);
  menu.popover = "auto";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "뷰 메뉴");
  document.body.append(dialog, menu);
  let menuTarget = "",
    menuAnchor: HTMLElement | undefined;
  const edit = actionButton("뷰 편집", "square-pen", { size: "sm" });
  const duplicate = actionButton("뷰 복제", "copy", { size: "sm" });
  edit.setAttribute("role", "menuitem");
  duplicate.setAttribute("role", "menuitem");
  menu.append(edit, duplicate);
  function closeMenu() {
    if (menu.matches(":popover-open")) menu.hidePopover();
    menuAnchor?.setAttribute("aria-expanded", "false");
  }
  function showMenu(id: string, anchor: HTMLElement, x?: number, y?: number) {
    closeMenu();
    menuTarget = id;
    menuAnchor = anchor;
    menu.setAttribute(
      "aria-label",
      `${options.state().tabs.find((tab) => tab.id === id)?.name ?? ""} 뷰 메뉴`,
    );
    Object.assign(
      menu.style,
      popoverPosition(
        x === undefined
          ? anchor.getBoundingClientRect()
          : { left: x, top: y ?? 0, bottom: y ?? 0, width: 0 },
        {
          width: 180,
          maxHeight: 120,
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
        },
      ),
    );
    menu.showPopover();
    anchor.setAttribute("aria-expanded", "true");
    edit.focus();
  }
  menu.addEventListener("toggle", () => {
    if (!menu.matches(":popover-open"))
      menuAnchor?.setAttribute("aria-expanded", "false");
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      menuAnchor?.focus();
    }
  });
  let editor: ReturnType<typeof createViewEditor> | undefined,
    iconPicker: ReturnType<typeof workspaceIconPicker> | undefined,
    revision = 0;
  function report(reason: unknown) {
    options.error(
      reason instanceof Error ? reason.message : "뷰를 변경하지 못했어요.",
    );
  }
  function revealActive() {
    const active = tabs.querySelector<HTMLButtonElement>(
      '[aria-selected="true"]',
    );
    if (!active) return;
    const visible = tabs.getBoundingClientRect(),
      item = active.getBoundingClientRect();
    if (item.left < visible.left) tabs.scrollLeft -= visible.left - item.left;
    else if (item.right > visible.right)
      tabs.scrollLeft += item.right - visible.right;
  }
  const resize = new ResizeObserver(revealActive);
  resize.observe(tabs);
  function render() {
    const focused = tabs.contains(document.activeElement);
    closeMenu();
    const state = options.state();
    tabs.replaceChildren(
      ...state.tabs.map((tab) => {
        const item = element("div", "workspace-tab-item"),
          button = element("button", "workspace-tab");
        if (tab.icon) button.append(workspaceIcon(tab.icon));
        button.append(element("span", "workspace-tab-label", tab.name));
        item.setAttribute("role", "presentation");
        button.setAttribute("aria-haspopup", "menu");
        button.setAttribute("aria-expanded", "false");
        if (tab.id === state.activeId) {
          const arrow = uiIcon("chevron-right");
          arrow.classList.add("workspace-tab-arrow");
          button.append(arrow);
        }
        button.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          showMenu(tab.id, button, event.clientX, event.clientY);
        });
        button.type = "button";
        button.id = `workspace-tab-${tab.id}`;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(tab.id === state.activeId));
        button.setAttribute("aria-controls", "workspace-list");
        button.tabIndex = tab.id === state.activeId ? 0 : -1;
        button.addEventListener("click", () => {
          try {
            if (tab.id === options.state().activeId) showMenu(tab.id, button);
            else options.select(tab.id);
          } catch (reason) {
            report(reason);
          }
        });
        button.addEventListener("keydown", (event) => {
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            event.preventDefault();
            showMenu(tab.id, button);
            return;
          }
          const index = state.tabs.findIndex((item) => item.id === tab.id);
          const next =
            event.key === "ArrowRight"
              ? (index + 1) % state.tabs.length
              : event.key === "ArrowLeft"
                ? (index + state.tabs.length - 1) % state.tabs.length
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? state.tabs.length - 1
                    : -1;
          if (next < 0) return;
          event.preventDefault();
          try {
            const tab = state.tabs[next];
            if (!tab) return;
            options.select(tab.id);
            tabs
              .querySelector<HTMLButtonElement>('[aria-selected="true"]')
              ?.focus();
          } catch (reason) {
            report(reason);
          }
        });
        item.append(button);
        return item;
      }),
    );
    requestAnimationFrame(revealActive);
    if (focused)
      tabs.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  }
  function open(creating: boolean, targetId = options.state().activeId) {
    const current = options.state().tabs.find((tab) => tab.id === targetId);
    if (!current) {
      report(new Error("뷰를 찾을 수 없습니다."));
      return;
    }
    const original = creating
        ? {
            ...current,
            id: `workspace-${Date.now()}-${elementId("view")}`,
            name: "",
            views: initialViews(resolveView(current.views, { kind: "global" })),
          }
        : current,
      draft = createViewDraft(resolveView(original.views, { kind: "global" }));
    let selected = [...original.projects],
      selectedIcon = original.icon ?? "",
      loading = false;
    const form = element("form", "workspace-view-form"),
      label = element("label", "view-name-field", "뷰 이름"),
      name = element("input"),
      projectHost = element("div"),
      editorHost = element("div"),
      error = element("p", "error"),
      save = actionButton(creating ? "뷰 만들기" : "저장", "check", "primary"),
      cancel = actionButton("취소", "x");
    name.value = original.name;
    name.required = true;
    name.maxLength = 80;
    name.placeholder = "예: 이번 주 내 작업";
    name.setAttribute("aria-label", "뷰 이름");
    iconPicker?.destroy();
    iconPicker = workspaceIconPicker(selectedIcon, (value) => {
      selectedIcon = value;
    });
    const nameRow = element("div", "workspace-name-row");
    nameRow.append(iconPicker.element, name);
    label.append(nameRow);
    error.setAttribute("role", "alert");
    form.append(label, projectHost, editorHost, error);
    async function loadEditor() {
      const request = ++revision;
      loading = true;
      save.disabled = true;
      editor?.destroy();
      editor = undefined;
      editorHost.replaceChildren(
        element("p", "view-help", "필터 선택지를 불러오는 중…"),
      );
      error.textContent = "";
      try {
        const choices = await options.load(selected);
        if (request !== revision || !dialog.open) return;
        editor = createViewEditor(draft, choices, options.me, () => {});
        editorHost.replaceChildren(editor.element);
        loading = false;
        save.disabled = false;
      } catch (reason) {
        if (request !== revision || !dialog.open) return;
        editorHost.replaceChildren();
        const retry = actionButton("다시 불러오기", "search");
        retry.addEventListener("click", () => void loadEditor());
        editorHost.append(retry);
        error.textContent =
          reason instanceof Error
            ? reason.message
            : "필터를 불러오지 못했어요.";
      }
    }
    function renderProjects() {
      const focused = document.activeElement?.getAttribute("aria-label");
      projectHost.replaceChildren(
        projectChecklist(options.projects, selected, (value) => {
          selected =
            value === null
              ? options.projects.map((project) => project.key)
              : [...value];
          renderProjects();
          void loadEditor();
        }),
      );
      if (focused)
        [...projectHost.querySelectorAll<HTMLInputElement>("input")]
          .find((input) => input.getAttribute("aria-label") === focused)
          ?.focus();
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (loading) return;
      try {
        options.save({
          ...original,
          name: name.value,
          icon: selectedIcon,
          projects: selected,
          views: applyView(original.views, { kind: "global" }, draft.value),
        });
        dialog.close();
      } catch (reason) {
        error.textContent =
          reason instanceof Error ? reason.message : "뷰를 저장하지 못했어요.";
      }
    });
    save.addEventListener("click", () => form.requestSubmit());
    cancel.addEventListener("click", () => dialog.close());
    const actions = [cancel, save];
    if (!creating && options.state().tabs.length > 1) {
      const remove = actionButton("뷰 삭제", "trash-2");
      remove.addEventListener("click", () => {
        if (
          !confirm(
            `‘${original.name}’ 뷰를 삭제할까요? Jira 이슈는 삭제되지 않습니다.`,
          )
        )
          return;
        try {
          options.remove(original.id);
          dialog.close();
        } catch (reason) {
          report(reason);
        }
      });
      actions.unshift(remove);
    }
    showModal(dialog, {
      title: creating ? "뷰 만들기" : "뷰 편집",
      content: form,
      actions,
    });
    renderProjects();
    void loadEditor();
    name.focus();
  }
  dialog.addEventListener("close", () => {
    revision++;
    editor?.destroy();
    editor = undefined;
    iconPicker?.destroy();
    iconPicker = undefined;
  });
  add.addEventListener("click", () => open(true));
  edit.addEventListener("click", () => {
    const id = menuTarget;
    closeMenu();
    open(false, id);
  });
  duplicate.addEventListener("click", () => {
    const current = options.state().tabs.find((tab) => tab.id === menuTarget);
    closeMenu();
    if (!current) return report(new Error("뷰를 찾을 수 없습니다."));
    try {
      const views = decodeViews(current.views);
      if (!views) throw new Error("뷰를 복제하지 못했어요.");
      const names = new Set(options.state().tabs.map((tab) => tab.name));
      let suffix = " 복사본";
      let count = 2;
      let name = `${current.name.slice(0, 80 - suffix.length)}${suffix}`;
      while (names.has(name)) {
        suffix = ` 복사본 ${count++}`;
        name = `${current.name.slice(0, 80 - suffix.length)}${suffix}`;
      }
      options.save({
        ...current,
        id: `workspace-${Date.now()}-${elementId("view")}`,
        name,
        projects: [...current.projects],
        views,
      });
    } catch (reason) {
      report(reason);
    }
  });
  render();
  return {
    element: root,
    render,
    destroy() {
      revision++;
      resize.disconnect();
      editor?.destroy();
      iconPicker?.destroy();
      closeMenu();
      menu.remove();
      dialog.remove();
      root.remove();
    },
  };
}
