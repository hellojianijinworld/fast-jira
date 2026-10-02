import type { Api } from "../client/api.ts";
import type { TreeCatalog } from "../domain/catalog.ts";
import { cloneFilters, type Filters, withoutDone } from "../domain/filters.ts";
import type {
  BranchOverrides,
  SelectionFilter,
  UserOption,
} from "../domain/issue.ts";
import { actionButton, element } from "./dom.ts";
import { personPill, projectIcon, statusPill } from "./meta.ts";
import { createSortEditor } from "./sort-editor.ts";

export interface FilterCallbacks {
  filters: () => Filters;
  catalog: () => TreeCatalog;
  compactDone?: () => boolean;
  onApply: (
    filters: Filters,
    catalog: TreeCatalog,
    compactDone: boolean,
  ) => void;
  onBranch: (key: string, overrides: BranchOverrides) => void;
}
interface Choice {
  id: string;
  name: string;
}
/** 전체·하위 팝오버는 초안을 유지하고 적용 버튼으로 상태를 한 번만 변경한다. */
export function createFilterPanel(
  api: Pick<Api, "statuses" | "users" | "types">,
  me: { accountId: string; displayName: string },
  callbacks: FilterCallbacks,
) {
  const panel = element("div", "filter-panel");
  panel.popover = "auto";
  panel.setAttribute("aria-label", "필터 및 정렬");
  document.body.append(panel);
  let draft = cloneFilters(callbacks.filters()),
    catalog = callbacks.catalog(),
    users: UserOption[] = [],
    userProjects = "";
  let branchKey = "",
    overrides: BranchOverrides = {},
    revision = 0,
    loading = false,
    error = "";
  let sort = createSortEditor();
  let compactDone = true;
  let metadataTimer: ReturnType<typeof setTimeout> | undefined;
  panel.addEventListener("beforetoggle", (event) => {
    if ((event as ToggleEvent).newState === "closed") {
      clearTimeout(metadataTimer);
      revision++;
    }
  });
  function close() {
    clearTimeout(metadataTimer);
    revision++;
    if (panel.matches(":popover-open")) panel.hidePopover();
  }
  function scheduleMetadata() {
    clearTimeout(metadataTimer);
    revision++;
    loading = true;
    error = "";
    metadataTimer = setTimeout(() => void metadata(), 200);
  }
  async function metadata() {
    const version = ++revision,
      keys = draft.projects.join(",");
    loading = true;
    error = "";
    render();
    try {
      const [statuses, people, types] = keys
        ? await Promise.all([
            api.statuses(draft.projects),
            api.users(draft.projects),
            api.types(draft.projects).catch(() => []),
          ])
        : [[], [], []];
      if (version !== revision) return;
      catalog = { ...catalog, statuses, types };
      normalizeDone();
      users = people;
      userProjects = keys;
      if (!users.some((user) => user.id === me.accountId))
        users.unshift({ id: me.accountId, name: me.displayName, avatar: "" });
    } catch (reason) {
      if (version === revision)
        error =
          reason instanceof Error
            ? reason.message
            : "선택지를 불러오지 못했어요.";
    } finally {
      if (version === revision) {
        loading = false;
        render();
      }
    }
  }
  function section(
    title: string,
    items: readonly Choice[],
    selected: SelectionFilter,
    renderValue: (choice: Choice) => Node,
    shortcuts: readonly [string, SelectionFilter][],
    change: (value: SelectionFilter) => void,
  ): HTMLElement {
    const section = element("section", "filter-section");
    const head = element("div", "filter-section-head");
    head.append(element("h3", "", title));
    const actions = element("div", "status-actions");
    for (const [label, value] of [
      ["전체 선택", null],
      ["선택 해제", []],
      ...shortcuts,
    ] as [string, SelectionFilter][]) {
      const button = element("button", "", label);
      button.type = "button";
      button.addEventListener("click", () => {
        change(value);
        render();
      });
      actions.append(button);
    }
    head.append(actions);
    section.append(head);
    const checks = element(
      "div",
      title === "담당자"
        ? "status-checks people-checks"
        : title === "프로젝트"
          ? "project-checks"
          : "status-checks",
    );
    for (const choice of items) {
      const label = element("label", "status-check");
      const input = element("input");
      input.type = "checkbox";
      input.value = choice.id;
      input.checked = selected === null || selected.includes(choice.id);
      input.setAttribute("aria-label", `${title}: ${choice.name}`);
      input.addEventListener("change", () => {
        const next = new Set(selected ?? items.map((item) => item.id));
        if (input.checked) next.add(choice.id);
        else next.delete(choice.id);
        change([...next]);
        render();
      });
      label.append(input, renderValue(choice));
      checks.append(label);
    }
    section.append(checks);
    return section;
  }
  function inheritRow(
    title: string,
    field: "statuses" | "assignees",
  ): HTMLElement | null {
    if (!branchKey) return null;
    const label = element("label", "filter-check");
    const input = element("input");
    input.type = "checkbox";
    input.checked =
      overrides[field] === undefined || overrides[field] === "inherit";
    input.setAttribute("aria-label", `${title} 글로벌 필터 적용`);
    input.addEventListener("change", () => {
      overrides[field] = input.checked ? "inherit" : draft[field];
      render();
    });
    label.append(input, document.createTextNode("글로벌 필터 적용"));
    return label;
  }
  function normalizeDone() {
    if (!draft.excludeDone) return;
    draft.statuses = withoutDone(draft.statuses, catalog.statuses);
    draft.excludeDone = false;
  }
  function render() {
    const focused = document.activeElement;
    const focusLabel =
      focused instanceof HTMLElement && panel.contains(focused)
        ? focused.getAttribute("aria-label")
        : null;
    const previousSort = sort.value;
    sort.destroy();
    sort = createSortEditor(previousSort, Boolean(branchKey), draft.sort);
    const title = element(
      "h2",
      "",
      branchKey ? `${branchKey} 하위 이슈` : "필터 및 정렬",
    );
    panel.replaceChildren(title);
    if (!branchKey)
      panel.append(
        section(
          "프로젝트",
          catalog.projects.map((project) => ({
            id: project.key,
            name: project.name,
          })),
          draft.projects,
          (choice) => {
            const copy = element("span", "project-choice");
            const project = catalog.projects.find(
              (project) => project.key === choice.id,
            );
            const icon = project ? projectIcon(project) : null;
            if (icon) copy.append(icon);
            copy.append(
              document.createTextNode(`${choice.name} (${choice.id})`),
            );
            return copy;
          },
          [],
          (value) => {
            draft.projects =
              value === null
                ? catalog.projects.map((project) => project.key)
                : [...value];
            scheduleMetadata();
          },
        ),
      );
    if (loading || error) {
      const status = element(
        "p",
        error ? "error" : "empty",
        error || "선택지를 불러오는 중…",
      );
      status.setAttribute("role", "status");
      panel.append(status);
    }
    const peopleSection = element("section", "filter-section");
    const peopleInherit = inheritRow("담당자", "assignees");
    if (peopleInherit)
      peopleSection.append(element("h3", "", "담당자"), peopleInherit);
    if (
      !peopleInherit ||
      (overrides.assignees !== undefined && overrides.assignees !== "inherit")
    ) {
      const selected = branchKey
        ? overrides.assignees === "inherit" || overrides.assignees === undefined
          ? draft.assignees
          : overrides.assignees
        : draft.assignees;
      const choices = [
        { id: "unassigned", name: "미지정", avatar: "" },
        ...users,
      ];
      const related = element("label", "filter-check");
      const check = element("input");
      check.type = "checkbox";
      check.checked = draft.scope === "related";
      check.addEventListener("change", () => {
        draft.scope = check.checked ? "related" : "all";
      });
      related.append(check, document.createTextNode("내 관련 항목만"));
      if (!branchKey) peopleSection.append(related);
      peopleSection.append(
        section(
          "담당자",
          choices,
          selected,
          (choice) =>
            personPill({
              name: choice.id === "unassigned" ? "" : choice.name,
              avatar: users.find((user) => user.id === choice.id)?.avatar ?? "",
            }),
          [
            ["나 또는 미지정", [me.accountId, "unassigned"]],
            ["나만", [me.accountId]],
            ["미지정만", ["unassigned"]],
          ],
          (value) => {
            if (branchKey) overrides.assignees = value;
            else {
              draft.assignees = value;
              draft.scope = "all";
            }
          },
        ),
      );
    }
    panel.append(peopleSection);
    const statusSection = element("section", "filter-section");
    const statusInherit = inheritRow("단계", "statuses");
    if (statusInherit)
      statusSection.append(element("h3", "", "단계"), statusInherit);
    if (
      !statusInherit ||
      (overrides.statuses !== undefined && overrides.statuses !== "inherit")
    ) {
      const selected = branchKey
        ? overrides.statuses === "inherit" || overrides.statuses === undefined
          ? draft.statuses
          : overrides.statuses
        : draft.statuses;
      const statuses = catalog.statuses.filter((status) =>
        status.projects.some((key) => draft.projects.includes(key)),
      );
      const current = selected ?? statuses.map((status) => status.id);
      statusSection.append(
        section(
          "단계",
          statuses,
          selected,
          (choice) =>
            statusPill(
              choice.name,
              catalog.statuses.map((status) => status.name),
            ),
          [
            [
              "완료 제외",
              current.filter(
                (id) =>
                  statuses.find((status) => status.id === id)?.category !==
                  "done",
              ),
            ],
          ],
          (value) => {
            if (branchKey) overrides.statuses = value;
            else draft.statuses = value;
          },
        ),
      );
    }
    panel.append(statusSection);
    if (!branchKey) {
      const row = element("label", "setting-row");
      const check = element("input");
      check.type = "checkbox";
      check.checked = compactDone;
      check.addEventListener("change", () => {
        compactDone = check.checked;
      });
      row.append(check, document.createTextNode("완료 항목 간단히 보기"));
      panel.append(row);
    }
    const order = element("section", "filter-section sort-section");
    order.append(element("h3", "", "정렬"), sort.element);
    panel.append(order);
    const footer = element("div", "filter-footer");
    const cancel = actionButton("취소", "x");
    cancel.addEventListener("click", close);
    const apply = actionButton("적용", "check", "");
    apply.disabled = loading || Boolean(error);
    apply.addEventListener("click", () => {
      if (!draft.projects.length) {
        error = "프로젝트를 하나 이상 선택하세요.";
        render();
        return;
      }
      if (branchKey)
        callbacks.onBranch(branchKey, {
          ...overrides,
          sort: sort.value,
          people:
            overrides.assignees !== undefined &&
            overrides.assignees !== "inherit"
              ? "all"
              : "inherit",
          done:
            overrides.statuses !== undefined && overrides.statuses !== "inherit"
              ? "include"
              : "inherit",
        });
      else
        callbacks.onApply(
          { ...cloneFilters(draft), excludeDone: false, sort: sort.value },
          catalog,
          compactDone,
        );
      close();
    });
    footer.append(cancel, apply);
    panel.append(footer);
    if (focusLabel)
      Array.from(panel.querySelectorAll<HTMLElement>("[aria-label]"))
        .find((node) => node.getAttribute("aria-label") === focusLabel)
        ?.focus();
  }
  function open(anchor: HTMLElement, key = "", setting: BranchOverrides = {}) {
    close();
    branchKey = key;
    overrides = { ...setting };
    draft = cloneFilters(callbacks.filters());
    compactDone = callbacks.compactDone?.() ?? true;
    catalog = callbacks.catalog();
    sort.destroy();
    sort = createSortEditor(
      key ? (setting.sort ?? "inherit") : draft.sort,
      Boolean(key),
      draft.sort,
    );
    if (key && setting.done === "exclude")
      overrides.statuses = (
        draft.statuses ?? catalog.statuses.map((status) => status.id)
      ).filter(
        (id) =>
          catalog.statuses.find((status) => status.id === id)?.category !==
          "done",
      );
    if (key && setting.people === "mine")
      overrides.assignees = [me.accountId, "unassigned"];
    loading = false;
    error = "";
    if (userProjects === draft.projects.join(",")) normalizeDone();
    render();
    const width = Math.min(960, innerWidth - 24),
      rect = anchor.getBoundingClientRect();
    const top =
      rect.bottom < innerHeight - 220
        ? Math.max(12, Math.min(rect.bottom + 6, 64))
        : 12;
    Object.assign(panel.style, {
      width: `${width}px`,
      left: `${Math.max(12, Math.min(rect.right - width, innerWidth - width - 12))}px`,
      top: `${top}px`,
      maxHeight: `calc(100dvh - ${top + 12}px)`,
    });
    panel.showPopover();
    panel.scrollTop = 0;
    if (userProjects !== draft.projects.join(",")) void metadata();
  }
  return {
    element: panel,
    open,
    close,
    destroy: () => {
      close();
      sort.destroy();
      panel.remove();
    },
  };
}
