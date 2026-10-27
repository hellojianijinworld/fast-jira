import { createApi } from "../src/client/api.ts";
import { createApp } from "../src/client/app.ts";
import { type AdfDocument, decodeAdfDocument } from "../src/domain/adf.ts";
import type { Comment } from "../src/domain/content.ts";
import type { LogEntry } from "../src/domain/log.ts";
import { record } from "../src/domain/validation.ts";
import { type ChangeBatch, emptyIssue } from "../src/domain/wire.ts";
import { element } from "../src/ui/dom.ts";
import { issueCard } from "../src/ui/issue-card.ts";
import { activityXML } from "./activity-fixture.ts";
import "../src/client/styles.css";

const root = document.querySelector<HTMLElement>("#app"),
  results = document.querySelector<HTMLOListElement>("#results");
if (!root || !results) throw new Error("검사 영역 누락");
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const values = new Map<string, string>([
  [
    "fastJira:filters:fixture.atlassian.net:my-account",
    JSON.stringify({ configured: true }),
  ],
]);
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    values.set(key, value);
  },
};
let activityItems = Array.from({ length: 10 }, (_, i) => ({
  id: String(10 - i),
  key: "TEST-1",
  author: i === 0 ? "나" : "동료",
  avatar: "",
  text: i === 0 ? "나 이슈를 만들었습니다" : `동료 활동 ${10 - i}`,
  created: new Date(Date.now() - (i + 1) * 60000).toISOString(),
}));
let activityFailed = false;
const issues = [
  {
    ...emptyIssue("TEST-1", "상위 계획"),
    status: "대기",
    statusId: "1",
    hasChildren: true,
    hierarchyLevel: 1,
    issueTypeId: "epic",
  },
  {
    ...emptyIssue("TEST-2", "다른 담당자의 중간 작업"),
    parent: "TEST-1",
    assigneeId: "other",
    assignee: "다른 사람",
    status: "진행 중",
    statusId: "2",
    hasChildren: true,
    hierarchyLevel: 0,
    issueTypeId: "task",
  },
  {
    ...emptyIssue("TEST-3", "내 하위 작업"),
    commentCount: 2,
    parent: "TEST-2",
    assigneeId: "my-account",
    assignee: "나",
    status: "완료",
    statusId: "3",
    statusCategory: "done",
    hierarchyLevel: -1,
    issueTypeId: "subtask",
  },
];
const statuses = [
  { id: "1", name: "대기", category: "new", projects: ["TEST"] },
  { id: "2", name: "진행 중", category: "indeterminate", projects: ["TEST"] },
  { id: "3", name: "완료", category: "done", projects: ["TEST"] },
];
let failSave = false;
let failChildren = false;
const details = (issue: (typeof issues)[number]) => ({
  ...issue,
  reporter: "작성자",
  reporterAvatar: "",
  created: "2026-10-01T08:00:00Z",
  url: `https://fixture.atlassian.net/browse/${issue.key}`,
  attachments: [],
  description: null,
});
let description: AdfDocument = {
  type: "doc",
  version: 1,
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "안전한 모의 본문" }],
    },
  ],
};
const mockComment = (
  id: string,
  parentId: string,
  authorId: string,
  body: AdfDocument = {
    type: "doc",
    version: 1,
    content: [
      { type: "paragraph", content: [{ type: "text", text: "모의 댓글" }] },
    ],
  },
): Comment => ({
  id,
  parentId,
  authorId,
  author: authorId === "my-account" ? "나" : "동료",
  avatar: "",
  created: "2026-10-01T08:00:00Z",
  updated: "2026-10-01T08:00:00Z",
  body,
});
const mockComments = new Map<string, Comment>([
  ["2", mockComment("2", "1", "other")],
  ["1", mockComment("1", "", "my-account")],
]);
let lastParent = "";
const calls: URL[] = [];
let changes: ChangeBatch = { issues: [], ancestors: [] };
let bulkBefore = "";
let bulkKeys: string[] = [];
let pendingRead: Promise<void> | null = null;
let pendingLookup: Promise<Response> | null = null;
let pendingChanges: Promise<Response> | null = null;
const api = createApi(async (input, init) => {
  assert(
    !init?.method ||
      init.method === "GET" ||
      (init.method === "POST" &&
        [
          "/api/update",
          "/api/comment",
          "/api/comment-edit",
          "/api/description",
          "/api/bulk-options",
          "/api/bulk-update",
          "/api/bulk-undo",
        ].includes(String(input))),
    "모의 검사는 Jira 쓰기를 허용하지 않는다",
  );
  const url = new URL(String(input), location.origin);
  calls.push(url);
  if (url.pathname === "/api/changes" && pendingChanges) {
    const response = pendingChanges;
    pendingChanges = null;
    return response;
  }
  if (url.pathname === "/api/issue" && pendingLookup) {
    const response = pendingLookup;
    pendingLookup = null;
    return response;
  }
  if (
    pendingRead &&
    ["/api/children", "/api/issue", "/api/issues"].includes(url.pathname)
  )
    await pendingRead;
  switch (url.pathname) {
    case "/api/activity":
      return activityFailed
        ? Response.json({ error: "모의 활동 조회 실패" }, { status: 503 })
        : Response.json({ feed: activityXML(activityItems) });
    case "/api/changes":
      return Response.json(changes);
    case "/api/bulk-options":
      return Response.json({
        priorities: [{ id: "high", name: "높음", icon: "" }],
        statuses: ["완료", "대기", "진행 중"],
        users: [{ id: "my-account", name: "나", avatar: "" }],
      });
    case "/api/bulk-update": {
      assert(typeof init?.body === "string", "일괄 본문 누락");
      const body = record(JSON.parse(init.body));
      assert(
        Array.isArray(body.keys) &&
          body.keys.every((key) => typeof key === "string"),
        "선택 키 형식",
      );
      bulkKeys = body.keys;
      const issue = issues[2];
      assert(issue, "모의 이슈 누락");
      if (body.field === "dueDate") {
        bulkBefore = issue.dueDate;
        assert(typeof body.value === "string", "마감일 형식");
        issue.dueDate = body.value;
      }
      return Response.json({
        issues: [{ ...issue }],
        failures: bulkKeys
          .filter((key) => key !== issue.key)
          .map((key) => ({ key, error: "모의 변경 권한 없음" })),
        warnings: [],
        undoToken: "mock-undo",
      });
    }
    case "/api/bulk-undo": {
      const issue = issues[2];
      assert(issue, "모의 이슈 누락");
      issue.dueDate = bulkBefore;
      return Response.json({
        issues: [{ ...issue }],
        failures: [],
        warnings: [],
        undoToken: "",
      });
    }
    case "/api/update": {
      assert(typeof init?.body === "string", "모의 변경 본문 누락");
      const body: unknown = JSON.parse(init.body);
      assert(
        typeof body === "object" &&
          body !== null &&
          "key" in body &&
          "field" in body &&
          "value" in body &&
          typeof body.value === "string",
        "모의 변경 형식",
      );
      const issue = issues.find((item) => item.key === body.key);
      assert(issue, "모의 변경 대상 누락");
      if (failSave)
        return Response.json({ error: "모의 권한 오류" }, { status: 403 });
      if (body.field === "summary") issue.summary = body.value;
      else if (body.field === "dueDate") issue.dueDate = body.value;
      else if (body.field === "assignee") {
        issue.assigneeId = body.value;
        issue.assignee = body.value ? "나" : "";
      } else if (body.field === "priority") {
        issue.priorityId = body.value;
        issue.priority = "높음";
      } else if (body.field === "status") {
        issue.status = body.value;
        issue.statusId =
          statuses.find((status) => status.name === body.value)?.id ?? "";
      } else throw new Error("예상하지 못한 변경");
      return Response.json(details(issue));
    }
    case "/api/matches":
      return Response.json(
        url.searchParams.has("keys")
          ? { keys: url.searchParams.get("keys")?.split(","), ancestors: [] }
          : { matches: true },
      );
    case "/api/comment":
    case "/api/comment-edit":
    case "/api/description": {
      assert(typeof init?.body === "string", "모의 작성 본문 누락");
      const body = record(JSON.parse(init.body));
      if (failSave)
        return Response.json({ error: "모의 저장 실패" }, { status: 400 });
      if (url.pathname === "/api/description") {
        description = decodeAdfDocument(body.description);
        return Response.json({ description });
      }
      const id =
        url.pathname === "/api/comment-edit" && typeof body.id === "string"
          ? body.id
          : String(mockComments.size + 1);
      const parentId =
        typeof body.parentId === "string"
          ? body.parentId
          : (mockComments.get(id)?.parentId ?? "");
      lastParent = parentId;
      const comment = mockComment(
        id,
        parentId,
        "my-account",
        decodeAdfDocument(body.document),
      );
      mockComments.set(id, comment);
      const issue = issues.find((item) => item.key === body.key);
      if (issue) issue.commentCount = mockComments.size;
      return Response.json(comment);
    }
    case "/api/mention-users":
      return Response.json([{ id: "other", name: "동료", avatar: "" }]);
    case "/api/comments": {
      const startAt = Number(url.searchParams.get("startAt"));
      return Response.json({
        total: mockComments.size,
        startAt,
        comments: [...mockComments.values()].slice(startAt, startAt + 1),
      });
    }
    case "/api/history":
      return Response.json({
        before: url.searchParams.has("before") ? null : 1,
        entries: [
          {
            id: url.searchParams.has("before") ? "old" : "new",
            author: "작성자",
            avatar: "",
            created: "2026-10-01T08:00:00Z",
            changes: [{ field: "상태", from: "대기", to: "진행 중" }],
          },
        ],
      });
    case "/api/options":
      return Response.json({
        priorities: [{ id: "high", name: "높음", icon: "" }],
        statuses: ["완료", "대기", "진행 중"],
        users: [{ id: "my-account", name: "나", avatar: "" }],
      });
    case "/api/transitions":
      return Response.json({ statuses: ["완료", "대기", "진행 중"] });
    case "/api/priority-options":
      return Response.json([{ id: "high", name: "높음", icon: "" }]);
    case "/api/projects":
      return Response.json({
        site: "fixture.atlassian.net",
        me: { accountId: "my-account", displayName: "나" },
        projects: [{ key: "TEST", name: "모의 프로젝트", avatar: "" }],
        priorities: [],
      });
    case "/api/statuses":
      return Response.json(statuses);
    case "/api/issue-types":
      return Response.json([
        { id: "epic", name: "Epic", project: "TEST", hierarchyLevel: 1 },
        { id: "task", name: "Task", project: "TEST", hierarchyLevel: 0 },
        { id: "subtask", name: "Subtask", project: "TEST", hierarchyLevel: -1 },
      ]);
    case "/api/assignees":
      return Response.json([{ id: "my-account", name: "나", avatar: "" }]);
    case "/api/issues":
      return Response.json({
        issues: url.searchParams.get("q") === "없음" ? [] : [issues[2]],
        ancestors:
          url.searchParams.get("q") === "없음" ? [] : issues.slice(0, 2),
        nextPageToken: null,
      });
    case "/api/issue-children":
      if (failChildren)
        return Response.json({ error: "모의 하위 조회 실패" }, { status: 503 });
      return Response.json(
        issues.filter((issue) => issue.parent === url.searchParams.get("key")),
      );
    case "/api/children":
      if (failChildren)
        return Response.json({ error: "모의 하위 조회 실패" }, { status: 503 });
      return Response.json({
        issues: issues.filter(
          (issue) => issue.parent === url.searchParams.get("key"),
        ),
        nextPageToken: null,
      });
    case "/api/issue": {
      const issue = issues.find(
        (issue) => issue.key === url.searchParams.get("key"),
      );
      assert(issue, "모의 이슈 키 확인");
      return Response.json({
        parent: {
          ...issue,
          reporter: "작성자",
          reporterAvatar: "",
          created: "2026-10-01T08:00:00Z",
          url: `https://fixture.atlassian.net/browse/${issue.key}`,
          attachments: [
            {
              id: "1",
              name: "설계.pdf",
              mimeType: "application/pdf",
              size: 10,
              url: "https://fixture.atlassian.net/file.pdf",
            },
            {
              id: "2",
              name: "이미지.png",
              mimeType: "image/png",
              size: 10,
              url: "https://fixture.atlassian.net/file.png",
            },
            {
              id: "3",
              name: "위험한 링크",
              mimeType: "application/pdf",
              size: 10,
              url: "javascript:alert(1)",
            },
          ],
          description,
        },
        children: [],
        imageEnabled: true,
        dateEditing: true,
        deferredChildren: true,
      });
    }
    default:
      throw new Error(`예상하지 못한 요청: ${url.pathname}`);
  }
});
const checks: [string, () => void | Promise<void>][] = [];
let logListener: (entry: LogEntry) => void = () => {};
let logConnections = 0;
// 앞선 검사에서 남긴 선택 URL이 모바일 모달을 열어 후속 검사를 가리지 않게 한다.
history.replaceState(null, "", location.pathname);
const app = await createApp(root, api, storage, (listener) => {
  logConnections++;
  logListener = listener;
  return () => {
    logConnections--;
  };
});
function button(label: string): HTMLButtonElement {
  const node = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  ).find(
    (button) =>
      (button.getAttribute("aria-label") === label ||
        button.textContent === label) &&
      button.getClientRects().length > 0,
  );
  assert(node, `버튼 없음: ${label}`);
  return node;
}
const tick = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
checks.push([
  "모바일은 보조 정보를 접고 목록부터 보여주며 펼쳐도 재조회하지 않는다",
  async () => {
    const fold = root.querySelector<HTMLDetailsElement>(".dashboard-fold");
    assert(fold, "보조 정보 접힘 영역 누락");
    assert(
      fold.open === !matchMedia("(max-width: 900px)").matches,
      "초기 펼침 조건 불일치",
    );
    if (!fold.open) {
      const before = calls.length;
      const heading = root.querySelector(".project-heading");
      assert(
        heading && heading.getBoundingClientRect().top < 250,
        "보조 정보가 목록을 밀어냄",
      );
      fold.querySelector("summary")?.click();
      await tick();
      assert(
        fold.open &&
          root.querySelector(".dashboard .activity-feed")?.getClientRects()
            .length,
        "기존 보조 정보 누락",
      );
      assert(calls.length === before, "펼침만으로 API 재조회");
      fold.querySelector("summary")?.click();
    }
    const nav = root.querySelector(".top-nav");
    const title = nav?.querySelector("h1");
    assert(title && title.clientWidth >= title.scrollWidth, "서비스명 잘림");
    for (const tool of root.querySelectorAll<HTMLElement>(
      ".nav-tools button:not([hidden])",
    )) {
      const rect = tool.getBoundingClientRect();
      assert(rect.left >= 0 && rect.right <= innerWidth, "상단 도구 넘침");
    }
  },
]);
checks.push([
  "다른 담당자의 조상도 내 작업의 부모 연결로 표시한다",
  () => {
    assert(
      root.querySelectorAll(".browse .list-item").length === 3,
      "부모·중간·하위 카드 누락",
    );
    assert(
      root.querySelector(".project-count")?.textContent === "1",
      "상위 컨텍스트를 직접 일치 개수로 세지 않는다",
    );
    const parent = root.querySelector<HTMLElement>(
      '[data-tree-key="TEST-1"] > .tree-row',
    );
    assert(
      parent && getComputedStyle(parent).position !== "sticky",
      "부모 카드 전체가 고정되어 읽을 공간을 차지한다",
    );
    assert(
      root.querySelector(
        '.tree-context[aria-label="현재 읽는 목록의 상위 경로"]',
      ),
      "공통 부모 경로 영역이 없다",
    );
    const toggle = root.querySelector(".browse .tree-row > .tree-toggle");
    assert(
      toggle?.parentElement?.classList.contains("tree-row") &&
        !root.querySelector(".tree-folder,.tree-actions"),
      "카드 안의 펼침 제어가 없거나 폴더 장식이 남음",
    );
    assert(
      !root.querySelector(".browse .card-view-button"),
      "전체 뷰 상속 카드의 뷰 버튼이 표시됨",
    );
  },
]);
checks.push([
  "키보드 상세 진입과 닫기는 원래 카드 초점을 복원하고 입력 중 갱신은 초안을 유지한다",
  async () => {
    const opener = root.querySelector<HTMLAnchorElement>(
      '.browse .list-title[href="?issue=TEST-3"]',
    );
    assert(opener, "시작 카드 누락");
    opener.focus();
    assert(opener.matches(":focus-visible"), "키보드 초점 준비");
    opener.click();
    await tick();
    const title = root.querySelector<HTMLElement>(".detail-title");
    assert(
      document.activeElement === title,
      "상세 제목으로 초점이 이동하지 않음",
    );
    button("상태").click();
    await tick();
    const option = root.querySelector<HTMLElement>(
      '.detail-fields [role="option"]',
    );
    assert(option, "상태 선택지 누락");
    option.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    assert(
      root.querySelector(".detail-title") === title &&
        document.activeElement?.getAttribute("aria-label") === "상태",
      "Escape가 상세를 닫거나 필드 초점을 잃음",
    );
    button("제목 수정").click();
    const input = root.querySelector<HTMLInputElement>(
      ".detail-title-editor input",
    );
    assert(input, "제목 입력 누락");
    input.value = "저장하지 않은 제목 초안";
    await app.select("TEST-3", false, true);
    assert(input.isConnected, "배경 갱신이 입력 폼을 교체함");
    assert(
      input.value === "저장하지 않은 제목 초안",
      "배경 갱신이 입력값을 덮음",
    );
    assert(
      document.activeElement === input,
      `배경 갱신 중 초점 유실: ${document.activeElement?.outerHTML.slice(0, 180)}`,
    );
    button("취소").click();
    button("이슈 상세 닫기").click();
    const returned = root.querySelector(
      '.browse .list-title[href="?issue=TEST-3"]',
    );
    assert(
      document.activeElement === returned,
      "상세 닫기 후 원래 카드 복귀 실패",
    );
  },
]);
checks.push([
  "상위를 접었다 펼치면 이전 하위 펼침은 복원하지 않는다",
  () => {
    button("TEST-1 하위 이슈 접기").click();
    button("TEST-1 하위 이슈 펼치기").click();
    assert(
      button("TEST-2 하위 이슈 펼치기").getAttribute("aria-expanded") ===
        "false",
      "하위 접힘 초기화 누락",
    );
    assert(
      !Array.from(root.querySelectorAll(".browse .key")).some(
        (node) => node.textContent === "TEST-3",
      ),
      "닫힌 하위가 보인다",
    );
    button("TEST-2 하위 이슈 펼치기").click();
  },
]);
checks.push([
  "필터 체크는 초안만 바꾸고 적용 버튼이 목록을 한 번 조회한다",
  async () => {
    button("필터 및 뷰").click();
    await tick();
    const panel = document.querySelector<HTMLElement>(".filter-panel");
    assert(panel, "팝오버 없음");
    assert(panel.matches(":popover-open"), "팝오버 닫힘");
    const checkbox = panel.querySelector<HTMLInputElement>(
      '[aria-label="단계: 완료"]',
    );
    assert(checkbox, "동적 완료 선택지 누락");
    const before = calls.filter(
      (call) => call.pathname === "/api/issues",
    ).length;
    checkbox.click();
    assert(
      calls.filter((call) => call.pathname === "/api/issues").length === before,
      "초안 변경마다 API 조회 발생",
    );
    const trigger = panel.querySelector<HTMLButtonElement>(
      ".sort-rule .select-trigger",
    );
    assert(trigger, "정렬 셀렉트 누락");
    trigger.click();
    const order = Array.from(
      panel.querySelectorAll<HTMLButtonElement>(".select-option"),
    ).find((option) => option.textContent === "상태 · Jira 순서");
    assert(order, "상태 정렬 옵션 누락");
    order.click();
    await tick();
    assert(
      document.activeElement ===
        panel.querySelector(".sort-rule .select-trigger"),
      `선택 후 정렬 포커스 유실: ${document.activeElement?.tagName} ${document.activeElement?.getAttribute("aria-label")} popup=${panel.matches(":popover-open")}`,
    );
    button("적용").click();
    await tick();
    assert(
      calls.filter((call) => call.pathname === "/api/issues").length ===
        before + 1,
      "일괄 적용 조회 개수",
    );
    assert(
      app.list.filters.statuses?.join(",") === "1,2",
      "선택한 단계 미반영",
    );
  },
]);
checks.push([
  "하위 필터는 글로벌 상속과 명시적 빈 선택을 구분한다",
  async () => {
    app.views.apply(
      { kind: "branch", key: "TEST-1" },
      app.views.resolve({ kind: "global" }, false),
    );
    await tick();
    button("TEST-1 하위 정렬·필터").click();
    await tick();
    const panel = document.querySelector<HTMLElement>(".filter-panel");
    assert(
      panel?.querySelector('[aria-label="사용할 뷰"]'),
      "보기 선택기 누락",
    );
    await tick();
    const mode = panel?.querySelector<HTMLSelectElement>(
      '[aria-label="표시할 사람"]',
    );
    assert(mode, "하위 사람 선택기 없음");
    mode.value = "custom";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    const section = Array.from(
      panel?.querySelectorAll<HTMLElement>(".filter-section") ?? [],
    ).find((section) =>
      ["담당자", "작업 관계자"].includes(
        section.querySelector(".filter-section-head h3")?.textContent ?? "",
      ),
    );
    const clear = Array.from(
      section?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent === "선택 해제");
    assert(clear, "하위 담당자 선택 해제 없음");
    clear.click();
    button("적용").click();
    assert(
      app.list.effectiveBranch("TEST-1").assignees?.length === 0,
      "빈 선택을 상속으로 바꾸면 안 된다",
    );
  },
]);
checks.push([
  "API 검색 적용 정보와 초기화가 같은 필터 상태를 사용한다",
  async () => {
    button("검색").click();
    const input = root.querySelector<HTMLInputElement>(".search-form input");
    assert(input, "검색 입력 누락");
    input.value = "없음";
    root.querySelector<HTMLFormElement>(".search-form")?.requestSubmit();
    await tick();
    assert(
      app.list.filters.q === "없음" &&
        root.querySelector(".search-info")?.textContent?.includes("없음"),
      "검색 적용 정보 누락",
    );
    button("검색 초기화").click();
    await tick();
    assert(String(app.list.filters.q) === "", "검색 초기화 누락");
  },
]);
checks.push([
  "선택 상세·보고 시점·최근 카드와 모달을 연결한다",
  async () => {
    await app.select("TEST-3");
    assert(
      root
        .querySelector(".detail-description")
        ?.textContent?.includes("안전한 모의 본문"),
      "상세 본문 누락",
    );
    assert(
      root.querySelectorAll(".detail-breadcrumbs a").length === 2 &&
        !calls.some((call) => call.pathname === "/api/ancestors"),
      "목록 상위 경로 재사용 누락",
    );
    assert(
      root.querySelector(".reported-at") instanceof HTMLTimeElement,
      "공통 상대 시각 누락",
    );
    assert(
      root.querySelector(".dashboard .list-item .key")?.textContent ===
        "TEST-3",
      "최근 카드 누락",
    );
    const images = root.querySelector<HTMLElement>(".attachment-images");
    assert(images, "첨부 이미지 영역 누락");
    const imageLink = images?.querySelector<HTMLAnchorElement>("a");
    assert(
      images?.textContent?.includes("첨부 이미지 1개"),
      "본문 밖 첨부 이미지 누락",
    );
    assert(
      imageLink?.textContent === "이미지 1 열기",
      "이미지 파일명이 노출됨",
    );
    assert(
      imageLink?.href === "https://fixture.atlassian.net/file.png",
      "첨부 원본 링크 손실",
    );
    assert(
      imageLink.target === "_blank" && imageLink.rel === "noopener noreferrer",
      "첨부 이미지 외부 링크 보호 누락",
    );
    assert(!images.querySelector("img"), "클릭 전에 이미지를 다운로드함");
    const links = root.querySelectorAll<HTMLAnchorElement>(".attachments a");
    assert(
      links.length === 1 && links[0]?.textContent === "설계.pdf",
      "첨부 링크 종류·프로토콜 구분 누락",
    );
    assert(
      links[0]?.target === "_blank" && links[0]?.rel === "noopener noreferrer",
      "외부 첨부 링크 보호 누락",
    );
    const modal = root.querySelector<HTMLDialogElement>(".detail-modal");
    assert(
      modal?.open === matchMedia("(max-width: 900px)").matches,
      "반응형 모달 조건 불일치",
    );
    app.closeDetail();
    assert(!modal.open, "닫기 이후 모달이 남는다");
  },
]);
checks.push([
  "설정 모달은 다크 모드와 간단히 보기를 로컬에 저장한다",
  () => {
    button("설정").click();
    const checks = root.querySelectorAll<HTMLInputElement>(
      ".settings-modal .setting-row input",
    );
    assert(checks.length === 5, "설정 체크 누락");
    for (const label of ["다크 모드", "간단히 보기"]) {
      const check = [...root.querySelectorAll<HTMLLabelElement>(".setting-row")]
        .find(
          (row) => row.querySelector(".setting-label")?.textContent === label,
        )
        ?.querySelector<HTMLInputElement>("input");
      assert(check, "설정 필드 누락");
      check.click();
    }
    assert(
      !root.querySelector(".settings-modal .modal-footer"),
      "설정 저장 푸터가 남는다",
    );
    assert(
      root.querySelector<HTMLDialogElement>(".settings-modal")?.open,
      "변경할 때 설정이 닫힌다",
    );
    assert(
      values.get("fastJira:theme") === "dark" &&
        values.get("fastJira:compactView") === "true",
      "설정 즉시 적용 누락",
    );
    assert(
      getComputedStyle(root).maxWidth === "none" &&
        root.getBoundingClientRect().width ===
          document.documentElement.clientWidth,
      "전체 너비에 제한이 남는다",
    );
    button("닫기").click();
  },
]);
checks.push([
  "설정 탭은 크기·연결 입력을 유지하고 키보드로 이동하며 도움말을 연결한다",
  () => {
    button("설정").click();
    const modal = root.querySelector<HTMLDialogElement>(".settings-modal");
    assert(modal, "설정 모달 누락");
    const tabs = [...modal.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    assert(
      tabs.length === 3 && tabs[1]?.getAttribute("aria-selected") === "true",
      "설정 카테고리 누락",
    );
    const height = modal.getBoundingClientRect().height;
    button("Jira 연결").click();
    const email = modal.querySelector<HTMLInputElement>('input[type="email"]');
    assert(
      email && !email.closest<HTMLElement>('[role="tabpanel"]')?.hidden,
      "연결 탭 내용 누락",
    );
    email.value = "fixture@example.com";
    button("관리").click();
    assert(
      Math.abs(modal.getBoundingClientRect().height - height) < 1,
      "탭 이동으로 모달 크기 변경",
    );
    const developer = modal.querySelector<HTMLInputElement>(
      'input[aria-label="개발자 모드"]',
    );
    assert(
      developer &&
        document
          .getElementById(developer.getAttribute("aria-describedby") ?? "")
          ?.textContent?.includes("저장하지"),
      "설정 도움말 연결 누락",
    );
    tabs[2]?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    );
    assert(
      tabs[0]?.getAttribute("aria-selected") === "true" &&
        email.value === "fixture@example.com",
      "키보드 이동 또는 연결 초안 보존 누락",
    );
    button("닫기").click();
  },
]);
checks.push([
  "늦은 이전 선택 응답은 상세와 최근 이력을 덮어쓰지 않는다",
  async () => {
    await Promise.all([app.select("TEST-1"), app.select("TEST-3")]);
    assert(
      root.querySelector(".detail-head .key")?.textContent === "TEST-3",
      "이전 선택이 현재 상세를 덮었다",
    );
    assert(
      !Array.from(root.querySelectorAll(".dashboard .key")).some(
        (node) => node.textContent === "TEST-1",
      ),
      "취소된 이전 응답이 최근 이력에 남았다",
    );
    app.closeDetail();
  },
]);
checks.push([
  "상태 선택은 Jira 순서를 지키고 목록·최근 카드·되돌리기를 갱신한다",
  async () => {
    await app.select("TEST-3");
    button("상태").click();
    await tick();
    const choices = [
      ...root.querySelectorAll<HTMLButtonElement>(
        ".detail-fields .select-option",
      ),
    ];
    assert(
      choices.map((item) => item.textContent).join(",") === "대기,진행 중,완료",
      "상태 순서 불일치",
    );
    choices.find((item) => item.textContent === "진행 중")?.click();
    await tick();
    assert(app.list.items.get("TEST-3")?.status === "진행 중", "목록 미반영");
    assert(
      root.querySelector(".dashboard .status-name")?.textContent === "진행 중",
      "최근 카드 미반영",
    );
    assert(
      root
        .querySelector(".detail-description")
        ?.textContent?.includes("안전한 모의 본문"),
      "본문 손실",
    );
    const changedParent = issues[0];
    assert(changedParent, "변경 대상 부모 누락");
    changes = {
      issues: [
        { ...changedParent, updated: "2026-10-01T17:00:00Z", matches: true },
      ],
      ancestors: [],
    };
    try {
      await app.checkChanges();
      assert(
        root.querySelector(".notice")?.textContent?.includes("되돌리기"),
        "자동 변경 알림이 수정 결과의 되돌리기를 덮음",
      );
    } finally {
      changes = { issues: [], ancestors: [] };
    }
    button("되돌리기").click();
    await tick();
    assert(
      String(app.list.items.get("TEST-3")?.status) === "완료",
      "되돌리기 미반영",
    );
    const before = calls.filter(
      (call) =>
        call.pathname === "/api/options" ||
        call.pathname === "/api/transitions",
    ).length;
    button("담당자").click();
    await tick();
    assert(
      calls.filter(
        (call) =>
          call.pathname === "/api/options" ||
          call.pathname === "/api/transitions",
      ).length === before,
      "담당자 캐시 재조회",
    );
    root
      .querySelector<HTMLElement>(".detail-fields .select-options:popover-open")
      ?.hidePopover();
  },
]);
checks.push([
  "제목 실패는 초안을 유지하고 재시도와 취소가 동작한다",
  async () => {
    button("제목 수정").click();
    const input = root.querySelector<HTMLInputElement>(
      ".detail-title-editor input",
    );
    assert(input, "제목 입력 누락");
    input.value = "새 제목";
    failSave = true;
    root
      .querySelector<HTMLFormElement>(".detail-title-editor")
      ?.requestSubmit();
    await tick();
    assert(
      !root.querySelector<HTMLElement>(".detail-title-editor")?.hidden &&
        input.value === "새 제목",
      "실패시 초안 손실",
    );
    failSave = false;
    root
      .querySelector<HTMLFormElement>(".detail-title-editor")
      ?.requestSubmit();
    await tick();
    assert(
      root.querySelector(".detail-title")?.textContent === "새 제목",
      "제목 저장 누락",
    );
    assert(
      root.querySelector(".detail-title-editor")?.getAttribute("aria-busy") ===
        "false",
      "저장중 표시 잔존",
    );
    button("제목 수정").click();
    button("취소").click();
    assert(
      root.querySelector<HTMLElement>(".detail-title-editor")?.hidden,
      "제목 취소 누락",
    );
  },
]);
checks.push([
  "나에게 할당과 우선순위·마감일 편집은 동일한 저장 경로를 쓴다",
  async () => {
    button("담당자").click();
    await tick();
    root
      .querySelector<HTMLButtonElement>(
        ".detail-fields .select-options:popover-open .select-option",
      )
      ?.click();
    await tick();
    assert(
      app.list.items.get("TEST-3")?.assigneeId === "",
      "미지정 선택 미반영",
    );
    button("나에게 할당").click();
    await tick();
    assert(
      app.list.items.get("TEST-3")?.assigneeId === "my-account",
      "나에게 할당 누락",
    );
    button("우선순위").click();
    await tick();
    const priority = [
      ...root.querySelectorAll<HTMLButtonElement>(
        ".detail-fields .select-option",
      ),
    ].find((item) => item.textContent === "높음");
    assert(priority, "우선순위 선택 누락");
    priority.click();
    await tick();
    assert(
      app.list.items.get("TEST-3")?.priorityId === "high",
      "우선순위 저장 누락",
    );
    const date = root.querySelector<HTMLInputElement>(
      '.detail-fields input[type="date"]',
    );
    assert(date, "날짜 입력 누락");
    date.value = "2026-10-05";
    date.dispatchEvent(new Event("change"));
    await tick();
    assert(
      app.list.items.get("TEST-3")?.dueDate === "2026-10-05",
      "날짜 저장 누락",
    );
    app.closeDetail();
  },
]);
checks.push([
  "변경 기록은 지연 조회하고 상대 시각·이전 페이지·재열기 캐시를 유지한다",
  async () => {
    await app.select("TEST-3");
    assert(
      calls.filter((call) => call.pathname === "/api/history").length === 0,
      "기록 선조회",
    );
    button("변경 기록").click();
    await tick();
    assert(
      root.querySelector(".history-author time") instanceof HTMLTimeElement,
      "기록 상대 시각 누락",
    );
    button("이전 기록").click();
    await tick();
    assert(
      root.querySelectorAll(".history-entry").length === 2,
      "이전 페이지 누락",
    );
    const count = calls.filter(
      (call) => call.pathname === "/api/history",
    ).length;
    button("변경 기록 닫기").click();
    button("변경 기록").click();
    await tick();
    assert(
      calls.filter((call) => call.pathname === "/api/history").length === count,
      "재열기 불필요 조회",
    );
    button("변경 기록 닫기").click();
    const reads = () =>
      calls.filter((call) => call.pathname === "/api/history");
    button("제목 수정").click();
    const titleInput = root.querySelector<HTMLInputElement>(
      ".detail-title-editor input",
    );
    const form = root.querySelector<HTMLFormElement>(".detail-title-editor");
    assert(titleInput && form, "제목 편집 폼 없음");
    titleInput.value = "기록 갱신 검사";
    failSave = true;
    form.requestSubmit();
    await tick();
    failSave = false;
    button("취소").click();
    button("변경 기록").click();
    await tick();
    assert(reads().length === count, "실패한 수정이 기록 캐시를 무효화함");
    button("변경 기록 닫기").click();
    button("제목 수정").click();
    titleInput.value = "기록 갱신 검사";
    form.requestSubmit();
    await tick();
    assert(reads().length === count, "수정만 해도 닫힌 기록을 선조회함");
    button("변경 기록").click();
    await tick();
    assert(
      reads().length === count + 1,
      "수정 뒤 기록 재열기에 최신 조회 없음",
    );
    assert(
      !reads().at(-1)?.searchParams.has("before"),
      "수정 뒤 이전 페이지 커서를 재사용함",
    );
    assert(
      root.querySelectorAll(".history-entry").length === 1,
      "이전 페이지와 최신 페이지가 섞임",
    );
    button("변경 기록 닫기").click();
    button("되돌리기").click();
    await tick();
    assert(reads().length === count + 1, "되돌리기 직후 기록을 선조회함");
    button("변경 기록").click();
    await tick();
    assert(reads().length === count + 2, "되돌린 뒤 기록 캐시가 갱신되지 않음");
    button("변경 기록 닫기").click();
    app.closeDetail();
  },
]);
checks.push([
  "댓글은 상세에서 페이지 단위로 읽으며 부모가 늦게 와도 답글을 들여쓴다",
  async () => {
    await app.select("TEST-3");
    await tick();
    assert(
      root.querySelector(".comment-parent-link"),
      "부모 미조회 원댓글 링크 누락",
    );
    const before = calls.filter(
      (call) => call.pathname === "/api/comments",
    ).length;
    button("댓글 더 보기").click();
    await tick();
    assert(
      calls.filter((call) => call.pathname === "/api/comments").length ===
        before + 1,
      "댓글 페이지 요청 개수",
    );
    assert(
      root.querySelector("#comment-1 .comment-replies #comment-2"),
      "실제 부모 아래 답글 배치 누락",
    );
    assert(
      !root.querySelector(".comment-parent-link"),
      "연결된 답글의 불필요한 원문 링크",
    );
    assert(
      root.querySelector(".comment-head time") instanceof HTMLTimeElement,
      "댓글 상대 시각 누락",
    );
    for (const header of root.querySelectorAll<HTMLElement>(".comment-head")) {
      const actions = header.querySelector<HTMLElement>(
        ":scope > .comment-toolbar",
      );
      const author = header.querySelector<HTMLElement>(
        ":scope > .comment-author",
      );
      assert(actions && author, "댓글 액션이 작성자 줄에 없다");
      assert(
        actions.getBoundingClientRect().top >=
          author.getBoundingClientRect().bottom - 1
          ? Math.abs(
              actions.getBoundingClientRect().right -
                header.getBoundingClientRect().right,
            ) < 1
          : actions.getBoundingClientRect().left >=
              author.getBoundingClientRect().right - 1,
        "댓글 액션 우측 정렬 누락",
      );
      const copy = actions.querySelector('[aria-label="댓글 링크 복사"] use');
      assert(
        copy?.getAttribute("href") === "/assets/icons.svg#copy",
        "댓글 복사 아이콘이 공통 Lucide가 아니다",
      );
    }
    const replies = root.querySelector(".comment-replies");
    assert(
      replies &&
        getComputedStyle(replies).marginLeft === "0px" &&
        getComputedStyle(replies).paddingLeft === "12px",
      "답글 왼쪽 여백이 중복된다",
    );
    app.closeDetail();
  },
]);
checks.push([
  "본문 저장 실패는 초안을 유지하며 저장 뒤 상태 변경도 새 본문을 보존한다",
  async () => {
    await app.select("TEST-3");
    button("변경 기록").click();
    await tick();
    button("변경 기록 닫기").click();
    const historyCount = calls.filter(
      (call) => call.pathname === "/api/history",
    ).length;
    button("수정").click();
    const form = root.querySelector<HTMLFormElement>(
        ".detail-description .document-form",
      ),
      input = form?.querySelector<HTMLElement>('[contenteditable="true"]');
    assert(form && input, "본문 작성 폼 누락");
    input.textContent = "수정한 본문";
    failSave = true;
    form.requestSubmit();
    await tick();
    assert(
      input.textContent === "수정한 본문" &&
        form
          .querySelector(":scope > .error")
          ?.textContent?.includes("모의 저장 실패"),
      "실패시 본문 손실",
    );
    failSave = false;
    form.requestSubmit();
    await tick();
    assert(
      !root.querySelector(".detail-description .document-form") &&
        root
          .querySelector(".detail-description")
          ?.textContent?.includes("수정한 본문"),
      "본문 저장 미반영",
    );
    assert(
      calls.filter((call) => call.pathname === "/api/history").length ===
        historyCount,
      "본문 저장 시 닫힌 기록을 선조회함",
    );
    button("변경 기록").click();
    await tick();
    assert(
      calls.filter((call) => call.pathname === "/api/history").length ===
        historyCount + 1,
      "본문 저장 뒤 기록 캐시가 갱신되지 않음",
    );
    button("변경 기록 닫기").click();
    button("상태").click();
    await tick();
    [
      ...root.querySelectorAll<HTMLButtonElement>(
        ".select-options:popover-open .select-option",
      ),
    ]
      .find((item) => item.textContent === "진행 중")
      ?.click();
    await tick();
    assert(
      root
        .querySelector(".detail-description")
        ?.textContent?.includes("수정한 본문"),
      "필드 저장이 본문을 덮음",
    );
    app.closeDetail();
  },
]);
checks.push([
  "내 댓글만 편집하고 답글은 실제 부모 ID로 저장하며 카드 개수를 갱신한다",
  async () => {
    await app.select("TEST-3");
    await tick();
    button("댓글 더 보기").click();
    await tick();
    assert(
      !root.querySelector(
        '#comment-2 > .comment-head > .comment-toolbar [aria-label="내 댓글 편집"]',
      ) &&
        root.querySelector(
          '#comment-1 > .comment-head > .comment-toolbar [aria-label="내 댓글 편집"]',
        ),
      "작성자 편집 권한 불일치",
    );
    root
      .querySelector<HTMLButtonElement>(
        '#comment-1 > .comment-head > .comment-toolbar [aria-label="내 댓글 편집"]',
      )
      ?.click();
    let form = root.querySelector<HTMLFormElement>(".comments .document-form");
    const input = form?.querySelector<HTMLElement>('[contenteditable="true"]');
    assert(form && input, "내 댓글 작성 폼 누락");
    input.textContent = "내 댓글 수정";
    form.requestSubmit();
    await tick();
    assert(
      root.querySelector("#comment-1 > .comment-body")?.textContent ===
        "내 댓글 수정",
      "댓글 편집 미반영",
    );
    root
      .querySelector<HTMLButtonElement>(
        '#comment-2 > .comment-head > .comment-toolbar [aria-label="답글 작성"]',
      )
      ?.click();
    form = root.querySelector<HTMLFormElement>(".comments .document-form");
    assert(form, "답글 작성 폼 누락");
    form
      .querySelector('[contenteditable="true"]')
      ?.append(document.createElement("p"));
    const repliesBefore = calls.filter(
      (call) => call.pathname === "/api/comment",
    ).length;
    form.requestSubmit();
    await tick();
    assert(
      calls.filter((call) => call.pathname === "/api/comment").length ===
        repliesBefore &&
        form.querySelector(":scope > .error")?.textContent?.includes("답글"),
      "멘션만 있는 답글을 저장함",
    );
    form
      .querySelector('[contenteditable="true"]')
      ?.append(document.createTextNode("확인했습니다"));
    form.requestSubmit();
    await tick();
    assert(
      lastParent === "1" &&
        root.querySelector("#comment-1 .comment-replies #comment-3"),
      "실제 부모 아래 답글 저장 누락",
    );
    assert(
      app.list.items.get("TEST-3")?.commentCount === 3,
      "목록 댓글 개수 미반영",
    );
    app.closeDetail();
  },
]);
checks.push([
  "댓글 추가는 빈 입력을 막고 저장 실패 뒤 초안으로 재시도한다",
  async () => {
    await app.select("TEST-3");
    button("댓글 추가").click();
    const form = root.querySelector<HTMLFormElement>(
        ".comments .document-form",
      ),
      input = form?.querySelector<HTMLElement>('[contenteditable="true"]');
    assert(form && input, "새 댓글 폼 누락");
    const before = calls.filter(
      (call) => call.pathname === "/api/comment",
    ).length;
    form.requestSubmit();
    await tick();
    assert(
      calls.filter((call) => call.pathname === "/api/comment").length ===
        before,
      "빈 댓글 요청",
    );
    input.textContent = "새 댓글 내용";
    failSave = true;
    form.requestSubmit();
    await tick();
    assert(
      input.textContent === "새 댓글 내용" &&
        form.querySelector(":scope > .error")?.textContent?.includes("실패"),
      "댓글 실패 초안 손실",
    );
    failSave = false;
    form.requestSubmit();
    await tick();
    assert(
      root.querySelector("#comment-4 > .comment-body")?.textContent ===
        "새 댓글 내용" && app.list.items.get("TEST-3")?.commentCount === 4,
      "댓글 추가·개수 갱신 누락",
    );
    assert(
      !root.querySelector(".comments .document-form"),
      "저장한 작성 폼 잔존",
    );
    app.closeDetail();
  },
]);
checks.push([
  "부모 조건 변경은 보이지 않는 일괄 선택을 해제하고 이름 변경은 유지한다",
  async () => {
    button("이슈 선택 모드").click();
    const choose = () => {
      const check = root.querySelector<HTMLInputElement>(
        '[data-select-key="TEST-3"]',
      );
      assert(check, "회귀 검사 선택 카드 누락");
      check.click();
    };
    choose();
    const target = { kind: "branch" as const, key: "TEST-2" };
    const original = app.views.resolve(target, false);
    app.views.register(target, original, "회귀 검사 보기");
    assert(
      root.querySelector(".bulk-head strong")?.textContent === "1개 선택",
      "동일 조건 등록이 선택을 해제함",
    );
    const saved = app.views.state.saved.find(
      (view) => view.name === "회귀 검사 보기",
    );
    assert(saved, "등록 보기 누락");
    app.views.update(saved.id, "이름만 수정", saved.definition);
    assert(
      root.querySelector(".bulk-head strong")?.textContent === "1개 선택",
      "이름 변경이 선택을 해제함",
    );
    app.views.update(saved.id, "조건 수정", {
      ...saved.definition,
      statuses: [],
    });
    assert(
      root.querySelector(".bulk-head strong")?.textContent === "0개 선택",
      "숨겨진 이슈가 일괄 대상에 남음",
    );
    app.views.apply(target, original);
    await tick();
    choose();
    app.views.peek(target.key, { people: true });
    assert(
      root.querySelector(".bulk-head strong")?.textContent === "0개 선택",
      "일시 범위 변경이 선택을 유지함",
    );
    app.views.clearPeek(target.key);
    app.views.delete(saved.id);
    button("선택 종료").click();
  },
]);
checks.push([
  "선택 모드는 명시적 체크·공통 상태 순서·부분 성공·되돌리기를 지원한다",
  async () => {
    app.closeDetail();
    button("이슈 선택 모드").click();
    const check = root.querySelector<HTMLInputElement>(
      '[data-select-key="TEST-3"]',
    );
    assert(check, "선택 체크 누락");
    check.click();
    const other = root.querySelector<HTMLInputElement>(
      '[data-select-key="TEST-1"]',
    );
    assert(other && !other.checked, "상위 자동 선택 발생");
    other.click();
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          copied = value;
        },
      },
    });
    try {
      const copy = root.querySelector<HTMLButtonElement>(
        '.browse [aria-label="TEST-3 이슈 링크 복사"]',
      );
      assert(copy, "선택 모드에서 복사 버튼 누락");
      copy.click();
      await tick();
      assert(
        copied === "https://fixture.atlassian.net/browse/TEST-3" &&
          check.checked &&
          other.checked,
        "복사가 카드 선택을 변경함",
      );
      assert(
        !root.querySelector(".detail-content:not([hidden]) .issue-detail"),
        "복사 시 상세 이동 발생",
      );
      const header = root.querySelector<HTMLElement>(".bulk-head");
      assert(header, "선택 액션 헤더 누락");
      const buttons = [...header.querySelectorAll("button")].filter(
        (button) => button.getClientRects().length,
      );
      if (header.getBoundingClientRect().width > 560) {
        assert(
          buttons.every(
            (button) =>
              Math.abs(
                button.getBoundingClientRect().top +
                  button.getBoundingClientRect().height / 2 -
                  (buttons[0]?.getBoundingClientRect().top ?? 0) -
                  (buttons[0]?.getBoundingClientRect().height ?? 0) / 2,
              ) < 1,
          ),
          "선택 액션이 한 줄에 있지 않다",
        );
      }
      assert(
        getComputedStyle(header.parentElement as HTMLElement).position !==
          "fixed",
        "선택 액션이 여전히 화면 하단에 떠 있다",
      );
      button("링크 복사").click();
      await tick();
      assert(
        copied.split("\n").length === 2 &&
          copied.includes("/TEST-1") &&
          copied.includes("/TEST-3"),
        "일괄 링크 복사 누락",
      );
      assert(
        root.querySelector(".detail-pane .bulk-bar") &&
          root.querySelector<HTMLElement>(".dashboard")?.hidden,
        "선택 액션이 우측 패널에 표시되지 않는다",
      );
      assert(
        !root.querySelector(
          '.bulk-bar [aria-label="보이는 항목 선택"],.bulk-bar [aria-label="선택 해제"]',
        ),
        "선택 보조 액션이 남는다",
      );
    } finally {
      if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
    button("우선순위 변경").click();
    await tick();
    assert(
      root.querySelector<HTMLSelectElement>(".bulk-editor select")?.value ===
        "high",
      "일괄 우선순위 선택지 누락",
    );
    root.querySelector<HTMLElement>(".bulk-editor")?.hidePopover();
    button("상태 변경").click();
    await tick();
    const statuses = root.querySelector<HTMLSelectElement>(
      ".bulk-editor select",
    );
    assert(
      statuses &&
        [...statuses.options].map((option) => option.textContent).join() ===
          "대기,진행 중,완료",
      "공통 상태 순서 오류",
    );
    const panel = root.querySelector<HTMLElement>(".bulk-editor");
    panel?.hidePopover();
    button("마감일 변경").click();
    await tick();
    const date = root.querySelector<HTMLInputElement>(".bulk-editor input");
    assert(date, "일괄 마감일 입력 누락");
    const previous = issues[2]?.dueDate;
    date.value = "2026-12-24";
    const listRequests = calls.filter(
      (path) =>
        path.pathname === "/api/issues" || path.pathname === "/api/children",
    ).length;
    const unchangedCard = root.querySelector('a[href="?issue=TEST-2"]');
    const cursor = app.list.nextPageToken;
    button("일괄 적용").click();
    await tick();
    assert(
      calls.filter(
        (path) =>
          path.pathname === "/api/issues" || path.pathname === "/api/children",
      ).length === listRequests,
      "일괄 변경 뒤 목록 재조회 발생",
    );
    assert(
      root.querySelector('a[href="?issue=TEST-2"]') === unchangedCard &&
        app.list.nextPageToken === cursor,
      "변경되지 않은 카드·커서 교체",
    );
    assert(
      bulkKeys.length === 2 &&
        bulkKeys.includes("TEST-3") &&
        bulkKeys.includes("TEST-1"),
      "명시적 선택과 요청 키 불일치",
    );
    assert(
      root.querySelector(".bulk-result")?.textContent?.includes("1개 실패") &&
        app.list.items.get("TEST-3")?.dueDate === "2026-12-24",
      "부분 성공 목록·실패 표시 누락",
    );
    assert(
      !root.querySelector('.bulk-bar button[aria-label="되돌리기"]') &&
        ![...root.querySelectorAll(".bulk-bar button")].some(
          (button) => button.textContent === "되돌리기",
        ),
      "메인 액션에 되돌리기가 남는다",
    );
    const undo = root.querySelector<HTMLButtonElement>(
      ".notice button.secondary",
    );
    assert(undo?.textContent === "되돌리기", "결과 토스트에 되돌리기 누락");
    undo.click();
    await tick();
    assert(
      app.list.items.get("TEST-3")?.dueDate === previous,
      "일괄 되돌리기 미반영",
    );
    button("선택 종료").click();
    assert(!root.querySelector("[data-select-key]"), "선택 종료 후 체크 잔존");
  },
]);
checks.push([
  "일괄 갱신은 작성 초안을 보존하고 닫은 뒤 상세를 갱신한다",
  async () => {
    await app.select("TEST-3");
    button("댓글 추가").click();
    const draft = root.querySelector<HTMLElement>(
      '.comments [contenteditable="true"]',
    );
    assert(draft, "초안 입력 누락");
    draft.textContent = "지켜야 하는 초안";
    button("이슈 선택 모드").click();
    root.querySelector<HTMLInputElement>('[data-select-key="TEST-3"]')?.click();
    button("마감일 변경").click();
    await tick();
    const date = root.querySelector<HTMLInputElement>(".bulk-editor input");
    assert(date, "일괄 입력 누락");
    date.value = "2026-12-25";
    button("일괄 적용").click();
    await tick();
    assert(
      root.querySelector('.comments [contenteditable="true"]') === draft &&
        draft.textContent === "지켜야 하는 초안",
      "갱신 중 초안 손실",
    );
    const cancel = [
      ...root.querySelectorAll<HTMLButtonElement>(
        ".comments .document-form button",
      ),
    ].find((button) => button.textContent === "취소");
    assert(cancel, "초안 취소 누락");
    const writes = calls.filter(
      (call) => call.pathname === "/api/comment",
    ).length;
    cancel.click();
    await tick();
    assert(
      calls.filter((call) => call.pathname === "/api/comment").length ===
        writes && !root.querySelector(".comments .document-form"),
      "취소 중 댓글 저장 또는 갱신 누락",
    );
    button("선택 종료").click();
    app.closeDetail();
  },
]);
checks.push([
  "상세를 불러오는 중에도 닫을 수 있고 늦은 응답은 다시 열지 않는다",
  async () => {
    app.closeDetail();
    let release = () => {};
    pendingRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = app.select("TEST-1");
    try {
      await tick();
      const close = root.querySelector<HTMLButtonElement>(
        '.detail-pending [aria-label="이슈 상세 닫기"]',
      );
      assert(close !== null && !close.hidden, "조회 중 닫기가 없다");
      close.click();
      assert(
        root.querySelector<HTMLDialogElement>(".detail-modal")?.open === false,
        "조회 중 모달을 닫지 못한다",
      );
    } finally {
      pendingRead = null;
      release();
      await pending;
    }
    assert(
      root.querySelector<HTMLDialogElement>(".detail-modal")?.open === false,
      "늦은 응답이 상세를 다시 연다",
    );
    assert(
      root.querySelector<HTMLElement>(".detail-content")?.hidden === true,
      "늦은 상세가 남는다",
    );
  },
]);
checks.push([
  "최근 변경 묶음은 신규 부모·필터 이탈·최근 카드에 반영하고 동일 결과는 재렌더하지 않는다",
  async () => {
    const child = issues[2];
    assert(child, "변경 대상 누락");
    child.updated = "2026-10-01T18:00:00Z";
    child.summary = "최근 변경된 제목";
    const ancestor = {
      ...emptyIssue("TEST-10", "새 부모 계획"),
      hasChildren: true,
      hierarchyLevel: 1,
      issueTypeId: "epic",
    };
    const added = {
      ...emptyIssue("TEST-4", "새 작업"),
      status: "진행 중",
      statusId: "2",
      assigneeId: "my-account",
      assignee: "나",
      hierarchyLevel: 0,
      issueTypeId: "task",
      parent: "TEST-10",
      updated: child.updated,
      matches: true,
    };
    changes = {
      issues: [{ ...child, matches: false }, added],
      ancestors: [ancestor],
    };
    await app.checkChanges();
    assert(
      !app.list.direct.has(child.key) && app.list.direct.has(added.key),
      "필터 이탈·추가 미반영",
    );
    assert(
      root.textContent?.includes("새 부모 계획") &&
        root.textContent?.includes("새 작업"),
      "부모 묶음 보강 누락",
    );
    assert(
      root
        .querySelector(".dashboard")
        ?.textContent?.includes("최근 변경된 제목"),
      "최근 카드 변경 누락",
    );
    const recentCard = root.querySelector<HTMLElement>(
      ".dashboard .issue-card",
    );
    const copy = recentCard?.querySelector<HTMLButtonElement>("button");
    const fold = root.querySelector<HTMLDetailsElement>(".dashboard-fold");
    const wasOpen = fold?.open;
    if (fold) fold.open = true;
    copy?.focus();
    app.list.updateMany([], new Set());
    assert(
      recentCard === root.querySelector(".dashboard .issue-card"),
      "동일 데이터의 최근 카드를 다시 만들었다",
    );
    assert(document.activeElement === copy, "최근 카드의 포커스를 잃었다");
    if (fold && wasOpen !== undefined) fold.open = wasOpen;
    const card = root.querySelector(".browse-list a.list-title");
    await app.checkChanges();
    assert(
      card === root.querySelector(".browse-list a.list-title"),
      "같은 변경에서 목록 렌더 반복",
    );
  },
]);
checks.push([
  "최근 변경으로 상세가 갱신돼도 댓글 초안은 취소할 때까지 유지한다",
  async () => {
    await app.select("TEST-3");
    button("댓글 추가").click();
    const draft = root.querySelector<HTMLElement>(
      '.comments [contenteditable="true"]',
    );
    assert(draft, "댓글 초안 누락");
    draft.textContent = "갱신 중 보존";
    const child = issues[2];
    assert(child, "변경 대상 누락");
    child.updated = "2026-10-01T18:01:00Z";
    child.summary = "상세 최신 제목";
    changes = { issues: [{ ...child, matches: true }], ancestors: [] };
    await app.checkChanges();
    assert(
      root.querySelector('.comments [contenteditable="true"]') === draft &&
        draft.textContent === "갱신 중 보존",
      "주기 갱신 초안 손실",
    );
    const cancel = [
      ...root.querySelectorAll<HTMLButtonElement>(
        ".comments .document-form button",
      ),
    ].find((button) => button.textContent === "취소");
    assert(cancel, "취소 누락");
    cancel.click();
    await tick();
    assert(
      root.querySelector(".detail-title")?.textContent === "상세 최신 제목",
      "편집 종료 후 갱신 누락",
    );
    app.closeDetail();
  },
]);
checks.push([
  "변경으로 앞에 카드가 추가돼도 현재 읽던 카드의 스크롤 위치를 유지한다",
  async () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({
      ...emptyIssue(`TEST-${100 + index}`, `스크롤 작업 ${index}`),
      statusId: "2",
      status: "진행 중",
      updated: "2026-10-01T18:02:00Z",
      matches: true,
    }));
    changes = { issues: rows, ancestors: [] };
    await app.checkChanges();
    const scroller = root.querySelector<HTMLElement>(
      matchMedia("(max-width:900px)").matches ? ".workspace" : ".browse",
    );
    assert(scroller, "스크롤 영역 누락");
    scroller.style.overflowAnchor = "none";
    scroller.scrollTop = 600;
    await new Promise((resolve) => setTimeout(resolve, 220));
    await tick();
    // 고정 경로에 가려진 카드 대신 실제로 읽을 수 있는 첫 카드를 추적한다.
    const top =
      scroller.getBoundingClientRect().top +
      (Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0);
    const card = [
      ...root.querySelectorAll<HTMLAnchorElement>(".browse-list a.list-title"),
    ].find(
      (card) =>
        !card.closest(".tree-parent") &&
        (card.closest(".list-item") ?? card).getBoundingClientRect().bottom >
          top,
    );
    assert(card && scroller.scrollTop > 0, "스크롤 검사 카드 누락");
    const href = card.getAttribute("href"),
      before = card.getBoundingClientRect().top;
    changes = {
      issues: [
        {
          ...emptyIssue("TEST-999", "앞에 추가됨"),
          statusId: "2",
          status: "진행 중",
          updated: "2026-10-01T18:03:00Z",
          matches: true,
        },
      ],
      ancestors: [],
    };
    await app.checkChanges();
    await tick();
    const after = [
      ...root.querySelectorAll<HTMLAnchorElement>(".browse-list a.list-title"),
    ]
      .find((card) => card.getAttribute("href") === href)
      ?.getBoundingClientRect().top;
    assert(
      after !== undefined && Math.abs(after - before) < 2,
      `읽던 카드 위치가 이동했다: ${href} ${before} → ${after}`,
    );
  },
]);
checks.push([
  "분할 구분선은 키보드·제한 폭·로컬 저장을 지원하고 모바일에서는 숨긴다",
  async () => {
    const split = root.querySelector<HTMLElement>(".splitter");
    assert(split, "구분선 누락");
    if (matchMedia("(max-width:900px)").matches) {
      assert(!split.getClientRects().length, "모바일 구분선 노출");
      return;
    }
    split.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    );
    const minimum = Number(split.getAttribute("aria-valuemin"));
    assert(
      Number(split.getAttribute("aria-valuenow")) === minimum &&
        Number(storage.getItem("fastJira:splitRatio")) > 0,
      "최소·저장 누락",
    );
    split.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true }),
    );
    assert(
      split.getAttribute("aria-valuenow") ===
        split.getAttribute("aria-valuemax"),
      "최대 제한 누락",
    );
    split.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    assert(split.getAttribute("aria-valuenow") === "50", "중앙 복원 누락");
    const card = root.querySelector(".browse .issue-card");
    const detail =
      root.querySelector(
        ".detail-pane .detail-content:not([hidden]) .issue-detail",
      ) ?? root.querySelector(".dashboard");
    assert(card && detail, "분할 영역 누락");
    const center =
      split.getBoundingClientRect().left +
      split.getBoundingClientRect().width / 2;
    const leftGap = center - card.getBoundingClientRect().right;
    const rightGap =
      detail.getBoundingClientRect().left +
      parseFloat(getComputedStyle(detail).paddingLeft) -
      center;
    assert(
      Math.abs(leftGap - rightGap) < 2,
      `목록·상세의 스플리터 간격 불일치: ${leftGap} / ${rightGap}`,
    );
  },
]);
checks.push([
  "개발자 모드에서만 로그를 켜며 시작·완료를 합치고 최근 300줄만 유지한다",
  async () => {
    assert(
      root.querySelector<HTMLButtonElement>('[aria-label="개발자 로그 켜기"]')
        ?.hidden && Number(logConnections) === 0,
      "기본 로그 구독 발생",
    );
    button("설정").click();
    button("관리").click();
    const setting = [...root.querySelectorAll<HTMLLabelElement>(".setting-row")]
      .find(
        (label) =>
          label.querySelector(".setting-label")?.textContent === "개발자 모드",
      )
      ?.querySelector<HTMLInputElement>("input");
    assert(setting, "개발자 설정 누락");
    setting.click();
    button("닫기").click();
    const navTitle = root.querySelector<HTMLElement>(".top-nav h1");
    assert(
      navTitle && navTitle.clientWidth >= navTitle.scrollWidth,
      "개발자 모드 서비스명 잘림",
    );
    const logRect = button("개발자 로그 켜기").getBoundingClientRect();
    assert(
      logRect.right <= innerWidth &&
        logRect.width >= (innerWidth <= 900 ? 32 : 34),
      "개발자 도구 넘침",
    );
    button("개발자 로그 켜기").click();
    assert(
      Number(logConnections) === 1 &&
        storage.getItem("fastJira:developerMode") === "true",
      "로그 구독·설정 저장 누락",
    );
    const entry: LogEntry = {
      id: 1,
      source: "API",
      time: "12:00",
      command: "GET /mock",
      result: "",
    };
    logListener(entry);
    logListener({ ...entry, result: "200 · 10ms", response: '{"ok":true}' });
    root.querySelector<HTMLButtonElement>('[data-request-id="1"]')?.click();
    assert(
      root
        .querySelector(".debug-response pre")
        ?.textContent?.includes('"ok": true'),
      "선택 응답 표시 누락",
    );
    assert(
      root.querySelectorAll('.debug-log [data-request-id="1"]').length === 1 &&
        root.querySelector('[data-request-id="1"] .debug-result')
          ?.textContent === "200 · 10ms",
      "요청 시작·완료 중복",
    );
    button("검색").click();
    assert(
      root.querySelector(".debug-line.action")?.textContent?.includes("검색"),
      "클릭 동작 기록 누락",
    );
    const resize = root.querySelector<HTMLElement>(".debug-resize"),
      panel = root.querySelector<HTMLElement>(".developer-panel");
    assert(resize && panel, "로그 높이 조절 누락");
    const height = panel.getBoundingClientRect().height;
    resize.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    assert(panel.getBoundingClientRect().height > height, "로그 높이 미반영");
    for (let id = 2; id <= 306; id++)
      logListener({ ...entry, id, result: "200" });
    assert(
      root.querySelector(".debug-log")?.children.length === 300,
      "로그 크기 제한 누락",
    );
    await app.select("TEST-3");
    if (matchMedia("(max-width:900px)").matches)
      assert(
        root.querySelector(".detail-modal .developer-panel"),
        "모달 로그 배치 누락",
      );
    app.closeDetail();
    button("개발자 로그 끄기").click();
    assert(
      Number(logConnections) === 0 &&
        !root.querySelector(".debug-log")?.children.length,
      "로그 닫기 정리 누락",
    );
    button("설정").click();
    button("관리").click();
    const disable = [...root.querySelectorAll<HTMLLabelElement>(".setting-row")]
      .find(
        (label) =>
          label.querySelector(".setting-label")?.textContent === "개발자 모드",
      )
      ?.querySelector<HTMLInputElement>("input");
    assert(disable, "개발자 설정 재열기 누락");
    disable.click();
    button("닫기").click();
    assert(
      root.querySelector<HTMLButtonElement>('[aria-label="개발자 로그 켜기"]')
        ?.hidden,
      "모드 종료 후 로그 버튼 노출",
    );
  },
]);
checks.push([
  "상단 메뉴는 스크롤해도 위치와 스크롤 영역 높이를 유지한다",
  async () => {
    const scroller = root.querySelector<HTMLElement>(
      matchMedia("(max-width:900px)").matches ? ".workspace" : ".browse",
    );
    const nav = root.querySelector<HTMLElement>(".top-nav");
    assert(scroller && nav, "스크롤 영역 또는 메뉴 누락");
    const before = nav.getBoundingClientRect();
    const height = scroller.clientHeight;
    for (const delta of [200, -100, 200]) {
      scroller.scrollTop += delta;
      await tick();
      const after = nav.getBoundingClientRect();
      assert(
        after.top === before.top && after.height === before.height,
        "스크롤 중 메뉴 위치 변경",
      );
      assert(scroller.clientHeight === height, "스크롤 중 영역 높이 변경");
    }
  },
]);
checks.push([
  "상세 하위 목록은 트리 필터·캐시를 공유하고 실패 재시도와 개별 필터 편집을 지원한다",
  async () => {
    app.list.toggle("TEST-1", true);
    app.views.apply(
      { kind: "branch", key: "TEST-1" },
      {
        ...app.views.resolve({ kind: "global" }),
        scope: "all",
        assignees: null,
        statuses: ["2"],
        sort: "oldest",
      },
    );
    await app.select("TEST-1");
    const before = calls.filter(
      (call) => call.pathname === "/api/children",
    ).length;
    const children = root.querySelector<HTMLDetailsElement>(".detail-children");
    assert(children && !children.open, "상세 하위 펼침 누락");
    assert(
      calls.filter((call) => call.pathname === "/api/children").length ===
        before,
      "펼치기 전에 하위 조회",
    );
    failChildren = true;
    children.open = true;
    for (
      let attempt = 0;
      !children.textContent?.includes("다시 시도") && attempt < 100;
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert(
      children.textContent?.includes("다시 시도"),
      "하위 조회 실패 복구 누락",
    );
    failChildren = false;
    children.querySelector<HTMLButtonElement>("button")?.click();
    for (
      let attempt = 0;
      !children.querySelector(".list-item") && attempt < 100;
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    const card = children.querySelector<HTMLAnchorElement>(".list-item");
    assert(card, "하위 카드 누락");
    assert(
      card.textContent?.includes("TEST-2") && card.querySelector(".list-meta"),
      "공통 하위 카드 누락",
    );
    app.list.updateMany([], new Set());
    assert(
      card === children.querySelector(".list-item"),
      "동일 데이터의 상세 하위 카드를 다시 만들었다",
    );
    const loaded = calls.filter(
      (call) => call.pathname === "/api/children",
    ).length;
    children.open = false;
    await tick();
    children.open = true;
    await tick();
    assert(
      calls.filter((call) => call.pathname === "/api/children").length ===
        loaded,
      "같은 상세에서 하위 중복 조회",
    );
    const filter = root.querySelector<HTMLButtonElement>(
      ".detail-child-filter",
    );
    assert(filter !== null, "상세 필터 버튼 누락");
    assert(filter.classList.contains("active"), "상세 개별 필터 표시 누락");
    filter.click();
    const panel = document.querySelector<HTMLElement>(
      ".filter-panel:popover-open",
    );
    assert(panel !== null, "상세 필터 팝오버 누락");
    assert(
      panel.textContent?.includes("TEST-1"),
      "상세에서 동일한 하위 필터 편집 누락",
    );
    panel
      .querySelector<HTMLButtonElement>(
        ".filter-footer .view-footer-actions button",
      )
      ?.click();
    card.click();
    await tick();
    assert(
      root.querySelector(".detail-identity .key")?.textContent === "TEST-2",
      "하위 상세 이동 누락",
    );
    app.closeDetail();
    app.list.toggle("TEST-1", false);
  },
]);
checks.push([
  "도움말은 시작·편집·일괄 변경·멘션 안내를 그룹별로 제공한다",
  () => {
    app.closeDetail();
    button("도움말").click();
    assert(
      root.querySelectorAll(".help-section").length === 3,
      "도움말 그룹 누락",
    );
    const text =
      root.querySelector(".help-section:last-child")?.textContent ?? "";
    assert(
      text.includes("일괄 변경") &&
        text.includes("@이름") &&
        text.includes("좋아요"),
      "주요 기능·지원 범위 안내 누락",
    );
    button("닫기").click();
  },
]);
checks.push([
  "새 브라우저의 첫 설정은 닫을 수 있고 목록 조회를 막지 않는다",
  async () => {
    const host = element("div"),
      localValues = new Map<string, string>();
    const localStore = {
      getItem: (key: string) => localValues.get(key) ?? null,
      setItem: (key: string, value: string) => {
        localValues.set(key, value);
      },
    };
    document.body.append(host);
    const before = calls.filter(
      (call) => call.pathname === "/api/issues",
    ).length;
    const pending = createApp(host, api, localStore, () => () => {});
    await tick();
    const popup = host.querySelector<HTMLDialogElement>(".settings-modal");
    try {
      assert(
        popup?.open && popup.textContent?.includes("처음 설정"),
        "첫 설정 누락",
      );
      const close = popup.querySelector<HTMLButtonElement>(
        '[aria-label="닫기"]',
      );
      assert(close && !close.hidden, "첫 설정 닫기가 숨겨져 있다");
      assert(
        popup.dispatchEvent(new Event("cancel", { cancelable: true })),
        "Escape를 차단한다",
      );
      assert(
        calls.filter((call) => call.pathname === "/api/issues").length > before,
        "설정이 목록 조회를 막는다",
      );
      close.click();
      await tick();
      assert(!popup.open, "첫 설정이 닫히지 않는다");
      assert(
        localStore
          .getItem("fastJira:filters:fixture.atlassian.net:my-account")
          ?.includes('"configured":true'),
        "닫은 첫 설정을 기억하지 않는다",
      );
      const fresh = await pending;
      host.querySelector<HTMLButtonElement>('[aria-label="설정"]')?.click();
      assert(
        popup.open && !popup.querySelector(".modal-footer"),
        "일반 설정에도 시작 푸터가 남는다",
      );
      popup.close();
      fresh.destroy();
    } finally {
      // 실패한 이전 구현의 초기화 대기도 해제해 검사 자원을 정리한다.
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "시작하기")
        ?.click();
      const fresh = await pending;
      fresh.destroy();
      popup?.close();
      host.remove();
      document.documentElement.dataset.theme = "dark";
    }
  },
]);
checks.push([
  "상세 키는 호버 복사를 공유하고 현재 경로 중복 없이 우측 액션을 유지한다",
  async () => {
    await app.select("TEST-3");
    const copy = root.querySelector<HTMLButtonElement>(
      ".breadcrumb-current .card-copy",
    );
    assert(
      copy &&
        copy.textContent === "TEST-3" &&
        !root.querySelector(".detail-copy"),
      "현재 이슈 키 복사 통합 누락",
    );
    assert(
      root.querySelectorAll(".detail-head .key").length === 1 &&
        !root.querySelector(".breadcrumb-current a"),
      "현재 이슈 중복 또는 이동 링크가 남음",
    );
    assert(
      copy.querySelector(".ui-icon") === null &&
        copy.dataset.tooltip === "링크 복사",
      "복사 아이콘이 남거나 즉시 툴팁이 누락됨",
    );
    const head = root.querySelector<HTMLElement>(".detail-head");
    const identity = root.querySelector<HTMLElement>(".detail-identity");
    const actions = root.querySelector<HTMLElement>(".detail-head-actions");
    const label = root.querySelector<HTMLElement>(".breadcrumb-label");
    assert(head && identity && actions && label, "상세 경로·우측 액션 누락");
    const original = label.textContent;
    head.style.width = "300px";
    label.textContent = "아주 긴 상위 이슈 이름 ".repeat(12);
    assert(
      identity.getBoundingClientRect().right <=
        actions.getBoundingClientRect().left,
      "긴 경로가 기록·닫기 영역을 침범함",
    );
    assert(head.scrollWidth <= head.clientWidth, "긴 경로가 가로로 넘침");
    label.textContent = original;
    head.style.removeProperty("width");
    button("설정").click();
    button("관리").click();
    const input = [...root.querySelectorAll<HTMLLabelElement>(".setting-row")]
      .find(
        (label) =>
          label.querySelector(".setting-label")?.textContent === "개발자 모드",
      )
      ?.querySelector<HTMLInputElement>("input");
    assert(input, "개발자 설정 누락");
    if (!input.checked) input.click();
    button("닫기").click();
    button("개발자 로그 켜기").click();
    logListener({
      id: 999,
      source: "API",
      time: "12:00",
      command: "POST /rest/api/3/issue/TEST-3/transitions",
      result: "204 · 180ms",
      response: "응답 본문 없음",
    });
    root.querySelector<HTMLButtonElement>('[data-request-id="999"]')?.click();
    const panel = root.querySelector<HTMLElement>(".developer-panel");
    const response = root.querySelector<HTMLElement>(".debug-response");
    const log = root.querySelector<HTMLElement>(".debug-log");
    assert(panel && response && log, "요청·응답 영역 누락");
    assert(
      response.getBoundingClientRect().left >=
        log.getBoundingClientRect().right - 1,
      "응답이 우측에 배치되지 않음",
    );
    assert(response.textContent?.includes("응답 본문 없음"), "선택 응답 누락");
    if (innerWidth <= 900)
      assert(
        panel.getBoundingClientRect().height >= innerHeight * 0.4 - 1,
        "모바일 로그 높이 부족",
      );
    assert(
      document.documentElement.scrollWidth <= innerWidth,
      "좁은 화면 가로 넘침",
    );
  },
]);
checks.push([
  "하위 로딩은 카드 효과로 표시하고 프로젝트 스피너는 중앙 정렬한다",
  async () => {
    let release = () => {};
    pendingRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    app.list.childPage("TEST-1").loaded = false;
    const row = root.querySelector<HTMLElement>(
      '[data-tree-key="TEST-1"] > .tree-row',
    );
    assert(row, "부모 행 누락");
    const card = row.querySelector<HTMLElement>(".list-item");
    assert(card, "부모 카드 누락");
    const before = card.getBoundingClientRect();
    const children = app.list.queueChildren("TEST-1");
    const busyCard = root.querySelector<HTMLElement>(
      '[data-tree-key="TEST-1"] > .tree-row .list-item[aria-busy="true"]',
    );
    assert(busyCard, "부모 카드 로딩 효과 누락");
    const after = busyCard.getBoundingClientRect();
    assert(
      after.width === before.width && after.height === before.height,
      "로딩으로 카드 크기 변경",
    );
    assert(
      getComputedStyle(busyCard).animationName === "card-loading",
      "카드 로딩 효과 누락",
    );
    assert(
      !root.querySelector(".tree-loading-slot,.child-loading"),
      "카드 옆 로딩 공간이 남는다",
    );
    const detail = app.select("TEST-3");
    assert(
      !root.querySelector<HTMLElement>(".detail-loading")?.hidden,
      "상세 조회 표시 누락",
    );
    assert(
      !root.textContent?.includes("이슈 내용을 불러오는 중"),
      "상세 로딩 문구가 공간을 차지한다",
    );
    release();
    pendingRead = null;
    await Promise.all([children, detail]);
    assert(
      !root.querySelector('.list-item[aria-busy="true"]'),
      "하위 로딩 효과가 남는다",
    );
    pendingRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loading = app.list.load({ ...app.list.filters });
    const projectSpinner = root.querySelector<HTMLElement>(
      ".project-heading .project-loading",
    );
    assert(projectSpinner, "프로젝트 제목의 로딩 표시 누락");
    assert(
      getComputedStyle(projectSpinner).position === "static",
      "프로젝트 로딩이 절대좌표를 사용한다",
    );
    assert(
      !root.querySelector(".splitter .loading-indicator"),
      "스플리터에 로딩 표시가 남는다",
    );
    const heading = projectSpinner.parentElement;
    assert(heading, "프로젝트 제목 누락");
    const headingRect = heading.getBoundingClientRect();
    const projectRect = projectSpinner.getBoundingClientRect();
    assert(
      headingRect.right - projectRect.right < 6,
      "프로젝트 제목 오른쪽 정렬 불일치",
    );
    assert(
      Math.abs(
        headingRect.top +
          headingRect.height / 2 -
          projectRect.top -
          projectRect.height / 2,
      ) < 1,
      "프로젝트 제목 세로 정렬 불일치",
    );
    release();
    pendingRead = null;
    await loading;
    assert(
      !root.querySelector(".project-loading"),
      "목록 조회 완료 후 로딩이 남는다",
    );
    assert(
      root.querySelector<HTMLElement>(".detail-loading")?.hidden === true,
      "조회 완료 후 표시가 남는다",
    );
  },
]);
checks.push([
  "완료 표시 설정은 즉시 적용하고 목록 재조회 없이 로컬에 저장한다",
  async () => {
    button("설정").click();
    await tick();
    const check = [
      ...document.querySelectorAll<HTMLLabelElement>(".settings-content label"),
    ]
      .find(
        (row) =>
          row.querySelector(".setting-label")?.textContent ===
          "완료된 하위 항목 타일로 보기",
      )
      ?.querySelector<HTMLInputElement>("input");
    assert(check, "완료 표시 옵션 누락");
    const count = calls.filter(
      (call) => call.pathname === "/api/issues",
    ).length;
    check.click();
    await tick();
    assert(
      document.documentElement.dataset.compactDone === String(check.checked),
      "표시 적용 누락",
    );
    assert(
      values.get("fastJira:compactDone") === String(check.checked),
      "로컬 저장 누락",
    );
    assert(
      calls.filter((call) => call.pathname === "/api/issues").length === count,
      "표시 변경에 불필요한 목록 조회",
    );
    button("닫기").click();
  },
]);
checks.push([
  "프로젝트 선택은 별도 팝오버에서 적용하며 뷰와 검색 조건을 유지한다",
  async () => {
    const beforeViews = JSON.stringify(app.views.state);
    const beforeFilters = {
      ...app.list.filters,
      projects: [...app.list.filters.projects],
    };
    const beforeCalls = calls.filter(
      (call) => call.pathname === "/api/issues",
    ).length;
    button("프로젝트 선택").click();
    const projects = document.querySelector<HTMLElement>(".project-panel");
    assert(projects, "프로젝트 팝오버 없음");
    assert(projects.matches(":popover-open"), "프로젝트 팝오버 닫힘");
    const check = projects.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    assert(check?.checked, "기존 선택 미반영");
    check.click();
    assert(
      app.list.filters.projects.length === beforeFilters.projects.length,
      "초안이 즉시 적용됨",
    );
    assert(
      calls.filter((call) => call.pathname === "/api/issues").length ===
        beforeCalls,
      "체크할 때 API 조회",
    );
    button("취소").click();
    button("프로젝트 선택").click();
    assert(
      projects.querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.checked,
      "취소된 초안이 남음",
    );
    button("선택 해제").click();
    button("적용").click();
    await tick();
    assert(app.list.filters.projects.length === 0, "프로젝트 선택 해제 실패");
    assert(
      calls.filter((call) => call.pathname === "/api/issues").length ===
        beforeCalls,
      "빈 프로젝트를 API로 조회",
    );
    button("프로젝트 선택").click();
    button("전체 선택").click();
    button("적용").click();
    await tick();
    assert(
      calls.filter((call) => call.pathname === "/api/issues").length ===
        beforeCalls + 1,
      "프로젝트 적용 중복 조회",
    );
    assert(
      JSON.stringify(app.views.state) === beforeViews,
      "프로젝트 변경이 뷰 정의를 바꿈",
    );
    assert(
      JSON.stringify(app.list.filters) === JSON.stringify(beforeFilters),
      "프로젝트 적용이 다른 조건을 바꿈",
    );
    button("필터 및 뷰").click();
    assert(
      !document.querySelector('.view-settings input[aria-label^="프로젝트:"]'),
      "뷰 안에 프로젝트 선택 잔존",
    );
    button("취소").click();
  },
]);

checks.push([
  "하위 뷰는 상세에서 설정하고 카드 배지 맨 앞에서 아이콘으로 구분한다",
  async () => {
    const target = { kind: "branch" as const, key: "TEST-1" };
    const original = app.views.binding(target);
    app.views.select(target, { kind: "default" });
    await tick();
    assert(
      !root.querySelector(
        '[data-tree-key="TEST-1"] > .tree-row .card-view-button',
      ),
      "상속 버튼 잔존",
    );
    await app.select("TEST-1");
    const filter = root.querySelector<HTMLButtonElement>(
      ".detail-child-filter",
    );
    assert(filter, "상속된 카드의 상세에 설정 진입점 없음");
    filter.click();
    const panel = document.querySelector<HTMLElement>(
      ".filter-panel:not(.project-panel)",
    );
    const select = panel?.querySelector<HTMLSelectElement>(
      ".view-picker select",
    );
    assert(select && panel, "상세 뷰 선택 없음");
    select.value = "inline";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    button("적용").click();
    await tick();
    app.closeDetail();
    const getAction = () =>
      root.querySelector<HTMLButtonElement>(
        '[data-tree-key="TEST-1"] > .tree-row .card-view-button',
      );
    const action = getAction();
    assert(action, "カード 뷰 버튼 없음");
    assert(
      action.parentElement?.classList.contains("list-meta") &&
        action === action.parentElement.firstElementChild,
      "뷰 버튼이 카드 오른쪽 정보의 맨 앞에 있지 않음",
    );
    assert(
      action
        .querySelector("use")
        ?.getAttribute("href")
        ?.endsWith("#list-filter-plus") &&
        root.querySelector(".card-view-label")?.textContent ===
          "이 하위 목록만 설정",
      "직접 설정 아이콘 불일치",
    );
    const expanded = root
      .querySelector('[data-issue-key="TEST-1"]')
      ?.getAttribute("aria-expanded");
    action.click();
    assert(
      !new URL(location.href).searchParams.get("issue"),
      "뷰 버튼 클릭이 이슈를 열었음",
    );
    assert(
      root
        .querySelector('[data-issue-key="TEST-1"]')
        ?.getAttribute("aria-expanded") === expanded,
      "뷰 클릭이 아코디언을 바꿈",
    );
    button("취소").click();
    app.views.register(
      target,
      app.views.resolve(target, false),
      "카드 뷰 검사",
    );
    const saved = app.views.binding(target);
    assert(saved.kind === "saved", "저장된 뷰 연결 실패");
    assert(
      getAction()
        ?.querySelector("use")
        ?.getAttribute("href")
        ?.endsWith("#user"),
      "저장한 뷰 아이콘 불일치",
    );
    app.views.delete(saved.viewId);
    app.views.select(target, original);
  },
]);

checks.push([
  "실제 활동은 초기 10건·생성·본인 활동을 표시하며 새 2건만 구분하고 목록 필터와 독립적으로 갱신한다",
  async () => {
    app.closeDetail();
    assert(
      root.querySelectorAll(".activity-row").length === 10,
      "초기 활동 10건 누락",
    );
    assert(
      root
        .querySelector(".activity-feed")
        ?.textContent?.includes("이슈를 만들었습니다"),
      "생성 활동 누락",
    );
    const target = { kind: "global" } as const;
    const original = app.views.resolve(target);
    const beforeFilter = calls.filter(
      (call) => call.pathname === "/api/activity",
    ).length;
    app.views.apply(target, { ...original, statuses: [] });
    await tick();
    assert(
      root.querySelectorAll(".activity-row").length === 10,
      "목록 필터가 활동을 숨긴다",
    );
    assert(
      calls.filter((call) => call.pathname === "/api/activity").length ===
        beforeFilter,
      "목록 필터 변경이 활동을 재조회한다",
    );
    const first = activityItems[0];
    assert(first, "활동 검사 기준 누락");
    activityItems = [
      {
        ...first,
        id: "12",
        created: new Date().toISOString(),
        text: "나 새로운 이슈를 만들었습니다",
      },
      {
        ...first,
        id: "11",
        created: new Date(Date.now() - 1000).toISOString(),
        text: "나 댓글을 남겼습니다",
      },
      ...activityItems,
    ];
    const start = calls.length;
    await app.checkChanges();
    assert(
      root.querySelectorAll(".activity-row").length === 10,
      "활동 상한 초과",
    );
    assert(
      root.querySelectorAll(".activity-new").length === 2,
      "신규 두 건 구분 실패",
    );
    assert(
      !root.querySelector(".activity-feed")?.textContent?.includes("활동 1"),
      "오래된 활동이 남는다",
    );
    const added = calls.slice(start);
    assert(
      added.filter((call) => call.pathname === "/api/activity").length === 1,
      "활동 조회가 한 번이 아니다",
    );
    assert(
      !added.some((call) =>
        ["/api/issue", "/api/comments", "/api/history"].includes(call.pathname),
      ),
      "활동 표시가 상세·댓글·기록 조회를 추가한다",
    );
    await app.checkChanges();
    assert(
      root.querySelectorAll(".activity-new").length === 0,
      "같은 기록이 다시 새 활동이 된다",
    );
    activityFailed = true;
    await app.checkChanges();
    assert(
      root.querySelectorAll(".activity-row").length === 10 &&
        root
          .querySelector(".activity-message")
          ?.textContent?.includes("이전 내역"),
      "실패 시 기존 기록 또는 오류 안내 누락",
    );
    activityFailed = false;
    const retry = root.querySelector<HTMLButtonElement>(
      ".activity-feed button",
    );
    assert(retry, "활동 재시도 없음");
    retry.click();
    await tick();
    assert(
      !root
        .querySelector(".activity-message")
        ?.textContent?.includes("조회 실패"),
      "재시도 실패",
    );
    const clickStart = calls.length;
    root.querySelector<HTMLAnchorElement>(".activity-row")?.click();
    await tick();
    assert(
      calls.slice(clickStart).some((call) => call.pathname === "/api/issue"),
      "클릭 시 기존 상세를 열지 않는다",
    );
    app.closeDetail();
    app.views.apply(target, original);
    await tick();
  },
]);

checks.push([
  "즐겨찾기는 상세에서 등록하고 최상단에서 해제하며 추가 조회 없이 계정별 저장한다",
  async () => {
    app.closeDetail();
    assert(!root.querySelector(".favorites"), "빈 즐겨찾기 영역이 보인다");
    await app.select("TEST-1");
    await tick();
    const start = calls.length;
    button("즐겨찾기 추가").click();
    assert(
      button("즐겨찾기 해제").getAttribute("aria-pressed") === "true",
      "별표 상태 누락",
    );
    assert(
      root.querySelector(".detail-title")?.textContent === issues[0]?.summary,
      "즐겨찾기가 상세를 닫았다",
    );
    app.closeDetail();
    const favorites = root.querySelector(".dashboard > .favorites");
    assert(
      favorites &&
        favorites === root.querySelector(".dashboard")?.firstElementChild,
      "즐겨찾기가 최상단에 없다",
    );
    assert(
      favorites.querySelector(".list-title")?.textContent ===
        issues[0]?.summary,
      "등록한 카드 누락",
    );
    const copies = [
      ...root.querySelectorAll<HTMLElement>(".issue-card"),
    ].filter(
      (card) =>
        card.querySelector(".card-copy")?.textContent?.trim() === "TEST-1",
    );
    assert(copies.length >= 3, "목록·최근·즐겨찾기 카드가 모두 있어야 한다");
    for (const card of copies) {
      assert(
        card.querySelector('.favorite-button[aria-pressed="true"]'),
        "같은 이슈인데 다른 목록의 즐겨찾기 별표가 빠졌다",
      );
      const item = card.querySelector(".list-item"),
        favoriteItem = favorites.querySelector(".list-item");
      assert(item && favoriteItem, "공통 카드 본문 누락");
      const style = getComputedStyle(item);
      const reference = getComputedStyle(favoriteItem);
      assert(
        style.padding === reference.padding && style.gap === reference.gap,
        "공통 카드의 여백이 다르다",
      );
    }
    assert(calls.length === start, "즐겨찾기 등록이 추가 요청을 만든다");
    const stored = JSON.parse(
      values.get("fastJira:favorites:fixture.atlassian.net:my-account") ??
        "null",
    );
    assert(stored?.[0]?.key === "TEST-1", "즐겨찾기 저장 누락");
    const first = issues[0];
    assert(first, "즐겨찾기 검사 대상 누락");
    app.list.update({ ...first, summary: "즐겨찾기의 최신 제목" }, true);
    assert(
      root.querySelector(".favorites .list-title")?.textContent ===
        "즐겨찾기의 최신 제목",
      "최신 목록 값 미반영",
    );
    const remove = root.querySelector<HTMLButtonElement>(
      '[aria-label="즐겨찾기 해제"]',
    );
    assert(remove, "해제 버튼 누락");
    remove.click();
    assert(
      !root.querySelector(".favorites"),
      "마지막 해제 후 빈 영역이 남는다",
    );
    assert(
      !root.querySelector(".issue-card .favorite-button"),
      "해제 후 다른 카드에 별표가 남았다",
    );
    assert(
      !new URL(location.href).searchParams.get("issue"),
      "해제 클릭이 상세를 열었다",
    );
    assert(calls.length === start, "해제가 추가 요청을 만들었다");
    assert(
      JSON.parse(
        values.get("fastJira:favorites:fixture.atlassian.net:my-account") ??
          "null",
      ).length === 0,
      "해제가 저장되지 않는다",
    );
  },
]);

checks.push([
  "내 제목·본문·댓글 저장 후 도착한 이전 상세는 화면·최근·즐겨찾기를 덮지 않는다",
  async () => {
    for (const kind of ["제목", "본문", "댓글"] as const) {
      const snapshot = await api.lookup("TEST-3");
      await app.select("TEST-3");
      button("즐겨찾기 추가").click();
      let release = () => {};
      pendingLookup = new Promise<Response>((resolve) => {
        release = () => resolve(Response.json(snapshot));
      });
      const reading = app.select("TEST-3", false, true);
      const before = calls.length;
      const matchesBefore = calls.filter(
        (call) => call.pathname === "/api/matches",
      ).length;
      try {
        if (kind === "제목") {
          button("제목 수정").click();
          const input = root.querySelector<HTMLInputElement>(
            ".detail-title-editor input",
          );
          const form = root.querySelector<HTMLFormElement>(
            ".detail-title-editor",
          );
          assert(input && form, "제목 작성 폼 누락");
          input.value = "이전 응답보다 새 제목";
          form.requestSubmit();
        } else {
          button(kind === "본문" ? "수정" : "댓글 추가").click();
          const form = root.querySelector<HTMLFormElement>(
            kind === "본문"
              ? ".detail-description .document-form"
              : ".comments .document-form",
          );
          const input = form?.querySelector<HTMLElement>(
            '[contenteditable="true"]',
          );
          assert(form && input, "작성 폼 누락");
          input.textContent = `이전 응답보다 새 ${kind}`;
          form.requestSubmit();
        }
        await tick();
        for (
          let attempt = 0;
          attempt < 30 &&
          root.querySelector(
            ".document-form,.detail-title-editor:not([hidden])",
          );
          attempt++
        )
          await tick();
        assert(
          !root.querySelector(
            ".document-form,.detail-title-editor:not([hidden])",
          ),
          `${kind}: 저장이 끝나지 않음 · ${root.querySelector(".document-form > .document-actions .error")?.textContent ?? root.querySelector(".document-form .error")?.textContent ?? ""}`,
        );
        assert(
          calls.filter((call) => call.pathname === "/api/matches").length ===
            matchesBefore + (kind === "제목" ? 1 : 0),
          `${kind}: 내용 저장에 불필요한 필터 재조회`,
        );
        const saved = root.querySelector(".issue-detail");
        const recent = values.get(
          "fastJira:recent:fixture.atlassian.net:my-account",
        );
        const favorites = values.get(
          "fastJira:favorites:fixture.atlassian.net:my-account",
        );
        assert(recent && favorites, "저장된 최근·즐겨찾기 검사 데이터 누락");
        const reads = calls.filter(
          (call) => call.pathname === "/api/issue",
        ).length;
        assert(calls.length > before, "저장 요청 누락");
        release();
        await reading;
        await tick();
        assert(
          root.querySelector(".issue-detail") === saved,
          `${kind}: 이전 응답이 상세를 교체함`,
        );
        assert(
          values.get("fastJira:recent:fixture.atlassian.net:my-account") ===
            recent,
          `${kind}: 최근 이력이 되돌아감`,
        );
        assert(
          values.get("fastJira:favorites:fixture.atlassian.net:my-account") ===
            favorites,
          `${kind}: 즐겨찾기가 되돌아감`,
        );
        assert(
          calls.filter((call) => call.pathname === "/api/issue").length ===
            reads,
          "이전 응답을 버리면서 추가 조회함",
        );
      } finally {
        pendingLookup = null;
        release();
        await reading;
        button("즐겨찾기 해제").click();
        app.closeDetail();
      }
    }
    await app.select("TEST-3");
    const previousView = root.querySelector(".issue-detail");
    await app.select("TEST-3", false, true);
    assert(
      root.querySelector(".issue-detail") !== previousView,
      "내 수정이 없는데 정상 갱신까지 차단함",
    );
    app.closeDetail();
  },
]);
checks.push([
  "탭 표시와 창 포커스가 모두 활성일 때만 자동 갱신하고 짧은 복귀는 재조회하지 않는다",
  async () => {
    const originalNow = Date.now;
    const focusDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "hasFocus",
    );
    const hiddenDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "hidden",
    );
    let focused = false;
    let hidden = false;
    let time = originalNow() + 61000;
    const count = () =>
      calls.filter((call) =>
        ["/api/changes", "/api/sync", "/api/activity"].includes(call.pathname),
      ).length;
    const before = count();
    try {
      Date.now = () => time;
      Object.defineProperty(document, "hasFocus", {
        configurable: true,
        value: () => focused,
      });
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => hidden,
      });
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
      await tick();
      assert(count() === before, "포커스 없는 창에서 자동 조회함");
      focused = true;
      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      await tick();
      assert(count() === before, "숨겨진 탭에서 자동 조회함");
      hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      await tick();
      assert(
        count() === before + 2,
        "복귀 시 목록·활동을 한 번씩 확인하지 않음",
      );
      focused = false;
      window.dispatchEvent(new Event("blur"));
      time += 1000;
      focused = true;
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      await tick();
      assert(count() === before + 2, "짧은 재진입에 같은 자료를 재조회함");
    } finally {
      Date.now = originalNow;
      if (focusDescriptor)
        Object.defineProperty(document, "hasFocus", focusDescriptor);
      else Reflect.deleteProperty(document, "hasFocus");
      if (hiddenDescriptor)
        Object.defineProperty(document, "hidden", hiddenDescriptor);
      else Reflect.deleteProperty(document, "hidden");
      window.dispatchEvent(new Event("focus"));
    }
  },
]);

