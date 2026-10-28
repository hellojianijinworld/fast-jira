import type { ProjectOption } from "../domain/catalog.ts";
import { actionButton, element, elementId, iconButton } from "./dom.ts";
import { filterChecklist } from "./filter-checklist.ts";
import { popoverPosition } from "./geometry.ts";
import { projectIcon } from "./meta.ts";

/** 현재 탭의 프로젝트 조회 범위를 편집한다. */
export function createProjectPanel(options: {
  projects: () => readonly ProjectOption[];
  selected: () => readonly string[];
  viewName?: () => string;
  apply: (projects: string[]) => void;
}) {
  const panel = element("div", "filter-panel view-panel project-panel");
  panel.id = elementId("projects");
  panel.popover = "auto";
  panel.setAttribute("aria-label", "프로젝트 선택");
  const head = element("div", "view-panel-head"),
    dismiss = iconButton("닫기", "x"),
    body = element("div", "view-panel-body"),
    error = element("p", "error view-error"),
    footer = element("div", "filter-footer"),
    cancel = actionButton("취소", "x"),
    apply = actionButton("적용", "check", "");
  const heading = element("div", "view-panel-heading"),
    scope = element("p", "view-help view-panel-scope");
  heading.append(element("h2", "", "프로젝트 선택"), scope);
  head.append(heading, dismiss);
  error.setAttribute("role", "alert");
  error.hidden = true;
  footer.append(cancel, apply);
  panel.append(head, body, error, footer);
  document.body.append(panel);
  let selected: string[] = [],
    anchor: HTMLElement | null = null;
  function render() {
    const projects = options.projects();
    body.replaceChildren(
      filterChecklist(
        "프로젝트",
        projects.map((project) => ({
          id: project.key,
          name: project.name,
        })),
        selected,
        (choice) => {
          const copy = element("span", "project-choice");
          const project = projects.find((project) => project.key === choice.id);
          const icon = project ? projectIcon(project) : null;
          if (icon) copy.append(icon);
          copy.append(document.createTextNode(`${choice.name} (${choice.id})`));
          return copy;
        },
        [],
        (value) => {
          const focused = document.activeElement?.getAttribute("aria-label");
          selected =
            value === null
              ? projects.map((project) => project.key)
              : [...value];
          render();
          if (focused)
            [...body.querySelectorAll<HTMLInputElement>("input")]
              .find((input) => input.getAttribute("aria-label") === focused)
              ?.focus();
        },
      ),
    );
  }
  function close() {
    if (panel.matches(":popover-open")) panel.hidePopover();
    anchor?.focus();
  }
  panel.addEventListener("beforetoggle", (event) => {
    anchor?.setAttribute(
      "aria-expanded",
      String((event as ToggleEvent).newState === "open"),
    );
  });
  dismiss.addEventListener("click", close);
  cancel.addEventListener("click", close);
  apply.addEventListener("click", () => {
    try {
      options.apply([...selected]);
      close();
    } catch (reason) {
      error.textContent =
        reason instanceof Error
          ? reason.message
          : "프로젝트를 적용하지 못했어요.";
      error.hidden = false;
    }
  });
  return {
    element: panel,
    open(nextAnchor: HTMLElement) {
      if (panel.matches(":popover-open")) {
        close();
        return;
      }
      anchor = nextAnchor;
      anchor.setAttribute("aria-controls", panel.id);
      selected = [...options.selected()];
      scope.textContent = options.viewName
        ? `‘${options.viewName()}’ 뷰에 적용`
        : "현재 탭에 적용";
      error.hidden = true;
      render();
      Object.assign(
        panel.style,
        popoverPosition(anchor.getBoundingClientRect(), {
          width: 720,
          maxHeight: innerHeight - 24,
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
        }),
      );
      panel.showPopover();
      body.scrollTop = 0;
      body.querySelector<HTMLButtonElement>("button")?.focus();
    },
    close,
    destroy() {
      close();
      panel.remove();
    },
  };
}
