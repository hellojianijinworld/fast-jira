import { createApi } from "../src/client/api.ts";
import { createApp } from "../src/client/app.ts";
import { createListCache } from "../src/client/list-cache.ts";
import { createListController } from "../src/client/list-controller.ts";
import type { Filters } from "../src/domain/filters.ts";
import type { Issue } from "../src/domain/issue.ts";
import { listCacheKey } from "../src/domain/list-snapshot.ts";
import { emptyIssue } from "../src/domain/wire.ts";
import "../src/client/styles.css";

const root = document.querySelector<HTMLElement>("#app"),
  results = document.querySelector<HTMLOListElement>("#results");
if (!root || !results) throw new Error("검사 영역 누락");
const appRoot = root,
  resultList = results;
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const tick = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
const filters: Filters = {
  projects: ["TEST"],
  scope: "all",
  excludeDone: false,
  sort: "recent",
  statuses: null,
  assignees: null,
  q: "",
};
const parent = {
  ...emptyIssue("TEST-1", "상위 계획"),
  hasChildren: true,
  hierarchyLevel: 1,
  issueTypeId: "epic",
};
const orphan = {
  ...emptyIssue("TEST-99", "부모 연결 없는 작업"),
  hierarchyLevel: 0,
  issueTypeId: "task",
};
const children = Array.from({ length: 35 }, (_, i) => ({
  ...emptyIssue(`TEST-${i + 2}`, `완료 하위 ${i + 1}`),
  parent: parent.key,
  status: "완료",
  statusCategory: "done",
  statusId: "1",
  hierarchyLevel: -1,
  issueTypeId: "subtask",
}));
const seed = createListController(
  {
    issues: async () => ({
      issues: [parent, orphan],
      ancestors: [],
      nextPageToken: null,
    }),
    children: async () => ({ issues: children, nextPageToken: null }),
  },
  filters,
  "me",
);
await seed.load();
await seed.queueChildren(parent.key);
const snapshot = {
  data: seed.snapshot(),
  catalog: {
    statuses: [{ id: "1", name: "완료", category: "done", projects: ["TEST"] }],
    types: [
      { id: "epic", name: "상위", project: "TEST", hierarchyLevel: 1 },
      { id: "task", name: "작업", project: "TEST", hierarchyLevel: 0 },
      { id: "subtask", name: "하위", project: "TEST", hierarchyLevel: -1 },
    ],
  },
};
async function stored(
  scope: string,
  query: Filters,
  value?: unknown,
): Promise<unknown> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("fast-jira-list-cache", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(
        "lists",
        value === undefined ? "readonly" : "readwrite",
      );
      const store = transaction.objectStore("lists");
      const key = JSON.stringify([scope, listCacheKey(query)]);
      const request =
        value === undefined ? store.get(key) : store.put(value, key);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
async function run() {
  const cache = createListCache(),
    scope = `mock-cache-${Date.now()}:me`;
  await cache.write(scope, filters, snapshot);
  const restored = await createListCache().read(scope, filters);
  assert(
    restored?.data.pages[0]?.[1].issues.length === 35,
    "IndexedDB 35개 복원 실패",
  );
  assert(
    (await cache.read(`${scope}:other`, filters)) === null,
    "다른 계정에 캐시 노출",
  );
  assert(
    (await cache.read(scope, { ...filters, statuses: [] })) === null,
    "다른 뷰에 캐시 노출",
  );
  resultList.append(
    Object.assign(document.createElement("li"), {
      textContent: "PASS · IndexedDB 복원, 계정 및 조건 격리",
    }),
  );
  const details = {
    ...parent,
    description: "본문",
    attachments: ["첨부"],
    comments: ["댓글"],
    token: "비밀",
  };
  const detailed = {
    ...snapshot,
    data: {
      ...snapshot.data,
      items: [details],
      pages: snapshot.data.pages.map(
        ([id, page]) =>
          [id, { ...page, issues: [details] }] as [string, typeof page],
      ),
    },
    token: "저장 금지",
  };
  const clean = {
    data: {
      ...detailed.data,
      items: [parent],
      pages: detailed.data.pages.map(([id, page]) => [
        id,
        { ...page, issues: [parent] },
      ]),
    },
    catalog: snapshot.catalog,
  };
  await cache.write(scope, filters, detailed);
  const written = (await stored(scope, filters)) as Record<string, unknown>;
  assert(
    JSON.stringify(written.data) === JSON.stringify(clean.data) &&
      !("token" in written),
    "새 목록 캐시에 상세가 저장됨",
  );
  const savedAt = Date.now() - 60_000;
  const legacy = { ...detailed, version: 1, scope, savedAt };
  await stored(scope, filters, legacy);
  assert(await cache.read(scope, filters), "이전 목록 캐시 복원 실패");
  const migrated = (await stored(scope, filters)) as Record<string, unknown>;
  assert(
    JSON.stringify(migrated.data) === JSON.stringify(clean.data) &&
      !("token" in migrated),
    "읽은 기존 캐시의 상세가 저장소에 남음",
  );
  assert(migrated.savedAt === savedAt, "기존 캐시의 유효기간이 연장됨");
  const otherQuery = { ...filters, q: "다른 검색" };
  await stored(scope, otherQuery, legacy);
  await stored(`${scope}:other`, filters, {
    ...legacy,
    scope: `${scope}:other`,
  });
  await cache.write(scope, filters, snapshot);
  const migratedQuery = (await stored(scope, otherQuery)) as Record<
    string,
    unknown
  >;
  assert(
    JSON.stringify(migratedQuery.data) === JSON.stringify(clean.data) &&
      migratedQuery.savedAt === savedAt,
    "같은 계정의 이전 검색 캐시 정리 실패",
  );
  const otherAccount = (await stored(`${scope}:other`, filters)) as Record<
    string,
    unknown
  >;
  assert(otherAccount.token === "저장 금지", "다른 계정의 캐시가 수정됨");
  resultList.append(
    Object.assign(document.createElement("li"), {
      textContent:
        "PASS · 저장 메타정보 제한, 기존 캐시 정리, 유효기간·계정 격리 보존",
    }),
  );
  let authenticate: () => void = () => {};
  const authentication = new Promise<void>((resolve) => {
    authenticate = resolve;
  });
  let release: () => void = () => {};
  let waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let responseChildren = children;
  const calls: URL[] = [];
  const fetchMock: typeof fetch = async (input) => {
    const url = new URL(String(input), location.origin);
    calls.push(url);
    switch (url.pathname) {
      case "/api/activity":
        return Response.json({
          feed: '<feed xmlns="http://www.w3.org/2005/Atom"/>',
        });
      case "/api/projects":
        await authentication;
        return Response.json({
          site: "mock.atlassian.net",
          me: { accountId: "me", displayName: "모의 계정" },
          projects: [{ key: "TEST", name: "모의 프로젝트", avatar: "" }],
          priorities: [],
        });
      case "/api/statuses":
        return Response.json(snapshot.catalog.statuses);
      case "/api/issue-types":
        return Response.json(snapshot.catalog.types);
      case "/api/issues":
        await waiting;
        return Response.json({
          issues: [parent, orphan],
          ancestors: [],
          nextPageToken: null,
        });
      case "/api/children":
        await waiting;
        return Response.json({ issues: responseChildren, nextPageToken: null });
      default:
        throw new Error(`허용하지 않은 모의 요청: ${url.pathname}`);
    }
  };
  const api = createApi(fetchMock);
  const values = new Map<string, string>([
    [
      "fastJira:filters:mock.atlassian.net:me",
      JSON.stringify({ ...filters, configured: true }),
    ],
  ]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const pending = createApp(appRoot, api, storage, {
    read: async () => restored,
    write: async () => {},
    remove: async () => {},
  });
  await tick();
  assert(
    appRoot.querySelector(".top-nav") && appRoot.querySelector(".workspace"),
    "계정 확인 중 화면 골격이 없다",
  );
  assert(
    !appRoot.querySelector(".list-item"),
    "계정 확인 전에 이전 목록이 노출됐다",
  );
  authenticate();
  await tick();
  await tick();
  assert(
    appRoot.querySelectorAll(".completed-grid .list-item").length === 35,
    "검증 전에 35개가 표시되지 않음",
  );
  const first = appRoot.querySelector(
    '.completed-grid [data-tree-key="TEST-2"] .list-title',
  );
  const card = (key: string) =>
    appRoot.querySelector<HTMLElement>(
      `[data-tree-key="${key}"] > .tree-row .list-item`,
    );
  assert(
    card(parent.key)?.getBoundingClientRect().left ===
      card(orphan.key)?.getBoundingClientRect().left,
    "부모 없는 작업이 한 단계 들여쓰기됨",
  );
  resultList.append(
    Object.assign(document.createElement("li"), {
      textContent: "PASS · 응답 전 35개 표시 및 독립 작업 들여쓰기 제거",
    }),
  );
  const parentCard = card(parent.key);
  const parentToggle = appRoot.querySelector<HTMLButtonElement>(
    '[data-issue-key="TEST-1"]',
  );
  parentToggle?.focus();
  release();
  const app = await pending;
  await tick();
  await tick();
  assert(
    appRoot.querySelectorAll(".completed-grid .list-item").length === 35,
    "검증 후 목록이 축소됨",
  );
  assert(
    first ===
      appRoot.querySelector(
        '.completed-grid [data-tree-key="TEST-2"] .list-title',
      ),
    "변경 없는 카드가 다시 만들어짐",
  );
  assert(
    parentCard === card(parent.key),
    "하위 검증 때문에 변경 없는 부모 카드를 교체했다",
  );
  assert(
    document.activeElement === parentToggle,
    "하위 검증이 아코디언 버튼 포커스를 지웠다",
  );
  const requests = calls.filter((url) => url.pathname === "/api/children");
  assert(
    requests.length === 1 &&
      requests[0]?.searchParams.get("pageSize") === "100",
    "재검증이 중복되거나 100개 묶음이 아님",
  );
  resultList.append(
    Object.assign(document.createElement("li"), {
      textContent: "PASS · 1회 묶음 확인, 변경 없는 카드 DOM 유지",
    }),
  );
  function required(selector: string): HTMLElement {
    const node = appRoot.querySelector<HTMLElement>(selector);
    if (!node) throw new Error(`요소 누락: ${selector}`);
    return node;
  }
  const scroller = () =>
    required(
      matchMedia("(max-width: 900px)").matches ? ".workspace" : ".browse",
    );
  const target = () => required('[data-tree-key="TEST-20"] .list-title');
  scroller().scrollTop +=
    target().getBoundingClientRect().top -
    scroller().getBoundingClientRect().top -
    110;
  await tick();
  const offset =
    target().getBoundingClientRect().top -
    scroller().getBoundingClientRect().top;
  app.destroy();
  waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reload = createApp(appRoot, api, storage, {
    read: async () => restored,
    write: async () => {},
    remove: async () => {},
  });
  await tick();
  await tick();
  assert(
    Math.abs(
      target().getBoundingClientRect().top -
        scroller().getBoundingClientRect().top -
        offset,
    ) <= 2,
    "새로고침 후 읽던 카드 위치가 복원되지 않았다",
  );
  const unchanged = target();
  responseChildren = children.slice(2);
  release();
  const reloaded = await reload;
  await tick();
  await tick();
  assert(
    appRoot.querySelectorAll(".completed-grid .list-item").length === 33,
    "삭제된 하위가 검증 후에도 남는다",
  );
  assert(
    Math.abs(
      target().getBoundingClientRect().top -
        scroller().getBoundingClientRect().top -
        offset,
    ) <= 2,
    "검증 반영이 읽던 카드 위치를 움직였다",
  );
  assert(unchanged === target(), "검증 때문에 변경 없는 카드를 교체했다");
  const nested = required('[data-tree-key="TEST-1"] > .tree-list');
  const nextRow = nested.parentElement?.nextElementSibling;
  assert(
    nextRow &&
      nextRow.getBoundingClientRect().top -
        nested.getBoundingClientRect().bottom >=
        8,
    "펼친 아코디언과 다음 항목 사이에 여백이 없다",
  );
  scroller().scrollTop = 0;
  reloaded.destroy();
  const savedPosition = JSON.parse(
    values.get("fastJira:position:mock.atlassian.net:me") ?? "null",
  );
  assert(
    savedPosition?.anchors.length === 0,
    "상단으로 돌아왔는데 옛 읽기 위치가 남았다",
  );
  resultList.append(
    Object.assign(document.createElement("li"), {
      textContent:
        "PASS · 계정 확인 전 골격, 읽던 카드 복원, 삭제 반영 후 위치·DOM 유지, 아코디언 하단 여백",
    }),
  );
  const owner = "mock.atlassian.net:me";
  await cache.write(owner, filters, snapshot);
  const deniedApi = createApi(async (input, init) =>
    String(input).startsWith("/api/issues")
      ? Response.json({ error: "권한 없음" }, { status: 403 })
      : fetchMock(input, init),
  );
  const deniedApp = await createApp(appRoot, deniedApi, storage, cache);
  await tick();
  await tick();
  assert(deniedApp.list.cacheDenied, "권한 거부를 캐시 삭제에 전달하지 않음");
  assert(
    (await cache.read(owner, filters)) === null,
    "거부된 캐시가 디스크에 남음",
  );
  const secondQuery = { ...filters, excludeDone: true };
  await cache.write(owner, secondQuery, snapshot);
  await deniedApp.list.load(secondQuery);
  await tick();
  await tick();
  assert(
    (await cache.read(owner, secondQuery)) === null,
    "연속된 다른 조회의 권한 거부에서 캐시 삭제를 생략함",
  );
  deniedApp.destroy();
  resultList.append(
    Object.assign(document.createElement("li"), {
      textContent: "PASS · 권한 거부 후 캐시 삭제, 다음 접속 재노출 방지",
    }),
  );
  let readBeforeAuth = false;
  const rejected = createApi(async () =>
    Response.json({ error: "인증 실패" }, { status: 401 }),
  );
  await createApp(appRoot, rejected, storage, {
    read: async () => {
      readBeforeAuth = true;
      return restored;
    },
    write: async () => {},
    remove: async () => {},
  }).then(
    () => {
      throw new Error("인증 실패를 성공으로 처리했다");
    },
    () => {},
  );
  assert(
    !readBeforeAuth && !appRoot.querySelector(".list-item"),
    "인증 실패 후 캐시를 읽거나 노출했다",
  );
  resultList.append(
    Object.assign(document.createElement("li"), {
      textContent: "PASS · 상단 위치 초기화와 인증 실패 시 캐시 미노출",
    }),
  );
  const stamp = new Date().toISOString();
  const identify = (issue: Issue) => ({
    ...issue,
    id: issue.key.split("-")[1] ?? "",
    updated: stamp,
  });
  const deltaSnapshot = {
    ...snapshot,
    data: {
      ...snapshot.data,
      items: snapshot.data.items.map(identify),
      checkedAt: stamp,
      reconciledAt: stamp,
      pages: snapshot.data.pages.map(
        ([key, page]) =>
          [key, { ...page, issues: page.issues.map(identify) }] as [
            string,
            typeof page,
          ],
      ),
    },
  };
  let unblock = () => {};
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const deltaCalls: string[] = [];
  values.set(
    "fastJira:recent:mock.atlassian.net:me",
    JSON.stringify([{ ...identify(orphan), summary: "오래된 제목" }]),
  );
  const deltaApi = createApi(async (input, init) => {
    const path = new URL(String(input), location.origin).pathname;
    deltaCalls.push(path);
    if (path === "/api/sync") {
      await blocked;
      return Response.json({
        issues: [
          { ...identify(orphan), summary: "갱신된 제목", matches: true },
        ],
        ancestors: [],
        removed: ["TEST-36"],
        checkedAt: stamp,
      });
    }
    if (path === "/api/issues" || path === "/api/children")
      throw new Error("캐시를 전체 재조회했다");
    return fetchMock(input, init);
  });
  const deltaPending = createApp(appRoot, deltaApi, storage, {
    read: async () => deltaSnapshot,
    write: async () => {},
    remove: async () => {},
  });
  await tick();
  await tick();
  assert(
    appRoot.querySelectorAll(".completed-grid .list-item").length === 35,
    "동기화 대기 중 하위 캐시를 유지하지 못했다",
  );
  const stableCard = card(parent.key);
  unblock();
  const deltaApp = await deltaPending;
  await tick();
  await tick();
  assert(
    appRoot.querySelectorAll(".completed-grid .list-item").length === 34,
    "삭제 항목을 반영하지 못했다",
  );
  assert(
    stableCard === card(parent.key),
    "동기화가 변경 없는 부모 DOM을 교체했다",
  );
  assert(
    appRoot.querySelector(".dashboard .list-title")?.textContent ===
      "갱신된 제목",
    "최근 카드가 동기화된 목록 값과 다르다",
  );
  await deltaApp.checkChanges();
  assert(
    deltaCalls.filter((path) => path === "/api/sync").length === 2,
    "새로고침과 주기 확인이 동기화를 공유하지 않는다",
  );
  assert(
    !deltaCalls.includes("/api/issues") &&
      !deltaCalls.includes("/api/children"),
    "부모별 전체 재조회가 발생했다",
  );
  deltaApp.destroy();
  resultList.append(
    Object.assign(document.createElement("li"), {
      textContent:
        "PASS · 캐시 우선 표시, 삭제 반영, DOM 유지, 새로고침·주기 확인의 단일 동기화 호출",
    }),
  );
  resultList.append(
    Object.assign(document.createElement("li"), {
      textContent: "전체 검사 통과 · Jira 요청 0회",
    }),
  );
}
try {
  await run();
} catch (reason) {
  resultList.append(
    Object.assign(document.createElement("li"), {
      textContent: `FAIL · ${reason instanceof Error ? reason.message : String(reason)}`,
    }),
  );
}
