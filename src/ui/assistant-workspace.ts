import {
  readGlobalSettings,
  updateGlobalSettings,
} from "../client/global-settings.ts";
import type { LocalStore } from "../client/preferences.ts";
import { actionButton, buttonGroup, element, elementId } from "./dom.ts";
import { createSplitPane } from "./split-pane.ts";

type Pane = "chat" | "list" | "detail";
/** 대화 실행과 독립적으로 패널 배치만 바꾼다. 숨겨도 각 화면은 유지한다. */
export function createAssistantWorkspace(
  workspace: HTMLElement,
  storage: LocalStore,
) {
  const elementRoot = element("div", "assistant-workspace"),
    navigation = buttonGroup(element("nav", "assistant-workspace-navigation"), {
      size: "sm",
      wrap: false,
    }),
    body = element("div", "assistant-workspace-body"),
    chatHost = element("aside", "assistant-workspace-chat"),
    splitter = element("div", "splitter assistant-splitter");
  navigation.setAttribute("aria-label", "작업 화면 전환");
  chatHost.setAttribute("aria-label", "AI 대화 패널");
  chatHost.id = elementId("assistant-panel");
  workspace.id ||= elementId("issue-workspace");
  let open = false,
    selected = false,
    pane: Pane = "chat",
    beforeDetail: Pane = "list";
  const buttons = (
    [
      ["chat", "대화", "sparkles"],
      ["list", "목록", "list"],
      ["detail", "상세", "file-text"],
    ] as const
  ).map(([id, label, icon]) => {
    const button = actionButton(label, icon, { variant: "ghost", size: "sm" });
    button.dataset.pane = id;
    button.setAttribute(
      "aria-controls",
      id === "chat" ? chatHost.id : workspace.id,
    );
    button.addEventListener("click", () => {
      if (id === "detail" && pane !== "detail") beforeDetail = pane;
      pane = id;
      render();
    });
    navigation.append(button);
    return button;
  });
  body.append(chatHost, splitter, workspace);
  elementRoot.append(navigation, body);
  function render() {
    const mobile = elementRoot.clientWidth <= 600;
    // 목록과 상세를 함께 읽기 어려운 폭에서는 한 화면씩 전환한다.
    const compact =
      open &&
      workspace.clientWidth <
        48 * parseFloat(getComputedStyle(document.documentElement).fontSize);
    elementRoot.dataset.chatOpen = String(open);
    elementRoot.dataset.mobile = String(mobile);
    elementRoot.dataset.compact = String(compact);
    elementRoot.dataset.pane = pane;
    workspace.classList.toggle("assistant-single-pane", compact);
    workspace.dataset.pane = pane === "detail" && selected ? "detail" : "list";
    navigation.hidden = !open || (!compact && !mobile);
    for (const button of buttons) {
      const id = button.dataset.pane;
      button.hidden = id === "chat" && !mobile;
      button.disabled = id === "detail" && !selected;
      button.setAttribute(
        "aria-pressed",
        String(id === (mobile ? pane : workspace.dataset.pane)),
      );
    }
  }
  let frame = 0;
  const resize = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  });
  resize.observe(elementRoot);
  resize.observe(workspace);
  const split = createSplitPane(
    body,
    splitter,
    matchMedia("(max-width: 600px)"),
    storage,
    {
      label: "AI 대화와 작업 영역 너비",
      defaultRatio: 0.34,
      readRatio: () => readGlobalSettings(storage).layout.assistantRatio,
      saveRatio: (assistantRatio) => {
        updateGlobalSettings(storage, { layout: { assistantRatio } });
      },
      disabled: () => !open || elementRoot.clientWidth <= 600,
    },
  );
  render();
  return {
    element: elementRoot,
    chatHost,
    get chatOpen() {
      return open;
    },
    setChatOpen(value: boolean) {
      if (value && elementRoot.clientWidth <= 600) pane = "chat";
      open = value;
      render();
      split.refresh();
    },
    setDetailSelected(value: boolean) {
      selected = value;
      if (value) {
        if (pane !== "detail") beforeDetail = pane;
        pane = "detail";
      } else if (pane === "detail") pane = beforeDetail;
      render();
    },
    destroy() {
      cancelAnimationFrame(frame);
      resize.disconnect();
      split.destroy();
    },
  };
}
