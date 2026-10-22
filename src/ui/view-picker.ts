import { viewPresentation } from "../domain/view-labels.ts";
import type {
  ViewBinding,
  ViewDefinition,
  ViewState,
  ViewTarget,
} from "../domain/views.ts";
import { element, uiIcon } from "./dom.ts";
import { enhanceSelect } from "./select-menu.ts";
import { viewSummary } from "./view-editor.ts";

export function createViewPicker(
  state: ViewState,
  target: ViewTarget,
  selected: ViewBinding,
  definition: () => ViewDefinition,
  change: (binding: ViewBinding) => void,
) {
  const root = element("div", "view-picker"),
    select = element("select");
  select.setAttribute("aria-label", "사용할 뷰");
  if (target.kind === "branch")
    select.append(
      new Option(
        viewPresentation(target, { kind: "default" }).label,
        "default",
      ),
    );
  select.append(
    new Option(
      viewPresentation(target, { kind: "inline", definition: definition() })
        .label,
      "inline",
    ),
  );
  for (const view of state.saved)
    select.append(new Option(view.name, `saved:${view.id}`));
  select.value =
    selected.kind === "saved" ? `saved:${selected.viewId}` : selected.kind;
  const help = element("p", "view-help view-selection-help");
  let current = selected;
  function describe() {
    help.textContent = viewPresentation(target, current).help;
  }
  describe();
  root.append(select, help);
  const menu = enhanceSelect(select, {
    renderOption: (option) => {
      const copy = element("span", "select-option-copy");
      const name = element("span", "view-option-name");
      const saved = state.saved.find(
        (view) => `saved:${view.id}` === option.value,
      );
      const binding: ViewBinding = saved
        ? { kind: "saved", viewId: saved.id }
        : option.value === "default"
          ? { kind: "default" }
          : { kind: "inline", definition: definition() };
      const presentation = viewPresentation(target, binding, saved?.name);
      const icon = uiIcon(presentation.icon);
      icon.classList.add("view-option-icon");
      name.append(
        icon,
        element("span", "view-option-title", option.textContent ?? ""),
      );
      const heading = element("span", "view-option-heading");
      heading.append(name);
      if (saved)
        heading.append(element("span", "view-custom-badge", "내가 만든 뷰"));
      copy.append(heading);
      copy.append(
        element(
          "small",
          "",
          saved ? viewSummary(saved.definition) : presentation.help,
        ),
      );
      return copy;
    },
  });
  select.addEventListener("change", () => {
    const value = select.value;
    current =
      value === "default"
        ? { kind: "default" }
        : value === "inline"
          ? { kind: "inline", definition: definition() }
          : { kind: "saved", viewId: value.slice(6) };
    describe();
    change(current);
  });
  return {
    element: root,
    set(binding: ViewBinding) {
      current = binding;
      describe();
      select.value =
        binding.kind === "saved" ? `saved:${binding.viewId}` : binding.kind;
      menu.sync();
    },
    destroy() {
      menu.destroy();
      root.remove();
    },
  };
}
