import {
  type SortRule,
  sortChoices,
  sortRules,
  validSort,
} from "../domain/sort.ts";
import { element } from "./dom.ts";
import { enhanceSelect, type SelectMenu } from "./select-menu.ts";

/** 필터의 초안만 변경한다. 실제 적용 시점은 부모 팝오버가 결정한다. */
export function createSortEditor(
  initial = "recent",
  inherit = false,
  defaultSort = "recent",
) {
  const root = element("div", "sort-rules");
  let value = initial;
  let menus: SelectMenu[] = [];
  function set(next: string) {
    if (!(inherit && next === "inherit") && !validSort(next))
      throw new Error("정렬 조건이 올바르지 않습니다.");
    value = next;
    render();
  }
  function button(
    label: string,
    title: string,
    action: () => void,
    disabled = false,
  ) {
    const button = element("button", "secondary", label);
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.disabled = disabled;
    button.addEventListener("click", action);
    return button;
  }
  function render() {
    for (const menu of menus) menu.destroy();
    menus = [];
    root.replaceChildren();
    if (inherit) {
      const label = element("label", "filter-check");
      const check = element("input");
      check.type = "checkbox";
      check.checked = value === "inherit";
      check.addEventListener("change", () =>
        set(check.checked ? "inherit" : defaultSort),
      );
      label.append(check, document.createTextNode("글로벌 필터 적용"));
      root.append(label);
      if (check.checked) return;
    }
    const rules: SortRule[] = sortRules(value);
    function move(index: number, direction: number) {
      const other = rules[index + direction],
        current = rules[index];
      if (!other || !current) return;
      rules[index] = other;
      rules[index + direction] = current;
      set(rules.join(","));
    }
    rules.forEach((rule, index) => {
      const row = element("div", "sort-rule");
      row.append(element("small", "sort-order-label", `${index + 1}순위`));
      const choice = element("select");
      choice.setAttribute("aria-label", `${index + 1}순위 정렬 기준`);
      for (const key of Object.keys(sortChoices)) {
        if (!validSort(key)) continue;
        const item = sortChoices[sortRules(key)[0]];
        if (
          rules.some(
            (other, position) =>
              position !== index && sortChoices[other].field === item.field,
          )
        )
          continue;
        choice.append(new Option(item.label, key));
      }
      choice.value = rule;
      choice.addEventListener("change", () => {
        rules[index] = sortRules(choice.value)[0];
        set(rules.join(","));
        menus[index]?.trigger.focus();
      });
      row.append(choice);
      menus.push(enhanceSelect(choice));
      row.append(
        button(
          "↑",
          `${index + 1}순위 위로`,
          () => move(index, -1),
          index === 0,
        ),
        button(
          "↓",
          `${index + 1}순위 아래로`,
          () => move(index, 1),
          index === rules.length - 1,
        ),
        button(
          "×",
          `${index + 1}순위 삭제`,
          () => {
            if (rules.length > 1) {
              rules.splice(index, 1);
              set(rules.join(","));
            }
          },
          rules.length === 1,
        ),
      );
      root.append(row);
    });
    root.append(
      button(
        "+ 정렬 추가",
        "정렬 기준 추가",
        () => {
          const next = Object.keys(sortChoices).find(
            (key) =>
              validSort(key) &&
              !rules.some(
                (rule) =>
                  sortChoices[rule].field ===
                  sortChoices[sortRules(key)[0]].field,
              ),
          );
          if (next) set([...rules, next].join(","));
        },
        rules.length === 3,
      ),
    );
  }
  set(initial);
  return {
    element: root,
    set,
    get value() {
      return value;
    },
    destroy: () => {
      for (const menu of menus) menu.destroy();
      menus = [];
      root.remove();
    },
  };
}