checks.push([
  "본문 저장 전 시작된 변경 조회는 저장 후 목록·상세를 이전 값으로 바꾸지 않는다",
  async () => {
    await app.select("TEST-3");
    const snapshot = await api.lookup("TEST-3");
    let release = () => {};
    pendingChanges = new Promise<Response>((resolve) => {
      release = () =>
        resolve(
          Response.json({
            issues: [
              {
                ...snapshot.parent,
                summary: "저장 전 변경 조회의 제목",
                updated: new Date().toISOString(),
                matches: true,
              },
            ],
            ancestors: [],
          }),
        );
    });
    const reading = app.checkChanges();
    try {
      await tick();
      button("수정").click();
      const form = root.querySelector<HTMLFormElement>(
        ".detail-description .document-form",
      );
      const input = form?.querySelector<HTMLElement>(
        '[contenteditable="true"]',
      );
      assert(form && input, "본문 폼 누락");
      input.textContent = "지연된 변경 응답보다 새 본문";
      form.requestSubmit();
      for (let attempt = 0; attempt < 30 && form.isConnected; attempt++)
        await tick();
      assert(!form.isConnected, "본문 저장이 끝나지 않음");
      const saved = root.querySelector(".issue-detail");
      const reads = calls.filter(
        (call) => call.pathname === "/api/issue",
      ).length;
      const matches = calls.filter(
        (call) => call.pathname === "/api/matches",
      ).length;
      pendingLookup = Promise.resolve(Response.json(snapshot));
      release();
      await reading;
      await tick();
      assert(
        root.querySelector(".issue-detail") === saved,
        "본문 저장 뒤 이전 변경 조회가 상세를 교체함",
      );
      assert(
        root
          .querySelector(".detail-description .adf")
          ?.textContent?.includes("지연된 변경 응답보다 새 본문"),
        "새 본문이 되돌아감",
      );
      assert(
        app.list.items.get("TEST-3")?.summary === snapshot.parent.summary,
        "본문 저장 뒤 이전 변경 조회가 목록을 덮음",
      );
      assert(
        calls.filter((call) => call.pathname === "/api/issue").length === reads,
        "이전 변경 응답으로 상세 재조회함",
      );
      assert(
        calls.filter((call) => call.pathname === "/api/matches").length ===
          matches,
        "이전 변경 응답으로 필터 재조회함",
      );
    } finally {
      release();
      await reading;
      pendingChanges = pendingLookup = null;
      changes = { issues: [], ancestors: [] };
      app.closeDetail();
    }
  },
]);

