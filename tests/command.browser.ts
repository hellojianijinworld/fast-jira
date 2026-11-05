import "../src/client/styles.css";
import { createApi } from "../src/client/api.ts";
import type { VoiceCallbacks } from "../src/client/codex-voice.ts";
import { emptyIssue } from "../src/domain/wire.ts";
import { chatEvent, chatMessage } from "../src/ui/chat-message.ts";
import { createCommandPalette } from "../src/ui/command-palette.ts";
import { element } from "../src/ui/dom.ts";
import { issueCard } from "../src/ui/issue-card.ts";
import { createNotice } from "../src/ui/notice.ts";

const host = document.querySelector<HTMLElement>("#fixture"),
  results = document.querySelector("#results");
if (!host || !results) throw new Error("fixture 누락");
let failures = 0;
let requestedThread = "";
let localApproval = false;
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
async function check(name: string, work: () => Promise<void>) {
  try {
    await work();
    results?.append(element("li", "", `통과: ${name}`));
  } catch (error) {
    failures++;
    results?.append(
      element(
        "li",
        "error",
        `${name}: ${error instanceof Error ? error.message : error}`,
      ),
    );
  }
}
const issue = {
  ...emptyIssue("AA-1"),
  id: "1",
  key: "AA-1",
  summary: "키보드로 검색하고 AI로 변경할 수 있는 긴 제목의 모의 이슈",
  project: "AA",
  status: "대기",
  issueType: "작업",
};
const details = {
  ...issue,
  reporter: "나",
  reporterAvatar: "",
  created: "",
  description: null,
  attachments: [],
  url: "https://fixture.atlassian.net/browse/AA-1",
};
const writes: string[] = [];
const updates: string[] = [];
let holdChange = false,
  releaseChange: (() => void) | undefined;
let conversation = "";
let approvalToken = "",
  pendingApproval = false,
  holdApproval = false,
  approvalAccepted = false;
let releaseApproval: (() => void) | undefined;
let holdAnswer = false,
  releaseAnswer: (() => void) | undefined,
  unread = false,
  noExecution = false,
  executionPreview = false;
const savedChats = new Map<string, string>();
const storage = {
  getItem: (key: string) => savedChats.get(key) ?? null,
  setItem: (key: string, value: string) => {
    savedChats.set(key, value);
  },
};
let localReads = 0,
  searchCalls = 0;
let searchProjects = "";
let localItems = [issue],
  holdSearch = false,
  failSearch = false;
let releaseSearch: (() => void) | undefined;
let streamReply = false;
let emitProgress: ((event: unknown) => void) | undefined;
const controls: { action: string; prompt?: string }[] = [];
let prompt = "",
  searchQuery = "",
  fail = false,
  networkFailure = false,
  assistantCalls = 0;
