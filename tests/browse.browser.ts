import { createApi } from "../src/client/api.ts";
import { createApp } from "../src/client/app.ts";
import { type AdfDocument, decodeAdfDocument } from "../src/domain/adf.ts";
import type { Comment } from "../src/domain/content.ts";
import type { LogEntry } from "../src/domain/log.ts";
import { record } from "../src/domain/validation.ts";
import { type ChangeBatch, emptyIssue } from "../src/domain/wire.ts";
import { element } from "../src/ui/dom.ts";
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
  if (
    pendingRead &&
    ["/api/children", "/api/issue", "/api/issues"].includes(url.pathname)
  )
    await pendingRead;
  switch (url.pathname) {
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
    const sticky = root.querySelector<HTMLElement>(".sticky-parent");
    assert(
      sticky && getComputedStyle(sticky).position === "sticky",
      "부모 sticky가 다른 CSS로 덮였다",
    );
    const actions = root.querySelector(".tree-actions");
    assert(actions, "카드 액션 누락");
    const filterRect = actions.firstElementChild?.getBoundingClientRect();
    const toggleRect = actions.lastElementChild?.getBoundingClientRect();
    assert(
      filterRect &&
        toggleRect &&
        filterRect.right <= toggleRect.left &&
        filterRect.top === toggleRect.top,
      "카드 필터·접기 버튼 가로 정렬 불일치",
    );
    assert(
      actions?.lastElementChild?.classList.contains("tree-toggle"),
      "필터가 접기 버튼 왼쪽에 있지 않다",
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
    button("필터 및 정렬").click();
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
    button("TEST-1 하위 정렬·필터").click();
    await tick();
    const panel = document.querySelector<HTMLElement>(".filter-panel");
    const inherit = panel?.querySelector<HTMLInputElement>(
      '[aria-label="담당자 글로벌 필터 적용"]',
    );
    assert(inherit?.checked, "상속 기본값 누락");
    inherit.click();
    const section = Array.from(
      panel?.querySelectorAll<HTMLElement>(".filter-section") ?? [],
    ).find(
      (section) =>
        section.querySelector(".filter-section-head h3")?.textContent ===
        "담당자",
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
      root.querySelector(".reported-at") instanceof HTMLTimeElement,
      "공통 상대 시각 누락",
    );
    assert(
      root.querySelector(".dashboard .list-item .key")?.textContent ===
        "TEST-3",
      "최근 카드 누락",
    );
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
      ".settings-modal input",
    );
    assert(checks.length === 3, "설정 체크 누락");
    for (const label of ["다크 모드", "간단히 보기"]) {
      const check = [...root.querySelectorAll<HTMLLabelElement>(".setting-row")]
        .find((row) => row.textContent === label)
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
    app.closeDetail();
  },
]);
checks.push([
  "본문 저장 실패는 초안을 유지하며 저장 뒤 상태 변경도 새 본문을 보존한다",
  async () => {
    await app.select("TEST-3");
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
        '#comment-2 > .comment-toolbar [aria-label="내 댓글 편집"]',
      ) &&
        root.querySelector(
          '#comment-1 > .comment-toolbar [aria-label="내 댓글 편집"]',
        ),
      "작성자 편집 권한 불일치",
    );
    root
      .querySelector<HTMLButtonElement>(
        '#comment-1 > .comment-toolbar [aria-label="내 댓글 편집"]',
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
        '#comment-2 > .comment-toolbar [aria-label="답글 작성"]',
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
    button("되돌리기").click();
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
    const top = scroller.getBoundingClientRect().top;
    const card = [
      ...root.querySelectorAll<HTMLAnchorElement>(".browse-list a.list-title"),
    ].find(
      (card) =>
        !card.closest(".sticky-parent") &&
        card.getBoundingClientRect().bottom > top,
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
      "읽던 카드 위치가 이동했다",
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
    const setting = [...root.querySelectorAll<HTMLLabelElement>(".setting-row")]
      .find((label) => label.textContent === "개발자 모드")
      ?.querySelector<HTMLInputElement>("input");
    assert(setting, "개발자 설정 누락");
    setting.click();
    button("닫기").click();
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
    const disable = [...root.querySelectorAll<HTMLLabelElement>(".setting-row")]
      .find((label) => label.textContent === "개발자 모드")
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
  "상세 하위 목록은 펼칠 때 조회하고 실패를 재시도하며 공통 카드로 이동한다",
  async () => {
    await app.select("TEST-1");
    const before = calls.filter(
      (call) => call.pathname === "/api/issue-children",
    ).length;
    const children = root.querySelector<HTMLDetailsElement>(".detail-children");
    assert(children && !children.open, "상세 하위 펼침 누락");
    assert(
      calls.filter((call) => call.pathname === "/api/issue-children").length ===
        before,
      "펼치기 전에 하위 조회",
    );
    failChildren = true;
    children.open = true;
    for (let attempt = 0; children.open && attempt < 100; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert(
      !children.open && children.textContent?.includes("다시 불러오기"),
      "하위 조회 실패 복구 누락",
    );
    failChildren = false;
    children.open = true;
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
    const loaded = calls.filter(
      (call) => call.pathname === "/api/issue-children",
    ).length;
    children.open = false;
    await tick();
    children.open = true;
    await tick();
    assert(
      calls.filter((call) => call.pathname === "/api/issue-children").length ===
        loaded,
      "같은 상세에서 하위 중복 조회",
    );
    card.click();
    await tick();
    assert(
      root.querySelector(".detail-identity .key")?.textContent === "TEST-2",
      "하위 상세 이동 누락",
    );
    app.closeDetail();
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
  "처음 설정은 계정을 표시하고 시작하며 일반 설정은 즉시 저장한다",
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
    assert(
      popup?.open && popup.textContent?.includes("처음 설정"),
      "첫 설정 누락",
    );
    assert(
      popup.textContent.includes("fixture.atlassian.net") &&
        popup.textContent.includes("로그인 계정"),
      "연결 계정 안내 누락",
    );
    assert(
      !popup.dispatchEvent(new Event("cancel", { cancelable: true })),
      "첫 설정 Escape 허용",
    );
    assert(
      calls.filter((call) => call.pathname === "/api/issues").length === before,
      "시작 전 목록 조회",
    );
    const start = [...popup.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "시작하기",
    );
    assert(start, "첫 시작 버튼 누락");
    start.click();
    const fresh = await pending;
    try {
      assert(
        !popup.open &&
          localStore
            .getItem("fastJira:filters:fixture.atlassian.net:my-account")
            ?.includes('"configured":true'),
        "첫 설정 저장 누락",
      );
      host.querySelector<HTMLButtonElement>('[aria-label="설정"]')?.click();
      const theme = [...popup.querySelectorAll<HTMLLabelElement>("label")]
        .find((label) => label.textContent === "다크 모드")
        ?.querySelector<HTMLInputElement>("input");
      assert(theme, "설정 재열기 누락");
      theme.click();
      [...popup.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.getAttribute("aria-label") === "닫기")
        ?.click();
      assert(
        localStore.getItem("fastJira:theme") === "dark",
        "닫은 뒤 즉시 적용 설정이 유지되지 않는다",
      );
    } finally {
      fresh.destroy();
      host.remove();
      document.documentElement.dataset.theme = "dark";
    }
  },
]);
checks.push([
  "링크 복사는 상시 작은 버튼이며 좁은 화면 로그도 요청·응답을 나눈다",
  async () => {
    await app.select("TEST-3");
    const copy = root.querySelector<HTMLButtonElement>(".detail-copy");
    assert(
      copy?.textContent === "이슈 링크 복사" &&
        getComputedStyle(copy).opacity === "1",
      "복사 버튼 상시 표시 누락",
    );
    button("설정").click();
    const input = [...root.querySelectorAll<HTMLLabelElement>(".setting-row")]
      .find((label) => label.textContent === "개발자 모드")
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
  "완료 표시 옵션은 적용 전까지 유지하고 목록 재조회 없이 로컬에 저장한다",
  async () => {
    button("필터 및 정렬").click();
    await tick();
    const check = [
      ...document.querySelectorAll<HTMLLabelElement>(".filter-panel label"),
    ]
      .find((row) => row.textContent === "완료 항목 간단히 보기")
      ?.querySelector<HTMLInputElement>("input");
    assert(check, "완료 표시 옵션 누락");
    const before = document.documentElement.dataset.compactDone;
    check.click();
    assert(
      document.documentElement.dataset.compactDone === before,
      "적용 전 표시가 바뀜",
    );
    const count = calls.filter(
      (call) => call.pathname === "/api/issues",
    ).length;
    button("적용").click();
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
