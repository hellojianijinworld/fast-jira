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
  const displayChoices = [
    [
      "테마",
      draft.theme === "dark" ? 1 : 0,
      [
        ["라이트", "밝은 배경으로 화면을 표시해요."],
        ["다크", "어두운 배경으로 눈부심을 줄여요."],
      ],
      (index: number) => {
        draft.theme = index === 1 ? "dark" : "light";
      },
    ],
    [
      "제목 표시",
      draft.compactView ? 1 : 0,
      [
        ["줄바꿈", "긴 제목을 줄바꿈하고 배지는 오른쪽에 모아요."],
        ["한 줄로", "제목을 한 줄로 표시하고 넘치면 말줄임해요."],
      ],
      (index: number) => {
        draft.compactView = index === 1;
      },
    ],
    [
      "완료된 하위 작업",
      draft.compactDone ? 1 : 0,
      [
        ["목록", "일반 카드로 작업 정보를 보여줘요."],
        ["타일", "작은 타일로 모아 스크롤을 줄여요."],
      ],
      (index: number) => {
        draft.compactDone = index === 1;
      },
    ],
    [
      "완료된 상위 작업",
      draft.compactDoneParents ? 1 : 0,
      [
        ["목록", "목록에서 하위 작업을 펼쳐봐요."],
        ["타일", "타일로 모으고, 하위 작업은 상세에서 봐요."],
      ],
      (index: number) => {
        draft.compactDoneParents = index === 1;
      },
    ],
  ] as const;
  displayChoices.forEach(([title, selected, choices, select], groupIndex) => {
    const group = element("fieldset", "setting-group");
    group.append(element("legend", "setting-group-title", title));
    const cards = element("div", "setting-options");
    choices.forEach(([label, help], index) => {
      const card = element("label", "setting-option");
      const radio = element("input");
      radio.type = "radio";
      radio.name = `${id}-choice-${groupIndex}`;
      radio.value = String(index);
      radio.checked = selected === index;
      radio.setAttribute("aria-label", `${title} · ${label}`);
      const description = element("small", "setting-help", help);
      description.id = `${id}-choice-${groupIndex}-${index}-help`;
      radio.setAttribute("aria-describedby", description.id);
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        select(index);
        save({ ...draft });
      });
      const copy = element("span", "setting-option-copy");
      copy.append(element("span", "setting-option-title", label), description);
      card.append(radio, copy);
      cards.append(card);
    });
    group.append(cards);
    categories[1].panel.append(group);
  });
  if (updates) categories[2].panel.append(updates);
  const actions: HTMLButtonElement[] = [];
  if (start) {
    const button = actionButton("시작하기", "check");
    button.addEventListener("click", start);
    actions.push(button);
  }
  return { element: root, actions };
}
