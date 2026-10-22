import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, createApi } from "../src/client/api.ts";
import { createListController } from "../src/client/list-controller.ts";
import { createLiveUpdates } from "../src/client/live-updates.ts";
import {
  accountSettingsScope,
  createAccountStore,
  readPreferences,
  writePreferences,
} from "../src/client/preferences.ts";
import { createViewController } from "../src/client/view-controller.ts";
import {
  branchDefaults,
  type Filters,
  withoutDone,
} from "../src/domain/filters.ts";
import { initialViews, resolveView } from "../src/domain/views.ts";
import {
  type ChangeBatch,
  decodeLogEntry,
  decodeLookup,
  emptyIssue,
} from "../src/domain/wire.ts";

const filters: Filters = {
  projects: ["TEST"],
  scope: "related",
  excludeDone: false,
  sort: "recent",
  statuses: null,
  assignees: null,
  q: "",
};
const storage = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};
const deferred = <T>() => {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test("계정별 설정은 이전 소유자만 이식하고 손상된 값은 각 항목에서 복구한다", () => {
  const local = storage();
  local.setItem(
    "fastJira:filters:example",
    JSON.stringify({
      configured: true,
      selectedProjects: ["TEST", "OLD"],
      statuses: ["1", "x", "1"],
      assignees: [],
      sort: "manual",
    }),
  );
  assert.equal(
    accountSettingsScope(local, "example", "first"),
    "example:first",
  );
  accountSettingsScope(local, "example", "second");
  assert.equal(local.getItem("fastJira:filters:example:second"), null);
  const store = createAccountStore(local, "example", "first");
  const saved = store.filters(["TEST"]);
  assert.equal(saved.configured, true);
  assert.deepEqual(saved.filters.projects, ["TEST"]);
  assert.deepEqual(saved.filters.statuses, ["1"]);
  assert.deepEqual(saved.filters.assignees, []);
  assert.equal(saved.filters.sort, "recent");
  local.setItem(
    `fastJira:tree:${store.scope}`,
    JSON.stringify({
      version: 1,
      states: [
        ["TEST-1", { resetAt: 8, openedAt: "wrong", collapsed: true }],
        ["invalid", {}],
      ],
    }),
  );
  assert.equal(store.tree().version, 8);
  assert.equal(store.tree().states.size, 1);
  local.setItem(
    `fastJira:branches:${store.scope}`,
    JSON.stringify([["TEST-1", { statuses: [], assignees: null }]]),
  );
  const restoredBranch = resolveView(store.views(saved.filters), {
    kind: "branch",
    key: "TEST-1",
  });
  assert.deepEqual(restoredBranch.statuses, []);
  assert.equal(restoredBranch.assignees, null);
  local.setItem(
    `fastJira:recent:${store.scope}`,
    JSON.stringify([
      { key: "TEST-1", summary: "이전 카드" },
      { key: "BAD", summary: "" },
      { key: "TEST-1", summary: "중복" },
    ]),
  );
  assert.deepEqual(
    store.recent().map((issue) => issue.summary),
    ["이전 카드"],
  );
});
test("저장소가 차단돼도 화면 설정과 계정 분리는 유지한다", () => {
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(readPreferences(blocked), {
    theme: "light",
    developerMode: false,
    compactView: false,
    compactDone: true,
    compactDoneParents: true,
  });
  assert.doesNotThrow(() =>
    writePreferences(blocked, {
      theme: "dark",
      developerMode: true,
      compactView: true,
      compactDone: false,
      compactDoneParents: false,
    }),
  );
  const store = createAccountStore(blocked, "example", "me");
  assert.equal(store.scope, "example:me");
  assert.deepEqual(store.filters(["TEST"]).filters.projects, ["TEST"]);
  assert.deepEqual(store.recent(), []);
});
test("브라우저 API 경계는 필터·커서 조건과 응답 형식·HTTP 오류를 보존한다", async () => {
  const calls: string[] = [];
  const item = emptyIssue("TEST-1");
  const api = createApi(async (input) => {
    calls.push(String(input));
    return Response.json({
      issues: [item],
      ancestors: [],
      nextPageToken: "cursor",
    });
  });
  assert.equal(
    (
      await api.issues(
        { ...filters, statuses: [], assignees: ["unassigned"], q: "검색" },
        "opaque token",
      )
    ).nextPageToken,
    "cursor",
  );
  const params = new URL(calls[0] ?? "", "http://localhost").searchParams;
  assert.equal(params.get("statuses"), "none");
  assert.equal(params.get("assignees"), "unassigned");
  assert.equal(params.get("pageToken"), "opaque token");
  const invalid = createApi(async () =>
    Response.json({
      issues: [{ ...item, hasChildren: "yes" }],
      ancestors: [],
      nextPageToken: null,
    }),
  );
  await assert.rejects(invalid.issues(filters), /참\/거짓/);
  const failed = createApi(async () =>
    Response.json({ error: "권한 없음" }, { status: 403 }),
  );
  await assert.rejects(
    failed.issues(filters),
    (error) =>
      error instanceof ApiError &&
      error.status === 403 &&
      error.message === "권한 없음",
  );
});
test("필터를 바꾼 뒤 늦게 도착한 목록은 새 목록과 섞이지 않는다", async () => {
  const old = deferred<{
    issues: ReturnType<typeof emptyIssue>[];
    ancestors: ReturnType<typeof emptyIssue>[];
    nextPageToken: null;
  }>();
  const api = {
    issues: async (value: Filters) =>
      value.q === "새 검색"
        ? { issues: [emptyIssue("TEST-2")], ancestors: [], nextPageToken: null }
        : old.promise,
    children: async () => ({ issues: [], nextPageToken: null }),
  };
  const state = createListController(api, filters, "me");
  const initial = state.load();
  await state.load({ ...filters, q: "새 검색" });
  old.resolve({
    issues: [emptyIssue("TEST-1")],
    ancestors: [],
    nextPageToken: null,
  });
  await initial;
  assert.deepEqual([...state.items.keys()], ["TEST-2"]);
  assert.equal(state.loading, false);
});

test("하위 커서는 중복 호출을 합치고 세 개씩 조회하며 변경된 분기 캐시를 섞지 않는다", async () => {
  let active = 0,
    maximum = 0;
  const waiting: {
    key: string;
    token: string;
    done: ReturnType<
      typeof deferred<{
        issues: ReturnType<typeof emptyIssue>[];
        nextPageToken: string | null;
      }>
    >;
  }[] = [];
  const views = createViewController(initialViews(filters), {
    save: () => {},
    changed: () => {},
    statuses: () => [],
  });
  const state = createListController(
    {
      issues: async () => ({ issues: [], ancestors: [], nextPageToken: null }),
      children: async (key, _filters, _settings, token = "") => {
        active++;
        maximum = Math.max(maximum, active);
        const done = deferred<{
          issues: ReturnType<typeof emptyIssue>[];
          nextPageToken: string | null;
        }>();
        waiting.push({ key, token, done });
        const page = await done.promise;
        active--;
        return page;
      },
    },
    filters,
    "me",
    () => {},
    undefined,
    (key, current) =>
      branchDefaults({ ...current, ...views.resolve({ kind: "branch", key }) }),
  );
  for (let index = 1; index <= 5; index++)
    state.items.set(`TEST-${index}`, {
      ...emptyIssue(`TEST-${index}`),
      hasChildren: true,
    });
  const requests = Array.from({ length: 5 }, (_, index) =>
    state.queueChildren(`TEST-${index + 1}`),
  );
  assert.equal(state.queueChildren("TEST-1"), requests[0]);
  assert.equal(waiting.length, 3);
  waiting[0]?.done.resolve({
    issues: [{ ...emptyIssue("TEST-11"), parent: "TEST-1" }],
    nextPageToken: "next",
  });
  await requests[0];
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(waiting.length, 4);
  for (const job of waiting.slice(1))
    job.done.resolve({ issues: [], nextPageToken: null });
  await new Promise((resolve) => setTimeout(resolve, 0));
  waiting[4]?.done.resolve({ issues: [], nextPageToken: null });
  await Promise.all(requests);
  assert.equal(maximum, 3);
  assert(state.visibleItems().has("TEST-11"));
  const next = state.queueChildren("TEST-1");
  assert.equal(waiting[5]?.token, "next");
  views.apply({ kind: "branch", key: "TEST-1" }, { ...filters, assignees: [] });
  waiting[5]?.done.resolve({
    issues: [{ ...emptyIssue("TEST-12"), parent: "TEST-1" }],
    nextPageToken: null,
  });
  await next;
  assert(
    !state.visibleItems().has("TEST-11") &&
      !state.visibleItems().has("TEST-12"),
  );
});
test("프로젝트 선택 없음은 요청하지 않고 접힘·하위 상속을 별도로 유지한다", async () => {
  let calls = 0;
  const views = createViewController(initialViews(filters), {
    save: () => {},
    changed: () => {},
    statuses: () => [],
  });
  const state = createListController(
    {
      issues: async () => {
        calls++;
        return { issues: [], ancestors: [], nextPageToken: null };
      },
      children: async () => ({ issues: [], nextPageToken: null }),
    },
    { ...filters, projects: [] },
    "me",
    () => {},
    undefined,
    (key, current) =>
      branchDefaults({ ...current, ...views.resolve({ kind: "branch", key }) }),
  );
  await state.load();
  assert.equal(calls, 0);
  assert.equal(state.loaded, true);
  state.toggle("TEST-1", true);
  state.toggle("TEST-1", false);
  assert.equal(state.tree.states.get("TEST-1")?.resetAt, 1);
  assert.equal(state.tree.states.get("TEST-1")?.openedAt, 2);
  views.apply({ kind: "branch", key: "TEST-1" }, { ...filters, assignees: [] });
  assert.deepEqual(state.effectiveBranch("TEST-1").assignees, []);
  views.select({ kind: "branch", key: "TEST-1" }, { kind: "default" });
  assert.equal(state.effectiveBranch("TEST-1").assignees, null);
});

test("완료 제외 설정을 단계 선택으로 옮길 때 개발 완료 이름을 추측하지 않는다", () => {
  const statuses = [
    {
      id: "1",
      name: "개발 완료",
      category: "indeterminate",
      projects: ["TEST"],
    },
    { id: "2", name: "완료", category: "done", projects: ["TEST"] },
    { id: "3", name: "대기", category: "new", projects: ["TEST"] },
  ];
  assert.deepEqual(withoutDone(null, statuses), ["1", "3"]);
  assert.deepEqual(withoutDone(["1", "2"], statuses), ["1"]);
  assert.deepEqual(withoutDone([], statuses), []);
});

test("상세 응답은 본문·보고 시각·첨부를 검증하며 잘못된 ADF를 거부한다", () => {
  const result = {
    parent: {
      ...emptyIssue("TEST-1"),
      reporter: "작성자",
      reporterAvatar: "",
      created: "2026-10-01T00:00:00Z",
      url: "https://fixture.atlassian.net/browse/TEST-1",
      description: { type: "doc", version: 1, content: [] },
      attachments: [],
    },
    children: [],
    deferredChildren: true,
    dateEditing: true,
    imageEnabled: true,
  };
  assert.equal(decodeLookup(result).parent.reporter, "작성자");
  assert.throws(
    () =>
      decodeLookup({
        ...result,
        parent: {
          ...result.parent,
          description: { type: "doc", version: 2, content: [] },
        },
      }),
    /형식/,
  );
  assert.throws(
    () => decodeLookup({ ...result, imageEnabled: "yes" }),
    /참\/거짓/,
  );
});

test("일괄 응답은 부분 실패와 되돌리기 키를 검증해 전달한다", async () => {
  const api = createApi(async () =>
    Response.json({
      issues: [emptyIssue("TEST-1")],
      failures: [{ key: "TEST-2", error: "권한 없음" }],
      warnings: [],
      undoToken: "undo",
    }),
  );
  const result = await api.bulkUpdate(
    ["TEST-1", "TEST-2"],
    "dueDate",
    "2026-12-25",
  );
  assert.equal(result.issues[0]?.key, "TEST-1");
  assert.deepEqual(result.failures, [{ key: "TEST-2", error: "권한 없음" }]);
  assert.equal(result.undoToken, "undo");
  const invalid = createApi(async () =>
    Response.json({
      issues: [],
      failures: [{ key: "TEST-2", error: 42 }],
      warnings: [],
      undoToken: "",
    }),
  );
  await assert.rejects(invalid.bulkUndo("undo"));
});

test("변경 확인은 중복·이전 필터·동시 저장을 배제하고 실패 뒤 재시도한다", async () => {
  let current: Filters | null = filters,
    time = 0,
    failures = 0;
  const versions = new Map<string, number>();
  const known = new Map([
    ["TEST-1", { ...emptyIssue("TEST-1"), updated: "2026-10-01T00:00:00Z" }],
  ]);
  const batches: ChangeBatch[] = [],
    lookbacks: number[] = [];
  let reply = deferred<ChangeBatch>();
  const live = createLiveUpdates({
    api: {
      changes: async (_filters, lookback) => {
        lookbacks.push(lookback);
        return reply.promise;
      },
    },
    filters: () => current,
    known: () => known,
    versions: () => versions,
    apply: (batch) => {
      batches.push(batch);
    },
    failed: () => {
      failures++;
    },
    now: () => time,
  });
  const batch: ChangeBatch = {
    issues: [
      {
        ...emptyIssue("TEST-1"),
        updated: "2026-10-01T00:01:00Z",
        matches: true,
      },
    ],
    ancestors: [],
  };
  const first = live.check();
  await live.check();
  assert.equal(lookbacks.length, 1);
  current = { ...filters };
  reply.resolve(batch);
  await first;
  assert.equal(batches.length, 0);
  reply = deferred<ChangeBatch>();
  const saving = live.check();
  versions.set("TEST-1", 1);
  reply.resolve(batch);
  await saving;
  assert.equal(batches.length, 0);
  await live.check();
  assert.equal(batches.length, 1);
  await live.check();
  assert.equal(batches.length, 1, "동일 변경 재반영");
  const local = known.get("TEST-1");
  assert(local);
  local.updated = "2026-10-01T00:03:00Z";
  reply = deferred<ChangeBatch>();
  reply.resolve({
    issues: [
      {
        ...batch.issues[0],
        ...local,
        updated: "2026-10-01T00:02:00Z",
        matches: true,
      },
    ],
    ancestors: [],
  });
  await live.check();
  assert.equal(
    batches.length,
    1,
    "이전 조회 이력보다 최신인 로컬 저장을 덮어썼다",
  );
  current = null;
  const before = lookbacks.length;
  await live.check();
  assert.equal(lookbacks.length, before);
  current = { ...filters };
  reply = deferred<ChangeBatch>();
  const pending = live.check();
  live.destroy();
  reply.resolve(batch);
  await pending;
  assert.equal(batches.length, 1);
  const malformed = createApi(async () =>
    Response.json({
      issues: [{ ...emptyIssue("TEST-1"), updated: "broken", matches: true }],
      ancestors: [],
    }),
  );
  await assert.rejects(malformed.changes(filters, 5), /변경 시각/);
  const failed = createLiveUpdates({
    api: {
      changes: async (_filters, lookback) => {
        lookbacks.push(lookback);
        throw new Error("offline");
      },
    },
    filters: () => filters,
    known: () => known,
    versions: () => versions,
    apply: () => {},
    failed: () => {
      failures++;
    },
    now: () => time,
  });
  await failed.check();
  time = 20 * 60000;
  await failed.check();
  assert.equal(failures, 2);
  assert.equal(lookbacks.at(-1), 22);
});
test("늦은 하위 페이지는 묶음 갱신 값을 덮어쓰지 않고 커서를 보존한다", async () => {
  const waiting = deferred<{
    issues: ReturnType<typeof emptyIssue>[];
    nextPageToken: string | null;
  }>();
  const original = {
    ...emptyIssue("TEST-2"),
    parent: "TEST-1",
    status: "대기",
  };
  let renders = 0;
  const list = createListController(
    {
      issues: async () => ({
        issues: [emptyIssue("TEST-1")],
        ancestors: [],
        nextPageToken: "root-next",
      }),
      children: async () => waiting.promise,
    },
    filters,
    "my-account",
    () => {
      renders++;
    },
  );
  await list.load();
  const pending = list.queueChildren("TEST-1");
  const before = renders;
  list.applyChanges({
    issues: [{ ...original, status: "진행 중", matches: true }],
    ancestors: [],
  });
  assert.equal(renders, before + 1, "묶음 렌더 횟수");
  waiting.resolve({ issues: [original], nextPageToken: "child-next" });
  await pending;
  assert.equal(list.visibleItems().get("TEST-2")?.status, "진행 중");
  assert.equal(list.nextPageToken, "root-next");
  assert.equal(list.childPage("TEST-1").nextPageToken, "child-next");
});

test("로그 이벤트의 ID·문자열·출처를 응답 경계에서 검증한다", () => {
  const entry = {
    id: 1,
    source: "API",
    command: "GET /test",
    time: "12:00",
    result: "200",
  };
  assert.deepEqual(decodeLogEntry(entry), entry);
  assert.throws(() => decodeLogEntry({ ...entry, id: -1 }));
  assert.throws(() => decodeLogEntry({ ...entry, result: {} }));
});

test("일괄 변경은 목록·하위 커서를 유지하고 한 번만 알린다", async () => {
  const parent = { ...emptyIssue("TEST-1"), hasChildren: true };
  const child = { ...emptyIssue("TEST-2"), parent: "TEST-1" };
  let notifications = 0,
    reads = 0;
  const list = createListController(
    {
      issues: async () => {
        reads++;
        return {
          issues: [parent],
          ancestors: [],
          nextPageToken: "root-cursor",
        };
      },
      children: async () => {
        reads++;
        return { issues: [child], nextPageToken: "child-cursor" };
      },
    },
    filters,
    "me",
    () => notifications++,
  );
  await list.load();
  await list.queueChildren(parent.key);
  const page = list.childPage(parent.key),
    before = notifications;
  list.updateMany([{ ...child, summary: "변경됨" }], new Set([child.key]));
  assert.equal(notifications, before + 1);
  assert.equal(reads, 2);
  assert.equal(list.nextPageToken, "root-cursor");
  assert.equal(list.childPage(parent.key), page);
  assert.equal(page.nextPageToken, "child-cursor");
  assert.equal(page.issues.get(child.key)?.summary, "변경됨");
  const newParent = emptyIssue("TEST-3");
  list.updateMany([{ ...child, parent: newParent.key }], new Set([child.key]), [
    newParent,
  ]);
  assert.ok(list.items.has(newParent.key));
  assert.ok(!page.issues.has(child.key));
});

test("완료 간단히 보기는 기본 켜짐이고 끈 선택을 로컬에 기억한다", () => {
  const local = storage();
  assert.equal(readPreferences(local).compactDone, true);
  assert.equal(readPreferences(local).compactDoneParents, true);
  writePreferences(local, { ...readPreferences(local), compactDone: false });
  assert.equal(readPreferences(local).compactDone, false);
  writePreferences(local, {
    ...readPreferences(local),
    compactDoneParents: false,
  });
  assert.equal(readPreferences(local).compactDoneParents, false);
});

test("읽던 위치는 계정·조회별로 분리하고 손상 좌표를 무시하며 상단 복귀를 저장한다", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const mine = createAccountStore(storage, "example.atlassian.net", "me");
  mine.savePosition("query", [{ key: "TEST-20", offset: -12.5 }]);
  assert.deepEqual(mine.position("query"), [{ key: "TEST-20", offset: -12.5 }]);
  assert.deepEqual(mine.position("other"), []);
  assert.deepEqual(
    createAccountStore(storage, "example.atlassian.net", "other").position(
      "query",
    ),
    [],
  );
  values.set(
    "fastJira:position:example.atlassian.net:me",
    JSON.stringify({
      query: "query",
      anchors: [
        { key: "TEST-1", offset: "12" },
        { key: "invalid", offset: 0 },
        { key: "TEST-2", offset: 1e10 },
        { key: "TEST-3", offset: null },
      ],
    }),
  );
  assert.deepEqual(mine.position("query"), []);
  mine.savePosition("query", []);
  assert.deepEqual(mine.position("query"), []);
});

