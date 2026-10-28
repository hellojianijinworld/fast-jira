import type { Preferences } from "../client/preferences.ts";
import { actionButton, element, elementId, uiIcon } from "./dom.ts";

/** 설정 변경은 즉시 적용한다. 첫 연결에서만 시작 버튼을 표시한다. */
export function settingsContent(
  current: Preferences,
  account: string,
  save: (preferences: Preferences) => void,
  start?: () => void,
  connection?: HTMLElement,
  updates?: HTMLElement,
  initialTab: "Jira 연결" | "화면 표시" | "관리" = start
    ? "Jira 연결"
    : "화면 표시",
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
  if (connection) categories[0].panel.append(connection);
  const accountState = element("section", "settings-account");
  accountState.append(
    element("h3", "", "현재 연결"),
    element("p", "", account),
    element(
      "small",
      "setting-help",
      "마지막으로 확인한 연결이에요. 새 정보는 연결 확인 후 반영돼요.",
    ),
  );
  categories[0].panel.append(accountState);
  tabs.append(...buttons);
  body.append(...categories.map(({ panel }) => panel));
  root.append(tabs, body);
  activate(categories.findIndex((category) => category.name === initialTab));
  const displayChoices = [
    [
      "테마",
      draft.theme === "dark" ? 1 : draft.theme === "system" ? 2 : 0,
      [
        ["화이트", ""],
        ["다크", ""],
        ["시스템", ""],
      ],
      (index: number) => {
        draft.theme = index === 2 ? "system" : index === 1 ? "dark" : "light";
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
      "완료된 작업",
      draft.compactDone ? 1 : 0,
      [
        ["목록", "작업을 목록으로 보고 하위 작업을 펼쳐봐요."],
        ["타일", "완료된 작업을 모아 보고 하위 작업은 상세에서 확인해요."],
      ],
      (index: number) => {
        draft.compactDone = index === 1;
      },
    ],
  ] as const;
  displayChoices.forEach(([title, selected, choices, select], groupIndex) => {
    const group = element("fieldset", "setting-group");
    group.append(element("legend", "setting-group-title", title));
    const cards = element("div", "setting-options");
    if (groupIndex === 0) cards.classList.add("setting-theme-options");
    choices.forEach(([label, help], index) => {
      const card = element("label", "setting-option");
      const radio = element("input");
      radio.type = "radio";
      radio.name = `${id}-choice-${groupIndex}`;
      radio.value = String(index);
      radio.checked = selected === index;
      radio.setAttribute("aria-label", `${title} · ${label}`);
      const description = help ? element("small", "setting-help", help) : null;
      if (description) {
        description.id = `${id}-choice-${groupIndex}-${index}-help`;
        radio.setAttribute("aria-describedby", description.id);
      }
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        select(index);
        save({ ...draft });
      });
      const copy = element("span", "setting-option-copy");
      const optionTitle = element("span", "setting-option-title");
      if (groupIndex === 0) {
        const icon = uiIcon(["sun", "moon", "monitor"][index] ?? "sun");
        icon.classList.add("setting-theme-icon");
        optionTitle.append(icon);
      }
      optionTitle.append(document.createTextNode(label));
      copy.append(optionTitle);
      if (description) copy.append(description);
      card.append(radio, copy);
      if (groupIndex > 0) {
        const preview = element(
          "span",
          `setting-preview ${groupIndex === 1 ? "setting-preview-title" : "setting-preview-done"}`,
        );
        preview.dataset.variant = index === 0 ? "list" : "compact";
        preview.setAttribute("aria-hidden", "true");
        preview.append(element("i"), element("i"), element("i"));
        card.append(preview);
      }
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
