import { createChatQueue } from "../client/chat-queue.ts";
import { createMentionSource } from "../client/mention-source.ts";
import { executionReport } from "../domain/assistant-execution.ts";
import type { IssueDraft } from "../domain/create-issue.ts";
import { mentionPrompt } from "../domain/mention.ts";
import { textareaMentions } from "./mention-editors.ts";
import "./command-palette.css";
import { type Api, ApiError, subscribeVoice } from "../client/api.ts";
import {
  createCodexVoice,
  type VoiceCallbacks,
  type VoiceInput,
} from "../client/codex-voice.ts";
import {
  type ConversationStore,
  createConversationStore,
} from "../client/conversation-store.ts";
import type { LocalStore } from "../client/preferences.ts";
import type { ChangeProposal } from "../domain/agent.ts";
import type {
  AssistantContext,
  AssistantModel,
  AssistantProgress,
  AssistantProviderStatus,
} from "../domain/assistant.ts";
import type { BulkResult } from "../domain/bulk.ts";
import {
  type ChatFollowupMode,
  type ChatSendMode,
  chatKeyboardAction,
  chatShortcutHints,
} from "../domain/chat-input.ts";
import {
  type CommandId,
  commandForShortcut,
  shortcutLabel as formatShortcut,
  matchingCommands,
} from "../domain/commands.ts";
import {
  type ChatMessage,
  type Conversation,
  conversationContext,
  conversationMarkdown,
} from "../domain/conversation.ts";
import type { Issue } from "../domain/issue.ts";
import { createAssistantApprovalPanel } from "./assistant-approvals.ts";
import { chatError, chatEvent, chatMessage } from "./chat-message.ts";
import { createChatSidebar } from "./chat-sidebar.ts";
import { copyText } from "./clipboard.ts";
import {
  actionButton,
  buttonGroup,
  element,
  elementId,
  iconButton,
  uiIcon,
} from "./dom.ts";
import { createFaqDialog } from "./faq.ts";
import { popoverPosition } from "./geometry.ts";
import type { CardOptions } from "./issue-card.ts";
import { createSearchDialog } from "./search-dialog.ts";

