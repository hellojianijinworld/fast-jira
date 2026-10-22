import type { SelectionFilter } from "../domain/issue.ts";
import { element } from "./dom.ts";
export interface FilterChoice {
  id: string;
  name: string;
}

export function filterChecklist(
  title: string,
  items: readonly FilterChoice[],
  selected: SelectionFilter,
  renderValue: (choice: FilterChoice) => Node,
  shortcuts: readonly [string, SelectionFilter][],
  change: (value: SelectionFilter) => void,
) {
  const section = element("section", "filter-section");
  const head = element("div", "filter-section-head");
  const actions = element("div", "status-actions");
  head.append(element("h3", "", title));
  for (const [label, value] of [
    ["전체 선택", null],
    ["선택 해제", []],
    ...shortcuts,
  ] as [string, SelectionFilter][]) {
    const button = element("button", "", label);
    button.type = "button";
    button.addEventListener("click", () => change(value));
    actions.append(button);
  }
  head.append(actions);
  const checks = element(
    "div",
    title === "담당자" || title === "작업 관계자"
      ? "status-checks people-checks"
      : title === "프로젝트"
        ? "project-checks"
        : title === "단계"
          ? "status-checks stage-checks"
          : "status-checks",
  );
  if (title === "단계")
    checks.style.setProperty(
      "--stage-rows",
      String(Math.max(1, Math.ceil(items.length / 2))),
    );
  for (const choice of items) {
    const label = element("label", "status-check");
    label.title = choice.name;
    const input = element("input");
    input.type = "checkbox";
    input.checked = selected === null || selected.includes(choice.id);
    input.setAttribute("aria-label", `${title}: ${choice.name}`);
    input.addEventListener("change", () => {
      const next = new Set(selected ?? items.map((item) => item.id));
      if (input.checked) next.add(choice.id);
      else next.delete(choice.id);
      change([...next]);
    });
    label.append(input, renderValue(choice));
    checks.append(label);
  }
  section.append(head, checks);
  return section;
}
