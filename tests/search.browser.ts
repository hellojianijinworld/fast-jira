import "../src/client/styles.css";
import "../src/ui/command-palette.css";
import { createApi } from "../src/client/api.ts";
import type { TreeCatalog } from "../src/domain/catalog.ts";
import type { Filters } from "../src/domain/filters.ts";
import { compareIssues } from "../src/domain/list.ts";
import { matchesSearchFilters } from "../src/domain/search-results.ts";
import { emptyIssue } from "../src/domain/wire.ts";
import { element } from "../src/ui/dom.ts";
import { createSearchDialog } from "../src/ui/search-dialog.ts";

if (new URLSearchParams(location.search).get("theme") === "dark")
  document.documentElement.dataset.theme = "dark";

const host = document.querySelector<HTMLElement>("#fixture");
const results = document.querySelector<HTMLElement>("#results");
if (!host || !results) throw new Error("검사 요소 누락");
const catalog: TreeCatalog = {
  projects: [
    { key: "AA", name: "개발 프로젝트", avatar: "" },
    { key: "BB", name: "디자인 프로젝트", avatar: "" },
  ],
  statuses: [
    {
      id: "1",
      name: "작업 중",
      category: "indeterminate",
      projects: ["AA", "BB"],
    },
    { id: "2", name: "작업 완료", category: "done", projects: ["AA", "BB"] },
  ],
  priorities: [],
  types: [],
};
const issues = [
  {
    ...emptyIssue("AA-1", "검색 필터 및 조건 개선"),
    status: "작업 중",
    statusId: "1",
    updated: "2026-11-05",
    dueDate: "2026-11-09",
    assigneeId: "account-other",
    relatedUserIds: ["account-me"],
  },
  {
    ...emptyIssue("BB-2", "검색 필터 디자인 점검"),
    status: "작업 완료",
    statusId: "2",
    statusCategory: "done",
    updated: "2026-11-04",
    dueDate: "2026-11-08",
  },
];
const calls: URLSearchParams[] = [];
let hold = false,
  release: (() => void) | undefined,
  localReads = 0,
  failures = 0;
