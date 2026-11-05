import {
  type createActionCatalog,
  shortcutAria,
  shortcutLabel,
} from "../domain/commands.ts";
import { element, uiIcon } from "./dom.ts";

export function bindActionButton(
  button: HTMLButtonElement,
  id: string,
  catalog: ReturnType<typeof createActionCatalog>,
  onError: (error: unknown) => void,
) {
  function refresh() {
    const action = catalog.all().find((action) => action.id === id);
    button.hidden = !action;
    button.disabled = !action || action.enabled === false;
    button.removeAttribute("aria-keyshortcuts");
    if (!action) return;
    button.setAttribute("aria-label", action.menuLabel ?? action.label);
    button.replaceChildren(
      uiIcon(action.icon),
      element("span", "", action.menuLabel ?? action.label),
    );
    if (action.shortcut) {
      button.setAttribute(
        "aria-keyshortcuts",
        shortcutAria(navigator.platform, action.shortcut),
      );
      const key = document.createElement("kbd");
      key.textContent = shortcutLabel(navigator.platform, action.shortcut);
      button.append(key);
    }
  }
  button.addEventListener("click", () => {
    void catalog.execute(id).catch(onError);
  });
  refresh();
  return refresh;
}