type Mode = "search" | "ai";
const fields = {
  parent: "부모",
  status: "상태",
  assignee: "담당자",
  dueDate: "마감일",
  priority: "우선순위",
};
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "요청에 실패했어요.";
/** 검색·대화 UI만 관리한다. 조회와 변경 후 목록 처리는 주입된 기존 API와 콜백을 쓴다. */
export function createCommandPalette(config: {
  host: HTMLElement;
  chatHost?: HTMLElement;
  chatVisibility?: (open: boolean) => void;
  api: Pick<
    Api,
    | "issues"
    | "lookup"
    | "assistantStatus"
    | "assistantControl"
    | "assistantRun"
    | "assistantApprovals"
    | "approveAssistant"
    | "bulkOptions"
    | "bulkUpdate"
    | "bulkUndo"
    | "voiceStart"
    | "voiceStop"
  > &
    Partial<Pick<Api, "users" | "mentionUsers">>;
  site: string;
  currentUserId?: string;
  context: () => AssistantContext;
  recent: () => readonly Issue[];
  localIssues: () => readonly Issue[];
  order: () => readonly string[];
  favorites?: CardOptions["favorites"];
  create?: (draft?: IssueDraft) => void;
  select: (key: string) => void;
  changed: (issues: Issue[]) => Promise<void>;
  canMutate: () => boolean;
  notice: (message: string, undo?: () => Promise<void>) => void;
  noticeHost?: HTMLElement;
  restoreNotice?: () => void;
  voice?: (callbacks: VoiceCallbacks) => VoiceInput;
  aiAvailable?: () => boolean;
  voiceAvailable?: () => boolean;
  storage?: LocalStore;
  scope?: string;
  unread?: (value: boolean) => void;
}) {
  const dialog = element("dialog", "command-modal ai-modal is-chat"),
    head = element("div", "command-head"),
    title = element("h2", "", "AI 대화"),
    close = iconButton("명령창 닫기", "x"),
    historyToggle = iconButton("대화 목록", "history", { size: "sm" }),
    pickerDialog = element("dialog", "command-modal command-picker-modal"),
    pickerHead = element("div", "command-head"),
    pickerTitle = element("h2", "", "명령 팔레트"),
    pickerClose = iconButton("명령 팔레트 닫기", "x"),
    picker = element("section", "command-picker"),
    commandQuery = element("input"),
    commandMenu = element("div", "command-menu"),
    panel = element("section", "command-panel"),
    form = element("form", "command-form"),
    input = element("textarea"),
    controls = buttonGroup(element("div", "command-controls"), { size: "sm" }),
    model = element("select", "command-model"),
    effortSelect = element("select", "command-effort"),
    microphone = iconButton("음성 입력", "mic"),
    send = actionButton("보내기", "arrow-up", "primary"),
    cancel = iconButton("답변 중단", "square"),
    pendingHost = element("section", "chat-queue"),
    followupField = element("fieldset", "setting-group ai-chat-setting-group"),
    followupHint = element("small", "view-help"),
    shortcutHint = element("div", "chat-input-shortcuts"),
    followupKeys = element("small", "view-help"),
    chatLayout = element("div", "chat-layout"),
    chatMain = element("div", "chat-main"),
    transcript = element("div", "chat-transcript"),
    transcriptRegion = element("div", "chat-transcript-region"),
    latestMessage = iconButton("최신 메시지로", "arrow-up", { size: "sm" }),
    helpToggle = iconButton("AI 대화 도움말", "circle-help", { size: "sm" }),
    helpPanel = element("div", "select-options ai-chat-help"),
    settingsToggle = iconButton("AI 대화 설정", "settings", { size: "sm" }),
    settingsPanel = element(
      "div",
      "select-options ai-chat-help ai-chat-settings",
    ),
    heading = buttonGroup(element("div", "command-heading"), {
      size: "sm",
      compact: true,
      wrap: false,
    }),
    headActions = buttonGroup(element("div", "command-heading"), {
      size: "sm",
      compact: true,
      wrap: false,
    }),
    sendGroup = element("div", "chat-send-group"),
    sendModeField = element("fieldset", "setting-group ai-chat-setting-group"),
    welcome = element("div", "chat-welcome"),
    provider = element("span", "chat-provider", "Codex"),
    capabilities = element("details", "chat-capabilities"),
    policy = element("details", "command-policy"),
    policyBody = element("div", "chat-policy-content"),
    status = element("p", "command-status"),
    aiResults = element("div", "command-results");
  let completionEffect: ReturnType<typeof setTimeout> | undefined;
  function setAiState(
    state: "idle" | "working" | "waiting" | "complete" | "error",
  ) {
    clearTimeout(completionEffect);
    dialog.dataset.aiState = state;
    if (state === "complete")
      completionEffect = setTimeout(() => {
        dialog.dataset.aiState = "idle";
      }, 900);
  }
  setAiState("idle");
  let conversations: Conversation[] = [],
    current: Conversation | undefined,
    storageError = "";
  let historyStore: ConversationStore | undefined;
  if (config.storage && config.scope) {
    historyStore = createConversationStore(config.storage, config.scope);
    try {
      conversations = historyStore.read();
    } catch (error) {
      storageError = errorText(error);
    }
  }
  let defaultModel = historyStore?.defaultModel() ?? "";
  let sendMode: ChatSendMode = historyStore?.sendMode() ?? "enter";
  let followupMode: ChatFollowupMode = historyStore?.followupMode() ?? "queue";
  const queue = createChatQueue();
  let reportedStorageError = "";
  const sidebar = createChatSidebar({
    copy: (item) => {
      const text = conversationMarkdown(item);
      if (text) void copyText(text, notify, "대화 내용을 복사했어요.");
    },
    create: () => {
      closeHistory();
      if (!busy && !steering && !stopping && !applying && !recording)
        newConversation();
    },
    choose: (item) => {
      closeHistory();
      if (busy || steering || stopping || applying || recording) return;
      setAiState("idle");
      current = item;
      conversationId = item.conversationId;
      selectedModel = item.model;
      selectedEffort =
        item.effort ?? historyStore?.defaultEffort(item.model) ?? "";
      if ([...model.options].some((option) => option.value === selectedModel))
        model.value = selectedModel;
      input.value = "";
      renderConversation();
      status.textContent = "";
      sync();
      input.focus({ preventScroll: true });
      revealLatest();
    },
    remove: (id) => {
      if (busy || steering || stopping || applying || recording) return;
      try {
        conversations = historyStore
          ? historyStore.remove(id)
          : conversations.filter((item) => item.id !== id);
      } catch (error) {
        storageError = errorText(error);
        sync();
        return;
      }
      queue.clear(id);
      if (current?.id === id) newConversation();
      else sync();
    },
  });
  welcome.append(
    element("h3", "", "어떤 작업을 도와드릴까요?"),
    element(
      "p",
      "",
      "연결된 업무 자료와 코드를 찾거나 변경할 내용을 이야기해 주세요.",
    ),
  );
  transcript.append(welcome, aiResults, status);
  transcript.setAttribute("aria-label", "대화 내용");
  aiResults.setAttribute("role", "log");
  aiResults.setAttribute("aria-live", "polite");
  latestMessage.classList.add("chat-latest-message");
  latestMessage.hidden = true;
  latestMessage.addEventListener("click", scrollConversation);
  transcriptRegion.append(transcript, latestMessage);
  chatMain.append(transcriptRegion, form);
  chatLayout.append(sidebar.root, chatMain);
  capabilities.append(element("summary", "", "연결 및 지원 상태"));
  commandQuery.placeholder = "명령 검색…";
  commandQuery.setAttribute("aria-label", "명령 검색");
  commandQuery.setAttribute("aria-controls", elementId("command-options"));
  commandMenu.id = commandQuery.getAttribute("aria-controls") ?? "";
  picker.append(commandQuery, commandMenu);
  title.id = elementId("command-title");
  dialog.setAttribute("aria-labelledby", title.id);
  pickerTitle.id = elementId("palette-title");
  pickerDialog.setAttribute("aria-labelledby", pickerTitle.id);
  pickerHead.append(pickerTitle, pickerClose);
  pickerDialog.append(pickerHead, picker);
  pickerClose.addEventListener("click", () => pickerDialog.close());
  send.setAttribute("aria-label", "요청 보내기");
  model.setAttribute("aria-label", "대화 모델");
  effortSelect.setAttribute("aria-label", "추론 강도");
  effortSelect.hidden = true;
  model.title = "이 대화의 모델 · 선택한 모델을 새 대화 기본값으로 저장합니다";
  model.append(element("option", "", "연결 확인 중…"));
  shortcutHint.id = elementId("chat-input-shortcuts");
  input.setAttribute("aria-describedby", shortcutHint.id);
  input.setAttribute("aria-label", "AI 메시지");
  input.maxLength = 10000;
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  send.type = "submit";
  historyToggle.hidden = !config.chatHost;
  heading.append(historyToggle, title, helpToggle, settingsToggle);
  headActions.append(close);
  head.append(heading, headActions);
  sendModeField.setAttribute("aria-label", "메시지 보내기 방식");
  followupField.setAttribute("aria-label", "답변 중 추가 요청");
  const sendShortcut = /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘Enter"
    : "Ctrl+Enter";
  function settingChoices(
    group: HTMLFieldSetElement,
    title: string,
    selected: string,
    choices: [string, string, string, string][],
  ) {
    group.append(element("legend", "setting-group-title", title));
    const cards = element("div", "setting-options");
    const name = elementId("chat-setting");
    for (const [value, label, icon, help] of choices) {
      const card = element("label", "setting-option"),
        radio = element("input"),
        copy = element("span", "setting-option-copy"),
        heading = element("span", "setting-option-title", label);
      radio.type = "radio";
      radio.name = name;
      radio.value = value;
      radio.checked = value === selected;
      radio.setAttribute("aria-label", `${title} · ${label}`);
      heading.append(uiIcon(icon));
      copy.append(heading, element("small", "view-help", help));
      card.append(radio, copy);
      cards.append(card);
    }
    group.append(cards);
  }
  settingChoices(followupField, "답변 중 추가 요청", followupMode, [
    ["queue", "대기열에 추가", "list-plus", "답변이 끝나면 이어서 보내요."],
    ["steer", "즉시 전달", "play", "답변 중인 AI에 바로 전달해요."],
  ]);
  settingChoices(sendModeField, "메시지 보내기", sendMode, [
    ["enter", "Enter로 보내기", "arrow-up", "Shift+Enter로 줄바꿈"],
    ["shortcut", `${sendShortcut}로 보내기`, "arrow-up", "Enter로 줄바꿈"],
  ]);
  followupField.append(followupHint, followupKeys);
  settingsPanel.append(
    element("h3", "", "전송 설정"),
    followupField,
    sendModeField,
  );
  sendGroup.append(send);

  controls.append(
    provider,
    model,
    effortSelect,
    shortcutHint,
    microphone,
    cancel,
    sendGroup,
  );
  pendingHost.setAttribute("aria-label", "대기 중인 요청");
  pendingHost.setAttribute("aria-live", "polite");
  form.append(pendingHost, input, controls);
  policy.replaceChildren(element("summary", "", "대화 보관 안내"), policyBody);
  panel.append(chatLayout);
  helpPanel.popover = "auto";
  helpPanel.tabIndex = -1;
  helpPanel.setAttribute("role", "dialog");
  helpPanel.setAttribute("aria-label", "AI 대화 도움말");
  helpPanel.id = elementId("ai-help");
  helpToggle.setAttribute("aria-haspopup", "dialog");
  helpToggle.setAttribute("aria-controls", helpPanel.id);
  helpToggle.setAttribute("aria-expanded", "false");
  function helpFacts(rows: [string, string][]) {
    const list = element("dl", "chat-help-facts");
    for (const [label, text] of rows) {
      const row = element("div");
      row.append(element("dt", "", label), element("dd", "", text));
      list.append(row);
    }
    return list;
  }
  function helpOverview() {
    const overview = element("div", "chat-help-overview");
    for (const [icon, title, text] of [
      [
        "sparkles",
        "작업을 말로 요청해요",
        "이슈를 찾거나 변경할 내용을 이야기해 주세요.",
      ],
      [
        "check",
        "변경 전에는 확인해요",
        "AI가 제안한 내용을 확인하고 적용할 수 있어요.",
      ],
      [
        "list-plus",
        "답변 중에도 요청할 수 있어요",
        "대기열·즉시 전달과 전송 키는 옆 톱니바퀴에서 바꿔요.",
      ],
    ] as const) {
      const row = element("div", "chat-help-overview-row"),
        copy = element("div");
      copy.append(element("strong", "", title), element("p", "", text));
      row.append(uiIcon(icon), copy);
      overview.append(row);
    }
    return overview;
  }
  helpPanel.append(
    element("h3", "", "AI 대화 도움말"),
    helpOverview(),
    policy,
    capabilities,
  );
  settingsPanel.popover = "auto";
  settingsPanel.tabIndex = -1;
  settingsPanel.setAttribute("role", "dialog");
  settingsPanel.setAttribute("aria-label", "AI 대화 설정");
  settingsPanel.id = elementId("ai-settings");
  settingsToggle.setAttribute("aria-haspopup", "dialog");
  settingsToggle.setAttribute("aria-controls", settingsPanel.id);
  settingsToggle.setAttribute("aria-expanded", "false");
  dialog.append(head, panel, helpPanel, settingsPanel);
  let settingsAnchor: HTMLElement = settingsToggle;
  function closeSettings() {
    if (settingsPanel.matches(":popover-open")) settingsPanel.hidePopover();
  }
  function openSendSettings(anchor: HTMLElement) {
    if (settingsPanel.matches(":popover-open")) {
      closeSettings();
      return;
    }
    settingsAnchor = anchor;
    closeHelp();
    Object.assign(
      settingsPanel.style,
      popoverPosition(anchor.getBoundingClientRect(), {
        width: 420,
        maxHeight: Math.min(560, innerHeight - 24),
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      }),
    );
    settingsPanel.showPopover();
    followupField.querySelector<HTMLInputElement>("input:checked")?.focus();
  }
  settingsToggle.addEventListener("click", () =>
    openSendSettings(settingsToggle),
  );
  settingsPanel.addEventListener("toggle", () => {
    settingsToggle.setAttribute(
      "aria-expanded",
      String(settingsPanel.matches(":popover-open")),
    );
  });
  settingsPanel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSettings();
      settingsAnchor.focus();
    }
  });
  function closeHelp() {
    if (helpPanel.matches(":popover-open")) helpPanel.hidePopover();
  }
  helpToggle.addEventListener("click", () => {
    if (helpPanel.matches(":popover-open")) {
      closeHelp();
      return;
    }
    closeSettings();
    Object.assign(
      helpPanel.style,
      popoverPosition(helpToggle.getBoundingClientRect(), {
        width: 420,
        maxHeight: 460,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      }),
    );
    helpPanel.showPopover();
    helpPanel.focus();
  });
  helpPanel.addEventListener("toggle", () =>
    helpToggle.setAttribute(
      "aria-expanded",
      String(helpPanel.matches(":popover-open")),
    ),
  );
  helpPanel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeHelp();
      helpToggle.focus();
    }
  });
  sendModeField.addEventListener("change", (event) => {
    sendMode =
      (event.target as HTMLInputElement).value === "shortcut"
        ? "shortcut"
        : "enter";
    try {
      historyStore?.setSendMode(sendMode);
    } catch (error) {
      notify(errorText(error));
    }
    sync();
  });
  followupField.addEventListener("change", (event) => {
    followupMode =
      (event.target as HTMLInputElement).value === "steer" ? "steer" : "queue";
    try {
      historyStore?.setFollowupMode(followupMode);
    } catch (error) {
      notify(errorText(error));
    }
    sync();
  });
  let historyResize: ResizeObserver | undefined;
  if (config.chatHost) {
    dialog.classList.add("is-docked");
    close.setAttribute("aria-label", "AI 대화 닫기");
    close.title = "AI 대화 닫기";
    config.chatHost.append(dialog);
    sidebar.root.popover = "auto";
    sidebar.root.classList.add("chat-history-popover", "popover-surface");
    sidebar.root.id = elementId("chat-history");
    historyToggle.setAttribute("aria-haspopup", "dialog");
    historyToggle.setAttribute("aria-controls", sidebar.root.id);
    historyToggle.setAttribute("aria-expanded", "false");
    historyToggle.addEventListener("click", () => {
      if (sidebar.root.matches(":popover-open")) closeHistory();
      else {
        sidebar.root.showPopover();
        Object.assign(
          sidebar.root.style,
          popoverPosition(historyToggle.getBoundingClientRect(), {
            width: sidebar.root.offsetWidth,
            maxHeight: Math.min(480, innerHeight * 0.7),
            viewportWidth: innerWidth,
            viewportHeight: innerHeight,
          }),
        );
      }
    });
    sidebar.root.addEventListener("toggle", () =>
      historyToggle.setAttribute(
        "aria-expanded",
        String(sidebar.root.matches(":popover-open")),
      ),
    );
    let inlineHistory = false;
    historyResize = new ResizeObserver(() => {
      // 목록 14rem과 대화 본문 38rem을 함께 확보할 때만 나란히 둔다.
      const wide =
        dialog.clientWidth >=
        52 * parseFloat(getComputedStyle(document.documentElement).fontSize);
      if (wide === inlineHistory) return;
      closeHistory();
      inlineHistory = wide;
      sidebar.root.classList.toggle("chat-history-inline", wide);
      sidebar.root.classList.toggle("chat-history-popover", !wide);
      historyToggle.hidden = wide;
      for (const property of ["left", "top", "width", "max-height"])
        sidebar.root.style.removeProperty(property);
      if (wide) sidebar.root.removeAttribute("popover");
      else sidebar.root.popover = "auto";
    });
    historyResize.observe(dialog);
  } else config.host.append(dialog);
  config.host.append(pickerDialog);
  function closeHistory() {
    if (sidebar.root.matches(":popover-open")) sidebar.root.hidePopover();
  }
  function selectIssue(key: string) {
    if (!config.chatHost) dialog.close();
    config.select(key);
  }
  const faqDialog = createFaqDialog(config.host);
  let alive = true,
    busy = false,
    steering = false,
    stopping = false,
    applying = false,
    conversationId = "",
    voicePrefix = "",
    recording = false,
    selectedModel = "",
    selectedEffort = "",
    ready = false,
    loadingModels = false;
  let providerStates: AssistantProviderStatus[] = [];
  let modelCatalog: AssistantModel[] = [];
  let request: AbortController | undefined;
  let activeRequestId = "";
  let noticeParent: HTMLElement | null = null;
  function restoreNotice(modal: HTMLDialogElement) {
    if (config.noticeHost?.parentElement === modal) {
      (noticeParent?.isConnected ? noticeParent : config.host).append(
        config.noticeHost,
      );
      noticeParent = null;
    }
    config.restoreNotice?.();
  }
  function notify(message: string, undo?: () => Promise<void>) {
    const modal = searchDialog.dialog.open ? searchDialog.dialog : dialog;
    if (
      modal.open &&
      !(config.chatHost && modal === dialog) &&
      config.noticeHost &&
      config.noticeHost.parentElement !== modal
    ) {
      noticeParent = config.noticeHost.parentElement;
      modal.append(config.noticeHost);
    }
    config.notice(message, undo);
  }
  const searchDialog = createSearchDialog({
    host: config.host,
    api: config.api,
    site: config.site,
    currentUserId: config.currentUserId ?? "",
    recent: config.recent,
    localIssues: config.localIssues,
    order: config.order,
    ...(config.favorites ? { favorites: config.favorites } : {}),
    select: config.select,
    copied: notify,
    closed: () => restoreNotice(searchDialog.dialog),
  });
  const voiceCallbacks = {
    transcript(text: string) {
      input.value =
        `${voicePrefix}${voicePrefix && text ? " " : ""}${text}`.slice(
          0,
          10000,
        );
    },
    state(active: boolean, message: string) {
      recording = active;
      microphone.classList.toggle("active", active);
      microphone.setAttribute("aria-pressed", String(active));
      microphone.setAttribute(
        "aria-label",
        active ? "음성 입력 중지" : "음성 입력",
      );
      microphone.title = active ? "음성 입력 중지" : "음성 입력";
      input.readOnly = active;
      sync();
      if (message) notify(message);
    },
  };
  const voice = config.voice
    ? config.voice(voiceCallbacks)
    : createCodexVoice({
        api: config.api,
        subscribe: subscribeVoice,
        ...voiceCallbacks,
      });
  const mentionSource = createMentionSource(config.api, {
    site: config.site,
    projects: () => config.context().projects,
    issue: () => config.context().issue,
    local: config.localIssues,
  });
  const mentions = textareaMentions(input, mentionSource, {
    select: selectIssue,
  });

  let awaitingApproval = false;
  const approvalPanel = createAssistantApprovalPanel(
    config.api,
    (waiting) => {
      if (!alive) return;
      awaitingApproval = waiting;
      if (busy) setAiState(stopping ? "idle" : waiting ? "waiting" : "working");
      dialog.classList.toggle("awaiting-approval", waiting);
      if (waiting) {
        hideThinking();
        status.textContent = "";
        if (!dialog.open || !dialog.getClientRects().length)
          config.unread?.(true);
        else scrollConversation();
      } else if (busy) {
        showThinking();
        if (dialog.open) scrollConversation();
      }
    },
    (approval, answer) => {
      if (!current) return;
      const text = `${approval.title} · ${answer.feedback ? "의견을 전달했어요" : answer.response || (answer.approved ? "승인했어요" : "건너뛰었어요")}`;
      const details = [approval.description, approval.details, answer.feedback]
        .filter(Boolean)
        .join("\n\n");
      const created = Date.now();
      current.messages.push({ role: "event", text, details, created });
      aiResults.append(chatEvent({ text, details, created }));
      saveConversation();
      if (dialog.open) scrollConversation();
    },
    {
      voice: (callbacks) =>
        config.voice
          ? config.voice(callbacks)
          : createCodexVoice({
              api: config.api,
              subscribe: subscribeVoice,
              ...callbacks,
            }),
      ...(config.voiceAvailable
        ? { voiceAvailable: config.voiceAvailable }
        : {}),
      mentions: mentionSource,
      selectIssue,
      notice: notify,
    },
  );
  transcript.insertBefore(approvalPanel.element, status);
  function renderQueue() {
    const id = current?.id ?? "",
      messages = queue.list(id);
    pendingHost.hidden = messages.length === 0;
    pendingHost.replaceChildren();
    if (!messages.length) return;
    const heading = element("div", "chat-queue-heading");
    heading.append(
      element(
        "small",
        "",
        `대기 중 ${messages.length}개${queue.paused(id) ? " · 일시정지" : ""}`,
      ),
    );
    if (queue.paused(id) && !busy) {
      const resume = actionButton("계속 보내기", "play", {
        size: "sm",
        variant: "ghost",
      });
      resume.addEventListener("click", () => {
        queue.resume(id);
        void drainQueue();
      });
      heading.append(resume);
    }
    pendingHost.append(heading);
    for (const message of messages) {
      const row = element("div", "chat-queue-row"),
        edit = element("button", "chat-queue-text", message.text),
        now = iconButton("지금 보내기", "arrow-up", { size: "sm" }),
        remove = iconButton("대기 요청 삭제", "x", { size: "sm" });
      edit.type = "button";
      edit.title = message.text;
      edit.setAttribute("aria-label", `대기 요청 수정: ${message.text}`);
      edit.disabled = Boolean(input.value.trim()) || steering || stopping;
      edit.addEventListener("click", () => {
        mentions.restore(message.text, message.mentions);
        queue.remove(id, message.id);
        sync();
        input.focus();
      });
      now.disabled = steering || stopping || applying;
      now.addEventListener(
        "click",
        () => void sendImmediately(message.text, message.id, message.mentions),
      );
      remove.addEventListener("click", () => {
        queue.remove(id, message.id);
        sync();
      });
      row.append(edit, now, remove);
      pendingHost.append(row);
    }
  }
  async function drainQueue() {
    if (
      !alive ||
      busy ||
      stopping ||
      steering ||
      applying ||
      recording ||
      !current ||
      !ready ||
      model.selectedOptions[0]?.disabled
    )
      return;
    const message = queue.take(current.id);
    if (message) await ask(message.text, followupMode, message.mentions ?? []);
    else sync();
  }
  async function sendImmediately(
    prompt: string,
    queuedId?: number,
    references = mentions.references(prompt),
  ) {
    if (
      !current ||
      steering ||
      stopping ||
      applying ||
      recording ||
      !ready ||
      model.selectedOptions[0]?.disabled
    )
      return;
    const active = current;
    steering = true;
    sync();
    try {
      if (busy && !selectedModel.startsWith("claude:")) {
        await config.api.assistantControl(
          activeRequestId,
          "steer",
          mentionPrompt(prompt, references),
        );
        active.messages.push({
          role: "user",
          text: prompt,
          ...(references.length
            ? { mentions: structuredClone(references) }
            : {}),
        });
        aiResults.append(
          renderMessage("user", prompt, selectedModel, {
            mentions: references,
          }),
        );
        saveConversation();
        scrollConversation();
      } else {
        if (busy && !(await stopRequest()))
          throw new Error("중단 결과를 확인하지 못했어요.");
        queue.resume(active.id);
        steering = false;
        void ask(prompt, followupMode, references);
      }
      if (queuedId !== undefined) queue.remove(active.id, queuedId);
      if (input.value.trim() === prompt) input.value = "";
    } catch (error) {
      if (queuedId === undefined) queue.add(active.id, prompt, references);
      if (input.value.trim() === prompt) input.value = "";
      notify(`${errorText(error)} 요청은 대기열에 남겨뒀어요.`);
    } finally {
      steering = false;
      sync();
      if (!busy) void drainQueue();
    }
  }
  function sync() {
    mentions.refresh();
    microphone.hidden = config.voiceAvailable
      ? !config.voiceAvailable() && !recording
      : false;
    input.rows = 3;
    input.placeholder = current?.messages.length
      ? "메시지를 입력하세요"
      : "어떤 작업을 도와드릴까요?";
    model.disabled =
      busy || steering || stopping || loadingModels || applying || recording;
    syncEffort();
    effortSelect.disabled = model.disabled;
    sendModeField.disabled = applying || recording;
    followupField.disabled = applying || recording;
    send.disabled =
      applying ||
      steering ||
      stopping ||
      recording ||
      !ready ||
      model.selectedOptions[0]?.disabled === true;
    cancel.hidden = !busy;
    cancel.disabled = stopping;
    send.replaceChildren(
      uiIcon(
        busy
          ? followupMode === "queue"
            ? "list-plus"
            : "arrow-up"
          : "arrow-up",
      ),
      document.createTextNode(
        busy
          ? followupMode === "queue"
            ? "대기열에 추가"
            : "즉시 전달"
          : "보내기",
      ),
    );
    followupHint.textContent = selectedModel.startsWith("claude:")
      ? "Claude의 즉시 전달은 현재 답변을 중단한 뒤 이어서 보내요."
      : "즉시 전달하면 답변 중인 AI에 지시를 추가해요.";
    renderQueue();
    const isClaude = selectedModel.startsWith("claude:");
    provider.textContent = isClaude ? "Claude" : "Codex";
    model.title = [
      model.selectedOptions[0]?.textContent,
      "선택한 모델을 새 대화 기본값으로 저장합니다",
    ]
      .filter(Boolean)
      .join("\n");
    const voiceUnavailable = config.voiceAvailable
      ? !config.voiceAvailable()
      : isClaude;
    microphone.disabled = busy || applying || voiceUnavailable;
    microphone.title = recording
      ? "음성 입력 중지"
      : voiceUnavailable
        ? "음성 입력 연결을 확인해 주세요."
        : "Codex 로그인으로 음성 입력";
    form.setAttribute("aria-busy", String(busy));
    welcome.hidden = aiResults.childElementCount > 0;
    provider.dataset.state = ready
      ? "ready"
      : loadingModels
        ? "loading"
        : "offline";
    sidebar.render(
      conversations,
      current?.id ?? "",
      busy || steering || stopping || applying || recording,
    );
    policyBody.replaceChildren(
      ...(storageError
        ? [element("p", "error", storageError)]
        : [
            helpFacts([
              [
                "저장",
                historyStore
                  ? "이 브라우저에 보관해요. 왼쪽 대화 목록에서 다시 열 수 있어요."
                  : "현재 화면에서만 보관해요.",
              ],
              [
                "삭제",
                "대화 목록에서 직접 지울 수 있어요. 브라우저 데이터를 지우면 기록도 사라져요.",
              ],
              ["대기열", "창을 닫아도 남아요. 페이지를 새로고침하면 지워져요."],
            ]),
          ]),
    );
    if (storageError) policy.open = true;
    if (storageError && storageError !== reportedStorageError)
      notify(storageError);
    reportedStorageError = storageError;
    helpToggle.classList.toggle("error", Boolean(storageError));
    policy.classList.toggle("error", Boolean(storageError));
    const keys = chatShortcutHints(
      sendMode,
      followupMode,
      busy,
      /Mac|iPhone|iPad/.test(navigator.platform),
    );
    shortcutHint.textContent = keys.composer;
    followupKeys.textContent = `답변 중: ${keys.followup}`;
    send.title = keys.composer;
  }
  async function loadModels() {
    if (ready || loadingModels) return;
    loadingModels = true;
    sync();
    status.textContent = "";
    try {
      const state = await config.api.assistantStatus();
      if (!alive) return;
      ready = state.ready && state.models.length > 0;
      providerStates = state.providers ?? [];
      modelCatalog = state.models;
      const options = state.models.map((item) => {
        const label = item.name.replace(/^(?:Codex|Claude)\s*·\s*/, "");
        const option = element("option", "", label);
        option.value = item.id;
        option.defaultSelected = option.selected = item.isDefault;
        option.dataset.label = label;
        return option;
      });
      const codex = options.filter(
        (option) => !option.value.startsWith("claude:"),
      );
      const claude = options.filter((option) =>
        option.value.startsWith("claude:"),
      );
      if (codex.length && claude.length) {
        const codexGroup = element("optgroup"),
          claudeGroup = element("optgroup");
        codexGroup.label = "Codex";
        claudeGroup.label = "Claude";
        codexGroup.append(...codex);
        claudeGroup.append(...claude);
        model.replaceChildren(codexGroup, claudeGroup);
      } else model.replaceChildren(...options);
      if (!selectedModel) selectedModel = defaultModel;
      if (
        selectedModel &&
        state.models.some((item) => item.id === selectedModel)
      )
        model.value = selectedModel;
      else if (selectedModel) {
        const missing = element("option", "", `${selectedModel} · 사용 불가`);
        missing.value = selectedModel;
        missing.disabled = missing.selected = true;
        model.append(missing);
        model.value = selectedModel;
      }
      selectedModel = model.value;
      selectedEffort =
        current?.effort ?? historyStore?.defaultEffort(selectedModel) ?? "";
      markDefaultModel();
      updateCapabilities(ready ? "연결됨" : "연결 필요");
      status.textContent = ready
        ? ""
        : state.error || "사용 가능한 AI 모델이 없습니다.";
    } catch (error) {
      if (alive) {
        status.textContent = errorText(error);
        updateCapabilities("연결 필요");
      }
    } finally {
      loadingModels = false;
      if (alive) sync();
    }
  }
  async function showResult(data: BulkResult, restoring: boolean) {
    const message = `${restoring ? "되돌리기" : "변경"} ${data.issues.length}개 완료${data.failures.length ? ` · ${data.failures.length}개 실패` : ""}`;
    const undo = data.undoToken
      ? async () => {
          if (!config.canMutate() || applying)
            throw new Error("진행 중인 변경이 끝난 뒤 다시 시도하세요.");
          applying = true;
          sync();
          try {
            await showResult(await config.api.bulkUndo(data.undoToken), true);
          } finally {
            applying = false;
            if (alive) sync();
          }
        }
      : undefined;
    let toast = message;
    try {
      await config.changed(data.issues);
    } catch {
      toast = "변경은 완료됐지만 목록을 갱신하지 못했어요.";
    }
    notify(toast, undo);
    return message;
  }
  function proposal(plan: ChangeProposal) {
    const box = element("section", "command-proposal"),
      value = element("strong", "", plan.value || "미지정"),
      list = element("p", "command-targets", plan.keys.join(", ")),
      apply = actionButton(
        `${plan.keys.length}개 이슈에 적용`,
        "check",
        "primary",
      ),
      result = element("p", "command-proposal-result");
    box.append(
      element("h3", "", `${fields[plan.field]} 변경`),
      value,
      list,
      apply,
      result,
    );
    // ID 대신 실제 Jira 옵션 이름을 보여준다. 이름을 확인하지 못하면 적용하지 않는다.
    let resolved =
      !plan.value || plan.field === "dueDate" || plan.field === "status";
    apply.disabled = !resolved;
    if (!resolved) {
      const label =
        plan.field === "parent"
          ? config.api
              .lookup(plan.value)
              .then((item) => `${item.parent.key} · ${item.parent.summary}`)
          : config.api
              .bulkOptions(
                plan.keys,
                plan.field === "assignee" ? "assignee" : "priority",
              )
              .then((options) =>
                plan.field === "assignee"
                  ? options.users.find((item) => item.id === plan.value)?.name
                  : options.priorities.find((item) => item.id === plan.value)
                      ?.name,
              );
      void label
        .then((name) => {
          if (!alive) return;
          if (!name)
            throw new Error(
              "변경 값을 확인하지 못했어요. AI에 다시 요청해 주세요.",
            );
          value.textContent = name;
          resolved = true;
          apply.disabled = applying;
        })
        .catch((error) => {
          result.textContent = errorText(error);
          result.classList.add("error");
        });
    }
    apply.addEventListener("click", async () => {
      if (applying || !resolved || !config.canMutate()) {
        notify("진행 중인 변경이 끝난 뒤 적용해 주세요.");
        return;
      }
      applying = true;
      sync();
      apply.disabled = true;
      apply.setAttribute("aria-busy", "true");
      result.textContent = "적용 중…";
      let saved = false;
      try {
        const data = await config.api.bulkUpdate(
          plan.keys,
          plan.field,
          plan.value,
        );
        saved = true;
        const message = await showResult(data, false);
        if (alive) {
          result.textContent = [
            message,
            ...data.failures.map((item) => `${item.key}: ${item.error}`),
            ...data.warnings.map((item) => `${item.key}: ${item.error}`),
          ].join("\n");
          apply.textContent = "처리 완료";
          if (current) {
            current.messages.push({
              role: "assistant",
              text: `저장 결과: ${result.textContent}`,
            });
            saveConversation();
          }
        }
      } catch (error) {
        if (alive) result.textContent = errorText(error);
        notify(errorText(error));
      } finally {
        applying = false;
        if (alive) {
          sync();
          apply.disabled = saved;
          apply.removeAttribute("aria-busy");
        }
      }
    });
    return box;
  }
  function saveConversation() {
    if (!current) return;
    current.updated = Date.now();
    conversations = [
      current,
      ...conversations.filter((item) => item.id !== current?.id),
    ];
    try {
      if (historyStore) conversations = historyStore.upsert(current);
      storageError = "";
    } catch (error) {
      storageError = errorText(error);
    }
    sync();
  }
  function renderConversation() {
    aiResults.replaceChildren(
      ...(current?.messages ?? []).map((message) =>
        message.role === "event"
          ? chatEvent(message)
          : message.role === "error"
            ? chatError(message)
            : renderMessage(
                message.role,
                message.text,
                message.model ?? current?.model ?? selectedModel,
                message,
              ),
      ),
    );
  }
  function newConversation() {
    setAiState("idle");
    current = undefined;
    conversationId = "";
    input.value = "";
    aiResults.replaceChildren();
    selectedModel = [...model.options].some(
      (option) => option.value === defaultModel,
    )
      ? defaultModel
      : ([...model.options].find(
          (option) => option.defaultSelected && !option.disabled,
        )?.value ??
        [...model.options].find((option) => !option.disabled)?.value ??
        "");
    model.value = selectedModel;
    selectedEffort = historyStore?.defaultEffort(selectedModel) ?? "";
    status.textContent = "";
    sync();
    input.focus();
  }
  const effortLabels: Record<string, string> = {
    none: "없음",
    minimal: "최소",
    low: "낮게",
    medium: "보통",
    high: "높게",
    xhigh: "매우 높게",
    max: "최대로",
    ultra: "울트라",
  };
  function syncEffort() {
    const metadata = modelCatalog.find((item) => item.id === selectedModel);
    const available = metadata?.efforts ?? [];
    const defaultLabel = metadata?.defaultEffort
      ? `기본 (${effortLabels[metadata.defaultEffort] ?? metadata.defaultEffort})`
      : "기본";
    effortSelect.hidden = !available.length;
    if (selectedEffort && !available.includes(selectedEffort))
      selectedEffort = "";
    effortSelect.replaceChildren(
      ...["", ...available].map((value) => {
        const option = element(
          "option",
          "",
          `추론 · ${value ? (effortLabels[value] ?? value) : defaultLabel}`,
        );
        option.value = value;
        option.selected = value === selectedEffort;
        return option;
      }),
    );
  }
  effortSelect.addEventListener("change", () => {
    if (model.disabled) return;
    selectedEffort = effortSelect.value;
    try {
      historyStore?.setDefaultEffort(selectedModel, selectedEffort);
    } catch (error) {
      storageError = errorText(error);
    }
    if (current && current.effort !== selectedEffort) {
      current.effort = selectedEffort;
      const event: ChatMessage = {
        role: "event",
        text: `추론 강도 · ${effortLabels[selectedEffort] ?? (selectedEffort || "기본값")}`,
        created: Date.now(),
      };
      current.messages.push(event);
      aiResults.append(chatEvent(event));
      saveConversation();
    }
    sync();
  });
  function markDefaultModel() {
    for (const option of model.options)
      if (option.dataset.label)
        option.textContent = `${option.dataset.label}${option.value === defaultModel ? " · 기본" : ""}`;
  }
  function updateCapabilities(codex: string) {
    const stateOf = (id: "codex" | "claude") => {
      const state = providerStates.find((state) => state.id === id);
      return state
        ? state.ready
          ? "연결됨"
          : state.error
        : id === "codex"
          ? codex
          : "미확인";
    };
    capabilities.replaceChildren(
      element("summary", "", "연결 및 지원 상태"),
      helpFacts([
        [
          "Codex",
          `${stateOf("codex")} · 모델 조회·대화를 지원해요. 음성 입력에는 Codex 앱이 필요해요.`,
        ],
        [
          "Claude",
          `${stateOf("claude")} · 모델은 CLI 별칭과 계정 권한을 따라요. 음성 입력은 지원하지 않아요.`,
        ],
        [
          "연결 유지",
          "Codex 대화는 Fast Jira 전용으로 연결해요. 재시작 후에는 저장한 메시지와 작업 기록으로 이어가요.",
        ],
        [
          "이전 대화",
          "Slack·Notion은 연결된 계정의 권한으로 참고해요. Claude는 최근 20개 메시지, 최대 2만 자를 참고해요.",
        ],
        [
          "대화 공유",
          "대화 목록에서 내용을 복사해 다른 곳에 붙여넣을 수 있어요.",
        ],
      ]),
    );
  }

  function renderMessage(
    role: "user" | "assistant",
    text: string,
    model = "",
    details: Pick<
      ChatMessage,
      "executionNote" | "executionSummary" | "mentions"
    > = {},
  ) {
    const { executionNote, executionSummary, mentions } = details;
    const message = chatMessage(
      role,
      text,
      model,
      {
        site: config.site,
        select: selectIssue,
      },
      executionSummary,
      mentions,
    );
    if (executionNote)
      message.append(element("p", "chat-execution-note", executionNote));
    if (role === "assistant" && text) {
      const actions = buttonGroup(element("div", "chat-message-actions"), {
        size: "sm",
      });
      const copy = iconButton("답변 복사", "copy", { size: "sm" });
      copy.addEventListener("click", () => {
        void copyText(text, notify, "답변을 복사했어요.");
      });
      actions.append(copy);
      message.append(actions);
    }
    return message;
  }
  let thinkingMessage: HTMLElement | undefined;
  function hideThinking() {
    thinkingMessage?.remove();
    thinkingMessage = undefined;
  }
  function showThinking(text = "생각하고 있어요…") {
    if (!busy || awaitingApproval) return;
    if (thinkingMessage) {
      const body = thinkingMessage.querySelector(".command-answer p");
      if (body) body.textContent = text;
      return;
    }
    const follow =
      transcript.scrollHeight - transcript.scrollTop <
      transcript.clientHeight + 80;
    thinkingMessage = chatMessage("assistant", text, selectedModel);
    thinkingMessage.classList.add("chat-pending");
    thinkingMessage.setAttribute("role", "status");
    thinkingMessage
      .querySelector(".command-answer p")
      ?.classList.add("chat-thinking");
    aiResults.append(thinkingMessage);
    if (follow) scrollConversation();
  }
  let followingLatest = true;
  let revealFrame = 0;
  function updateLatestButton() {
    latestMessage.hidden =
      transcript.scrollHeight -
        transcript.scrollTop -
        transcript.clientHeight <=
      80;
  }
  function scrollConversation() {
    followingLatest = true;
    transcript.scrollTop = transcript.scrollHeight;
    updateLatestButton();
  }
  function revealLatest() {
    cancelAnimationFrame(revealFrame);
    scrollConversation();
    revealFrame = requestAnimationFrame(scrollConversation);
  }
  transcript.addEventListener("scroll", () => {
    updateLatestButton();
    followingLatest = latestMessage.hidden === true;
  });
  const transcriptResize = new ResizeObserver(() => {
    if (!dialog.open || !dialog.getClientRects().length) return;
    if (followingLatest) scrollConversation();
    else updateLatestButton();
  });
  transcriptResize.observe(transcript);
  transcriptResize.observe(aiResults);
  async function ask(
    queuedPrompt?: string,
    followup = followupMode,
    references = mentions.references(queuedPrompt ?? input.value.trim()),
  ) {
    const prompt = queuedPrompt ?? input.value.trim();
    if (
      !prompt ||
      stopping ||
      applying ||
      recording ||
      !ready ||
      model.selectedOptions[0]?.disabled
    )
      return;
    if (busy) {
      if (!current) return;
      if (followup === "steer")
        await sendImmediately(prompt, undefined, references);
      else {
        queue.add(current.id, prompt, references);
        input.value = "";
        sync();
      }
      return;
    }
    voice.stop();
    if (!current)
      current = {
        id: `${Date.now().toString(36)}-${elementId("conversation")}`,
        conversationId: "",
        model: selectedModel,
        updated: Date.now(),
        messages: [],
      };
    current.model = selectedModel;
    current.effort = selectedEffort;
    const active = current;
    let history: ChatMessage[];
    try {
      history = conversationContext(
        active.messages,
        !selectedModel.startsWith("claude:"),
      );
    } catch (error) {
      notify(errorText(error));
      return;
    }
    active.messages.push({
      role: "user",
      text: prompt,
      ...(references.length ? { mentions: structuredClone(references) } : {}),
    });
    const startedAt = Date.now();
    busy = true;
    setAiState("working");
    request = new AbortController();
    const controller = request;
    aiResults.append(
      renderMessage("user", prompt, selectedModel, { mentions: references }),
    );
    if (queuedPrompt === undefined) input.value = "";
    status.textContent = "";
    showThinking();
    saveConversation();
    scrollConversation();
    const requestId = [...crypto.getRandomValues(new Uint8Array(16))]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    activeRequestId = requestId;
    const stopApprovals = approvalPanel.start(requestId, controller.signal);
    let succeeded = false;
    const streamed = new Map<
      string,
      { message: ChatMessage; row: HTMLElement }
    >();
    const dirty = new Set<string>();
    let progressFrame = 0;
    function flushProgress(final = false) {
      cancelAnimationFrame(progressFrame);
      progressFrame = 0;
      const follow =
        transcript.scrollHeight - transcript.scrollTop <
        transcript.clientHeight + 80;
      for (const [id, entry] of streamed) {
        if (!final && !dirty.has(id)) continue;
        const row = final
          ? renderMessage("assistant", entry.message.text, selectedModel)
          : chatMessage("assistant", entry.message.text, selectedModel, {
              site: config.site,
              select: selectIssue,
            });
        entry.row.replaceWith(row);
        entry.row = row;
      }
      dirty.clear();
      if (follow) scrollConversation();
    }
    function receiveProgress(event: AssistantProgress) {
      if (!alive || controller.signal.aborted) return;
      if (event.type === "activity") {
        showThinking(event.text);
        return;
      }
      const follow =
        transcript.scrollHeight - transcript.scrollTop <
        transcript.clientHeight + 80;
      hideThinking();
      let entry = streamed.get(event.id);
      if (!entry) {
        const message: ChatMessage = {
          role: "assistant",
          text: "",
          model: selectedModel,
        };
        const row = chatMessage("assistant", "", selectedModel);
        entry = { message, row };
        streamed.set(event.id, entry);
        active.messages.push(message);
        aiResults.append(row);
      }
      entry.message.text = event.replace
        ? event.text
        : entry.message.text + event.text;
      dirty.add(event.id);
      if (!progressFrame)
        progressFrame = requestAnimationFrame(() => flushProgress());
      if (event.replace) saveConversation();
      if (follow) scrollConversation();
    }
    try {
      const reply = await config.api.assistantRun(
        mentionPrompt(prompt, references),
        config.context(),
        conversationId,
        selectedModel,
        controller.signal,
        history,
        requestId,
        receiveProgress,
        selectedEffort || undefined,
      );
      if (!alive || controller.signal.aborted) return;
      succeeded = true;
      if (reply.issues?.length)
        await config
          .changed(reply.issues)
          .catch(() =>
            config.notice("Jira 변경은 저장됐지만 화면 갱신에 실패했어요."),
          );
      if (!alive || controller.signal.aborted) return;
      conversationId = active.conversationId = reply.conversationId;
      if (reply.reconnected && !selectedModel.startsWith("claude:")) {
        const event = {
          role: "event" as const,
          text: "저장한 대화와 작업 기록을 불러와 이어가요.",
          created: Date.now(),
        };
        active.messages.push(event);
        aiResults.append(chatEvent(event));
      }
      const answer =
        reply.answer ||
        (reply.execution?.length
          ? ""
          : "답변을 받지 못했어요. 다시 요청해 주세요.");
      const executionSummary = reply.execution?.length
        ? executionReport(reply.execution, config.site)
        : undefined;
      const executionNote =
        reply.execution?.length === 0 && !reply.proposals.length
          ? "이 답변에는 확인된 Jira 실행 결과가 없어요."
          : undefined;
      const activity = reply.activity?.length
        ? {
            role: "event" as const,
            text: `작업 과정 · ${Math.max(1, Math.round((Date.now() - startedAt) / 1000))}초`,
            details: reply.activity
              .map((event) =>
                [event.text, event.details].filter(Boolean).join("\n"),
              )
              .join("\n\n"),
            created: reply.activity[0]?.created ?? Date.now(),
          }
        : undefined;
      if (activity) active.messages.push(activity);
      if (!streamed.size)
        for (const text of reply.intermediate ?? []) {
          active.messages.push({
            role: "assistant",
            text,
            model: selectedModel,
          });
          aiResults.append(renderMessage("assistant", text, selectedModel));
        }
      flushProgress(true);
      const finalEntry = [...streamed.values()]
        .reverse()
        .find((entry) => entry.message.text === answer);
      const finalMessage = {
        role: "assistant" as const,
        text: answer,
        model: selectedModel,
        ...(executionNote ? { executionNote } : {}),
        ...(executionSummary ? { executionSummary } : {}),
      };
      if (finalEntry) Object.assign(finalEntry.message, finalMessage);
      else active.messages.push(finalMessage);
      if (reply.proposals.length)
        active.messages.push({
          role: "assistant",
          text: `제안 내역 (자동 저장되지 않음):\n${reply.proposals.map((plan) => `${fields[plan.field]} · ${plan.keys.join(", ")} (이전 제안은 확인용입니다)`).join("\n")}`,
        });
      const follow =
        transcript.scrollHeight - transcript.scrollTop <
        transcript.clientHeight + 80;
      hideThinking();
      const finalRow = renderMessage("assistant", answer, selectedModel, {
        ...(executionNote ? { executionNote } : {}),
        ...(executionSummary ? { executionSummary } : {}),
      });
      if (finalEntry) {
        finalEntry.row.replaceWith(finalRow);
        finalEntry.row = finalRow;
      }
      aiResults.append(
        ...(activity ? [chatEvent(activity)] : []),
        ...(!finalEntry ? [finalRow] : []),
        ...reply.proposals.map(proposal),
      );
      saveConversation();
      if (follow) scrollConversation();
      status.textContent = reply.proposals.length
        ? "아직 저장하지 않았어요. 대상과 값을 확인하고 적용하세요."
        : "";
      if (!dialog.open || !dialog.getClientRects().length)
        config.unread?.(true);
    } catch (error) {
      if (alive && !controller.signal.aborted) {
        conversationId = active.conversationId = "";
        const message = errorText(error);
        const executionNote =
          error instanceof ApiError &&
          (error.status === 0 || (error.status >= 400 && error.status < 500))
            ? undefined
            : "실행 결과를 확인하지 못했어요. 일부 변경은 저장됐을 수 있으니 다시 실행하기 전에 결과를 확인해 주세요.";
        const failure: ChatMessage = {
          role: "error",
          text: message,
          ...(executionNote ? { executionNote } : {}),
        };
        active.messages.push(failure);
        const follow =
          transcript.scrollHeight - transcript.scrollTop <
          transcript.clientHeight + 80;
        hideThinking();
        aiResults.append(chatError(failure));
        setAiState("error");
        status.textContent = "";
        saveConversation();
        if (follow) scrollConversation();
        if (!dialog.open || !dialog.getClientRects().length)
          config.unread?.(true);
      }
    } finally {
      flushProgress();
      if (request === controller) {
        request = undefined;
        activeRequestId = "";
        busy = false;
        if (!succeeded) queue.pause(active.id);
        hideThinking();
        stopApprovals();
        if (alive) {
          if (controller.signal.aborted) setAiState("idle");
          else if (succeeded && dialog.dataset.aiState !== "error")
            setAiState(
              dialog.open &&
                dialog.getClientRects().length &&
                document.visibilityState === "visible"
                ? "complete"
                : "idle",
            );
          sync();
          if (dialog.open) input.focus();
          if (succeeded) void drainQueue();
        }
      }
    }
  }
  function open(next: Mode = "search") {
    if (
      !alive ||
      (next === "ai" && config.aiAvailable?.() === false && !dialog.open)
    )
      return;
    pickerDialog.close();
    faqDialog.close();
    if (next === "search") {
      voice.stop();
      if (!config.chatHost) dialog.close();
      searchDialog.open();
    } else {
      searchDialog.close();
      if (!dialog.open) {
        if (config.chatHost) dialog.show();
        else dialog.showModal();
      }
      config.chatVisibility?.(true);
      config.unread?.(false);
      sync();
      void loadModels();
      input.focus({ preventScroll: true });
      revealLatest();
    }
  }
  function toggleAI() {
    if (!alive) return;
    if (dialog.open && dialog.getClientRects().length) dialog.close();
    else open("ai");
  }
  function openFaq(id?: string) {
    if (!alive) return;
    pickerDialog.close();
    searchDialog.close();
    if (!config.chatHost) dialog.close();
    voice.stop();
    faqDialog.open(id);
  }
  const commandActions: Record<CommandId, () => void> = {
    faq: () => openFaq(),
    create: () => {
      pickerDialog.close();
      config.create?.();
    },
    search: () => open("search"),
    ai: () => open("ai"),
  };
  function renderCommands() {
    const items = matchingCommands(
      commandQuery.value,
      config.aiAvailable?.() ?? true,
    ).filter((item) => item.id !== "create" || config.create);
    commandMenu.replaceChildren(
      ...items.map((item) => {
        const button = actionButton(item.label, item.icon);
        if (item.id === "search" || item.id === "ai")
          button.append(
            element("kbd", "", formatShortcut(navigator.platform, item.id)),
          );
        button.addEventListener("click", commandActions[item.id]);
        return button;
      }),
    );
    if (!items.length)
      commandMenu.append(
        element("p", "command-hint", "일치하는 명령이 없습니다."),
      );
  }
  function openCommands() {
    if (!alive) return;
    searchDialog.close();
    faqDialog.close();
    if (!config.chatHost) dialog.close();
    voice.stop();
    commandQuery.value = "";
    renderCommands();
    if (!pickerDialog.open) pickerDialog.showModal();
    commandQuery.focus();
  }
  commandQuery.addEventListener("input", renderCommands);
  commandQuery.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "Enter") {
      event.preventDefault();
      const button = commandMenu.querySelector("button");
      if (event.key === "Enter") button?.click();
      else button?.focus();
    }
  });
  commandMenu.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...commandMenu.querySelectorAll("button")],
      index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowUp" && index <= 0) commandQuery.focus();
    else buttons[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
  });
  current = conversations[0];
  if (current) {
    conversationId = current.conversationId;
    selectedModel = current.model;
    selectedEffort = current.effort ?? "";
    renderConversation();
  }
  input.addEventListener("input", renderQueue);
  input.addEventListener("keydown", (event) => {
    const action = chatKeyboardAction(sendMode, followupMode, busy, event);
    if (!action) return;
    event.preventDefault();
    if (action === "steer" && !input.value.trim() && current) {
      const first = queue.list(current.id)[0];
      if (first) void sendImmediately(first.text, first.id, first.mentions);
    } else if (action === "send") form.requestSubmit();
    else void ask(undefined, action);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void ask();
  });
  model.addEventListener("change", () => {
    if (busy || steering || stopping || applying || recording) return;
    selectedModel = model.value;
    selectedEffort = historyStore?.defaultEffort(selectedModel) ?? "";
    defaultModel = selectedModel;
    markDefaultModel();
    try {
      historyStore?.setDefaultModel(defaultModel);
    } catch (error) {
      storageError = errorText(error);
    }
    if (current) {
      const previous = current.model;
      if (previous !== selectedModel) {
        if (
          previous.startsWith("claude:") !== selectedModel.startsWith("claude:")
        )
          current.conversationId = conversationId = "";
        current.model = selectedModel;
        current.effort = selectedEffort;
        const text = `모델을 ${model.selectedOptions[0]?.dataset.label ?? selectedModel}로 변경했어요.`;
        const created = Date.now();
        current.messages.push({ role: "event", text, created });
        aiResults.append(chatEvent({ text, created }));
        saveConversation();
        scrollConversation();
      }
    }
    sync();
  });
  microphone.addEventListener("click", () => {
    if (!recording) voicePrefix = input.value.trimEnd();
    if (config.voiceAvailable?.() === false) return;
    voice.start();
  });
  async function stopRequest() {
    if (stopping) return;
    stopping = true;
    setAiState("idle");
    const requestId = activeRequestId;
    if (current) queue.pause(current.id);
    request?.abort();
    hideThinking();
    conversationId = "";
    status.textContent = "요청을 중지했어요. 이미 저장된 변경은 유지돼요.";
    if (current) {
      current.conversationId = "";
      current.messages.push({
        role: "assistant",
        text: "요청을 중지했어요. 이미 저장된 변경은 유지돼요.",
      });
      aiResults.append(
        renderMessage(
          "assistant",
          "요청을 중지했어요. 이미 저장된 변경은 유지돼요.",
          selectedModel,
        ),
      );
      saveConversation();
    }
    let confirmed = true;
    try {
      if (requestId) await config.api.assistantControl(requestId, "stop");
    } catch (error) {
      confirmed = false;
      notify(errorText(error));
    } finally {
      stopping = false;
      sync();
    }
    return confirmed;
  }
  cancel.addEventListener("click", () => void stopRequest());
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    if (!alive || dialog.open) return;
    if (dialog.dataset.aiState === "complete") setAiState("idle");
    config.chatVisibility?.(false);
    closeHistory();
    restoreNotice(dialog);
    closeHelp();
    closeSettings();
    voice.stop();
    approvalPanel.stopVoice();
  });
  for (const modal of [dialog, pickerDialog])
    modal.addEventListener("click", (event) => {
      if (event.target !== modal) return;
      const bounds = modal.getBoundingClientRect();
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      )
        modal.close();
    });
  const shortcut = (event: KeyboardEvent) => {
    const command = commandForShortcut(event, navigator.platform);
    if (
      !command ||
      (command === "ai" && config.aiAvailable?.() === false && !dialog.open)
    )
      return;
    event.preventDefault();
    if (command === "palette") openCommands();
    else if (command === "ai") toggleAI();
    else open(command);
  };
  updateCapabilities("미확인");
  window.addEventListener("keydown", shortcut, true);
  sync();
  return {
    open,
    toggleAI,
    openCommands,
    openFaq,
    get busy() {
      return busy || steering || stopping || applying || recording;
    },
    refreshAvailability() {
      ready = false;
      if (config.aiAvailable?.() === false) voice.stop();
      else if (dialog.open) void loadModels();
      if (pickerDialog.open) renderCommands();
      sync();
    },
    destroy() {
      alive = false;
      clearTimeout(completionEffect);
      cancelAnimationFrame(revealFrame);
      transcriptResize.disconnect();
      request?.abort();
      voice.destroy();
      historyResize?.disconnect();
      closeHistory();
      closeHelp();
      closeSettings();
      approvalPanel.destroy();
      mentions.destroy();
      window.removeEventListener("keydown", shortcut, true);
      searchDialog.destroy();
      faqDialog.destroy();
      pickerDialog.close();
      pickerDialog.remove();
      if (dialog.open) dialog.close();
      restoreNotice(dialog);
      dialog.remove();
    },
  };
}
