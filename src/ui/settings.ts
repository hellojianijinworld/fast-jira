import type { Preferences } from "../client/preferences.ts";
import { actionButton, element } from "./dom.ts";

/** 설정 변경은 즉시 적용한다. 첫 연결에서만 시작 버튼을 표시한다. */
export function settingsContent(
  current: Preferences,
  account: string,
  save: (preferences: Preferences) => void,
  start?: () => void,
) {
  const root = element("section", "settings-content"),
    draft = { ...current };
  root.append(element("p", "settings-account", account));
  for (const [label, checked, change] of [
    [
      "다크 모드",
      draft.theme === "dark",
      (value: boolean) => {
        draft.theme = value ? "dark" : "light";
      },
    ],
    [
      "개발자 모드",
      draft.developerMode,
      (value: boolean) => {
        draft.developerMode = value;
      },
    ],
    [
      "간단히 보기",
      draft.compactView,
      (value: boolean) => {
        draft.compactView = value;
      },
    ],
  ] as const) {
    const row = element("label", "setting-row"),
      check = element("input");
    check.type = "checkbox";
    check.checked = checked;
    check.addEventListener("change", () => {
      change(check.checked);
      save({ ...draft });
    });
    row.append(check, document.createTextNode(label));
    root.append(row);
  }
  root.append(
    element(
      "p",
      "empty",
      "개발자 모드를 켜면 상단에 로그 버튼이 표시돼요. 로그 내용은 저장하지 않아요.",
    ),
  );
  const actions: HTMLButtonElement[] = [];
  if (start) {
    const button = actionButton("시작하기", "check");
    button.addEventListener("click", start);
    actions.push(button);
  }
  return { element: root, actions };
}
