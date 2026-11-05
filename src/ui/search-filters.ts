import type { Api } from "../client/api.ts";
import { createViewDraft } from "../client/view-editor-controller.ts";
import type { TreeCatalog } from "../domain/catalog.ts";
import { withoutDone } from "../domain/filters.ts";
import {
  defaultSearchFilters,
  type SearchSort,
  searchSortChoices,
} from "../domain/search-results.ts";
import {
  actionButton,
  buttonGroup,
  element,
  iconButton,
  textButton,
  uiIcon,
} from "./dom.ts";
import { filterChecklist } from "./filter-checklist.ts";
import { popoverPosition } from "./geometry.ts";
import { statusPill } from "./meta.ts";
import { createPeopleFilter } from "./people-filter.ts";
import { projectChecklist } from "./project-checklist.ts";
import { enhanceSelect } from "./select-menu.ts";

export interface SearchFilterConfig {
  api: Partial<Pick<Api, "statuses" | "users">>;
  catalog?: () => TreeCatalog;
  me: { accountId: string; displayName: string };
  changed: () => void;
}
/** 검색창만 소유하는 일시 조건. 다중 선택을 마친 뒤 한 번 조회한다. */
export function createSearchFilters(config: SearchFilterConfig) {
  const root = element("div", "search-refinements"),
    bar = buttonGroup(element("div", "search-filter-bar"), { size: "sm" }),
    chips = buttonGroup(element("div", "search-filter-chips"), {
      size: "sm",
      compact: true,
    }),
    order = element("select", "search-sort");
  let filters = defaultSearchFilters(),
    sort: SearchSort = "recommended",
    alive = true,
    noProjects = false;
  const base = (): TreeCatalog =>
    config.catalog?.() ?? {
      projects: [],
      statuses: [],
      types: [],
      priorities: [],
    };
  const draft = createViewDraft(filters);
  const panels: HTMLElement[] = [];
  const statusCache = new Map<string, Promise<TreeCatalog["statuses"]>>();
  const usersCache = new Map<
    string,
    Promise<Awaited<ReturnType<Api["users"]>>>
  >();
  const keys = () =>
    filters.projects.length
      ? filters.projects
      : base().projects.map((p) => p.key);
  const snapshot = () => JSON.stringify([filters, sort, noProjects]);
  let notified = snapshot();
  function changed() {
    const next = snapshot();
    if (notified === next) return;
    notified = next;
    config.changed();
  }
  function peopleLabel() {
    if (filters.scope === "all" && filters.assignees === null) return "";
    const basis = filters.scope === "related" ? "참여자" : "담당자";
    if (
      filters.assignees?.length === 1 &&
      filters.assignees[0] === "unassigned"
    )
      return `${basis} 지정 없음`;
    if (filters.assignees === null) return `${basis}: 나`;
    return `${basis}: ${filters.assignees.length}명`;
  }
  function render() {
    chips.replaceChildren();
    const add = (label: string, reset: () => void) => {
      const chip = textButton(label, { purpose: "entry", size: "sm" });
      chip.append(uiIcon("x"));
      chip.setAttribute("aria-label", `${label} 조건 해제`);
      chip.addEventListener("click", () => {
        reset();
        draft.change(filters);
        render();
        changed();
      });
      chips.append(chip);
    };
    if (filters.projects.length || noProjects)
      add(
        noProjects
          ? "프로젝트 0개"
          : filters.projects.length === 1
            ? (base().projects.find((p) => p.key === filters.projects[0])
                ?.name ??
              filters.projects[0] ??
              "프로젝트")
            : `프로젝트 ${filters.projects.length}개`,
        () => {
          filters.projects = [];
          noProjects = false;
        },
      );
    const people = peopleLabel();
    if (people)
      add(people, () => {
        filters.scope = "all";
        filters.assignees = null;
        filters.includeUnassigned = false;
      });
    if (filters.statuses !== null || filters.excludeDone)
      add(
        filters.excludeDone
          ? "완료 제외"
          : `단계 ${filters.statuses?.length ?? 0}개`,
        () => {
          filters.statuses = null;
          filters.excludeDone = false;
        },
      );
    if (chips.childElementCount) {
      const reset = textButton("초기화", { purpose: "quiet", size: "sm" });
      reset.addEventListener("click", () => {
        resetState();
        changed();
      });
      chips.append(reset);
    }
    chips.hidden = chips.childElementCount === 0;
    projectButton.setAttribute(
      "aria-pressed",
      String(filters.projects.length > 0 || noProjects),
    );
    peopleButton.setAttribute("aria-pressed", String(Boolean(people)));
    statusButton.setAttribute(
      "aria-pressed",
      String(filters.statuses !== null || filters.excludeDone),
    );
  }
  function popover(
    label: string,
    icon: string,
    content: (
      host: HTMLElement,
      current: () => boolean,
    ) => void | Promise<void>,
  ) {
    const button = actionButton(label, icon, {
      purpose: "quiet",
      size: "sm",
      selectable: true,
    });
    button.append(uiIcon("chevron-down"));
    const panel = element("div", "search-filter-popover popover-surface");
    panel.popover = "auto";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", `검색 ${label} 필터`);
    const close = iconButton("닫기", "x", { size: "sm" });
    const head = element("div", "search-filter-head");
    head.append(element("strong", "", label), close);
    const body = element("div", "search-filter-body");
    panel.append(head, body);
    root.append(panel);
    panels.push(panel);
    let before = "",
      revision = 0;
    close.addEventListener("click", () => panel.hidePopover());
    panel.addEventListener("toggle", () => {
      if (panel.matches(":popover-open")) return;
      revision++;
      button.setAttribute("aria-expanded", "false");
      render();
      if (before && before !== snapshot()) changed();
    });
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", async () => {
      if (panel.matches(":popover-open")) {
        panel.hidePopover();
        return;
      }
      before = snapshot();
      const version = ++revision;
      body.replaceChildren(
        element("p", "view-help", "선택지를 불러오는 중이에요…"),
      );
      panel.showPopover();
      button.setAttribute("aria-expanded", "true");
      const place = () =>
        Object.assign(
          panel.style,
          popoverPosition(button.getBoundingClientRect(), {
            width: 480,
            maxHeight: 460,
            viewportWidth: innerWidth,
            viewportHeight: innerHeight,
          }),
        );
      place();
      try {
        await content(
          body,
          () => alive && version === revision && panel.matches(":popover-open"),
        );
      } catch (error) {
        if (alive && version === revision)
          body.replaceChildren(
            element(
              "p",
              "error",
              error instanceof Error
                ? error.message
                : "선택지를 불러오지 못했어요. 다시 열어 주세요.",
            ),
          );
      }
      if (alive && version === revision && panel.matches(":popover-open")) {
        place();
        close.focus({ preventScroll: true });
      }
    });
    return button;
  }
  function replaceChecklist(host: HTMLElement, checklist: HTMLElement) {
    const panel = host.parentElement;
    const active = document.activeElement;
    const focused = panel?.contains(active)
      ? active?.getAttribute("aria-label") || active?.textContent
      : null;
    const head = panel?.querySelector(".search-filter-head");
    const actions = checklist.querySelector(".status-actions");
    head?.querySelector(".status-actions")?.remove();
    if (actions && head) head.insertBefore(actions, head.lastElementChild);
    checklist.querySelector(".filter-section-head")?.remove();
    host.replaceChildren(checklist);
    if (focused)
      [...(panel?.querySelectorAll<HTMLElement>("button, input") ?? [])]
        .find(
          (item) =>
            (item.getAttribute("aria-label") || item.textContent) === focused,
        )
        ?.focus();
  }
  const projectButton = popover("프로젝트", "folder", (host) => {
    function list() {
      replaceChecklist(
        host,
        projectChecklist(
          base().projects,
          noProjects ? [] : filters.projects.length ? filters.projects : null,
          (value) => {
            filters.projects = value === null ? [] : [...value];
            noProjects = value !== null && value.length === 0;
            list();
            render();
          },
        ),
      );
    }
    list();
  });
  let people: ReturnType<typeof createPeopleFilter> | undefined;
  const peopleButton = popover("작업참여자", "users", (host) => {
    people?.destroy();
    draft.change(filters);
    const selected = keys();
    const cacheKey = [...selected].sort().join(",");
    const getUsers = config.api.users;
    const loadUsers = getUsers
      ? () => {
          let found = usersCache.get(cacheKey);
          if (!found) {
            found = getUsers(selected).catch((error) => {
              usersCache.delete(cacheKey);
              throw error;
            });
            usersCache.set(cacheKey, found);
          }
          return found;
        }
      : undefined;
    people = createPeopleFilter(
      draft,
      [],
      config.me,
      () => {
        filters = { ...filters, ...draft.value };
        render();
      },
      loadUsers,
    );
    people.element.querySelector(":scope > h3")?.remove();
    host.replaceChildren(people.element);
  });
  const statusButton = popover("단계", "list-filter", async (host, current) => {
    const selected = keys(),
      cacheKey = [...selected].sort().join(",");
    let pending = statusCache.get(cacheKey);
    if (!pending) {
      pending = config.api.statuses
        ? config.api.statuses(selected).catch((error) => {
            statusCache.delete(cacheKey);
            throw error;
          })
        : Promise.resolve(base().statuses);
      statusCache.set(cacheKey, pending);
    }
    const statuses = await pending;
    if (!current()) return;
    function list() {
      const chosen = filters.excludeDone
        ? withoutDone(filters.statuses, statuses)
        : filters.statuses;
      replaceChecklist(
        host,
        filterChecklist(
          "단계",
          statuses,
          chosen,
          (choice) =>
            statusPill(
              choice.name,
              statuses.map((s) => s.name),
            ),
          [["완료 제외", withoutDone(null, statuses)]],
          (value) => {
            const nonDone = withoutDone(null, statuses);
            filters.excludeDone =
              value !== null &&
              nonDone.length > 0 &&
              value.length === nonDone.length &&
              nonDone.every((id) => value.includes(id));
            filters.statuses = filters.excludeDone ? null : value;
            list();
            render();
          },
        ),
      );
    }
    list();
  });
  order.setAttribute("aria-label", "검색 정렬");
  for (const [value, label] of Object.entries(searchSortChoices))
    order.append(new Option(label, value));
  order.addEventListener("change", () => {
    sort = order.value as SearchSort;
    filters.sort = sort === "recommended" ? "recent" : sort;
    changed();
  });
  bar.append(projectButton, peopleButton, statusButton, order);
  const sortMenu = enhanceSelect(order, { size: "sm" });
  root.prepend(bar, chips);
  function resetState() {
    filters = defaultSearchFilters();
    sort = "recommended";
    noProjects = false;
    draft.change(filters);
    order.value = sort;
    sortMenu.sync();
    render();
  }
  render();
  return {
    element: root,
    get value() {
      return { ...filters, projects: [...filters.projects] };
    },
    get sort() {
      return sort;
    },
    get emptyProjects() {
      return noProjects;
    },
    get active() {
      return (
        noProjects ||
        filters.projects.length > 0 ||
        filters.scope !== "all" ||
        filters.assignees !== null ||
        filters.statuses !== null ||
        filters.excludeDone
      );
    },
    reset() {
      for (const panel of panels)
        if (panel.matches(":popover-open")) panel.hidePopover();
      resetState();
      notified = snapshot();
    },
    destroy() {
      alive = false;
      people?.destroy();
      sortMenu.destroy();
      root.remove();
    },
  };
}
