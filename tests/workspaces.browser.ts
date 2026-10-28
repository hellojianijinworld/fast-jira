import { createApi } from "../src/client/api.ts";
import { createApp } from "../src/client/app.ts";
import type { AppUpdateStatus } from "../src/domain/app-update.ts";
import { activeWorkspace } from "../src/domain/workspace-views.ts";
import { appUpdate } from "../src/ui/app-update.ts";
import { element } from "../src/ui/dom.ts";
import { activityXML } from "./activity-fixture.ts";
import "../src/client/styles.css";

const root = document.querySelector<HTMLElement>("#app"),
  results = document.querySelector<HTMLOListElement>("#results");
if (!root || !results) throw new Error("검사 화면 누락");
const values = new Map<string, string>([
  [
    "fastJira:filters:fixture.atlassian.net:my-account",
    JSON.stringify({ configured: true, projects: ["TEST"], scope: "all" }),
  ],
]);
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    values.set(key, value);
  },
};
const calls: URL[] = [];
let releaseOld: ((value: Response) => void) | undefined;
const api = createApi(async (input, init) => {
  if (init?.method && init.method !== "GET")
    throw new Error("실제 Jira 쓰기 금지");
  const url = new URL(String(input), location.origin);
  calls.push(url);
  switch (url.pathname) {
    case "/api/projects":
      return Response.json({
        site: "fixture.atlassian.net",
        me: { accountId: "my-account", displayName: "검사 사용자" },
        projects: [
          {
            key: "TEST",
            name: "제품 개발",
            avatar: "https://fixture.atlassian.net/project-avatar/test.png",
          },
          {
            key: "DESIGN",
            name: "디자인",
            avatar: "https://fixture.atlassian.net/project-avatar/design.png",
          },
        ],
        priorities: [],
      });
    case "/api/issues":
      if (url.searchParams.get("projects") === "DESIGN")
        return new Promise<Response>((resolve) => {
          releaseOld = resolve;
        });
      return Response.json({ issues: [], ancestors: [], nextPageToken: null });
    case "/api/statuses":
      return Response.json([
        {
          id: "1",
          name: "대기",
          category: "new",
          projects: ["TEST", "DESIGN"],
        },
        {
          id: "2",
          name: "작업 중",
          category: "indeterminate",
          projects: ["TEST", "DESIGN"],
        },
      ]);
    case "/api/issue-types":
    case "/api/assignees":
      return Response.json([]);
    case "/api/activity":
      return Response.json({ feed: activityXML([]) });
    default:
      throw new Error(`예상하지 않은 요청 ${url.pathname}`);
  }
});
const wait = () => new Promise((resolve) => setTimeout(resolve, 30));
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function button(label: string, scope: ParentNode = document) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) =>
      item.textContent?.trim() === label ||
      item.getAttribute("aria-label") === label,
  );
  assert(found, `버튼 누락 ${label}`);
  return found;
}
let updateStatus: AppUpdateStatus = {
  currentVersion: "0.2.0",
  supported: true,
  phase: "current",
  checkedAt: Date.now(),
  release: null,
  message: "최신 버전",
  job: null,
};
const updates = appUpdate(
  {
    appUpdateStatus: async () => updateStatus,
    checkAppUpdate: async () => updateStatus,
    installAppUpdate: async () => {
      throw new Error("실제 설치 금지");
    },
  },
  { active: () => false, reload: () => {} },
);
let app = await createApp(root, api, storage, undefined, updates);
let failures = 0;
async function check(name: string, run: () => Promise<void>) {
  try {
    await run();
    results?.append(element("li", "", `통과 · ${name}`));
  } catch (reason) {
    failures++;
    results?.append(
      element("li", "error", `실패 · ${name}: ${String(reason)}`),
    );
  }
}
await check(
  "탭 생성에서 프로젝트와 필터를 함께 저장하고 전환한다",
  async () => {
    button("뷰 만들기").click();
    const projectIcons = document.querySelectorAll<HTMLImageElement>(
      ".workspace-view-modal .project-checks img.project-icon",
    );
    assert(projectIcons.length === 2, "뷰 생성의 프로젝트 이미지 누락");
    assert(
      projectIcons[0]?.src.includes(
        encodeURIComponent(
          "https://fixture.atlassian.net/project-avatar/test.png",
        ),
      ),
      "프로젝트 이미지 정보 보존",
    );
    await wait();
    const dialog = document.querySelector<HTMLDialogElement>(
      ".workspace-view-modal[open]",
    );
    assert(dialog, "생성 모달");
    const name = dialog.querySelector<HTMLInputElement>(
      '[aria-label="뷰 이름"]',
    );
    assert(name, "이름 입력");
    name.value = "디자인 작업";
    const inputs = [
      ...dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ];
    const design = inputs.find((item) =>
      item.getAttribute("aria-label")?.includes("디자인"),
    );
    const test = inputs.find((item) =>
      item.getAttribute("aria-label")?.includes("제품 개발"),
    );
    assert(design && test, "프로젝트 선택");
    design.click();
    await wait();
    [...dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find((item) => item.getAttribute("aria-label")?.includes("제품 개발"))
      ?.click();
    await wait();
    button("뷰 만들기", dialog).click();
    await wait();
    assert(!dialog.open, "저장 후 닫힘");
    assert(
      root.querySelector('[role="tab"][aria-selected="true"]')?.textContent ===
        "디자인 작업",
      "활성 탭",
    );
    assert(app.list.filters.projects.join() === "DESIGN", "프로젝트 전환");
    assert(
      calls.some(
        (url) =>
          url.pathname === "/api/issues" &&
          url.searchParams.get("projects") === "DESIGN",
      ),
      "목록 요청 범위",
    );
  },
);
await check(
  "빠른 탭 전환 뒤 늦은 응답은 이전 프로젝트를 섞지 않는다",
  async () => {
    button("내 작업").click();
    await wait();
    releaseOld?.(
      Response.json({ issues: [], ancestors: [], nextPageToken: null }),
    );
    await wait();
    assert(app.list.filters.projects.join() === "TEST", "새 조회 유지");
    assert(
      root.querySelector('[role="tab"][aria-selected="true"]')?.textContent ===
        "내 작업",
      "활성 표시 유지",
    );
    assert(!app.list.loading, "이전 요청이 로딩을 고정하지 않음");
  },
);
await check(
  "탭 필터와 하위 조건이 섞이지 않고 다시 열어도 활성 탭이 복원된다",
  async () => {
    app.views.apply(
      { kind: "global" },
      { ...app.list.filters, statuses: ["2"] },
    );
    await wait();
    button("디자인 작업").click();
    await wait();
    assert(app.list.filters.statuses === null, "다른 탭의 단계 독립");
    button("내 작업").click();
    await wait();
    assert(
      JSON.stringify(app.list.filters.statuses) === '["2"]',
      "첫 탭의 단계 보존",
    );
    app.destroy();
    app = await createApp(root, api, storage, undefined, updates);
    assert(
      JSON.stringify(app.list.filters.statuses) === '["2"]',
      "재시작 복원",
    );
    const raw = JSON.parse(
      values.get("fastJira:workspaces:fixture.atlassian.net:my-account") ??
        "{}",
    );
    assert(activeWorkspace(raw).name === "내 작업", "저장된 활성 탭");
  },
);
await check(
  "이름 편집은 목록을 다시 조회하지 않고 Enter로 저장한다",
  async () => {
    const before = calls.filter((url) => url.pathname === "/api/issues").length;
    button("내 작업 뷰 메뉴").click();
    button("뷰 편집").click();
    assert(
      document.querySelectorAll(
        ".workspace-view-modal .project-checks img.project-icon",
      ).length === 2,
      "뷰 편집의 프로젝트 이미지 누락",
    );
    await wait();
    const dialog = document.querySelector<HTMLDialogElement>(
      ".workspace-view-modal[open]",
    );
    assert(dialog, "편집 모달");
    const input = dialog.querySelector<HTMLInputElement>(
      '[aria-label="뷰 이름"]',
    );
    assert(input, "이름");
    input.value = "진행 확인";
    dialog.querySelector("form")?.requestSubmit();
    await wait();
    assert(
      root.querySelector('[role="tab"][aria-selected="true"]')?.textContent ===
        "진행 확인",
      "이름 변경",
    );
    assert(
      calls.filter((url) => url.pathname === "/api/issues").length === before,
      "불필요한 재조회 없음",
    );
  },
);
await check(
  "상단 필터는 현재 탭만 편집하고 다른 탭은 바꾸지 않는다",
  async () => {
    const count = calls.filter((url) => url.pathname === "/api/issues").length;
    button("필터").click();
    await wait();
    const panel = document.querySelector<HTMLElement>(
      ".filter-panel:not(.project-panel):popover-open",
    );
    assert(panel, "현재 탭 필터");
    assert(
      panel.querySelector(".view-panel-scope")?.textContent ===
        "‘진행 확인’ 뷰에 적용",
      "필터 적용 탭 안내",
    );
    assert(
      !panel.querySelector('[aria-label="사용할 뷰"], [aria-label="뷰 이름"]'),
      "중복 뷰 UI",
    );
    const stage = panel.querySelector<HTMLInputElement>(
      '[aria-label="단계: 대기"]',
    );
    assert(stage, "단계 편집");
    stage.click();
    assert(
      calls.filter((url) => url.pathname === "/api/issues").length === count,
      "초안에서 재조회",
    );
    button("적용", panel).click();
    await wait();
    assert(
      JSON.stringify(app.list.filters.statuses) === '["1","2"]',
      "현재 탭 저장",
    );
    button("디자인 작업").click();
    await wait();
    assert(app.list.filters.statuses === null, "다른 탭 조건 변경");
    button("진행 확인").click();
    await wait();
    assert(
      JSON.stringify(app.list.filters.statuses) === '["1","2"]',
      "첫 탭 조건 복원",
    );
  },
);
await check(
  "프로젝트 선택은 현재 탭에만 저장하고 빈 선택도 재시작 후 유지한다",
  async () => {
    button("프로젝트 선택").click();
    let panel = document.querySelector<HTMLElement>(
      ".project-panel:popover-open",
    );
    assert(panel, "프로젝트 선택");
    assert(
      panel.querySelector(".view-panel-scope")?.textContent ===
        "‘진행 확인’ 뷰에 적용",
      "프로젝트 적용 탭 안내",
    );
    button("선택 해제", panel).click();
    button("취소", panel).click();
    assert(
      app.list.filters.projects.join() === "TEST",
      "취소가 프로젝트를 바꿈",
    );
    button("프로젝트 선택").click();
    panel = document.querySelector<HTMLElement>(".project-panel:popover-open");
    assert(panel, "프로젝트 다시 열기");
    button("선택 해제", panel).click();
    button("적용", panel).click();
    await wait();
    assert(app.list.filters.projects.length === 0, "현재 탭 선택 해제 저장");
    button("디자인 작업").click();
    await wait();
    assert(
      app.list.filters.projects.join() === "DESIGN",
      "다른 탭 프로젝트 변경",
    );
    button("진행 확인").click();
    await wait();
    assert(app.list.filters.projects.length === 0, "현재 탭의 빈 선택 복원");
    app.destroy();
    app = await createApp(root, api, storage, undefined, updates);
    assert(app.list.filters.projects.length === 0, "재시작 시 빈 선택 유실");
  },
);
await check(
  "새 버전은 상단 아이콘만 표시하고 클릭하면 관리 화면을 연다",
  async () => {
    assert(updates.trigger.hidden, "현재 버전인데 아이콘 표시");
    updateStatus = {
      ...updateStatus,
      phase: "available",
      release: {
        version: "0.3.0",
        commit: "a".repeat(40),
        notes: "모의 변경 내용",
        url: "https://github.com/hellojianijinworld/fast-jira/releases/tag/v0.3.0",
      },
    };
    updates.element
      .querySelector<HTMLButtonElement>('[aria-label="직접 업데이트 확인"]')
      ?.click();
    await wait();
    assert(
      !updates.trigger.hidden && updates.trigger.closest(".nav-tools"),
      "상단 업데이트 아이콘 없음",
    );
    assert(
      !root.querySelector("dialog[open]"),
      "새 버전 감지로 모달 자동 표시",
    );
    updates.trigger.click();
    let dialog = root.querySelector<HTMLDialogElement>(".settings-modal[open]");
    assert(dialog, "관리 모달 없음");
    assert(
      dialog.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent === "관리",
      "관리 탭 바로가기 실패",
    );
    assert(dialog.textContent?.includes("모의 변경 내용"), "변경 내용 누락");
    assert(
      dialog.querySelector<HTMLButtonElement>(
        '[aria-label="업데이트하고 다시 시작"]',
      )?.disabled === false,
      "수동 설치 버튼 없음",
    );
    dialog.close();
    updateStatus = {
      ...updateStatus,
      phase: "error",
      message: "일시적 조회 실패",
    };
    updates.element
      .querySelector<HTMLButtonElement>('[aria-label="직접 업데이트 확인"]')
      ?.click();
    await wait();
    assert(
      !updates.trigger.hidden,
      "조회 실패가 감지했던 업데이트 표시를 지움",
    );
    updateStatus = {
      ...updateStatus,
      phase: "current",
      release: null,
      currentVersion: "0.3.0",
    };
    updates.element
      .querySelector<HTMLButtonElement>('[aria-label="직접 업데이트 확인"]')
      ?.click();
    await wait();
    assert(updates.trigger.hidden, "업데이트 후 아이콘 잔존");
    button("설정").click();
    dialog = root.querySelector<HTMLDialogElement>(".settings-modal[open]");
    assert(dialog, "일반 설정");
    assert(
      dialog.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent === "화면 표시",
      "일반 설정까지 관리로 고정됨",
    );
    dialog.close();
  },
);
await check(
  "비활성 뷰의 우클릭 편집은 현재 탭과 목록을 바꾸지 않는다",
  async () => {
    const tab = [...root.querySelectorAll<HTMLElement>("[role=tab]")].find(
      (item) => item.textContent === "디자인 작업",
    );
    assert(tab, "편집 대상");
    const before = calls.filter((url) => url.pathname === "/api/issues").length;
    tab.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 40,
      }),
    );
    button("뷰 편집").click();
    assert(
      document.querySelectorAll(
        ".workspace-view-modal .project-checks img.project-icon",
      ).length === 2,
      "뷰 편집의 프로젝트 이미지 누락",
    );
    await wait();
    const dialog = document.querySelector<HTMLDialogElement>(
      ".workspace-view-modal[open]",
    );
    assert(dialog, "편집 모달");
    const input = dialog.querySelector<HTMLInputElement>(
      '[aria-label="뷰 이름"]',
    );
    assert(input?.value === "디자인 작업", "우클릭한 뷰 편집");
    input.value = "디자인 작업 (편집)";
    dialog.querySelector("form")?.requestSubmit();
    await wait();
    assert(
      root.querySelector("[role=tab][aria-selected=true]")?.textContent ===
        "진행 확인",
      "활성 뷰 유지",
    );
    assert(
      root.querySelector('[aria-label="디자인 작업 (편집) 뷰 메뉴"]'),
      "탭별 메뉴 이름 갱신",
    );
    assert(
      calls.filter((url) => url.pathname === "/api/issues").length === before,
      "편집으로 목록 재조회",
    );
  },
);
await check(
  "PC에서는 뷰와 상단 도구가 같은 줄에 있고 헤더 높이가 작다",
  async () => {
    if (innerWidth < 700) return;
    const nav = root.querySelector<HTMLElement>(".top-nav"),
      views = root.querySelector<HTMLElement>(".workspace-views"),
      tools = root.querySelector<HTMLElement>(".nav-tools");
    assert(nav && views && tools, "상단 구조");
    assert(nav.getBoundingClientRect().height <= 64, "헤더 높이");
    assert(
      Math.abs(
        views.getBoundingClientRect().top - tools.getBoundingClientRect().top,
      ) < 12,
      "상단 한 줄 정렬",
    );
    assert(document.documentElement.scrollWidth <= innerWidth, "가로 넘침");
  },
);
results.dataset.failures = String(failures);
results.dataset.complete = "true";
