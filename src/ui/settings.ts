import type { Preferences } from "../client/preferences.ts";
import { actionButton, element, elementId } from "./dom.ts";

/** 설정 변경은 즉시 적용한다. 첫 연결에서만 시작 버튼을 표시한다. */
export function settingsContent(
  current: Preferences,
  account: string,
  save: (preferences: Preferences) => void,
  start?: () => void,
  connection?: HTMLElement,
  updates?: HTMLElement,
) {
  const root = element("section", "settings-content"),
    draft = { ...current },
    id = elementId("settings");
  const tabs = element("div", "settings-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "설정 카테고리");
  const body = element("div", "settings-panels");
  const categories = [
    { name: "Jira 연결", panel: element("section", "settings-panel") },
    { name: "화면 표시", panel: element("section", "settings-panel") },
    { name: "관리", panel: element("section", "settings-panel") },
  ] as const;
  const buttons = categories.map(({ name, panel }, index) => {
    const button = element("button", "settings-tab", name);
    button.type = "button";
    button.id = `${id}-tab-${index}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", `${id}-panel-${index}`);
    panel.id = `${id}-panel-${index}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", button.id);
    button.addEventListener("click", () => activate(index));
    button.addEventListener("keydown", (event) => {
      const target =
        event.key === "ArrowRight"
          ? (index + 1) % categories.length
          : event.key === "ArrowLeft"
            ? (index + categories.length - 1) % categories.length
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? categories.length - 1
                : -1;
      if (target < 0) return;
      event.preventDefault();
      activate(target);
      buttons[target]?.focus();
    });
    return button;
  });
  function activate(index: number) {
    buttons.forEach((button, current) => {
      button.setAttribute("aria-selected", String(current === index));
      button.tabIndex = current === index ? 0 : -1;
    });
    categories.forEach(({ panel }, current) => {
      panel.hidden = current !== index;
    });
    body.scrollTop = 0;
  }
  const accountState = element("p", "settings-account", account);
  accountState.append(
    element(
      "small",
      "setting-help",
      "Jira에서 확인한 연결 상태예요. 아래 입력값은 연결 확인·저장에 성공한 뒤 반영돼요.",
    ),
  );
  categories[0].panel.append(accountState);
  if (connection) categories[0].panel.append(connection);
  tabs.append(...buttons);
  body.append(...categories.map(({ panel }) => panel));
  root.append(tabs, body);
  activate(start ? 0 : 1);
  for (const [label, help, category, checked, change] of [
    [
      "다크 모드",
      "어두운 배경으로 화면을 표시해요. 이 기기의 브라우저에 선택을 기억해요.",
      1,
      draft.theme === "dark",
      (value: boolean) => {
        draft.theme = value ? "dark" : "light";
      },
    ],
    [
      "개발자 모드",
      "상단에 개발자 로그 버튼을 표시해요. 요청과 응답을 확인할 수 있고, 로그는 저장하지 않아요.",
      2,
      draft.developerMode,
      (value: boolean) => {
        draft.developerMode = value;
      },
    ],
    [
      "간단히 보기",
      "긴 제목을 한 줄로 줄이고, 담당자와 상태를 오른쪽에 유지해요.",
      1,
      draft.compactView,
      (value: boolean) => {
        draft.compactView = value;
      },
    ],
    [
      "완료된 하위 항목 타일로 보기",
      "완료된 서브태스크를 작은 타일로 모아 목록의 스크롤을 줄여요.",
      1,
      draft.compactDone,
      (value: boolean) => {
        draft.compactDone = value;
      },
    ],
    [
      "완료된 상위 항목 타일로 보기",
      "완료된 상위 작업도 타일로 모아요. 하위 작업은 타일을 눌러 상세에서 확인할 수 있어요.",
      1,
      draft.compactDoneParents,
      (value: boolean) => {
        draft.compactDoneParents = value;
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
    check.setAttribute("aria-label", label);
    const description = element("small", "setting-help", help);
    description.id = `${id}-help-${category}-${categories[category].panel.children.length}`;
    check.setAttribute("aria-describedby", description.id);
    const text = element("span", "setting-copy");
    text.append(element("span", "setting-label", label), description);
    row.append(check, text);
    categories[category].panel.append(row);
  }
  if (updates) categories[2].panel.append(updates);
  const actions: HTMLButtonElement[] = [];
  if (start) {
    const button = actionButton("시작하기", "check");
    button.addEventListener("click", start);
    actions.push(button);
  }
  return { element: root, actions };
}
