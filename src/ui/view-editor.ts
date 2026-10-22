import type { ViewDraft } from "../client/view-editor-controller.ts";
import type { ViewOptions } from "../client/view-options.ts";
import { personFilter } from "../domain/people.ts";
import { sortLabel } from "../domain/sort.ts";
import type { ViewDefinition } from "../domain/views.ts";
import { element } from "./dom.ts";
import { filterChecklist } from "./filter-checklist.ts";
import { statusPill } from "./meta.ts";
import { createPeopleFilter } from "./people-filter.ts";
import { createSortEditor } from "./sort-editor.ts";

export function viewSummary(definition: ViewDefinition): string {
  const person = personFilter(definition);
  const label = person.basis === "related" ? "작업 관계자" : "담당자";
  const people =
    person.mode === "all"
      ? "전체 작업"
      : person.mode === "unassigned"
        ? person.basis === "related"
          ? "작업 관계자 모두 미지정"
          : "담당자 미지정 작업"
        : person.mode === "me"
          ? person.basis === "related"
            ? "내가 작업 관계자인 태스크"
            : "내가 담당한 태스크"
          : definition.assignees?.length
            ? `${label} ${definition.assignees.length}명 선택`
            : `${label} 선택 없음`;
  const stages =
    definition.statuses === null
      ? definition.excludeDone
        ? "완료 제외"
        : "전체 단계"
      : definition.statuses.length
        ? `단계 ${definition.statuses.length}개 선택`
        : "단계 선택 없음";
  return `${people} · ${stages} · ${sortLabel(definition.sort)}`;
}

/** 초안과 선택지만 받아 렌더링한다. 조회·저장·적용은 소유하지 않는다. */
export function createViewEditor(
  draft: ViewDraft,
  choices: ViewOptions,
  me: { accountId: string; displayName: string },
  changed: () => void,
) {
  const root = element("div", "view-editor");
  const stages = element("div");
  const people = createPeopleFilter(
    draft,
    choices.users,
    me,
    changed,
    choices.loadUsers,
  );
  const order = element("section", "filter-section sort-section");
  const sort = createSortEditor(draft.value.sort, (value) => {
    draft.change({ sort: value });
    changed();
  });
  order.append(element("h3", "", "정렬"), sort.element);
  root.append(people.element, stages, order);
  function change(patch: Partial<ViewDefinition>) {
    draft.change(patch);
    renderLists();
    changed();
  }
  function renderLists() {
    const focused = document.activeElement?.getAttribute("aria-label");
    const value = draft.value;
    const selected = value.excludeDone
      ? (value.statuses ?? choices.statuses.map((status) => status.id)).filter(
          (id) =>
            choices.statuses.find((status) => status.id === id)?.category !==
            "done",
        )
      : value.statuses;
    const current = selected ?? choices.statuses.map((status) => status.id);
    stages.replaceChildren(
      filterChecklist(
        "단계",
        choices.statuses,
        selected,
        (choice) =>
          statusPill(
            choice.name,
            choices.statuses.map((status) => status.name),
          ),
        [
          [
            "완료 제외",
            current.filter(
              (id) =>
                choices.statuses.find((status) => status.id === id)
                  ?.category !== "done",
            ),
          ],
        ],
        (statuses) => change({ statuses, excludeDone: false }),
      ),
    );
    if (focused)
      [...root.querySelectorAll<HTMLElement>("[aria-label]")]
        .find((item) => item.getAttribute("aria-label") === focused)
        ?.focus();
  }
  renderLists();
  return {
    element: root,
    destroy() {
      people.destroy();
      sort.destroy();
      root.remove();
    },
  };
}