let voiceTranscript: ((text: string) => void) | undefined;
function mockVoice(callbacks: VoiceCallbacks) {
  let active = false;
  const stop = () => {
    active = false;
    callbacks.state(false, "");
  };
  return {
    start() {
      voiceTranscript = callbacks.transcript;
      active = !active;
      callbacks.state(active, "");
    },
    stop,
    destroy: stop,
  };
}
const api = createApi(async (input, init) => {
  const path = new URL(String(input), location.origin);
  if (path.pathname === "/api/issues") {
    searchQuery = path.searchParams.get("q") ?? "";
    searchProjects = path.searchParams.get("projects") ?? "";
    const query = searchQuery;
    searchCalls++;
    if (holdSearch)
      await new Promise<void>((resolve) => {
        releaseSearch = resolve;
      });
    if (failSearch)
      return Response.json({ error: "모의 검색 실패" }, { status: 503 });
    if (query === "페이지 검색")
      return Response.json({
        issues: [
          {
            ...issue,
            id: path.searchParams.get("pageToken") ? "3" : "2",
            key: path.searchParams.get("pageToken") ? "AA-3" : "AA-2",
          },
        ],
        ancestors: [],
        nextPageToken: path.searchParams.get("pageToken") ? null : "next",
      });
    return Response.json({
      issues:
        query === "로컬 검색"
          ? [
              { ...issue, summary: "로컬 검색 최신" },
              { ...issue, id: "2", key: "AA-2", summary: "로컬 검색 추가" },
            ]
          : [issue],
      ancestors: [],
      nextPageToken: null,
    });
  }
  if (path.pathname === "/api/issue")
    return Response.json({
      parent: details,
      children: [],
      deferredChildren: true,
      dateEditing: true,
      imageEnabled: false,
    });
  if (path.pathname === "/api/assistant/status")
    return Response.json({
      ready: true,
      models: [
        {
          id: "test",
          name: "Codex · 검사 모델",
          isDefault: true,
          efforts: ["medium", "high"],
          defaultEffort: "medium",
        },
        { id: "other", name: "Codex · 다른 모델", isDefault: false },
        {
          id: "claude:sonnet",
          name: "Claude · sonnet (CLI 별칭)",
          isDefault: false,
        },
      ],
      error: "",
      providers: [
        { id: "codex", ready: true, error: "" },
        { id: "claude", ready: true, error: "" },
      ],
    });
  if (path.pathname === "/api/assistant/approvals")
    return Response.json(
      pendingApproval && path.searchParams.get("requestId") === approvalToken
        ? [
            {
              id: "approval",
              title: localApproval
                ? "이 명령을 실행할까요?"
                : "AA-1의 상태를 ‘개발 대기중’에서 ‘개발 진행 중’으로 바꿀까요?",
              description: localApproval
                ? "AA-1 검증에 필요한 명령이에요. 표시된 작업만 승인해요."
                : "",
              details: localApproval
                ? "작업 폴더: /project\n명령: npm test"
                : "",
              fields: [
                {
                  key: "feedback",
                  label: "기타 의견",
                  type: "text",
                  required: false,
                },
              ],
            },
          ]
        : [],
    );
  if (path.pathname === "/api/assistant/approve") {
    pendingApproval = false;
    approvalAccepted = JSON.parse(String(init?.body)).approved === true;
    releaseApproval?.();
    return Response.json({});
  }
  if (path.pathname === "/api/assistant/control") {
    const input = JSON.parse(String(init?.body));
    controls.push(input);
    if (input.action === "stop") releaseAnswer?.();
    return Response.json({});
  }
  if (path.pathname === "/api/assistant/run") {
    assistantCalls++;
    requestedThread = JSON.parse(String(init?.body)).threadId ?? "";
    if (networkFailure) throw new TypeError("Failed to fetch");
    if (holdApproval) {
      approvalToken = JSON.parse(String(init?.body)).requestId;
      pendingApproval = true;
      await new Promise<void>((resolve) => {
        releaseApproval = resolve;
      });
    }
    prompt = JSON.parse(String(init?.body)).prompt;
    conversation = JSON.parse(String(init?.body)).conversationId;
    if (streamReply) {
      return new Response(
        new ReadableStream({
          start(controller) {
            emitProgress = (event) =>
              controller.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
              );
          },
          cancel() {
            emitProgress = undefined;
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    }
    if (holdAnswer)
      await new Promise<void>((resolve) => {
        releaseAnswer = resolve;
      });
    if (fail)
      return Response.json({ error: "모의 연결 실패" }, { status: 503 });
    if (executionPreview) {
      const execution = [
        {
          tool: "jira_create_issue",
          label: "이슈 생성 · [모의] 프롬프트 반영",
          status: "applied" as const,
          keys: ["AA-99"],
        },
        {
          tool: "jira_edit_issue",
          label: "기존 이슈 제목 수정",
          status: "notApproved" as const,
          keys: ["AA-1"],
        },
        {
          tool: "jira_description",
          label: "본문 수정",
          status: "failed" as const,
          keys: ["AA-2"],
          error: "모의 권한 오류",
        },
      ];
      return Response.json({
        conversationId: "test",
        threadId: "01a1804c-6b69-7621-aa0f-83a2a66d2959",
        answer: "남은 작업의 상위는 모의 창체 개선(AA-1)이 맞나요?",
        activity: [
          {
            role: "event",
            text: "이슈 확인 · 완료",
            details: "AA-1 · 생성 파이프라인 후속 작업 · 개발 중",
            created: Date.now(),
          },
          {
            role: "event",
            text: "이슈 검색 · 완료",
            details: "AA · AA-1 하위 · 내 관련 작업\n5건 확인 · 다음 결과 있음",
            created: Date.now(),
          },
          {
            role: "event",
            text: "본문 수정 요청 처리 · 실패",
            created: Date.now(),
            details: "모의 권한 오류",
          },
        ],
        execution,
        proposals: [],
      });
    }
    return Response.json({
      conversationId: "test",
      threadId: "01a1804c-6b69-7621-aa0f-83a2a66d2959",
      answer: "대상 이슈를 확인했습니다. 아래 변경안을 확인하세요.",
      ...(holdApproval
        ? {
            creations: [
              { project: "AA", type: "1", fields: { summary: "레거시 초안" } },
            ],
          }
        : {}),
      ...(holdApproval && approvalAccepted ? { issues: [issue] } : {}),
      ...(noExecution
        ? { proposals: [], execution: [] }
        : {
            proposals: [
              { keys: [issue.key], field: "assignee", value: "user" },
            ],
          }),
    });
  }
  if (path.pathname === "/api/bulk-options")
    return Response.json({
      users: [{ id: "user", name: "모의 사용자", avatar: "" }],
      statuses: [],
      priorities: [],
    });
  if (
    path.pathname === "/api/bulk-update" ||
    path.pathname === "/api/bulk-undo"
  ) {
    writes.push(path.pathname);
    return Response.json({
      issues: [issue],
      failures: [],
      warnings: [],
      undoToken: path.pathname.endsWith("update") ? "receipt" : "",
    });
  }
  throw new Error(`예상하지 않은 요청: ${path.pathname}`);
});
const noticeHost = element("div");
host.append(noticeHost);
const notice = createNotice(noticeHost);
let selected = "";
function makePalette(availability?: { chat: boolean; voice: boolean }) {
  return createCommandPalette({
    storage,
    scope: "fixture:account",
    unread: (value) => {
      unread = value;
    },
    host: host as HTMLElement,
    api,
    site: "fixture.atlassian.net",
    context: () => ({ projects: ["AA"], issue: "", keys: [] }),
    recent: () => [issue],
    localIssues: () => {
      localReads++;
      return localItems;
    },
    order: () => [],
    select: (key) => {
      selected = key;
    },
    changed: async (issues) => {
      updates.push(...issues.map((item) => item.key));
      if (holdChange)
        await new Promise<void>((resolve) => {
          releaseChange = resolve;
        });
    },
    canMutate: () => true,
    notice: notice.show,
    noticeHost,
    voice: mockVoice,
    ...(availability
      ? {
          aiAvailable: () => availability.chat,
          voiceAvailable: () => availability.voice,
        }
      : {}),
  });
}
let palette = makePalette();
function dialog() {
  const value =
    host?.querySelector<HTMLDialogElement>("dialog[open]") ??
    host?.querySelector<HTMLDialogElement>(".ai-modal");
  if (!value) throw new Error("명령창 누락");
  return value;
}
function input() {
  const value = dialog().querySelector<HTMLInputElement | HTMLTextAreaElement>(
    "textarea, .search-query",
  );
  if (!value) throw new Error("입력창 누락");
  return value;
}
function button(text: string) {
  const value = [...dialog().querySelectorAll("button")].find(
    (item) =>
      item.textContent === text || item.getAttribute("aria-label") === text,
  );
  if (!value) throw new Error(`${text} 버튼 누락`);
  return value;
}
await check("Ctrl+K와 돋보기의 공통 검색창·키보드 이동·IME 입력", async () => {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true }),
  );
  await tick();
  assert(dialog().open, "검색창이 안 열림");
  assert(
    dialog().querySelectorAll(".issue-card").length === 1,
    "최근 카드 누락",
  );
  input().value = "검색어";
  input().dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
    }),
  );
  await tick();
  assert(searchQuery === "", "IME 조합 Enter로 검색했다");
  dialog().querySelector("form")?.requestSubmit();
  await tick();
  assert(searchQuery === "검색어", "검색 전달 누락");
  assert(
    !dialog().textContent?.includes("로컬") &&
      !dialog().textContent?.includes("이미 불러온"),
    "내부 검색 동작 설명이 노출됨",
  );
  assert(input().value === "검색어", "검색 실행 후 검색어가 사라짐");
  input().dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  assert(
    document.activeElement?.classList.contains("list-title"),
    "검색 결과로 키보드 이동 실패",
  );
  dialog().querySelector<HTMLAnchorElement>(".list-title")?.click();
  assert(selected === "AA-1" && !dialog().open, "상세 선택·닫기 실패");
});
await check(
  "Enter 전에는 로컬·API 검색을 하지 않고 로컬 후보를 먼저 표시한 뒤 최신 결과를 중복 없이 합친다",
  async () => {
    palette.open("search");
    const reads = localReads,
      calls = searchCalls;
    input().value = "로컬 검색";
    input().dispatchEvent(new Event("input"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert(localReads === reads && searchCalls === calls, "입력 중 검색 실행");
    localItems = [{ ...issue, summary: "로컬 검색 이전" }];
    holdSearch = true;
    dialog().querySelector("form")?.requestSubmit();
    assert(
      dialog().querySelector(".list-title")?.textContent === "로컬 검색 이전",
      "API 응답 전 로컬 후보 누락",
    );
    assert(searchProjects === "", "전체 검색이 현재 뷰의 프로젝트로 제한됨");
    assert(
      dialog().textContent?.includes("현재 뷰 밖"),
      "뷰 밖 검색 중 안내 누락",
    );
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    releaseSearch?.();
    await tick();
    assert(
      dialog().querySelectorAll(".issue-card").length === 2,
      "중복 카드 또는 추가 결과 누락",
    );
    assert(
      dialog().querySelector(".list-title")?.textContent === "로컬 검색 최신",
      "서버 최신 정보 미반영",
    );
    assert(
      document.activeElement?.textContent === "로컬 검색 최신",
      "응답 병합으로 키보드 선택 유실",
    );
    assert(dialog().querySelectorAll("mark").length > 0, "일치 단어 강조 누락");
    holdSearch = false;
    failSearch = true;
    input().value = "로컬 검색";
    dialog().querySelector("form")?.requestSubmit();
    await tick();
    assert(
      dialog().querySelector(".list-title")?.textContent === "로컬 검색 이전",
      "API 실패로 로컬 결과 삭제",
    );
    failSearch = false;
    holdSearch = true;
    input().value = "로컬 검색";
    dialog().querySelector("form")?.requestSubmit();
    input().value = "다른 검색";
    input().dispatchEvent(new Event("input"));
    releaseSearch?.();
    await tick();
    assert(
      dialog().querySelectorAll(".issue-card").length === 1,
      "입력 변경 후 이전 응답 반영",
    );
    const after = searchCalls;
    dialog().close();
    palette.open("search");
    await tick();
    assert(input().value === "", "닫은 검색어가 다시 복원됨");
    assert(
      !dialog().querySelector(".command-search-group, .command-more"),
      "닫은 검색 결과·페이지가 다시 복원됨",
    );
    assert(searchCalls === after, "창 재열기에서 검색 자동 실행");
    holdSearch = false;
    localItems = [issue];
    input().value = "";
    dialog().close();
  },
);
await check(
  "검색어·결과는 실행 후 유지하고 닫을 때만 초기화하며 더 보기는 같은 검색어를 쓴다",
  async () => {
    palette.open("search");
    holdSearch = true;
    input().value = "로컬 검색";
    dialog().querySelector("form")?.requestSubmit();
    const previous = dialog();
    previous.close();
    palette.open("search");
    releaseSearch?.();
    await tick();
    assert(
      input().value === "" && !dialog().querySelector(".command-search-group"),
      "닫기 전 응답이 새 창에 반영됨",
    );
    holdSearch = false;
    input().value = "페이지 검색";
    dialog().querySelector("form")?.requestSubmit();
    await tick();
    assert(input().value === "페이지 검색", "검색어가 실행 직후 사라짐");
    button("더 보기").click();
    await tick();
    assert(searchQuery === "페이지 검색", "더 보기가 다른 검색어로 검색함");
    assert(
      dialog().querySelectorAll(".issue-card").length === 3 &&
        !dialog().querySelector(".command-more"),
      "페이지 결과 또는 마지막 페이지 상태 오류",
    );
    previous.close();
    await tick();
  },
);
await check(
  "한글 배열·조합 중에도 Cmd+Shift+P를 물리 키로 인식한다",
  async () => {
    palette.open("search");
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "K",
        code: "KeyK",
        metaKey: true,
        shiftKey: true,
        cancelable: true,
      }),
    );
    assert(
      !host?.querySelector(".command-picker-modal[open]"),
      "이전 단축키가 여전히 명령 팔레트를 연다",
    );
    input().addEventListener("keydown", (event) => event.stopPropagation(), {
      once: true,
    });
    input().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ㅖ",
        code: "KeyP",
        metaKey: true,
        shiftKey: true,
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    try {
      assert(
        !!host?.querySelector(".command-picker-modal[open]"),
        "한글 키 또는 입력창 전파 차단으로 명령 팔레트가 열리지 않음",
      );
    } finally {
      dialog().close();
      await tick();
    }
  },
);
await check(
  "AI 단축키는 같은 대화를 열고 닫으며 초안과 포커스를 유지한다",
  async () => {
    palette.open("search");
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const press = () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ㅑ",
          code: "KeyI",
          metaKey: mac,
          ctrlKey: true,
          altKey: !mac,
          bubbles: true,
          cancelable: true,
        }),
      );
    press();
    await tick();
    const chat = dialog();
    assert(
      chat.classList.contains("ai-modal") && document.activeElement === input(),
      "AI 대화 열기·포커스 실패",
    );
    input().value = "단축키 초안";
    press();
    await tick();
    assert(!chat.open, "같은 단축키로 AI 대화가 닫히지 않음");
    press();
    await tick();
    assert(
      dialog() === chat && input().value === "단축키 초안",
      "단축키 반복으로 새 대화가 생성되거나 초안 유실",
    );
    assert(
      !host?.querySelector(".search-modal[open], .command-picker-modal[open]"),
      "다른 모달이 함께 열림",
    );
    assert(prompt === "", "단축키만 눌렀는데 AI 요청 실행");
    input().value = "";
    chat.close();
    await tick();
  },
);
await check(
  "AI 음성은 입력창에서 수정한 후 전송하고 제안 확인 전에는 저장하지 않는다",
  async () => {
    palette.open("ai");
    await tick();
    input().value = "내 작업";
    button("음성 입력").click();
    voiceTranscript?.("담당자를 변경해 줘");
    assert(input().value === "내 작업 담당자를 변경해 줘", "음성 전사 누락");
    assert(writes.length === 0, "음성이 자동 저장됨");
    dialog().querySelector("form")?.requestSubmit();
    await tick();
    assert(prompt === "", "전사 중에 Enter가 요청을 보냈다");
    button("음성 입력 중지").click();
    input().value += " 모의 사용자에게";
    dialog().querySelector("form")?.requestSubmit();
    await tick();
    await tick();
    assert(prompt.endsWith("모의 사용자에게"), "편집한 전사가 전달되지 않음");
    assert(writes.length === 0, "제안 단계에서 저장됨");
    assert(
      dialog().querySelector(".command-proposal strong")?.textContent ===
        "모의 사용자",
      "ID 대신 실제 이름을 표시하지 않음",
    );
    holdChange = true;
    button("1개 이슈에 적용").click();
    await tick();
    assert(
      noticeHost.hidden,
      "목록 갱신이 끝나기 전에 되돌리기 토스트가 나왔다",
    );
    holdChange = false;
    releaseChange?.();
    await tick();
    assert(
      writes.length === 1 && updates[0] === "AA-1",
      "적용 및 목록 갱신 누락",
    );
    const undo = noticeHost.querySelector<HTMLButtonElement>("button");
    if (!undo) throw new Error("되돌리기 버튼 누락");
    assert(
      dialog().getBoundingClientRect().bottom <= innerHeight - 8,
      "토스트가 있는 명령창이 화면 아래로 잘린다",
    );
    undo.focus();
    assert(
      document.activeElement === undo,
      "모달 바깥 토스트에 초점을 둘 수 없다",
    );
    undo.click();
    await tick();
    assert(
      writes.at(-1) === "/api/bulk-undo" && updates.length === 2,
      "토스트 되돌리기 누락",
    );
  },
);
await check(
  "닫았다 다시 연 AI 대화는 보이는 답변과 같은 대화를 이어간다",
  async () => {
    const chat = dialog();
    const closed = new Promise<void>((resolve) =>
      chat.addEventListener("close", () => resolve(), { once: true }),
    );
    chat.close();
    await closed;
    assert(
      noticeHost.parentElement === host,
      "명령창을 닫아도 토스트가 돌아오지 않았다",
    );
    palette.open("ai");
    input().value = "그 변경안의 대상은 누구였지?";
    dialog().querySelector("form")?.requestSubmit();
    await tick();
    assert(conversation === "test", "보이는 대화와 서버 대화가 끊겼다");
  },
);
await check(
  "Shift+Ctrl+P는 검색 가능한 명령 목록을 열고 전환해도 대화와 초안이 남는다",
  async () => {
    input().value = "아직 보내지 않은 초안";
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "P",
        ctrlKey: true,
        shiftKey: true,
        cancelable: true,
      }),
    );
    assert(
      !!host?.querySelector(".command-picker-modal[open]"),
      "명령 목록이 안 열림",
    );
    assert(
      dialog().querySelectorAll(".command-menu button").length === 3,
      "검색·AI·FAQ 명령 누락",
    );
    const query = dialog().querySelector<HTMLInputElement>(
      ".command-picker input",
    );
    if (!query) throw Error("명령 검색 누락");
    query.value = "AI";
    query.dispatchEvent(new Event("input"));
    assert(
      dialog().querySelectorAll(".command-menu button").length === 1,
      "명령 필터 실패",
    );
    query.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    assert(input().value === "아직 보내지 않은 초안", "팔레트에서 초안 유실");
    palette.open("search");
    await tick();
    assert(
      !dialog().querySelector("textarea, select, .chat-layout, [role=tab]"),
      "검색 모달에 AI UI가 섞임",
    );
    palette.open("ai");
    assert(
      !dialog().querySelector(".search-query, .search-form, [role=tab]"),
      "AI 모달에 검색 UI가 섞임",
    );
    assert(
      input().value === "아직 보내지 않은 초안",
      "검색 전환으로 초안 유실",
    );
    assert(
      dialog().querySelectorAll(".command-answer").length > 0,
      "검색 전환으로 대화 유실",
    );
  },
);
await check(
  "질문 후 닫아도 답변을 저장하고 새 화면의 대화 기록에서 복원·삭제한다",
  async () => {
    holdAnswer = true;
    input().value = `닫은 뒤에도 받을 답변\n${"긴 요청 내용을 확인해 주세요.\n".repeat(60)}`;
    dialog().querySelector("form")?.requestSubmit();
    await tick();
    const transcript = dialog().querySelector<HTMLElement>(".chat-transcript");
    const thinking = dialog().querySelector<HTMLElement>(
      ".command-results > .chat-pending",
    );
    assert(
      transcript && thinking,
      "생각 중 상태가 대화 메시지로 표시되지 않음",
    );
    if (transcript && thinking) {
      assert(
        transcript.scrollHeight > transcript.clientHeight,
        "긴 대화 스크롤 재현 실패",
      );
      assert(
        transcript.scrollHeight -
          transcript.scrollTop -
          transcript.clientHeight <
          2,
        "생각 중 메시지까지 스크롤되지 않음",
      );
      assert(
        thinking.getBoundingClientRect().bottom <=
          transcript.getBoundingClientRect().bottom,
        "생각 중 메시지가 입력창 아래 가려짐",
      );
    }
    dialog().close();
    await tick();
    holdAnswer = false;
    releaseAnswer?.();
    await tick();
    await tick();
    assert(unread, "닫힌 창의 새 답변 안내 누락");
    palette.destroy();
    palette = makePalette();
    palette.open("ai");
    await tick();
    assert(!unread, "대화를 봐도 새 답변 표시 잔존");
    assert(
      dialog()
        .querySelector(".command-results:not([hidden])")
        ?.textContent?.includes("닫은 뒤에도 받을 답변"),
      "새 화면에서 대화 복원 실패",
    );
    const restoredTranscript =
      dialog().querySelector<HTMLElement>(".chat-transcript");
    assert(restoredTranscript, "복원한 대화 영역 누락");
    if (restoredTranscript) {
      const atBottom = () =>
        restoredTranscript.scrollHeight -
          restoredTranscript.scrollTop -
          restoredTranscript.clientHeight <
        2;
      assert(atBottom(), "다시 연 대화가 최신 메시지에 있지 않음");
      restoredTranscript.scrollTop = 0;
      restoredTranscript.dispatchEvent(new Event("scroll"));
      const latest = dialog().querySelector<HTMLButtonElement>(
        '[aria-label="최신 메시지로"]',
      );
      assert(
        latest && !latest.hidden,
        "지난 대화에서 최신 메시지 이동 버튼 누락",
      );
      dialog()
        .querySelector(".command-results")
        ?.append(element("p", "", "추가 응답\n".repeat(20)));
      await tick();
      assert(
        restoredTranscript.scrollTop === 0 && !latest?.hidden,
        "이전 내용을 읽는데 새 응답이 스크롤을 하단으로 이동함",
      );
      latest?.click();
      assert(
        atBottom() && latest?.hidden,
        "최신 메시지 이동 후 버튼이 남거나 하단에 도착하지 않음",
      );
      restoredTranscript.scrollTop = 0;
      dialog().close();
      palette.open("ai");
      await tick();
      assert(atBottom(), "같은 대화를 다시 열면 스크롤이 이전 위치에 남음");
    }
    assert(
      dialog().querySelectorAll(".command-proposal").length === 0,
      "이전 변경안을 재실행할 수 있다",
    );
    button("대화 시작").click();
    input().value = "두 번째 대화";
    dialog().querySelector("form")?.requestSubmit();
    await tick();
    await tick();
    assert(
      dialog().querySelectorAll(".chat-conversation").length === 2,
      "새 대화가 이전 기록을 덮어씀",
    );
    const previous = [
      ...dialog().querySelectorAll<HTMLButtonElement>(
        ".chat-conversation-open",
      ),
    ].find((item) => item.textContent?.includes("닫은 뒤에도 받을 답변"));
    previous?.click();
    await tick();
    const switchedTranscript =
      dialog().querySelector<HTMLElement>(".chat-transcript");
    assert(
      switchedTranscript &&
        switchedTranscript.scrollHeight -
          switchedTranscript.scrollTop -
          switchedTranscript.clientHeight <
          2,
      "대화 전환 후 최신 메시지가 보이지 않음",
    );
    const first = dialog().querySelector<HTMLButtonElement>(
      ".chat-conversation button",
    );
    first?.click();
    assert(
      dialog().querySelector(".command-answer"),
      "기록에서 대화 열기 실패",
    );
    button("대화 삭제").click();
    assert(
      dialog().querySelectorAll(".chat-conversation").length === 1,
      "직접 삭제 실패",
    );
    dialog()
      .querySelector<HTMLButtonElement>(".chat-conversation button")
      ?.click();
  },
);
await check(
  "전용 대화는 제공자 원본 링크 대신 보관한 대화 내용을 복사한다",
  async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copied = text;
        },
      },
    });
    try {
      button("대화 내용 복사").click();
      await tick();
      assert(
        copied.includes("## 나") && !copied.includes("codex://"),
        "보관한 대화 내용 복사 누락",
      );
      button("대화 시작").click();
      assert(
        !dialog().querySelector(".command-head [aria-label='대화 내용 복사']"),
        "대화 복사 버튼이 모달 상단에 남아 있음",
      );
      assert(
        dialog().querySelectorAll(
          ".chat-conversation [aria-label='대화 내용 복사']",
        ).length === 1,
        "보관한 대화의 복사 버튼 누락",
      );
      button("대화 내용 복사").click();
      await tick();
      assert(
        copied.includes("## 나") && !copied.includes("codex://"),
        "선택하지 않은 대화의 내용 복사 실패",
      );
      dialog()
        .querySelector<HTMLButtonElement>(".chat-conversation-open")
        ?.click();
      assert(
        !button("대화 내용 복사").hidden && !button("대화 내용 복사").disabled,
        "기록 복원 후 복사 비활성",
      );
    } finally {
      if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  },
);
await check(
  "모델 선택은 대화별로 남고 기록 열기가 새 대화 기본값을 바꾸지 않는다",
  async () => {
    const select = dialog().querySelector<HTMLSelectElement>("select");
    if (!select) throw Error("모델 누락");
    const proposalCount = dialog().querySelectorAll(".command-proposal").length;
    select.value = "other";
    select.dispatchEvent(new Event("change"));
    assert(
      dialog().querySelectorAll(".command-proposal").length === proposalCount,
      "모델 변경이 변경안 UI를 지웠다",
    );
    const currentMessages = dialog().querySelectorAll(".chat-message").length;
    assert(currentMessages > 0, "모델 변경이 대화를 초기화했다");
    assert(
      dialog().querySelector(".chat-event")?.textContent?.includes("모델을"),
      "모델 변경 이력 누락",
    );
    assert(
      !button("대화 내용 복사").hidden,
      "모델 변경으로 대화 복사 버튼이 사라짐",
    );
    input().value = "다른 모델로 이어가기";
    dialog().querySelector("form")?.requestSubmit();
    await tick();
    assert(
      requestedThread === "",
      "모델 변경 뒤 이전 Codex 원본 ID를 다시 전달함",
    );
    const existing = [
      ...dialog().querySelectorAll<HTMLButtonElement>(
        ".chat-conversation-open",
      ),
    ];
    assert(
      existing.some((x) => x.textContent?.includes("other")),
      "대화 모델 기록 누락",
    );
    button("대화 시작").click();
    assert(select.value === "other", "선택한 기본 모델 미반영");
    assert(
      input().placeholder === "어떤 작업을 도와드릴까요?",
      "새 대화 입력 안내 누락",
    );
    select.value = "test";
    select.dispatchEvent(new Event("change"));
    existing[0]?.click();
    assert(select.value === "other", "이전 대화 모델 복원 누락");
    assert(
      dialog().querySelector(".chat-event")?.textContent?.includes("모델을"),
      "다시 연 대화의 모델 변경 이력 누락",
    );
    assert(
      input().placeholder === "메시지를 입력하세요",
      "이어가는 대화 입력 안내 누락",
    );
    button("대화 시작").click();
    assert(select.value === "test", "대화 열기가 기본값을 덮어썼다");
    palette.destroy();
    palette = makePalette();
    palette.open("ai");
    await tick();
    button("대화 시작").click();
    assert(
      dialog().querySelector<HTMLSelectElement>("select")?.value === "test",
      "화면 재생성 후 기본 모델 복원 실패",
    );
  },
);
await check(
  "Claude 모델도 기본 선택을 저장하고 제공자·음성 지원을 구분한다",
  async () => {
    const select = dialog().querySelector<HTMLSelectElement>("select");
    if (!select) throw new Error("모델 없음");
    assert(
      [...select.querySelectorAll("optgroup")]
        .map((group) => group.label)
        .join(",") === "Codex,Claude",
      "제공자별 선택지 구분 누락",
    );
    assert(
      [...select.options].every(
        (option) => !/^(Codex|Claude) · /.test(option.textContent ?? ""),
      ),
      "모델 이름에 제공자 중복",
    );
    select.value = "claude:sonnet";
    select.dispatchEvent(new Event("change"));
    assert(
      dialog().querySelector(".chat-provider")?.textContent === "Claude",
      "제공자 표시가 Codex에 머묾",
    );
    assert(button("음성 입력").disabled, "Claude 전용 음성 입력으로 오인됨");
    button("대화 시작").click();
    assert(select.value === "claude:sonnet", "Claude 기본 모델 미보관");
    assert(
      dialog()
        .querySelector(".chat-capabilities")
        ?.textContent?.includes("CLI 별칭"),
      "모델 조회 방식을 표시하지 않음",
    );
    select.value = "test";
    select.dispatchEvent(new Event("change"));
    assert(!button("음성 입력").disabled, "Codex로 돌아와도 마이크가 비활성");
  },
);
await check(
  "실패한 요청은 대화에 남기고 입력란을 다시 채우지 않으며 새 초안도 보존한다",
  async () => {
    fail = true;
    input().value = "실패할 요청";
    dialog().querySelector("form")?.requestSubmit();
    await tick();
    assert(
      input().value === "" && dialog().textContent?.includes("모의 연결 실패"),
      "보낸 메시지를 입력란에 다시 채우거나 실패 안내 누락",
    );
    assert(
      dialog()
        .querySelector(".chat-error:last-child .chat-execution-note")
        ?.textContent?.includes("다시 실행하기 전에"),
      "연결 실패의 불확실한 실행 결과를 안내하지 않음",
    );
    assert(
      dialog().textContent?.includes("실패할 요청"),
      "실패한 요청이 대화에서 사라짐",
    );
    const failure = dialog().querySelector(".chat-error:last-child");
    assert(
      failure?.getAttribute("role") === "alert" &&
        !failure.querySelector(".chat-message-actions"),
      "오류가 답변으로 표시되거나 복사 동작이 붙음",
    );
    holdAnswer = true;
    input().value = "다시 보낼 요청";
    dialog().querySelector("form")?.requestSubmit();
    await tick();
    input().value = "새로 작성 중인 내용";
    releaseAnswer?.();
    await tick();
    holdAnswer = false;
    assert(input().value === "새로 작성 중인 내용", "실패로 새 초안을 덮어씀");
    dialog().style.width = "300px";
    await tick();
    assert(
      dialog().scrollWidth <= dialog().clientWidth + 1,
      "좁은 명령창 가로 넘침",
    );
    dialog().style.width = "";
    palette.destroy();
    palette = makePalette();
    palette.open("ai");
    await tick();
    const restoredError = dialog().querySelector(".chat-error:last-child");
    assert(
      restoredError?.getAttribute("aria-label") === "요청 오류" &&
        !restoredError.querySelector("button"),
      "복원한 오류가 답변으로 표시됨",
    );
    dialog().close();
  },
);
await check(
  "메시지는 기본 서식을 읽기 쉽게 표시하고 HTML을 실행하지 않는다",
  async () => {
    const row = chatMessage(
      "assistant",
      "## 작업 요약\n**확인할 내용**과 `AA-1`\n<script>throw Error('x')</script>\nhttps://example.com\n```html\n<img src=x>\n```",
      "검사 모델",
    );
    assert(
      row.querySelector("strong")?.textContent === "확인할 내용",
      "강조 표시 실패",
    );
    assert(
      row.querySelector("pre code")?.textContent?.includes("<img src=x>"),
      "코드 표시 실패",
    );
    assert(!row.querySelector("script,img"), "AI 메시지에서 HTML을 실행했다");
    assert(
      row.querySelector<HTMLAnchorElement>("a")?.href ===
        "https://example.com/",
      "안전한 링크 표시 실패",
    );
  },
);
await check(
  "마크다운 표·목록은 구조로 렌더링하고 표 안의 Jira 링크도 내부 상세로 연다",
  async () => {
    let opened = "";
    const source =
      "| 이슈 | 상태 | 근거 |\n| --- | --- | --- |\n| [AA-853 · 자료 등록 개선](https://fixture.atlassian.net/browse/AA-853) | **PR 대기중** | PR 병합 확인 |\n| AA-787 | 개발 중 | 값 A\\|B |\n\n1. 상태 확인\n2. 다음 작업\n\n> 완료 기준을 확인하세요.";
    const row = chatMessage("assistant", source, "검사 모델", {
      site: "fixture.atlassian.net",
      select: (key) => {
        opened = key;
      },
    });
    assert(
      row.querySelectorAll("table thead th").length === 3 &&
        row.querySelectorAll("table tbody tr").length === 2,
      "표 구조가 생성되지 않음",
    );
    assert(
      row.querySelector("tbody strong")?.textContent === "PR 대기중",
      "셀 안 서식 누락",
    );
    assert(
      row.querySelector("tbody tr:last-child td:last-child")?.textContent ===
        "값 A|B",
      "셀 안 이스케이프된 파이프 처리 실패",
    );
    assert(
      row.querySelectorAll("ol li").length === 2 &&
        row.querySelector("blockquote"),
      "목록·인용문 서식 누락",
    );
    row.querySelector<HTMLAnchorElement>("tbody a")?.click();
    assert(opened === "AA-853", "표 안의 내부 이슈 링크 연결 실패");
    const box = element("div");
    box.style.width = "300px";
    box.append(row);
    host.append(box);
    const wrap = row.querySelector<HTMLElement>(".chat-table-wrap");
    assert(
      wrap &&
        wrap.scrollWidth > wrap.clientWidth &&
        box.scrollWidth <= box.clientWidth + 1,
      "표가 좁은 패널 전체를 밀어냄",
    );
    box.remove();
    const user = chatMessage("user", source);
    assert(
      !user.querySelector("table") && user.textContent === source,
      "사용자 입력을 마크다운으로 변환함",
    );
    for (let n = 1; n <= source.length; n += 7)
      chatMessage("assistant", source.slice(0, n));
  },
);
await check(
  "마크다운으로 HTML·외부 이미지·위험한 URL을 실행하지 않는다",
  async () => {
    const row = chatMessage(
      "assistant",
      "<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n![외부 이미지](https://example.com/tracker.png)\n[위험](javascript:alert(1))\n[데이터](data:text/html,hello)\n[메일](mailto:test@example.com)",
    );
    assert(
      !row.querySelector("script,img,iframe,svg,[onerror]"),
      "신뢰하지 않은 요소를 생성함",
    );
    assert(
      [...row.querySelectorAll<HTMLAnchorElement>("a")].every((link) =>
        ["https:", "http:"].includes(new URL(link.href).protocol),
      ),
      "허용하지 않은 프로토콜의 링크를 생성함",
    );
    assert(row.textContent?.includes("<script>"), "HTML 원문 표시 누락");
  },
);
await check(
  "Jira 링크의 제목은 보존하고 원문 주소만 이슈 번호로 줄여 내부 상세로 이동한다",
  async () => {
    let opened = "";
    const row = chatMessage(
      "assistant",
      "[모의 상위 작업 · AA-17](https://fixture.atlassian.net/browse/AA-17)을 생성했습니다.\nhttps://fixture.atlassian.net/browse/AA-18\n[참고](https://example.com/reference)\n[위험](javascript:alert(1))\n**[AA-19](https://fixture.atlassian.net/browse/AA-19)**",
      "검사 모델",
      {
        site: "fixture.atlassian.net",
        select: (key) => {
          opened = key;
        },
      },
    );
    const links = [...row.querySelectorAll<HTMLAnchorElement>("a")];
    assert(links.length === 4, "링크 파싱 실패 또는 위험 링크 생성");
    assert(
      links[0]?.textContent === "모의 상위 작업 · AA-17" &&
        links[0]?.getAttribute("href") === "?issue=AA-17",
      "마크다운 Jira 링크가 외부 주소로 표시됨",
    );
    assert(
      links[1]?.textContent === "AA-18" && !links[1]?.target,
      "Jira 주소가 이슈 번호로 축약되지 않음",
    );
    assert(
      links[2]?.textContent === "참고" &&
        links[2]?.href === "https://example.com/reference",
      "일반 외부 링크 손상",
    );
    assert(
      links[3]?.textContent === "AA-19" && links[3]?.closest("strong"),
      "강조 안의 Jira 링크가 변환되지 않음",
    );
    links[0]?.click();
    assert(opened === "AA-17", "내부 상세 콜백 누락");
    assert(
      !row.textContent?.includes("fixture.atlassian.net"),
      "Jira 원문 주소가 노출됨",
    );
  },
);
await check(
  "대괄호가 포함된 실제 이슈 제목도 링크 레이블과 번호를 유지한다",
  async () => {
    const row = chatMessage(
      "assistant",
      "[[창체] 프롬프트 검증](https://fixture.atlassian.net/browse/AA-20)",
      "검사 모델",
      { site: "fixture.atlassian.net", select: () => {} },
    );
    const link = row.querySelector("a");
    assert(
      link?.textContent === "[창체] 프롬프트 검증 (AA-20)",
      "제목이나 번호가 사라짐",
    );
    assert(link?.getAttribute("href") === "?issue=AA-20", "내부 링크가 아님");
  },
);
await check(
  "공통 카드 sm은 정보를 유지하고 태블릿 이하의 기본 카드에도 같은 크기를 적용한다",
  async () => {
    const value = {
      ...issue,
      summary: "짧은 제목",
      assignee: "검사자",
      assigneeId: "member-test",
      commentCount: 3,
    };
    const options = { statusOrder: [], onSelect: () => {} };
    const standard = issueCard(value, options),
      small = issueCard(value, { ...options, size: "sm" });
    const box = element("div");
    box.style.width = "700px";
    box.append(standard, small);
    host?.append(box);
    await tick();
    try {
      const normalRow = standard.querySelector<HTMLElement>(".list-item");
      const smallRow = small.querySelector<HTMLElement>(".list-item");
      if (!normalRow || !smallRow) throw new Error("카드 누락");
      const responsiveSmall = innerWidth <= 900;
      assert(
        responsiveSmall
          ? Math.abs(
              smallRow.getBoundingClientRect().height -
                normalRow.getBoundingClientRect().height,
            ) < 1
          : smallRow.getBoundingClientRect().height <
              normalRow.getBoundingClientRect().height,
        "공통 카드 크기가 화면 밀도와 일치하지 않음",
      );
      for (const selector of [".list-title", ".status-pill"]) {
        const normal = standard.querySelector<HTMLElement>(selector),
          compact = small.querySelector<HTMLElement>(selector);
        if (!normal || !compact) throw new Error("공통 카드 정보 누락");
        const compactSize = parseFloat(getComputedStyle(compact).fontSize);
        const normalSize = parseFloat(getComputedStyle(normal).fontSize);
        assert(
          responsiveSmall
            ? compactSize === normalSize
            : compactSize < normalSize,
          `${selector} 크기가 화면 밀도와 일치하지 않음`,
        );
      }
      const normalAvatar = standard.querySelector<HTMLElement>(
        ".participant-avatars .avatar",
      );
      const smallAvatar = small.querySelector<HTMLElement>(
        ".participant-avatars .avatar",
      );
      if (!normalAvatar || !smallAvatar)
        throw new Error("작업참여자 아바타 누락");
      assert(
        responsiveSmall
          ? normalAvatar.offsetWidth === smallAvatar.offsetWidth
          : normalAvatar.offsetWidth > smallAvatar.offsetWidth,
        "아바타 크기가 공통 밀도와 다름",
      );
      assert(
        small.textContent === standard.textContent,
        "sm 크기에서 카드 정보가 누락됨",
      );
    } finally {
      box.remove();
    }
  },
);
await check("검색과 AI 대화의 여백도 공통 밀도를 따른다", async () => {
  const small = innerWidth <= 900;
  palette.open("search");
  await tick();
  const searchPanel = host.querySelector<HTMLElement>(
    ".search-modal .command-panel",
  );
  assert(searchPanel, "검색 본문 누락");
  if (!searchPanel) return;
  assert(
    Number.parseFloat(getComputedStyle(searchPanel).paddingLeft) ===
      (small ? 12 : 16),
    "검색 여백이 공통 밀도를 따르지 않음",
  );
  palette.open("ai");
  await tick();
  const transcript = host.querySelector<HTMLElement>(".chat-transcript");
  const composer = host.querySelector<HTMLElement>(".chat-main .command-form");
  assert(transcript && composer, "AI 대화 영역 누락");
  if (!transcript || !composer) return;
  assert(
    Number.parseFloat(getComputedStyle(transcript).paddingTop) ===
      (small ? 14 : 20) &&
      Number.parseFloat(getComputedStyle(composer).paddingTop) ===
        (small ? 8 : 10),
    "AI 대화와 입력창 여백이 공통 밀도를 따르지 않음",
  );
});
await check(
  "연결 도구 승인은 대화 안에 표시하고 거절 후에도 완료 상태를 유지한다",
  async () => {
    fail = false;
    palette.open("ai");
    holdApproval = true;
    input().value = "모의 Slack 작업";
    dialog().querySelector("form")?.requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert(
      dialog().querySelector(".assistant-approval"),
      "대화 안 승인 카드 누락",
    );
    assert(pendingApproval, "확인 전 실행 금지");
    assert(
      dialog().dataset.aiState === "waiting",
      "승인 대기 중 효과가 멈추지 않음",
    );
    const deny = dialog().querySelector<HTMLInputElement>(
      ".assistant-approval input[value=deny]",
    );
    if (deny) {
      deny.checked = true;
      deny.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await tick();
    holdApproval = false;
    approvalAccepted = false;
    assert(
      !dialog().querySelector(".assistant-approval"),
      "완료된 승인 카드 잔존",
    );
    assert(
      !dialog().textContent?.includes("생각하고 있어요"),
      "응답 후 생각 중 상태 잔존",
    );
    assert(
      [...dialog().querySelectorAll(".chat-event")].some((event) =>
        event.textContent?.includes("건너뛸게요"),
      ),
      "승인 거절 기록 누락",
    );
    dialog().close();
    palette.open("ai");
    await tick();
    assert(
      [...dialog().querySelectorAll(".chat-event")].some((event) =>
        event.textContent?.includes("건너뛸게요"),
      ),
      "대화를 다시 연 뒤 승인 기록 유실",
    );
  },
);
await check(
  "로컬 명령도 같은 승인 카드에서 목적·작업 폴더·명령을 보여주고 거절할 수 있다",
  async () => {
    localApproval = true;
    holdApproval = true;
    try {
      input().value = "AA-1 코드 검증";
      dialog().querySelector("form")?.requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const card = dialog().querySelector(".assistant-approval");
      assert(card?.textContent?.includes("npm test"), "승인 명령 누락");
      assert(card?.textContent?.includes("/project"), "작업 폴더 누락");
      assert(pendingApproval, "확인 전 실행됨");
      const deny = card?.querySelector<HTMLInputElement>("input[value=deny]");
      assert(deny, "거절 선택지 누락");
      if (deny) {
        deny.checked = true;
        deny.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await tick();
      assert(!approvalAccepted && !pendingApproval, "거절한 명령 승인됨");
    } finally {
      localApproval = false;
      holdApproval = false;
    }
  },
);
await check(
  "승인 후 변경한 이슈만 갱신하고 생성 초안 모달 버튼을 표시하지 않는다",
  async () => {
    fail = false;
    palette.open("ai");
    holdApproval = true;
    const before = updates.length;
    input().value = "작업 변경";
    dialog().querySelector("form")?.requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const approve = dialog().querySelector<HTMLInputElement>(
      ".assistant-approval input[value=allow]",
    );
    if (approve) {
      approve.checked = true;
      approve.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await tick();
    holdApproval = false;
    assert(updates.length === before + 1, "변경한 이슈 갱신 누락");
    assert(
      !dialog().querySelector(".create-draft-card"),
      "생성 모달 우회 카드가 남았다",
    );
  },
);
await check(
  "AI 도움말은 제목 옆에서 열고 하단 안내를 남기지 않는다",
  async () => {
    palette.open("ai");
    const help = dialog().querySelector<HTMLButtonElement>(
      '.command-heading [aria-label="AI 대화 도움말"]',
    );
    assert(help, "제목 옆 도움말");
    input().value = "아직 보내지 않은 입력";
    help?.click();
    await tick();
    const panel = dialog().querySelector<HTMLElement>(".ai-chat-help");
    assert(panel?.matches(":popover-open"), "도움말 열기");
    assert(
      panel && Number.parseFloat(getComputedStyle(panel).paddingLeft) >= 12,
      "옵션 목록 스타일이 도움말 안쪽 여백을 덮어씀",
    );
    assert(
      panel?.textContent?.includes("보관 안내") &&
        panel?.textContent?.includes("연결 및 지원 상태"),
      "도움말 내용",
    );
    assert(
      !dialog().querySelector(".chat-main .command-hint,.chat-footer"),
      "하단 도움말 잔존",
    );
    help?.click();
    assert(!panel?.matches(":popover-open"), "도움말 닫기");
    assert(input().value === "아직 보내지 않은 입력", "입력 보존");
  },
);
await check(
  "제목 옆 AI 설정에서 보내기 방식을 바꾸고 다시 열어도 유지한다",
  async () => {
    const settings = button("AI 대화 설정");
    assert(
      settings.parentElement === button("AI 대화 도움말").parentElement,
      "설정 위치",
    );
    settings.click();
    await tick();
    const option = dialog().querySelector<HTMLInputElement>(
      '[aria-label="메시지 보내기 방식"] input[value="shortcut"]',
    );
    const settingsPanel =
      dialog().querySelector<HTMLElement>(".ai-chat-settings");
    assert(
      settingsPanel &&
        Number.parseFloat(getComputedStyle(settingsPanel).paddingLeft) >= 12,
      "설정 내용이 팝오버 가장자리에 붙음",
    );
    assert(option, "Enter 줄바꿈 라디오 선택지");
    option?.click();
    assert(option?.checked, "모드 변경");
    input().value = "보내기 방식 검사";
    const before = prompt;
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    input().dispatchEvent(enter);
    await tick();
    assert(!enter.defaultPrevented && prompt === before, "Enter가 전송했다");
    const sendKey = new KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    input().dispatchEvent(sendKey);
    await tick();
    assert(
      sendKey.defaultPrevented && prompt === "보내기 방식 검사",
      "Ctrl Enter 전송",
    );
    palette.destroy();
    palette = makePalette();
    palette.open("ai");
    await tick();
    const restored = dialog().querySelector<HTMLInputElement>(
      '[aria-label="메시지 보내기 방식"] input:checked',
    );
    assert(restored?.value === "shortcut", "모드 복원");
    if (restored) {
      chooseChatSetting("메시지 보내기 방식", "enter");
    }
    input().value = "기본 Enter 검사";
    input().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    await tick();
    assert(prompt === "기본 Enter 검사", "기본 모드 전송");
  },
);
await check(
  "실행하지 않은 답변은 확인된 결과가 없음을 표시하고 기록 복원 후에도 유지한다",
  async () => {
    noExecution = true;
    try {
      input().value = "읽기 전용으로 방향을 제안해 줘";
      dialog().querySelector("form")?.requestSubmit();
      await tick();
      await tick();
      assert(
        dialog().querySelector(".chat-message:last-child .chat-execution-note"),
        "실행 없는 답변의 상태 누락",
      );
      palette.destroy();
      palette = makePalette();
      palette.open("ai");
      await tick();
      assert(
        dialog().querySelector(".chat-message:last-child .chat-execution-note"),
        "대화 복원 후 실행 상태 유실",
      );
    } finally {
      noExecution = false;
      executionPreview = false;
    }
  },
);
await check(
  "실행 결과는 완료·미실행·실패와 내부 링크를 표시하고 기록에도 남긴다",
  async () => {
    executionPreview = true;
    try {
      input().value = "생성과 두 개 수정에 대한 모의 결과";
      dialog().querySelector("form")?.requestSubmit();
      await tick();
      await tick();
      const result = dialog().querySelector(".chat-message:last-child");
      assert(
        result
          ?.querySelector(".chat-execution-result")
          ?.textContent?.includes("완료") &&
          result.textContent.includes("미실행") &&
          result.textContent.includes("실패"),
        "부분 실행 상태 누락",
      );
      assert(
        result
          ?.querySelector(".command-answer")
          ?.textContent?.includes("상위는 모의 창체 개선"),
        "실행 결과가 후속 질문을 덮어씀",
      );
      const link = result?.querySelector<HTMLAnchorElement>(
        'a[href="?issue=AA-99"]',
      );
      assert(
        link?.textContent === "AA-99",
        "앞의 대괄호 제목이 결과 링크에 섞임",
      );
      palette.destroy();
      palette = makePalette();
      palette.open("ai");
      await tick();
      assert(
        dialog()
          .querySelector(".chat-message:last-child")
          ?.textContent?.includes("모의 권한 오류"),
        "실행 기록 복원 실패",
      );
    } finally {
      executionPreview = false;
    }
  },
);
await check(
  "연결 유실은 결과 불확실성을 알리고 보낸 메시지를 기록하며 자동 재실행하지 않는다",
  async () => {
    networkFailure = true;
    try {
      const before = assistantCalls;
      input().value = "연결 유실을 재현할 모의 요청";
      dialog().querySelector("form")?.requestSubmit();
      await tick();
      await tick();
      const result = dialog().querySelector(".chat-error:last-child");
      assert(result?.textContent?.includes("연결이 끊"), "연결 오류 안내 누락");
      assert(
        result?.textContent?.includes("저장됐을 수"),
        "실행 결과를 미실행으로 단정함",
      );
      assert(
        !result?.textContent?.includes("Failed to fetch"),
        "기술 오류만 표시됨",
      );
      assert(
        input().value === "" &&
          dialog().textContent?.includes("연결 유실을 재현할 모의 요청"),
        "보낸 메시지를 다시 채우거나 대화 기록을 지움",
      );
      assert(assistantCalls === before + 1, "생성 요청을 자동 재실행함");
    } finally {
      networkFailure = false;
    }
  },
);
await check("destroy는 단축키와 명령창을 해제한다", async () => {
  palette.destroy();
  notice.destroy();
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", metaKey: true }),
  );
  assert(!host?.querySelector("dialog"), "해제 후 명령창 잔존");
});
await check("AI 미연결 진입점·음성 지원·열린 대화 보존", async () => {
  const available = { chat: false, voice: false };
  palette = makePalette(available);
  palette.open("ai");
  assert(!host?.querySelector(".ai-modal[open]"), "미연결 AI 열림");
  palette.openCommands();
  assert(
    ![...(host?.querySelectorAll(".command-menu button") ?? [])].some(
      (button) => button.textContent?.includes("AI 대화"),
    ),
    "AI 명령 잔존",
  );
  assert(
    [...(host?.querySelectorAll(".command-menu button") ?? [])].some((button) =>
      button.textContent?.includes("검색"),
    ),
    "검색 명령 누락",
  );
  available.chat = true;
  palette.refreshAvailability();
  palette.open("ai");
  await tick();
  input().value = "작성 중인 내용 유지";
  const mic = dialog().querySelector<HTMLButtonElement>(
    'button[aria-label="음성 입력"]',
  );
  assert(mic?.hidden, "미지원 음성 노출");
  available.voice = true;
  palette.refreshAvailability();
  await tick();
  assert(mic && !mic.hidden, "지원 음성 숨김");
  const selected = dialog().querySelector<HTMLSelectElement>(".command-model");
  if (!selected || !mic) throw new Error("모델 또는 마이크 누락");
  selected.value = "claude:sonnet";
  selected.dispatchEvent(new Event("change", { bubbles: true }));
  assert(!mic.disabled, "대화 모델 때문에 별도 음성 연결이 차단됨");
  available.chat = false;
  available.voice = false;
  palette.refreshAvailability();
  assert(dialog().open, "연결 실패로 대화 닫힘");
  assert(input().value === "작성 중인 내용 유지", "작성문 유실");
  palette.destroy();
});
await check(
  "FAQ 명령은 AI·Jira 조회 없이 질문 검색·답변·뒤로 가기를 제공한다",
  async () => {
    const required = <T>(value: T | null | undefined): T => {
      if (value == null) throw new Error("FAQ 검사 요소 누락");
      return value;
    };
    const palette = makePalette({ chat: false, voice: false });
    const reads = searchCalls,
      local = localReads,
      written = writes.length;
    palette.openCommands();
    const command = [
      ...host.querySelectorAll<HTMLButtonElement>(".command-menu button"),
    ].find((button) => button.textContent === "FAQ 검색");
    assert(command, "FAQ 명령 없음");
    required(command).click();
    const faq = required(host.querySelector<HTMLDialogElement>(".faq-dialog"));
    assert(faq?.open, "FAQ 닫힘");
    const query = required(
      faq.querySelector<HTMLInputElement>('[aria-label="FAQ 질문 검색"]'),
    );
    const form = required(faq.querySelector<HTMLElement>(".faq-search"));
    const formRect = form.getBoundingClientRect();
    const inputRect = query.getBoundingClientRect();
    assert(inputRect.height >= 28, "검색 입력이 목록에 밀려 찌그러짐");
    assert(
      inputRect.left >= formRect.left + 3 &&
        inputRect.right <= formRect.right - 3,
      "검색 포커스 테두리가 본문 경계에 잘림",
    );
    assert(
      faq.querySelectorAll(".faq-group").length > 1,
      "검색 없이 주제별 질문을 볼 수 없음",
    );
    const topic = [
      ...faq.querySelectorAll<HTMLButtonElement>(".faq-topic"),
    ].find((button) => button.textContent?.includes("작업 만들기·변경"));
    required(topic).click();
    assert(
      faq.querySelectorAll(".faq-group").length === 1,
      "선택 주제 외 질문이 표시됨",
    );
    assert(
      faq.querySelectorAll(".faq-result").length > 1,
      "주제 내 여러 질문 누락",
    );
    query.value = "작업참여자";
    query.dispatchEvent(new Event("input", { bubbles: true }));
    const first = faq.querySelector<HTMLButtonElement>(".faq-result");
    assert(first?.textContent?.includes("담당자"), "질문 검색 누락");
    required(first).click();
    assert(
      faq.querySelector(".faq-answer")?.textContent?.includes("사용자 지정"),
      "답변 없음",
    );
    required(faq.querySelector<HTMLButtonElement>(".faq-back")).click();
    assert(
      faq.querySelector<HTMLInputElement>("input")?.value === "작업참여자",
      "돌아올 때 검색어 유실",
    );
    assert(
      faq
        .querySelector('.faq-topic[aria-pressed="true"]')
        ?.textContent?.includes("작업 만들기·변경"),
      "답변에서 돌아올 때 선택 주제 유실",
    );
    assert(
      searchCalls === reads &&
        localReads === local &&
        writes.length === written,
      "FAQ가 Jira를 조회·변경함",
    );
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const shortcuts = [
      {
        code: "KeyK",
        key: "k",
        shiftKey: false,
        ctrlKey: !mac,
        metaKey: mac,
        altKey: false,
        selector: ".search-modal",
      },
      {
        code: "KeyP",
        key: "P",
        shiftKey: true,
        ctrlKey: !mac,
        metaKey: mac,
        altKey: false,
        selector: ".command-picker-modal",
      },
    ];
    for (const shortcut of shortcuts) {
      palette.openFaq();
      window.dispatchEvent(
        new KeyboardEvent("keydown", { ...shortcut, cancelable: true }),
      );
      assert(!faq.open, "기능 단축키 실행 후 FAQ가 남음");
      assert(
        host.querySelector(`${shortcut.selector}[open]`),
        "단축키가 다른 화면을 엶",
      );
    }
    palette.destroy();
    assert(!host.querySelector(".faq-dialog"), "FAQ 정리 누락");
  },
);
function chooseChatSetting(label: string, value: string) {
  const radio = dialog().querySelector<HTMLInputElement>(
    `[aria-label="${label}"] input[value="${value}"]`,
  );
  assert(radio, `설정 선택지 누락: ${label} ${value}`);
  radio?.click();
}
async function openControlChat(modelId = "test") {
  palette = makePalette();
  palette.open("ai");
  await tick();
  const model = dialog().querySelector<HTMLSelectElement>(
    '[aria-label="대화 모델"]',
  );
  if (model) {
    model.value = modelId;
    model.dispatchEvent(new Event("change"));
  }
  chooseChatSetting("답변 중 추가 요청", "queue");
}
function endControlChat() {
  holdAnswer = false;
  releaseAnswer?.();
  palette.destroy();
}
await check(
  "답변 중 요청은 대기열에 보관하고 완료 후 순서대로 실행한다",
  async () => {
    await openControlChat();
    try {
      holdAnswer = true;
      const before = assistantCalls;
      input().value = "첫 요청";
      dialog().querySelector("form")?.requestSubmit();
      await tick();
      input().value = "다음 요청";
      dialog().querySelector("form")?.requestSubmit();
      await tick();
      assert(
        assistantCalls === before + 1 &&
          dialog().querySelector(".chat-queue-text")?.textContent ===
            "다음 요청",
        "대기열이 즉시 실행되거나 표시되지 않음",
      );
      holdAnswer = false;
      releaseAnswer?.();
      for (let n = 0; n < 100 && assistantCalls < before + 2; n++) await tick();
      assert(
        assistantCalls === before + 2 && prompt === "다음 요청",
        "다음 요청 자동 실행 누락",
      );
      await tick();
    } finally {
      endControlChat();
    }
  },
);
await check(
  "빈 입력창의 즉시 전달 단축키는 첫 대기 요청만 전달한다",
  async () => {
    for (const mode of ["enter", "shortcut"]) {
      await openControlChat();
      try {
        chooseChatSetting("메시지 보내기 방식", mode);
        holdAnswer = true;
        input().value = "진행 요청";
        dialog().querySelector("form")?.requestSubmit();
        await tick();
        for (const text of ["먼저 전달할 요청", "남겨둘 요청"]) {
          input().value = text;
          dialog().querySelector("form")?.requestSubmit();
          await tick();
        }
        const before = assistantCalls;
        input().dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            metaKey: true,
            shiftKey: mode === "shortcut",
            bubbles: true,
            cancelable: true,
          }),
        );
        await tick();
        assert(
          controls.at(-1)?.action === "steer" &&
            controls.at(-1)?.prompt === "먼저 전달할 요청",
          "빈 입력창에서 첫 대기 요청을 전달하지 않음",
        );
        assert(
          assistantCalls === before &&
            dialog().querySelector(".chat-queue-text")?.textContent ===
              "남겨둘 요청",
          "대기열 전체를 보내거나 새 답변을 시작함",
        );
      } finally {
        endControlChat();
        await tick();
      }
    }
  },
);
await check(
  "공개 중간 답변은 완료 전에 보이고 최종 답변은 중복되지 않는다",
  async () => {
    await openControlChat();
    try {
      streamReply = true;
      input().value = "중간 응답 확인";
      dialog().querySelector("form")?.requestSubmit();
      await tick();
      emitProgress?.({
        type: "message",
        id: "comment",
        text: "대상 작업을 먼저 확인하겠습니다.",
        replace: true,
      });
      for (
        let n = 0;
        n < 30 &&
        !dialog().textContent?.includes("대상 작업을 먼저 확인하겠습니다.");
        n++
      )
        await tick();
      assert(
        dialog().textContent?.includes("대상 작업을 먼저 확인하겠습니다."),
        "완료 전 중간 응답 누락",
      );
      emitProgress?.({
        type: "activity",
        text: "Jira 정보를 확인하고 있어요…",
      });
      await tick();
      assert(
        dialog().textContent?.includes("Jira 정보를 확인하고 있어요…"),
        "진행 상태 누락",
      );
      emitProgress?.({
        type: "message",
        id: "final",
        text: "작업 확인을 마쳤습니다.",
        replace: false,
      });
      emitProgress?.({
        type: "result",
        value: {
          conversationId: "test",
          answer: "작업 확인을 마쳤습니다.",
          proposals: [],
        },
      });
      for (let n = 0; n < 10; n++) await tick();
      assert(
        [...dialog().querySelectorAll(".command-answer")].filter((row) =>
          row.textContent?.includes("작업 확인을 마쳤습니다."),
        ).length === 1,
        "최종 답변이 중복됨",
      );
      assert(
        dialog().textContent?.includes("대상 작업을 먼저 확인하겠습니다."),
        "최종 응답 후 중간 응답 유실",
      );
    } finally {
      streamReply = false;
      emitProgress = undefined;
      palette.destroy();
    }
  },
);
await check(
  "상단 전송 설정의 즉시 전달은 진행 중 Codex에 지시를 추가한다",
  async () => {
    await openControlChat();
    try {
      holdAnswer = true;
      input().value = "진행 요청";
      dialog().querySelector("form")?.requestSubmit();
      await tick();
      button("AI 대화 설정").click();
      const settings = dialog().querySelector(".ai-chat-settings");
      assert(settings?.matches(":popover-open"), "상단 전송 설정 누락");
      chooseChatSetting("답변 중 추가 요청", "steer");
      const before = assistantCalls;
      input().value = "수정하지 말고 조회만 해";
      dialog().querySelector("form")?.requestSubmit();
      await tick();
      assert(
        controls.at(-1)?.action === "steer" &&
          controls.at(-1)?.prompt === "수정하지 말고 조회만 해" &&
          assistantCalls === before,
        "즉시 전달이 새 요청으로 실행됨",
      );
    } finally {
      endControlChat();
    }
  },
);
await check(
  "답변 중단은 대기 요청을 보존하고 직접 재개할 때만 실행한다",
  async () => {
    await openControlChat();
    try {
      holdAnswer = true;
      input().value = "중단할 요청";
      dialog().querySelector("form")?.requestSubmit();
      await tick();
      input().value = "중단 뒤 실행할 요청";
      dialog().querySelector("form")?.requestSubmit();
      await tick();
      const before = assistantCalls;
      button("답변 중단").click();
      for (
        let n = 0;
        n < 100 && !dialog().textContent?.includes("계속 보내기");
        n++
      )
        await tick();
      assert(controls.at(-1)?.action === "stop", "서버 중단 요청 누락");
      assert(
        assistantCalls === before && dialog().textContent?.includes("일시정지"),
        "중단이 대기열을 실행하거나 삭제함",
      );
      holdAnswer = false;
      button("계속 보내기").click();
      for (let n = 0; n < 100 && assistantCalls === before; n++) await tick();
      assert(
        assistantCalls === before + 1 && prompt === "중단 뒤 실행할 요청",
        "대기열 재개 누락",
      );
      await tick();
    } finally {
      endControlChat();
    }
  },
);
await check(
  "Claude 즉시 전달은 중단을 확인한 뒤 최근 대화로 이어서 실행한다",
  async () => {
    await openControlChat("claude:sonnet");
    try {
      holdAnswer = true;
      input().value = "기존 Claude 요청";
      dialog().querySelector("form")?.requestSubmit();
      await tick();
      chooseChatSetting("답변 중 추가 요청", "steer");
      assert(
        dialog()
          .querySelector(".ai-chat-settings")
          ?.textContent?.includes("Claude의 즉시 전달"),
        "Claude 동작 차이 안내 누락",
      );
      const before = assistantCalls;
      holdAnswer = false;
      input().value = "새 Claude 지시";
      dialog().querySelector("form")?.requestSubmit();
      for (let n = 0; n < 100 && assistantCalls === before; n++) await tick();
      assert(
        controls.at(-1)?.action === "stop" &&
          assistantCalls === before + 1 &&
          prompt === "새 Claude 지시",
        "Claude 중단·이어서 실행 순서 오류",
      );
      await tick();
    } finally {
      endControlChat();
    }
  },
);
await check(
  "대기열·즉시 전달 키 안내와 실제 키 동작이 일치하고 기본값을 바꾸지 않는다",
  async () => {
    await openControlChat();
    try {
      chooseChatSetting("메시지 보내기 방식", "enter");
      assert(
        dialog()
          .querySelector(".chat-input-shortcuts")
          ?.textContent?.includes("Enter 전송"),
        "대기 상태 전송 키 안내 없음",
      );
      holdAnswer = true;
      input().value = "단축키 검사";
      dialog().querySelector("form")?.requestSubmit();
      await tick();
      assert(
        dialog()
          .querySelector(".chat-input-shortcuts")
          ?.textContent?.includes("Enter 대기열"),
        "답변 중 큐 단축키 안내 없음",
      );
      input().value = "단축키로 즉시 전달";
      const key = new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      input().dispatchEvent(key);
      await tick();
      assert(
        key.defaultPrevented &&
          controls.at(-1)?.action === "steer" &&
          controls.at(-1)?.prompt === "단축키로 즉시 전달",
        "보조 키가 즉시 전달하지 않음",
      );
      assert(
        dialog().querySelector<HTMLInputElement>(
          '[aria-label="답변 중 추가 요청"] input:checked',
        )?.value === "queue",
        "일회성 키가 기본 설정을 바꿈",
      );
      input().value = "기본 키로 대기열";
      input().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      await tick();
      assert(
        dialog().querySelector(".chat-queue-text")?.textContent ===
          "기본 키로 대기열",
        "기본 키 대기열 동작 누락",
      );
    } finally {
      endControlChat();
    }
  },
);
await check(
  "공통 멘션은 AI 전송·대기열·즉시 전달에서 이슈 ID를 유지한다",
  async () => {
    await openControlChat();
    try {
      async function selectMention() {
        const composer = input();
        composer.value = "@AA";
        composer.focus();
        composer.setSelectionRange(3, 3);
        composer.dispatchEvent(new InputEvent("input", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 350));
        composer.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        );
        assert(composer.value.startsWith("@AA-1 · "), "멘션 선택 실패");
      }
      holdAnswer = true;
      const before = assistantCalls;
      await selectMention();
      assert(assistantCalls === before, "선택하면서 전송됨");
      dialog().querySelector("form")?.requestSubmit();
      await tick();
      assert(prompt.includes('"id":"1"'), "일반 요청에 이슈 ID 누락");
      assert(
        dialog()
          .querySelector('.command-user .chat-mention[data-kind="issue"]')
          ?.textContent?.includes("AA-1"),
        "전송된 멘션 배지 누락",
      );
      await selectMention();
      dialog().querySelector("form")?.requestSubmit();
      await tick();
      assert(
        dialog()
          .querySelector(".chat-queue-text")
          ?.textContent?.startsWith("@AA-1 · "),
        "대기열 표시에 내부 데이터 노출",
      );
      button("지금 보내기").click();
      await tick();
      assert(
        controls.at(-1)?.prompt?.includes('"id":"1"'),
        "즉시 전달에 ID 누락",
      );
      assert(
        !dialog().querySelector(".chat-queue-text"),
        "전달한 대기 요청 잔존",
      );
    } finally {
      endControlChat();
    }
  },
);
await check(
  "저장한 멘션은 대화를 다시 열어도 배지를 복원하고 기존 이슈 표기도 안전하게 표시한다",
  async () => {
    palette.destroy();
    palette = makePalette();
    palette.open("ai");
    await tick();
    assert(
      dialog()
        .querySelector('.command-user .chat-mention[data-kind="issue"]')
        ?.textContent?.includes("AA-1"),
      "대화 복원 후 멘션 마크업 누락",
    );
    const old = chatMessage("user", "@AA-1 · 이전에 선택한 긴 제목… 확인해 줘");
    assert(
      old.querySelector(".chat-mention")?.textContent?.includes("이전"),
      "기존 이슈 멘션 표시 누락",
    );
    const plain = chatMessage("user", "<script>실행 안 함</script>");
    assert(!plain.querySelector("script"), "사용자 입력을 HTML로 실행함");
  },
);
await check(
  "AI 테두리는 생성·정상 완료·중단·오류를 구분하고 완료 효과는 한 번만 재생한다",
  async () => {
    const effectHost = element("div"),
      chatHost = element("aside");
    effectHost.style.height = "500px";
    effectHost.append(chatHost);
    document.body.append(effectHost);
    let complete:
      | ((value: Awaited<ReturnType<typeof api.assistantRun>>) => void)
      | undefined;
    let rejectRun: ((error: Error) => void) | undefined;
    const effectPalette = createCommandPalette({
      host: effectHost,
      chatHost,
      api: {
        ...api,
        assistantRun: async (
          _prompt,
          _context,
          _conversation,
          _model,
          signal,
        ) =>
          new Promise((resolve, reject) => {
            complete = resolve;
            rejectRun = reject;
            signal.addEventListener("abort", () => reject(new Error("취소")), {
              once: true,
            });
          }),
      },
      site: "fixture.atlassian.net",
      context: () => ({ projects: ["AA"], issue: "", keys: [] }),
      recent: () => [],
      localIssues: () => [],
      order: () => [],
      select: () => {},
      changed: async () => {},
      canMutate: () => true,
      notice: () => {},
    });
    try {
      effectPalette.open("ai");
      await tick();
      const panel = effectHost.querySelector<HTMLDialogElement>(".ai-modal");
      const composer = effectHost.querySelector<HTMLTextAreaElement>(
        ".command-form textarea",
      );
      assert(panel && composer, "효과 검사 UI 누락");
      if (!panel || !composer) return;
      const send = () => {
        composer.value = "모의 작업 확인";
        panel.querySelector("form")?.requestSubmit();
      };
      const reply = {
        conversationId: "effects",
        answer: "모의 작업을 확인했어요.",
        proposals: [],
      };
      send();
      await tick();
      assert(panel.dataset.aiState === "working", "생성 중 상태 누락");
      complete?.(reply);
      await tick();
      assert(panel.dataset.aiState === "complete", "완료 효과 누락");
      assert(
        getComputedStyle(panel, "::after").animationIterationCount === "1",
        "완료 효과가 반복됨",
      );
      await new Promise((resolve) => setTimeout(resolve, 950));
      assert(panel.dataset.aiState === "idle", "완료 효과가 끝나지 않음");
      panel.close();
      effectPalette.open("ai");
      await tick();
      assert(panel.dataset.aiState === "idle", "다시 열면서 완료 효과 재생됨");
      send();
      await tick();
      panel
        .querySelector<HTMLButtonElement>('[aria-label="답변 중단"]')
        ?.click();
      await tick();
      assert(panel.dataset.aiState === "idle", "중단 후 완료 효과가 남음");
      send();
      await tick();
      rejectRun?.(new Error("모의 실패"));
      await tick();
      assert(panel.dataset.aiState === "error", "실패가 완료로 표시됨");
      send();
      await tick();
      panel.close();
      complete?.(reply);
      await tick();
      effectPalette.open("ai");
      await tick();
      assert(
        panel.dataset.aiState === "idle",
        "닫힌 상태의 완료 효과가 다시 재생됨",
      );
    } finally {
      effectPalette.destroy();
      effectHost.remove();
    }
  },
);
await check(
  "작업 기록은 대상·결과를 구분하고 본문보다 작은 타이포로 표시한다",
  async () => {
    const event = chatEvent({
      text: "작업 과정 · 12초",
      details:
        "이슈 확인 · 완료\nAA-1 · 조회 경합 수정 · 개발 중\n\n이슈 검색 · 완료\nAA · AA-1 하위\n5건 확인",
    });
    if (event instanceof HTMLDetailsElement) event.open = true;
    host.append(event);
    try {
      const entries = event.querySelector<HTMLElement>(".chat-event-entries");
      const [first, second] =
        event.querySelectorAll<HTMLElement>(".chat-event-entry");
      if (!entries || !first || !second) throw new Error("작업 기록 누락");
      assert(
        first.getBoundingClientRect().left -
          entries.getBoundingClientRect().left >=
          12,
        "작업 기록 본문이 구분선에 붙음",
      );
      assert(
        second.getBoundingClientRect().top -
          first.getBoundingClientRect().bottom <=
          8,
        "작업 기록 항목 사이의 간격이 너무 넓음",
      );
      assert(
        event.querySelectorAll(".chat-event-entry").length === 2,
        "작업별 기록 구분 누락",
      );
      assert(!event.querySelector("pre"), "작업 기록이 코드 블록으로 표시됨");
      assert(
        event
          .querySelector(".chat-event-detail")
          ?.textContent?.includes("AA-1"),
        "대상 정보 누락",
      );
      const title = event.querySelector<HTMLElement>(".chat-event-title");
      assert(
        title && Number.parseFloat(getComputedStyle(title).fontSize) <= 12,
        "작업 기록 글자가 본문처럼 크게 표시됨",
      );
    } finally {
      event.remove();
    }
  },
);
await check(
  "추론 강도는 지원 모델만 선택·전송·복원하고 헤더 조작부의 중심선이 일치한다",
  async () => {
    const fixture = element("div");
    document.body.append(fixture);
    const saved = new Map<string, string>();
    const memory = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => {
        saved.set(key, value);
      },
    };
    let sentEffort: string | undefined;
    const make = () =>
      createCommandPalette({
        host: fixture,
        api: {
          ...api,
          assistantRun: async (
            _prompt,
            _context,
            _conversation,
            _model,
            _signal,
            _history,
            _request,
            _progress,
            effort,
          ) => {
            sentEffort = effort;
            return {
              conversationId: "effort-test",
              answer: "확인했어요.",
              proposals: [],
            };
          },
        },
        site: "fixture.atlassian.net",
        context: () => ({ projects: ["AA"], issue: "", keys: [] }),
        recent: () => [],
        localIssues: () => [],
        order: () => [],
        select: () => {},
        changed: async () => {},
        canMutate: () => true,
        notice: () => {},
        storage: memory,
        scope: "effort-test",
      });
    let view = make();
    try {
      view.open("ai");
      await tick();
      let panel = fixture.querySelector<HTMLDialogElement>(".ai-modal");
      let effort = panel?.querySelector<HTMLSelectElement>(
        '[aria-label="추론 강도"]',
      );
      assert(effort && !effort.hidden, "지원 추론 강도 선택기 누락");
      const header = panel?.querySelector<HTMLElement>(".command-head h2");
      if (header && panel)
        for (const button of panel.querySelectorAll<HTMLButtonElement>(
          ".command-head button:not([hidden])",
        )) {
          const a = header.getBoundingClientRect(),
            b = button.getBoundingClientRect();
          assert(
            Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 1,
            "AI 헤더 중심선 불일치",
          );
        }
      if (!effort || !panel) return;
      effort.value = "high";
      effort.dispatchEvent(new Event("change"));
      const composer = panel.querySelector<HTMLTextAreaElement>("textarea");
      if (composer) composer.value = "강도 확인";
      panel.querySelector("form")?.requestSubmit();
      await tick();
      assert(sentEffort === "high", "선택 강도가 요청에 전달되지 않음");
      view.destroy();
      view = make();
      view.open("ai");
      await tick();
      panel = fixture.querySelector<HTMLDialogElement>(".ai-modal");
      effort = panel?.querySelector<HTMLSelectElement>(
        '[aria-label="추론 강도"]',
      );
      assert(effort?.value === "high", "기존 대화의 추론 강도 복원 실패");
      const model = panel?.querySelector<HTMLSelectElement>(".command-model");
      if (model) {
        model.value = "claude:sonnet";
        model.dispatchEvent(new Event("change"));
      }
      assert(effort?.hidden, "지원 정보를 받지 않은 모델에 임의 강도 표시");
    } finally {
      view.destroy();
      fixture.remove();
    }
  },
);
document.body.dataset.result = failures ? "failed" : "passed";
results.append(
  element(
    "li",
    "",
    failures ? `${failures}개 실패` : "전체 검사 통과 · 실제 Jira 변경 없음",
  ),
);
fail = new URLSearchParams(location.search).has("failure");
const previewNoticeHost = element("div");
host.append(previewNoticeHost);
const previewNotice = createNotice(previewNoticeHost);
const preview = createCommandPalette({
  host,
  api,
  site: "fixture.atlassian.net",
  context: () => ({ projects: ["AA"], issue: "", keys: [] }),
  recent: () => [issue],
  localIssues: () => [issue],
  order: () => [],
  select: () => {},
  changed: async () => {},
  canMutate: () => true,
  notice: previewNotice.show,
  noticeHost: previewNoticeHost,
  voice: mockVoice,
});
const theme = new URLSearchParams(location.search).get("theme");
if (theme === "dark") document.documentElement.dataset.theme = "dark";
const show = element("button", "", "검사 창 열기");
show.addEventListener("click", () => preview.open("ai"));
host.append(show);
if (new URLSearchParams(location.search).has("preview")) {
  holdAnswer = new URLSearchParams(location.search).has("thinking");
  holdApproval = new URLSearchParams(location.search).has("approval");
  executionPreview = new URLSearchParams(location.search).has("result");
  streamReply = new URLSearchParams(location.search).has("stream");
  preview.open("ai");
  await tick();
  input().value = holdApproval
    ? "제목과 본문을 수정하고 하위 작업을 만들어줘"
    : "내가 맡은 진행 중 작업을 모의 사용자에게 넘겨줘";
  dialog().querySelector("form")?.requestSubmit();
}

if (new URLSearchParams(location.search).has("stream")) {
  await tick();
  emitProgress?.({
    type: "message",
    id: "intro",
    text: "담당한 작업을 확인한 뒤, 마감이 가까운 순서로 정리하겠습니다.",
    replace: true,
  });
  emitProgress?.({ type: "activity", text: "Jira 정보를 확인하고 있어요…" });
}