checks.push([
  "본문·댓글 저장은 작성 중 갱신된 목록의 제목·상태를 보존한다",
  async () => {
    for (const kind of ["본문", "댓글"] as const) {
      await app.select("TEST-3");
      const before = await api.lookup("TEST-3");
      button(kind === "본문" ? "수정" : "댓글 추가").click();
      const form = root.querySelector<HTMLFormElement>(
        kind === "본문"
          ? ".detail-description .document-form"
          : ".comments .document-form",
      );
      const input = form?.querySelector<HTMLElement>(
        '[contenteditable="true"]',
      );
      assert(form && input, "내용 작성 폼 누락");
      const current = {
        ...before.parent,
        summary: `작성 중 갱신된 ${kind} 이슈`,
        status: "완료",
        statusId: "3",
        updated: new Date().toISOString(),
      };
      app.list.update(current, true);
      input.textContent = `갱신된 목록과 함께 저장할 ${kind}`;
      const count = before.parent.commentCount;
      form.requestSubmit();
      for (let attempt = 0; attempt < 30 && form.isConnected; attempt++)
        await tick();
      assert(!form.isConnected, "내용 저장이 끝나지 않음");
      const saved = app.list.items.get("TEST-3");
      assert(
        saved?.summary === current.summary &&
          saved.status === current.status &&
          saved.updated === current.updated,
        `${kind}: 내용 저장이 최신 목록 메타정보를 덮음`,
      );
      assert(
        saved.commentCount ===
          (kind === "댓글" ? count + 1 : current.commentCount),
        `${kind}: 댓글 개수 반영 불일치`,
      );
      app.closeDetail();
    }
  },
]);

