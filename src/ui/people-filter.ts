import type { ViewDraft } from "../client/view-editor-controller.ts";
import { MAX_FILTER_SELECTION } from "../domain/filters.ts";
import type { UserOption } from "../domain/issue.ts";
import {
  type PersonBasis,
  type PersonMode,
  personFilter,
  personSelection,
} from "../domain/people.ts";
import { element } from "./dom.ts";
import { filterChecklist } from "./filter-checklist.ts";
import { personPill } from "./meta.ts";
import { enhanceSelect } from "./select-menu.ts";

/** 사용자 목록은 직접 선택할 때만 노출한다. 조회·저장은 편집기 밖에서 처리한다. */
export function createPeopleFilter(
  draft: ViewDraft,
  users: readonly UserOption[],
  me: { accountId: string; displayName: string },
  changed: () => void,
  loadUsers?: () => Promise<UserOption[]>,
) {
  const root = element("section", "filter-section people-filter");
  const controls = element("div", "people-filter-controls");
  const basis = element("select"),
    mode = element("select");
  basis.setAttribute("aria-label", "사람 조건 기준");
  mode.setAttribute("aria-label", "표시할 사람");
  basis.append(
    new Option("담당자 기준", "assigned"),
    new Option("작업 관계자 기준", "related"),
  );
  const initial = personFilter(draft.value);
  basis.value = initial.basis;
  const basisLabel = element("label", "people-filter-field", "기준"),
    modeLabel = element("label", "people-filter-field", "대상");
  basisLabel.append(basis);
  modeLabel.append(mode);
  controls.append(basisLabel, modeLabel);
  const help = element("p", "view-help"),
    choices = element("div", "people-filter-choices");
  root.append(element("h3", "", "사람"), controls, help, choices);
  const basisMenu = enhanceSelect(basis);
  let members = users.some((user) => user.id === me.accountId)
    ? [...users]
    : [{ id: me.accountId, name: me.displayName, avatar: "" }, ...users];
  let currentMode: PersonMode = initial.mode;
  let alive = true,
    loading = false,
    loaded = !loadUsers,
    error = "";
  function renderModes() {
    mode.replaceChildren(
      new Option(
        basis.value === "related"
          ? "내가 작업 관계자인 태스크만"
          : "내가 담당한 태스크만",
        "me",
      ),
      new Option("미지정 작업만", "unassigned"),
      new Option("전체 작업", "all"),
      new Option("직접 선택", "custom"),
    );
    mode.value = currentMode;
  }
  renderModes();
  const modeMenu = enhanceSelect(mode);
  function apply(selected = draft.value.assignees) {
    draft.change(
      personSelection(basis.value as PersonBasis, currentMode, selected),
    );
    renderChoices();
    changed();
  }
  function renderChoices() {
    const related = basis.value === "related";
    help.textContent =
      currentMode === "unassigned"
        ? related
          ? "담당자와 작업참여자가 모두 비어 있는 작업을 보여줘요."
          : "담당자가 비어 있는 작업을 보여줘요."
        : related
          ? "담당자와 작업참여자에 지정된 사람을 함께 찾아요."
          : "담당자를 기준으로 작업을 찾아요.";
    const focusLabel = document.activeElement?.getAttribute("aria-label");
    choices.replaceChildren();
    choices.hidden = currentMode !== "custom";
    if (choices.hidden) return;
    if (loading || error) {
      choices.append(
        element(
          "p",
          error ? "error" : "view-help",
          error || "사용자를 불러오는 중…",
        ),
      );
      return;
    }
    const title = related ? "작업 관계자" : "담당자";
    choices.append(
      filterChecklist(
        title,
        related ? members : [{ id: "unassigned", name: "미지정" }, ...members],
        draft.value.assignees,
        (choice) =>
          personPill({
            name: choice.id === "unassigned" ? "" : choice.name,
            avatar: members.find((user) => user.id === choice.id)?.avatar ?? "",
          }),
        related
          ? [["나만", [me.accountId]]]
          : [
              ["나 또는 미지정", [me.accountId, "unassigned"]],
              ["나만", [me.accountId]],
              ["미지정만", ["unassigned"]],
            ],
        (selected) => {
          if (selected === null) {
            currentMode = "all";
            renderModes();
            modeMenu.sync();
            apply(null);
            modeMenu.trigger.focus();
          } else if (selected.length <= MAX_FILTER_SELECTION) apply(selected);
        },
      ),
    );
    if ((draft.value.assignees?.length ?? 0) >= MAX_FILTER_SELECTION) {
      choices.append(
        element(
          "p",
          "view-help",
          `최대 ${MAX_FILTER_SELECTION}명까지 직접 선택할 수 있어요. 모두 보려면 전체 선택을 이용하세요.`,
        ),
      );
      for (const check of choices.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]',
      ))
        if (!check.checked) check.disabled = true;
    }
    if (focusLabel)
      [...choices.querySelectorAll<HTMLElement>("[aria-label]")]
        .find((item) => item.getAttribute("aria-label") === focusLabel)
        ?.focus();
  }
  async function ensureMembers() {
    if (currentMode !== "custom" || loaded || loading || !loadUsers) return;
    loading = true;
    error = "";
    renderChoices();
    try {
      const users = await loadUsers();
      if (!alive) return;
      members = users.some((user) => user.id === me.accountId)
        ? users
        : [{ id: me.accountId, name: me.displayName, avatar: "" }, ...users];
      loaded = true;
    } catch (reason) {
      error =
        reason instanceof Error
          ? reason.message
          : "사용자를 불러오지 못했어요.";
    } finally {
      loading = false;
      if (alive) renderChoices();
    }
  }
  basis.addEventListener("change", () => {
    if (currentMode === "all") currentMode = "me";
    renderModes();
    modeMenu.sync();
    apply();
  });
  mode.addEventListener("change", () => {
    currentMode = mode.value as PersonMode;
    apply();
    void ensureMembers();
  });
  renderChoices();
  void ensureMembers();
  return {
    element: root,
    destroy() {
      alive = false;
      basisMenu.destroy();
      modeMenu.destroy();
      root.remove();
    },
  };
}