const api = createApi(async (input) => {
  const url = new URL(String(input), location.href);
  if (url.pathname === "/api/issues") {
    calls.push(url.searchParams);
    if (hold)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    const selected = (key: string) => {
      const raw = url.searchParams.get(key);
      return raw === "none" ? [] : raw ? raw.split(",") : null;
    };
    const filters: Filters = {
      projects: selected("projects") ?? [],
      scope: url.searchParams.get("scope") as Filters["scope"],
      statuses: selected("statuses"),
      assignees: selected("assignees"),
      excludeDone: url.searchParams.get("excludeDone") === "true",
      q: url.searchParams.get("q") ?? "",
      sort: url.searchParams.get("sort") ?? "recent",
    };
    const matches = issues.filter((issue) =>
      matchesSearchFilters(issue, filters, "account-me"),
    );
    matches.sort((a, b) => compareIssues(a, b, filters.sort, new Map()));
    return Response.json({
      issues: matches,
      ancestors: [],
      nextPageToken: url.searchParams.get("pageToken") ? null : "next",
    });
  }
  if (url.pathname === "/api/statuses") return Response.json(catalog.statuses);
  if (url.pathname === "/api/assignees")
    return Response.json([{ id: "account-me", name: "검사자", avatar: "" }]);
  throw new Error(`예상하지 않은 조회: ${url.pathname}`);
});
const search = createSearchDialog({
  host,
  api,
  site: "fixture.atlassian.net",
  currentUserId: "account-me",
  currentUserName: "검사자",
  catalog: () => catalog,
  recent: () => issues,
  localIssues: () => {
    localReads++;
    return issues;
  },
  order: () => [],
  select: () => {},
  copied: () => {},
  closed: () => {},
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function check(name: string, run: () => Promise<void>) {
  try {
    await run();
    results?.append(element("li", "", `통과 · ${name}`));
  } catch (error) {
    failures++;
    results?.append(element("li", "error", `실패 · ${name}: ${String(error)}`));
  }
}
const button = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === text,
  );
const popup = (name: string) =>
  search.dialog.querySelector<HTMLElement>(`[aria-label="검색 ${name} 필터"]`);
async function openFilter(name: string) {
  button(
    search.dialog.querySelector(".search-filter-bar") ?? search.dialog,
    name,
  )?.click();
  await tick();
  const panel = popup(name);
  assert(panel, "필터 누락");
  assert(panel.matches(":popover-open"), "필터 열림 실패");
  return panel;
}
async function closeFilter(panel: HTMLElement) {
  panel.hidePopover();
  await tick();
}
const query = search.dialog.querySelector<HTMLInputElement>(".search-query");
assert(query, "검색 입력 누락");
search.open();
await check("검색·조건 편집은 Enter 전에 조회하지 않는다", async () => {
  query.value = "검색";
  query.dispatchEvent(new Event("input"));
  const panel = await openFilter("프로젝트");
  button(panel, "선택 해제")?.click();
  const check = panel.querySelector<HTMLInputElement>(
    '[aria-label="프로젝트: 개발 프로젝트"]',
  );
  assert(check, "프로젝트 선택지 누락");
  check.click();
  await closeFilter(panel);
  assert(
    calls.length === 0 && localReads === 0,
    "입력·조건 변경만으로 검색 실행됨",
  );
  search.dialog.querySelector("form")?.requestSubmit();
  await tick();
  assert(calls.at(-1)?.get("projects") === "AA", "프로젝트 조건 미전달");
  assert(
    search.dialog.querySelectorAll(".issue-card").length === 1,
    "뷰 밖 조건 적용 실패",
  );
});
await check(
  "추가 페이지 이후 필터 변경은 커서를 버리고 한 번만 재조회한다",
  async () => {
    button(search.dialog, "더 보기")?.click();
    await tick();
    assert(calls.at(-1)?.get("pageToken") === "next", "추가 페이지 누락");
    const panel = await openFilter("프로젝트");
    const count = calls.length;
    button(panel, "전체 선택")?.click();
    assert(calls.length === count, "다중 선택 중 반복 조회");
    await closeFilter(panel);
    assert(
      calls.length === count + 1 && !calls.at(-1)?.get("pageToken"),
      "조건 변경 시 페이지·조회 횟수 오류",
    );
    assert(
      search.dialog.querySelectorAll(".issue-card").length === 2,
      "전체 프로젝트 검색 누락",
    );
  },
);
await check("단계 선택과 해제는 서버 조건과 칩에 반영된다", async () => {
  const panel = await openFilter("단계");
  button(panel, "선택 해제")?.click();
  panel
    .querySelector<HTMLInputElement>('[aria-label="단계: 작업 완료"]')
    ?.click();
  await closeFilter(panel);
  assert(calls.at(-1)?.get("statuses") === "2", "단계 미전달");
  assert(
    search.dialog.querySelector(".list-title")?.textContent ===
      issues[1]?.summary,
    "단계 조건 결과 오류",
  );
  search.dialog
    .querySelector<HTMLButtonElement>('[aria-label="단계 1개 조건 해제"]')
    ?.click();
  await tick();
  assert(calls.at(-1)?.get("statuses") === "", "조건 칩 해제 실패");
});
await check(
  "정렬 변경은 서버 순서를 따르고 로컬 항목이 끼어들지 않는다",
  async () => {
    const order =
      search.dialog.querySelector<HTMLSelectElement>(".search-sort");
    assert(order, "정렬 누락");
    order.value = "due";
    order.dispatchEvent(new Event("change"));
    await tick();
    assert(calls.at(-1)?.get("sort") === "due", "정렬 미전달");
    assert(
      search.dialog.querySelector(".list-title")?.textContent ===
        issues[1]?.summary,
      "서버 정렬 순서 오류",
    );
  },
);
await check("사람 기준은 담당자와 작업참여자를 구분해 조회한다", async () => {
  const panel = await openFilter("작업참여자");
  const basis = panel.querySelector<HTMLSelectElement>(
    'select[aria-label="사람 조건 기준"]',
  );
  assert(basis, "사람 기준 누락");
  basis.value = "related";
  basis.dispatchEvent(new Event("change"));
  await closeFilter(panel);
  assert(calls.at(-1)?.get("scope") === "related", "참여자 범위 미전달");
  assert(
    search.dialog.querySelectorAll(".issue-card").length === 1,
    "커스텀 참여자 검색 실패",
  );
});
await check("이전 응답은 조건 변경 후 결과를 덮어쓰지 않는다", async () => {
  hold = true;
  query.value = "이전 검색";
  search.dialog.querySelector("form")?.requestSubmit();
  await tick();
  const delayed = release;
  hold = false;
  const order = search.dialog.querySelector<HTMLSelectElement>(".search-sort");
  assert(order, "정렬 누락");
  order.value = "recent";
  order.dispatchEvent(new Event("change"));
  await tick();
  const before = search.dialog.querySelector(".command-results")?.textContent;
  delayed?.();
  await tick();
  assert(
    search.dialog.querySelector(".command-results")?.textContent === before,
    "늦은 응답 덮어쓰기",
  );
});
await check("닫았다 열면 검색어·조건·정렬이 모두 초기화된다", async () => {
  search.close();
  search.open();
  await tick();
  assert(query.value === "", "검색어 보존됨");
  assert(
    search.dialog.querySelector<HTMLSelectElement>(".search-sort")?.value ===
      "recommended",
    "정렬 보존됨",
  );
  assert(
    search.dialog.querySelector<HTMLElement>(".search-filter-chips")?.hidden,
    "조건 보존됨",
  );
});
await check("빈 검색어에서도 조건만 지정해 전체 범위를 조회한다", async () => {
  const panel = await openFilter("단계");
  button(panel, "완료 제외")?.click();
  await closeFilter(panel);
  search.dialog.querySelector("form")?.requestSubmit();
  await tick();
  assert(
    calls.at(-1)?.get("q") === "" &&
      calls.at(-1)?.get("excludeDone") === "true",
    "빈 검색 조건 미전달",
  );
});
search.close();
document.body.dataset.result = failures ? "failed" : "passed";
if (new URLSearchParams(location.search).has("preview")) {
  search.open();
  query.value = "검색";
  search.dialog.querySelector("form")?.requestSubmit();
}