checks.push([
  "멘션 후보의 첫 Escape는 상세·초안·초점을 유지하고 후보만 닫는다",
  async () => {
    await app.select("TEST-3");
    button("댓글 추가").click();
    const input = root.querySelector<HTMLElement>(
      '.comments [contenteditable="true"]',
    );
    assert(input, "댓글 입력 누락");
    const paragraph = input.querySelector("p");
    assert(paragraph, "편집 문단 누락");
    paragraph.textContent = "보존할 초안 @동";
    input.focus();
    const range = document.createRange();
    assert(paragraph.firstChild, "멘션 텍스트 누락");
    range.setStart(paragraph.firstChild, paragraph.textContent.length);
    range.collapse(true);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    input.dispatchEvent(new Event("input"));
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert(input.getAttribute("aria-expanded") === "true", "멘션 후보 누락");
    const escapeEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(escapeEvent);
    assert(escapeEvent.defaultPrevented, "후보 Escape가 상세 닫기까지 전달됨");
    assert(
      input.isConnected &&
        input.textContent === "보존할 초안 @동" &&
        document.activeElement === input,
      "멘션 초안/초점 손실",
    );
    assert(
      input.getAttribute("aria-expanded") === "false",
      "멘션 후보가 닫히지 않음",
    );
    const next = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(next);
    assert(!next.defaultPrevented, "후보 없는 Escape 기본 동작을 차단함");
    app.closeDetail();
  },
]);
checks.push([
  "화면 폭이 바뀌면 열린 선택기만 닫고 값과 상세를 유지한다",
  async () => {
    await app.select("TEST-3");
    button("상태").click();
    await tick();
    assert(root.querySelector(".select-options:popover-open"), "선택기 누락");
    const detail = root.querySelector(".issue-detail");
    const selected = root.querySelector<HTMLSelectElement>(
      '[aria-label="상태"]',
    )?.value;
    const descriptor = Object.getOwnPropertyDescriptor(window, "innerWidth");
    try {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: innerWidth + 100,
      });
      window.dispatchEvent(new Event("resize"));
      assert(
        !root.querySelector(".select-options:popover-open"),
        "폭 변경 뒤 이전 좌표의 선택기가 남음",
      );
      assert(
        root.querySelector(".issue-detail") === detail &&
          root.querySelector<HTMLSelectElement>('[aria-label="상태"]')
            ?.value === selected,
        "회전이 상세/값을 변경함",
      );
      assert(
        document.activeElement === button("상태"),
        "닫힌 선택기에 초점이 남음",
      );
    } finally {
      if (descriptor) Object.defineProperty(window, "innerWidth", descriptor);
      window.dispatchEvent(new Event("resize"));
      app.closeDetail();
    }
  },
]);