test("주기 동기화는 저장된 확인 시점과 ID를 사용하고 삭제만 있어도 반영한다", async () => {
  const stamp = new Date().toISOString();
  const issue = { ...emptyIssue("TEST-1"), id: "1", updated: stamp };
  let applied: ChangeBatch | undefined;
  let checkpoint = stamp;
  const live = createLiveUpdates({
    api: {
      changes: async () => {
        throw new Error("기존 변경 조회 중복");
      },
      sync: async (_filters, known, since) => {
        assert.equal(since, stamp);
        assert.equal(known[0]?.id, "1");
        return {
          issues: [],
          ancestors: [],
          removed: [issue.key],
          checkedAt: stamp,
        };
      },
    },
    checkpoint: () => checkpoint,
    syncKnown: () => [{ id: issue.id, key: issue.key, updated: issue.updated }],
    filters: () => filters,
    known: () => new Map([[issue.key, issue]]),
    versions: () => new Map(),
    apply: (batch) => {
      applied = batch;
      checkpoint = batch.checkedAt ?? checkpoint;
    },
    failed: () => {
      throw new Error("동기화 실패");
    },
  });
  await live.check();
  assert.deepEqual(applied?.removed, ["TEST-1"]);
});

test("동기화 응답의 이전 updated는 새 상세 조회 값을 덮어쓰지 않는다", async () => {
  const stamp = new Date().toISOString();
  const newer = {
    ...emptyIssue("TEST-1"),
    id: "1",
    summary: "새 제목",
    updated: "2026-10-03T00:00:00Z",
  };
  const applied: ChangeBatch[] = [];
  const live = createLiveUpdates({
    api: {
      changes: async () => ({ issues: [], ancestors: [] }),
      sync: async () => ({
        issues: [
          {
            ...newer,
            summary: "이전 제목",
            updated: "2026-10-02T00:00:00Z",
            matches: true,
          },
        ],
        ancestors: [],
        removed: [],
        checkedAt: stamp,
      }),
    },
    checkpoint: () => stamp,
    syncKnown: () => [],
    filters: () => filters,
    known: () => new Map([[newer.key, newer]]),
    versions: () => new Map(),
    apply: (batch) => {
      applied.push(batch);
    },
    failed: () => {},
  });
  await live.check();
  assert.deepEqual(applied[0]?.issues, []);
});

test("즐겨찾기는 사이트·계정별로 복원하고 손상·중복 항목을 제외한다", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const store = createAccountStore(storage, "example.atlassian.net", "me");
  assert.deepEqual(store.favorites(), []);
  const saved = Array.from({ length: 7 }, (_, index) =>
    emptyIssue(`TEST-${index + 1}`, `작업 ${index + 1}`),
  );
  store.saveFavorites(saved);
  assert.deepEqual(
    createAccountStore(storage, "example.atlassian.net", "me").favorites(),
    saved,
  );
  assert.deepEqual(
    createAccountStore(storage, "example.atlassian.net", "other").favorites(),
    [],
  );
  assert.deepEqual(
    createAccountStore(storage, "other.atlassian.net", "me").favorites(),
    [],
  );
  storage.setItem(
    `fastJira:favorites:${store.scope}`,
    JSON.stringify([saved[0], { key: "BAD", summary: "잘못된 키" }, saved[0]]),
  );
  assert.deepEqual(
    store.favorites().map((issue) => issue.key),
    ["TEST-1"],
  );
  store.saveFavorites([]);
  assert.deepEqual(store.favorites(), []);
});
