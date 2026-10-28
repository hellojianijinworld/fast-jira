import type { ProjectOption } from "../domain/catalog.ts";
import type { SelectionFilter } from "../domain/issue.ts";
import { element } from "./dom.ts";
import { filterChecklist } from "./filter-checklist.ts";
import { projectIcon } from "./meta.ts";

/** 프로젝트 선택과 뷰 편집은 같은 아이콘·이름·선택 액션을 사용한다. */
export function projectChecklist(
  projects: readonly ProjectOption[],
  selected: SelectionFilter,
  change: (value: SelectionFilter) => void,
) {
  const byKey = new Map(projects.map((project) => [project.key, project]));
  return filterChecklist(
    "프로젝트",
    projects.map((project) => ({ id: project.key, name: project.name })),
    selected,
    (choice) => {
      const copy = element("span", "project-choice"),
        project = byKey.get(choice.id),
        icon = project ? projectIcon(project) : null;
      if (icon) copy.append(icon);
      copy.append(document.createTextNode(`${choice.name} (${choice.id})`));
      return copy;
    },
    [],
    change,
  );
}