checks.push([
  "실제 카드 폭이 좁아져도 간단히 보기의 제목과 배지 정보를 유지한다",
  () => {
    const compact = document.documentElement.dataset.compact;
    const host = element("div", "issue-list-container");
    host.style.cssText = "width:230px;position:fixed;top:0;left:0";
    const card = issueCard(
      {
        ...emptyIssue(
          "TEST-100",
          "다양한 정보를 담은 긴 카드 제목을 읽을 수 있어야 합니다",
        ),
        assignee: "긴 이름의 담당자",
        status: "개발 진행 중",
        commentCount: 2,
        dueDate: "2026-12-31",
        priority: "높음",
      },
      { statusOrder: ["개발 진행 중"], onSelect() {} },
    );
    host.append(card);
    document.body.append(host);
    document.documentElement.dataset.compact = "true";
    try {
      const title = card.querySelector<HTMLElement>(".list-title");
      assert(
        title && title.getBoundingClientRect().width > 180,
        "좁은 카드에서 제목이 사라짐",
      );
      assert(card.scrollWidth <= card.clientWidth, "배지가 카드를 넘어감");
      assert(
        card.querySelector(".status-pill")?.getClientRects().length,
        "좁은 카드에서 상태 누락",
      );
    } finally {
      host.remove();
      if (compact === undefined)
        delete document.documentElement.dataset.compact;
      else document.documentElement.dataset.compact = compact;
    }
  },
]);
checks.push([
  "좁은 일괄 작업 바는 동작 이름을 보여주고 가로로 넘치지 않는다",
  () => {
    app.closeDetail();
    button("이슈 선택 모드").click();
    try {
      const bar = root.querySelector<HTMLElement>(".bulk-bar");
      assert(
        bar && bar.scrollWidth <= bar.clientWidth,
        "일괄 작업 바 가로 넘침",
      );
      const actions = root.querySelectorAll<HTMLElement>(
        ".bulk-actions button",
      );
      assert(actions.length === 6, "일괄 동작 누락");
      for (const action of actions) {
        assert(
          Number.parseFloat(getComputedStyle(action).fontSize) >= 12,
          "일괄 동작 이름 숨김",
        );
        if (innerWidth <= 900)
          assert(
            action.getBoundingClientRect().height >= 32,
            "일괄 동작 터치 영역 부족",
          );
      }
    } finally {
      button("선택 종료").click();
    }
  },
]);

