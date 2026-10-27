import "../src/client/styles.css";
import { createApi } from "../src/client/api.ts";
import type { VoiceCallbacks } from "../src/client/codex-voice.ts";
import { emptyIssue } from "../src/domain/wire.ts";
import { chatMessage } from "../src/ui/chat-message.ts";
import { createCommandPalette } from "../src/ui/command-palette.ts";
import { element } from "../src/ui/dom.ts";
import { issueCard } from "../src/ui/issue-card.ts";
import { createNotice } from "../src/ui/notice.ts";

const host = document.querySelector<HTMLElement>("#fixture"),
  results = document.querySelector("#results");
if (!host || !results) throw new Error("fixture 누락");
let failures = 0;
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
let holdAnswer = false,
  releaseAnswer: (() => void) | undefined,
  unread = false;
const savedChats = new Map<string, string>();
const storage = {
  getItem: (key: string) => savedChats.get(key) ?? null,
  setItem: (key: string, value: string) => {
    savedChats.set(key, value);
  },
};
let localReads = 0,
  searchCalls = 0;
let localItems = [issue],
  holdSearch = false,
  failSearch = false;
let releaseSearch: (() => void) | undefined;
let prompt = "",
  searchQuery = "",
  fail = false;
let voiceTranscript: ((text: string) => void) | undefined;
function mockVoice(callbacks: VoiceCallbacks) {
  let active = false;
  voiceTranscript = callbacks.transcript;
  const stop = () => {
    active = false;
    callbacks.state(false, "");
  };
  return {
    start() {
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
        { id: "test", name: "검사 모델", isDefault: true },
        { id: "other", name: "다른 모델", isDefault: false },
      ],
      error: "",
    });
  if (path.pathname === "/api/assistant/run") {
    prompt = JSON.parse(String(init?.body)).prompt;
    conversation = JSON.parse(String(init?.body)).conversationId;
    if (holdAnswer)
      await new Promise<void>((resolve) => {
        releaseAnswer = resolve;
      });
    if (fail)
      return Response.json({ error: "모의 연결 실패" }, { status: 503 });
    return Response.json({
      conversationId: "test",
      answer: "대상 이슈를 확인했습니다. 아래 변경안을 확인하세요.",
      proposals: [{ keys: [issue.key], field: "assignee", value: "user" }],
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
function makePalette() {
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
  "AI 단축키는 별도 대화를 열고 반복해도 초안을 유지하며 입력창에 초점을 둔다",
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
      dialog().querySelectorAll(".command-menu button").length === 2,
      "두 명령 누락",
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
    input().value = "닫은 뒤에도 받을 답변";
    dialog().querySelector("form")?.requestSubmit();
    await tick();
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
  "모델 선택은 대화별로 남고 기록 열기가 새 대화 기본값을 바꾸지 않는다",
  async () => {
    const select = dialog().querySelector<HTMLSelectElement>("select");
    if (!select) throw Error("모델 누락");
    select.value = "other";
    select.dispatchEvent(new Event("change"));
    const currentMessages = dialog().querySelectorAll(".chat-message").length;
    assert(currentMessages > 0, "모델 변경이 대화를 초기화했다");
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
    select.value = "test";
    select.dispatchEvent(new Event("change"));
    existing[0]?.click();
    assert(select.value === "other", "이전 대화 모델 복원 누락");
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
  "실패한 요청은 입력을 복구하고 좁은 명령창에서 가로로 넘치지 않는다",
  async () => {
    fail = true;
    input().value = "실패할 요청";
    dialog().querySelector("form")?.requestSubmit();
    await tick();
    assert(
      input().value === "실패할 요청" &&
        dialog().textContent?.includes("모의 연결 실패"),
      "실패 입력·안내 누락",
    );
    dialog().style.width = "300px";
    await tick();
    assert(
      dialog().scrollWidth <= dialog().clientWidth + 1,
      "좁은 명령창 가로 넘침",
    );
    dialog().style.width = "";
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
  "공통 카드 sm은 정보를 유지하고 태블릿 이하의 기본 카드에도 같은 크기를 적용한다",
  async () => {
    const value = {
      ...issue,
      summary: "짧은 제목",
      assignee: "검사자",
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
      for (const selector of [".list-title", ".person-pill", ".status-pill"]) {
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
await check("destroy는 단축키와 명령창을 해제한다", async () => {
  palette.destroy();
  notice.destroy();
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "k", metaKey: true }),
  );
  assert(!host?.querySelector("dialog"), "해제 후 명령창 잔존");
});
document.body.dataset.result = failures ? "failed" : "passed";
results.append(
  element(
    "li",
    "",
    failures ? `${failures}개 실패` : "전체 검사 통과 · 실제 Jira 변경 없음",
  ),
);
fail = false;
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
  preview.open("ai");
  await tick();
  input().value = "내가 맡은 진행 중 작업을 모의 사용자에게 넘겨줘";
  dialog().querySelector("form")?.requestSubmit();
}
