import "./command-palette.css";
import { type Api, subscribeVoice } from "../client/api.ts";
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
import type { AssistantContext } from "../domain/assistant.ts";
import type { BulkResult } from "../domain/bulk.ts";
import {
  type CommandId,
  commandForShortcut,
  shortcutLabel as formatShortcut,
  matchingCommands,
} from "../domain/commands.ts";
import {
  type Conversation,
  conversationContext,
} from "../domain/conversation.ts";
import type { Issue } from "../domain/issue.ts";
import { chatMessage } from "./chat-message.ts";
import { createChatSidebar } from "./chat-sidebar.ts";
import { actionButton, element, elementId, iconButton } from "./dom.ts";
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
  api: Pick<
    Api,
    | "issues"
    | "lookup"
    | "assistantStatus"
    | "assistantRun"
    | "bulkOptions"
    | "bulkUpdate"
    | "bulkUndo"
    | "voiceStart"
    | "voiceStop"
  >;
  site: string;
  context: () => AssistantContext;
  recent: () => readonly Issue[];
  localIssues: () => readonly Issue[];
  order: () => readonly string[];
  favorites?: CardOptions["favorites"];
  select: (key: string) => void;
  changed: (issues: Issue[]) => Promise<void>;
  canMutate: () => boolean;
  notice: (message: string, undo?: () => Promise<void>) => void;
  noticeHost?: HTMLElement;
  restoreNotice?: () => void;
  voice?: (callbacks: VoiceCallbacks) => VoiceInput;
  storage?: LocalStore;
  scope?: string;
  unread?: (value: boolean) => void;
}) {
  const dialog = element("dialog", "command-modal ai-modal is-chat"),
    head = element("div", "command-head"),
    title = element("h2", "", "AI 대화"),
    close = iconButton("명령창 닫기", "x"),
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
    controls = element("div", "command-controls"),
    model = element("select", "command-model"),
    microphone = iconButton("음성 입력", "mic"),
    send = actionButton("요청 보내기", "arrow-up", "primary"),
    cancel = actionButton("요청 중지", "square"),
    chatLayout = element("div", "chat-layout"),
    chatMain = element("div", "chat-main"),
    transcript = element("div", "chat-transcript"),
    footer = element("div", "chat-footer"),
    welcome = element("div", "chat-welcome"),
    provider = element("span", "chat-provider", "Codex"),
    capabilities = element("details", "chat-capabilities"),
    policy = element(
      "details",
      "command-policy",
      "대화는 이 브라우저에 보관되며 직접 삭제할 때까지 남습니다. 연결이 만료되면 최근 대화 일부를 참고해 새 연결로 이어갑니다. 브라우저 데이터를 지우면 기록도 삭제됩니다.",
    ),
    hint = element("p", "command-hint"),
    status = element("p", "command-status"),
    aiResults = element("div", "command-results");
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
  const sidebar = createChatSidebar({
    create: () => {
      if (!busy && !applying && !recording) newConversation();
    },
    choose: (item) => {
      if (busy || applying || recording) return;
      current = item;
      conversationId = item.conversationId;
      selectedModel = item.model;
      if ([...model.options].some((option) => option.value === selectedModel))
        model.value = selectedModel;
      input.value = "";
      renderConversation();
      status.textContent = "";
      sync();
      input.focus();
    },
    remove: (id) => {
      if (busy || applying || recording) return;
      try {
        conversations = historyStore
          ? historyStore.remove(id)
          : conversations.filter((item) => item.id !== id);
      } catch (error) {
        storageError = errorText(error);
        sync();
        return;
      }
      if (current?.id === id) newConversation();
      else sync();
    },
  });
  welcome.append(
    element("h3", "", "어떤 작업을 도와드릴까요?"),
    element("p", "", "이슈를 찾거나 변경할 내용을 이야기해 주세요."),
  );
  transcript.append(welcome, aiResults, status);
  transcript.setAttribute("aria-label", "대화 내용");
  aiResults.setAttribute("role", "log");
  aiResults.setAttribute("aria-live", "polite");
  chatMain.append(transcript, form, footer);
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
  model.setAttribute("aria-label", "대화 모델");
  model.title = "이 대화의 모델 · 선택한 모델을 새 대화 기본값으로 저장합니다";
  model.append(element("option", "", "연결 확인 중…"));
  input.setAttribute("aria-label", "AI 메시지");
  input.maxLength = 10000;
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  send.type = "submit";
  head.append(title, close);
  controls.append(provider, model, microphone, cancel, send);
  form.append(input, controls);
  policy.replaceChildren(
    element("summary", "", "이 브라우저에 보관 · 보관 안내"),
    element("p"),
  );
  panel.append(chatLayout);
  footer.append(hint, policy, capabilities);
  dialog.append(head, panel);
  config.host.append(dialog, pickerDialog);
  let alive = true,
    busy = false,
    applying = false,
    conversationId = "",
    voicePrefix = "",
    recording = false,
    selectedModel = "",
    ready = false,
    loadingModels = false;
  let request: AbortController | undefined;
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
    context: config.context,
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
      hint.textContent = message || hintText();
    },
  };
  const voice = config.voice
    ? config.voice(voiceCallbacks)
    : createCodexVoice({
        api: config.api,
        subscribe: subscribeVoice,
        ...voiceCallbacks,
      });
  function hintText() {
    return "Enter 보내기 · Shift+Enter 줄바꿈 · 변경은 확인 후 적용";
  }
  function sync() {
    input.rows = 3;
    input.placeholder = "예: 내 진행 중 이슈를 찾아 담당자를 변경해 줘";
    model.disabled = busy || loadingModels || applying || recording;
    send.disabled =
      applying ||
      busy ||
      recording ||
      !ready ||
      model.selectedOptions[0]?.disabled === true;
    cancel.hidden = !busy;
    microphone.disabled = busy || applying;
    microphone.title = recording
      ? "음성 입력 중지"
      : "Codex 로그인으로 음성 입력";
    form.setAttribute("aria-busy", String(busy));
    welcome.hidden = aiResults.childElementCount > 0;
    status.classList.toggle("chat-thinking", busy);
    provider.dataset.state = ready
      ? "ready"
      : loadingModels
        ? "loading"
        : "offline";
    sidebar.render(
      conversations,
      current?.id ?? "",
      busy || applying || recording,
    );
    const policyText = policy.querySelector("p");
    if (policyText)
      policyText.textContent =
        storageError ||
        (historyStore
          ? "대화는 이 브라우저에 직접 삭제할 때까지 남습니다. 브라우저 데이터를 지우면 기록도 삭제됩니다. Codex 연결은 30분 미사용 또는 서버 재시작 시 만료되며, 최근 20개 메시지·최대 2만 자를 참고해 새 연결로 이어갑니다."
          : "현재 화면에서만 대화를 보관합니다.");
    if (storageError) policy.open = true;
    policy.classList.toggle("error", Boolean(storageError));
    hint.textContent = hintText();
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
      model.replaceChildren(
        ...state.models.map((item) => {
          const option = element("option", "", item.name);
          option.value = item.id;
          option.defaultSelected = option.selected = item.isDefault;
          option.dataset.label = item.name;
          return option;
        }),
      );
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
        chatMessage(
          message.role,
          message.text,
          message.model ?? current?.model ?? selectedModel,
        ),
      ),
    );
  }
  function newConversation() {
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
    status.textContent = "";
    sync();
    input.focus();
  }
  function markDefaultModel() {
    for (const option of model.options)
      if (option.dataset.label)
        option.textContent = `${option.dataset.label}${option.value === defaultModel ? " · 기본" : ""}`;
  }
  function updateCapabilities(codex: string) {
    const table = element("table");
    const head = element("tr");
    for (const label of ["제공자", "모델 조회", "대화", "음성 입력"])
      head.append(element("th", "", label));
    table.append(head);
    for (const values of [
      ["Codex", codex, codex, "지원 · Codex 앱 필요"],
      ["Claude", "Fast Jira 미연동", "Fast Jira 미연동", "Fast Jira 미연동"],
    ]) {
      const row = element("tr");
      for (const value of values) row.append(element("td", "", value));
      table.append(row);
    }
    capabilities.replaceChildren(
      element("summary", "", "연결 및 지원 상태"),
      table,
    );
  }
  function scrollConversation() {
    transcript.scrollTop = transcript.scrollHeight;
  }
  async function ask() {
    const prompt = input.value.trim();
    if (
      !prompt ||
      busy ||
      applying ||
      recording ||
      !ready ||
      model.selectedOptions[0]?.disabled
    )
      return;
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
    const active = current,
      history = conversationContext(active.messages);
    active.messages.push({ role: "user", text: prompt });
    busy = true;
    saveConversation();
    request = new AbortController();
    const controller = request;
    aiResults.append(chatMessage("user", prompt));
    scrollConversation();
    input.value = "";
    status.textContent = "생각하고 있어요…";
    try {
      const reply = await config.api.assistantRun(
        prompt,
        config.context(),
        conversationId,
        selectedModel,
        controller.signal,
        history,
      );
      if (!alive || controller.signal.aborted) return;
      conversationId = active.conversationId = reply.conversationId;
      const answer = reply.answer || "변경안을 확인해 주세요.";
      active.messages.push({
        role: "assistant",
        text: answer,
        model: selectedModel,
      });
      if (reply.proposals.length)
        active.messages.push({
          role: "assistant",
          text: `제안 내역 (자동 저장되지 않음):\n${reply.proposals.map((plan) => `${fields[plan.field]} · ${plan.keys.join(", ")} (이전 제안은 확인용입니다)`).join("\n")}`,
        });
      const follow =
        transcript.scrollHeight - transcript.scrollTop <
        transcript.clientHeight + 80;
      aiResults.append(
        chatMessage("assistant", answer, selectedModel),
        ...reply.proposals.map(proposal),
      );
      saveConversation();
      if (follow) scrollConversation();
      status.textContent = reply.proposals.length
        ? "아직 저장하지 않았어요. 대상과 값을 확인하고 적용하세요."
        : "";
      if (!dialog.open) config.unread?.(true);
    } catch (error) {
      if (alive && !controller.signal.aborted) {
        conversationId = active.conversationId = "";
        const message = errorText(error);
        active.messages.push({
          role: "assistant",
          text: `요청 실패: ${message}`,
        });
        aiResults.append(
          chatMessage("assistant", `요청 실패: ${message}`, selectedModel),
        );
        status.textContent = "";
        if (!input.value) input.value = prompt;
        saveConversation();
        if (!dialog.open) config.unread?.(true);
      }
    } finally {
      if (request === controller) {
        request = undefined;
        busy = false;
        if (alive) {
          sync();
          if (dialog.open) input.focus();
        }
      }
    }
  }
  function open(next: Mode = "search") {
    if (!alive) return;
    pickerDialog.close();
    if (next === "search") {
      voice.stop();
      dialog.close();
      searchDialog.open();
    } else {
      searchDialog.close();
      if (!dialog.open) dialog.showModal();
      config.unread?.(false);
      sync();
      void loadModels();
      input.focus();
    }
  }
  const commandActions: Record<CommandId, () => void> = {
    search: () => open("search"),
    ai: () => open("ai"),
  };
  function renderCommands() {
    const items = matchingCommands(commandQuery.value);
    commandMenu.replaceChildren(
      ...items.map((item) => {
        const button = actionButton(item.label, item.icon);
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
    dialog.close();
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
    renderConversation();
  }
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void ask();
  });
  model.addEventListener("change", () => {
    if (busy || applying || recording) return;
    selectedModel = model.value;
    defaultModel = selectedModel;
    markDefaultModel();
    try {
      historyStore?.setDefaultModel(defaultModel);
    } catch (error) {
      storageError = errorText(error);
    }
    if (current) {
      current.model = selectedModel;
      current.conversationId = conversationId = "";
      saveConversation();
    }
    sync();
  });
  microphone.addEventListener("click", () => {
    if (!recording) voicePrefix = input.value.trimEnd();
    voice.start();
  });
  cancel.addEventListener("click", () => {
    request?.abort();
    conversationId = "";
    status.textContent = "요청을 중지했어요.";
    if (current) {
      current.conversationId = "";
      current.messages.push({ role: "assistant", text: "요청을 중지했어요." });
      aiResults.append(
        chatMessage("assistant", "요청을 중지했어요.", selectedModel),
      );
      saveConversation();
    }
  });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    restoreNotice(dialog);
    voice.stop();
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
    if (!command) return;
    event.preventDefault();
    if (command === "palette") openCommands();
    else open(command);
  };
  updateCapabilities("미확인");
  window.addEventListener("keydown", shortcut, true);
  sync();
  return {
    open,
    openCommands,
    destroy() {
      alive = false;
      request?.abort();
      voice.destroy();
      window.removeEventListener("keydown", shortcut, true);
      searchDialog.destroy();
      pickerDialog.close();
      pickerDialog.remove();
      if (dialog.open) dialog.close();
      restoreNotice(dialog);
      dialog.remove();
    },
  };
}