checks.push([
  "상세 상위 경로는 전체 폭을 쓰고 긴 내용을 내려도 닫기 행이 보인다",
  async () => {
    await app.select("TEST-3");
    const article = root.querySelector<HTMLElement>(".issue-detail");
    const head = root.querySelector<HTMLElement>(".detail-head");
    const path = root.querySelector<HTMLElement>(".detail-breadcrumbs");
    assert(article && head && path, "상세 헤더 누락");
    head.style.width = "min(100%, 259px)";
    const fillers = Array.from({ length: 20 }, () =>
      element("p", "", "길어진 설명과 댓글을 읽는 상황입니다. ".repeat(5)),
    );
    const scroller = root.querySelector<HTMLElement>(
      matchMedia("(max-width: 900px)").matches
        ? ".detail-content"
        : ".detail-pane",
    );
    assert(scroller, "상세 스크롤 영역 누락");
    const before = scroller.scrollTop;
    try {
      assert(
        !head.contains(path) &&
          path.getBoundingClientRect().width >=
            head.getBoundingClientRect().width - 1,
        "상위 경로가 동작 버튼과 좁은 폭을 공유함",
      );
      article.append(...fillers);
      scroller.scrollTop = scroller.scrollHeight;
      await tick();
      const close = button("이슈 상세 닫기").getBoundingClientRect();
      const bounds = scroller.getBoundingClientRect();
      assert(
        close.top >= bounds.top && close.bottom <= bounds.bottom,
        "스크롤 후 상세 닫기가 화면 밖으로 사라짐",
      );
      assert(head.scrollWidth <= head.clientWidth, "상세 키와 버튼 가로 넘침");
      const current = head.querySelector(".breadcrumb-current");
      const actions = head.querySelector(".detail-head-actions");
      assert(
        current &&
          actions &&
          current.getBoundingClientRect().right <=
            actions.getBoundingClientRect().left,
        "이슈 키와 즐겨찾기/기록 버튼이 겹침",
      );
    } finally {
      for (const filler of fillers) filler.remove();
      head.style.removeProperty("width");
      scroller.scrollTop = before;
      app.closeDetail();
    }
  },
]);
checks.push([
  "작은 화면의 카드·댓글 조작은 S 크기와 보조 버튼 크기를 구분한다",
  async () => {
    if (!matchMedia("(max-width: 900px)").matches) return;
    await app.select("TEST-3");
    await tick();
    for (const control of root.querySelectorAll<HTMLElement>(
      ".comment-toolbar button, .breadcrumb-current .card-copy",
    )) {
      assert(
        control.getBoundingClientRect().height >=
          (control.matches(".card-copy") ? 24 : 32),
        "댓글/복사 조작 크기가 S 기준보다 작음",
      );
    }
    app.closeDetail();
    for (const control of root.querySelectorAll<HTMLElement>(
      ".browse .tree-toggle, .browse .card-copy, .browse .card-view-button",
    )) {
      if (control.getClientRects().length)
        assert(
          control.getBoundingClientRect().height >=
            (control.matches(".card-copy") ? 24 : 32),
          "목록 조작 크기가 S 기준보다 작음",
        );
    }
  },
]);

checks.push([
  "좁은 화면의 버튼·선택기·필드 간격은 함께 작아지고 작성 글자는 읽을 수 있다",
  async () => {
    await app.select("TEST-3");
    const small = matchMedia("(max-width: 900px)").matches;
    const controls = [
      ...root.querySelectorAll<HTMLElement>(".detail-field .select-trigger"),
    ];
    assert(controls.length === 3, "상세 선택기 누락");
    for (const control of controls) {
      const height = control.getBoundingClientRect().height;
      assert(
        height >= 30 && height <= (small ? 34 : 36),
        "선택기가 공통 크기를 벗어남",
      );
    }
    const fields = root.querySelector<HTMLElement>(".detail-fields");
    assert(
      fields &&
        Number.parseFloat(getComputedStyle(fields).rowGap) <= (small ? 12 : 16),
      "필드 간격이 지나치게 큼",
    );
    const field = root.querySelector<HTMLElement>(".detail-field");
    assert(
      field &&
        Number.parseFloat(getComputedStyle(field).rowGap) <= (small ? 4 : 6),
      "레이블 간격이 지나치게 큼",
    );
    button("댓글 추가").click();
    const save = button("댓글 저장");
    assert(
      Math.abs(
        save.getBoundingClientRect().height -
          (controls[0]?.getBoundingClientRect().height ?? 0),
      ) < 2,
      "버튼과 선택기 크기가 다름",
    );
    if (innerWidth <= 600) {
      const date = root.querySelector<HTMLElement>(
        '.detail-field input[type="date"]',
      );
      assert(
        date && Number.parseFloat(getComputedStyle(date).fontSize) >= 16,
        "직접 입력 글자까지 작아짐",
      );
    }
    button("취소").click();
    app.closeDetail();
  },
]);

let failures = 0;
for (const [name, check] of checks) {
  try {
    await check();
    results.append(element("li", "", `통과 · ${name}`));
  } catch (reason) {
    failures++;
    results.append(
      element(
        "li",
        "error",
        `실패 · ${name}: ${reason instanceof Error ? reason.message : String(reason)}`,
      ),
    );
  }
}
results.dataset.failures = String(failures);
results.dataset.complete = "true";
results.style.cssText =
  "position:fixed;bottom:0;left:12px;z-index:60;max-height:28vh;overflow:auto;background:var(--surface);padding:12px 12px 12px 28px;border:1px solid var(--border);font-size:12px";
