import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../src/client/api.ts";
import { createListCache } from "../src/client/list-cache.ts";
import { createListController } from "../src/client/list-controller.ts";
import type { Filters } from "../src/domain/filters.ts";
import {
  decodeListSnapshot,
  type ListSnapshot,
  listCacheKey,
} from "../src/domain/list-snapshot.ts";
import type { SyncBatch } from "../src/domain/sync.ts";
import { emptyIssue } from "../src/domain/wire.ts";

const filters: Filters = {
  projects: ["TEST"],
  scope: "all",
  excludeDone: false,
  sort: "recent",
  statuses: null,
  assignees: null,
  q: "",
};
const parent = { ...emptyIssue("TEST-1"), hasChildren: true };
const children = Array.from({ length: 35 }, (_, i) => ({
  ...emptyIssue(`TEST-${i + 2}`),
  parent: parent.key,
}));
const deferred = <T>() => {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function previous() {
  const list = createListController(
    {
      issues: async () => ({
        issues: [parent],
        ancestors: [],
        nextPageToken: null,
      }),
      children: async (_key, _filters, _settings, token) => ({
        issues: token ? children.slice(25) : children.slice(0, 25),
        nextPageToken: token ? null : "old-session-cursor",
      }),
    },
    filters,
    "me",
  );
  await list.load();
  await list.queueChildren(parent.key);
  await list.queueChildren(parent.key);
  return list.snapshot();
}
test("캐시 키는 선택 순서를 통일하지만 빈 선택·전체 및 정렬 우선순위는 구분한다", () => {
  assert.equal(
    listCacheKey({ ...filters, projects: ["B", "A"], statuses: ["2", "1"] }),
    listCacheKey({ ...filters, projects: ["A", "B"], statuses: ["1", "2"] }),
  );
  assert.notEqual(
    listCacheKey(filters),
    listCacheKey({ ...filters, statuses: [] }),
  );
  assert.notEqual(
    listCacheKey({ ...filters, sort: "status,priority" }),
    listCacheKey({ ...filters, sort: "priority,status" }),
  );
  assert.notEqual(
    listCacheKey(filters),
    listCacheKey({ ...filters, q: "검색" }),
  );
});
test("35개를 먼저 복원하고 오래된 커서 없이 100개 묶음으로 변경·이탈·신규를 반영한다", async () => {
  const snapshot = await previous();
  assert.equal(JSON.stringify(snapshot).includes("old-session-cursor"), false);
  const reply = deferred<{ issues: typeof children; nextPageToken: null }>();
  const calls: [string, number][] = [];
  const list = createListController(
    {
      issues: async () => ({
        issues: [parent],
        ancestors: [],
        nextPageToken: null,
      }),
      children: async (_key, _filters, _settings, token, size) => {
        calls.push([token ?? "", size ?? 25]);
        return reply.promise;
      },
    },
    filters,
    "me",
  );
  list.restore(decodeListSnapshot(structuredClone(snapshot)));
  assert.equal(list.childPage(parent.key).issues.size, 35);
  assert.equal(list.visibleItems().size, 36);
  const first = list.queueChildren(parent.key),
    second = list.queueChildren(parent.key);
  assert.equal(first, second);
  assert.equal(list.childPage(parent.key).issues.size, 35);
  const fresh = children.slice(0, 34).map((issue) => ({ ...issue }));
  assert.ok(fresh[0]);
  fresh[0] = { ...fresh[0], status: "완료" };
  fresh.push({ ...emptyIssue("TEST-99"), parent: parent.key });
  reply.resolve({ issues: fresh, nextPageToken: null });
  await first;
  assert.deepEqual(calls, [["", 100]]);
  assert.equal(list.childPage(parent.key).issues.size, 35);
  assert.equal(list.childPage(parent.key).issues.get("TEST-2")?.status, "완료");
  assert.equal(list.childPage(parent.key).issues.has("TEST-36"), false);
  assert.equal(list.childPage(parent.key).issues.has("TEST-99"), true);
  await list.queueChildren(parent.key);
  assert.equal(calls.length, 1);
});
test("여러 페이지 검증 중에도 35개를 유지하며 마지막 페이지 성공 후에만 교체한다", async () => {
  const snapshot = await previous(),
    last = deferred<{ issues: typeof children; nextPageToken: null }>();
  let count = 0;
  const list = createListController(
    {
      issues: async () => ({
        issues: [parent],
        ancestors: [],
        nextPageToken: null,
      }),
      children: async () =>
        ++count === 1
          ? { issues: children.slice(0, 25), nextPageToken: "new-cursor" }
          : last.promise,
    },
    filters,
    "me",
  );
  list.restore(snapshot);
  const pending = list.queueChildren(parent.key);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(count, 2);
  assert.equal(list.childPage(parent.key).issues.size, 35);
  last.resolve({ issues: children.slice(25), nextPageToken: null });
  await pending;
  assert.equal(list.childPage(parent.key).issues.size, 35);
});
test("검증 실패는 이전 목록을 유지하고 늦은 응답은 사용자 수정과 새 필터를 덮지 않는다", async () => {
  const snapshot = await previous();
  const late = deferred<{ issues: typeof children; nextPageToken: null }>();
  const list = createListController(
    {
      issues: async () => ({
        issues: [parent],
        ancestors: [],
        nextPageToken: null,
      }),
      children: async () => late.promise,
    },
    filters,
    "me",
  );
  list.restore(snapshot);
  const pending = list.queueChildren(parent.key);
  assert.ok(children[0]);
  list.update({ ...children[0], summary: "저장한 제목" }, true);
  late.resolve({ issues: children, nextPageToken: null });
  await pending;
  assert.equal(
    list.childPage(parent.key).issues.get("TEST-2")?.summary,
    "저장한 제목",
  );
  const failed = createListController(
    {
      issues: async () => {
        throw new ApiError("일시적 장애", 503);
      },
      children: async () => ({ issues: [], nextPageToken: null }),
    },
    filters,
    "me",
  );
  failed.restore(snapshot);
  await failed.load();
  assert.equal(failed.visibleItems().size, 36);
  const revoked = createListController(
    {
      issues: async () => {
        throw new ApiError("권한 없음", 403);
      },
      children: async () => ({ issues: [], nextPageToken: null }),
    },
    filters,
    "me",
  );
  revoked.restore(snapshot);
  await revoked.load();
  assert.equal(revoked.visibleItems().size, 0);
  const waiting = deferred<{
    issues: typeof children;
    ancestors: never[];
    nextPageToken: null;
  }>();
  const moved = createListController(
    {
      issues: async (query) =>
        query.q
          ? { issues: [], ancestors: [], nextPageToken: null }
          : waiting.promise,
      children: async () => ({ issues: [], nextPageToken: null }),
    },
    filters,
    "me",
  );
  moved.restore(snapshot);
  const old = moved.load();
  await moved.load({ ...filters, q: "다른 검색" });
  waiting.resolve({ issues: children, ancestors: [], nextPageToken: null });
  await old;
  assert.equal(moved.items.size, 0);
});
test("캐시가 손상됐거나 브라우저 저장소가 없으면 일반 조회로 복구한다", async () => {
  assert.throws(() => decodeListSnapshot({ items: "손상" }));
  const cache = createListCache();
  assert.equal(await cache.read("site:me", filters), null);
  await cache.write("site:me", filters, {
    data: await previous(),
    catalog: { statuses: [], types: [] },
  });
});

test("접힌 부모의 캐시는 루트 검증의 상태·제목·부모 이동을 덮지 않는다", async () => {
  const snapshot = await previous();
  const nextParent = { ...emptyIssue("TEST-100"), hasChildren: true };
  const moved = {
    ...children[0],
    ...emptyIssue("TEST-2", "이동 후 제목"),
    parent: nextParent.key,
    updated: "2026-10-15T10:00:00Z",
  };
  const list = createListController(
    {
      issues: async () => ({
        issues: [parent, nextParent, moved],
        ancestors: [],
        nextPageToken: null,
      }),
      children: async () => {
        throw new Error("접힌 부모는 조회하지 않는다");
      },
    },
    filters,
    "me",
  );
  list.restore(snapshot);
  list.toggle(parent.key, true);
  await list.load();
  assert.equal(list.visibleItems().get(moved.key)?.parent, nextParent.key);
  assert.equal(list.visibleItems().get(moved.key)?.summary, "이동 후 제목");
  assert.equal(list.childPage(parent.key).issues.has(moved.key), false);
});
test("늦은 페이지의 이전 updated는 더 최근에 검증한 상태를 덮지 않는다", async () => {
  const snapshot = await previous();
  const child = children[0];
  assert.ok(child);
  const newer = { ...child, status: "완료", updated: "2026-10-15T10:00:00Z" };
  const older = {
    ...child,
    status: "진행 중",
    updated: "2026-10-15T09:00:00Z",
  };
  const late = deferred<{ issues: typeof children; nextPageToken: null }>();
  const list = createListController(
    {
      issues: async () => ({
        issues: [parent, newer],
        ancestors: [],
        nextPageToken: null,
      }),
      children: async () => late.promise,
    },
    filters,
    "me",
  );
  list.restore(snapshot);
  const pending = list.queueChildren(parent.key);
  await list.load();
  late.resolve({ issues: [older], nextPageToken: null });
  await pending;
  assert.equal(list.visibleItems().get(child.key)?.status, "완료");
});
test("반복 커서는 무한 요청 대신 기존 목록을 유지하고 재시도 안내를 남긴다", async () => {
  let calls = 0;
  const list = createListController(
    {
      issues: async () => ({
        issues: [parent],
        ancestors: [],
        nextPageToken: null,
      }),
      children: async () => {
        calls++;
        return { issues: children.slice(0, 25), nextPageToken: "same" };
      },
    },
    filters,
    "me",
  );
  list.restore(await previous());
  await list.queueChildren(parent.key);
  assert.equal(calls, 2);
  assert.equal(list.childPage(parent.key).issues.size, 35);
  assert.match(list.childPage(parent.key).error, /반복/);
});

test("최신 값이 하위에만 있어도 오래된 검증 응답 때문에 카드를 잃지 않는다", async () => {
  const snapshot = await previous(),
    child = children[0];
  assert.ok(child);
  const newer = {
    ...child,
    summary: "최신 하위",
    updated: "2026-10-15T10:00:00Z",
  };
  const page = snapshot.pages[0];
  assert.ok(page);
  page[1].issues = [newer];
  const list = createListController(
    {
      issues: async () => ({
        issues: [parent],
        ancestors: [],
        nextPageToken: null,
      }),
      children: async () => ({
        issues: [{ ...child, updated: "2026-10-15T09:00:00Z" }],
        nextPageToken: null,
      }),
    },
    filters,
    "me",
  );
  list.restore(snapshot);
  await list.queueChildren(parent.key);
  assert.equal(list.visibleItems().get(child.key)?.summary, "최신 하위");
  assert.equal(list.childPage(parent.key).issues.size, 1);
});
test("조회 조건을 바꿔도 이전 최신 표현을 가진 이슈가 사라지지 않는다", async () => {
  const snapshot = await previous(),
    newer = {
      ...parent,
      summary: "최신 상위",
      updated: "2026-10-15T10:00:00Z",
    };
  snapshot.items = [newer];
  const list = createListController(
    {
      issues: async () => ({
        issues: [{ ...parent, updated: "2026-10-15T09:00:00Z" }],
        ancestors: [],
        nextPageToken: null,
      }),
      children: async () => ({ issues: [], nextPageToken: null }),
    },
    filters,
    "me",
  );
  list.restore(snapshot);
  await list.load({ ...filters, excludeDone: true });
  assert.equal(list.items.get(parent.key)?.summary, "최신 상위");
});

test("부분 목록은 새로고침 확인 때문에 이전에 읽은 범위보다 늘어나지 않는다", async () => {
  const all = Array.from({ length: 100 }, (_, i) =>
    emptyIssue(`TEST-${i + 1}`),
  );
  const old = all.slice(0, 35);
  let requested = 0;
  const list = createListController(
    {
      issues: async (_query, _token, size) => {
        requested = size ?? 30;
        return {
          issues: all.slice(0, requested),
          ancestors: [],
          nextPageToken: "fresh-next",
        };
      },
      children: async () => ({ issues: [], nextPageToken: null }),
    },
    filters,
    "me",
  );
  list.restore({
    items: old,
    matched: old.map((issue) => issue.key),
    direct: old.map((issue) => issue.key),
    complete: false,
    pages: [],
  });
  await list.load();
  assert.equal(requested, 35);
  assert.equal(list.items.size, 35);
  assert.equal(list.nextPageToken, "fresh-next");
});

for (const treeOpen of [false, true])
  for (const detailOpen of [false, true]) {
    test(`검증 중 접힘 조합(tree=${treeOpen},detail=${detailOpen})은 남은 소비자만 조회를 이어간다`, async () => {
      const snapshot = await previous();
      let treeVisible = true,
        detailVisible = true,
        calls = 0;
      const gate = deferred<void>();
      const list = createListController(
        {
          issues: async () => ({
            issues: [parent],
            ancestors: [],
            nextPageToken: null,
          }),
          children: async (_key, _filters, _settings, token) => {
            calls++;
            if (!token) await gate.promise;
            return {
              issues: token ? children.slice(25) : children.slice(0, 25),
              nextPageToken: token ? null : "next",
            };
          },
        },
        filters,
        "me",
      );
      list.restore(snapshot);
      const pending = list.queueChildren(parent.key, () => treeVisible);
      assert.equal(
        list.queueChildren(parent.key, () => detailVisible),
        pending,
      );
      treeVisible = treeOpen;
      detailVisible = detailOpen;
      gate.resolve();
      await pending;
      assert.equal(calls, treeOpen || detailOpen ? 2 : 1);
      assert.equal(list.childPage(parent.key).issues.size, 35);
      assert.equal(
        Boolean(list.childPage(parent.key).restored),
        !treeOpen && !detailOpen,
      );
      treeVisible = true;
      await list.queueChildren(parent.key, () => treeVisible);
      assert.equal(list.childPage(parent.key).restored, undefined);
      assert.equal(list.childPage(parent.key).issues.size, 35);
    });
  }
test("동시 조회 제한으로 대기하던 분기를 접으면 네트워크 요청을 시작하지 않는다", async () => {
  const gate = deferred<void>();
  const called: string[] = [];
  const list = createListController(
    {
      issues: async () => ({ issues: [], ancestors: [], nextPageToken: null }),
      children: async (key) => {
        called.push(key);
        await gate.promise;
        return { issues: [], nextPageToken: null };
      },
    },
    filters,
    "me",
  );
  let needed = true;
  const active = [1, 2, 3].map((n) => list.queueChildren(`TEST-${n}`));
  const queued = list.queueChildren("TEST-4", () => needed);
  needed = false;
  gate.resolve();
  await Promise.all([...active, queued]);
  assert.deepEqual(called, ["TEST-1", "TEST-2", "TEST-3"]);
  assert.equal(list.childPage("TEST-4").loaded, false);
  assert.equal(list.childPage("TEST-4").pending, null);
});

test("화면 종료는 진행·대기 조회를 무효화하고 늦은 결과로 캐시를 바꾸지 않는다", async () => {
  const gate = deferred<void>();
  const called: string[] = [];
  const list = createListController(
    {
      issues: async () => ({ issues: [], ancestors: [], nextPageToken: null }),
      children: async (key) => {
        called.push(key);
        await gate.promise;
        return {
          issues: [{ ...parent, key: "TEST-50", parent: key }],
          nextPageToken: "more",
        };
      },
    },
    filters,
    "me",
  );
  const pending = [1, 2, 3, 4].map((n) => list.queueChildren(`TEST-${n}`));
  list.destroy();
  gate.resolve();
  await Promise.all(pending);
  await list.queueChildren("TEST-9");
  assert.deepEqual(called, ["TEST-1", "TEST-2", "TEST-3"]);
  assert.equal(list.visibleItems().size, 0);
  assert.equal(list.loading, false);
});

test("검색 후 돌아온 메모리 하위 목록도 삭제된 이슈를 재검증한다", async () => {
  let childRequests = 0;
  let current = children.slice(0, 1);
  const list = createListController(
    {
      issues: async () => ({
        issues: [parent],
        ancestors: [],
        nextPageToken: null,
      }),
      children: async () => {
        childRequests++;
        return { issues: current, nextPageToken: null };
      },
    },
    filters,
    "me",
  );
  await list.load();
  await list.queueChildren(parent.key);
  current = [];
  await list.load({ ...filters, q: "parent" });
  await list.load(filters);
  assert.equal(list.childPage(parent.key).issues.size, 1);
  await list.queueChildren(parent.key);
  assert.equal(childRequests, 2);
  assert.equal(list.childPage(parent.key).issues.size, 0);
  list.destroy();
});

test("확인 시각과 ID가 있는 캐시는 변경분·존재 확인만 하고 부모별 페이지를 다시 읽지 않는다", async () => {
  const snapshot = await previous();
  const stamp = new Date().toISOString();
  const identify = (issue: ReturnType<typeof emptyIssue>) => ({
    ...issue,
    id: issue.key.split("-")[1] ?? "",
    updated: stamp,
  });
  const saved: ListSnapshot = {
    ...snapshot,
    checkedAt: stamp,
    reconciledAt: stamp,
    items: snapshot.items.map(identify),
    pages: snapshot.pages.map(
      ([key, page]) =>
        [key, { ...page, issues: page.issues.map(identify) }] as const,
    ),
  };
  let syncCalls = 0;
  const list = createListController(
    {
      issues: async () => {
        throw new Error("전체 목록 재조회");
      },
      children: async () => {
        throw new Error("부모별 재조회");
      },
      sync: async (_filters, known, since) => {
        syncCalls++;
        assert.equal(known.length, 36);
        assert.equal(since, stamp);
        return { issues: [], ancestors: [], removed: [], checkedAt: stamp };
      },
    },
    filters,
    "me",
  );
  list.restore(structuredClone(saved));
  await list.load();
  await list.queueChildren(parent.key);
  assert.equal(syncCalls, 1);
  assert.equal(list.error, "");
  assert.equal(list.childPage(parent.key).issues.size, 35);
  assert.equal(list.childPage(parent.key).restored, undefined);
  assert.equal(list.snapshot().checkedAt, stamp);
});

test("동기화 삭제·키 이동을 반영하고 부모가 달라진 하위는 새 부모로 이동한다", async () => {
  const stamp = new Date().toISOString();
  const a = { ...parent, id: "1", updated: stamp },
    b = {
      ...emptyIssue("TEST-99"),
      id: "99",
      hasChildren: true,
      updated: stamp,
    };
  const firstChild = children[0],
    secondChild = children[1];
  assert(firstChild && secondChild);
  const child = { ...firstChild, id: "2", updated: stamp };
  const list = createListController(
    {
      issues: async () => ({ issues: [], ancestors: [], nextPageToken: null }),
      children: async () => ({ issues: [], nextPageToken: null }),
      sync: async () => ({
        issues: [{ ...child, parent: b.key, matches: true }],
        ancestors: [],
        removed: ["TEST-3"],
        checkedAt: stamp,
      }),
    },
    filters,
    "me",
  );
  list.restore({
    items: [a, b, child, { ...secondChild, id: "3", updated: stamp }],
    matched: [a.key, b.key, child.key, "TEST-3"],
    direct: [a.key, b.key],
    complete: true,
    pages: [],
    checkedAt: stamp,
    reconciledAt: stamp,
  });
  await list.load();
  assert.equal(list.visibleItems().has("TEST-3"), false);
  assert.equal(list.visibleItems().get(child.key)?.parent, b.key);
  assert.equal(list.error, "");
});

test("부분 캐시는 동기화 후 추가 읽기 때만 새 커서로 범위를 잇는다", async () => {
  const stamp = new Date().toISOString();
  const all = Array.from({ length: 80 }, (_, i) => ({
    ...emptyIssue(`TEST-${i + 1}`),
    id: String(i + 1),
    updated: stamp,
  }));
  const calls: { token: string; size: number }[] = [];
  const list = createListController(
    {
      issues: async (_filters, token, size = 30) => {
        calls.push({ token: token ?? "", size });
        return {
          issues: all.slice(0, size),
          ancestors: [],
          nextPageToken: "new",
        };
      },
      children: async () => {
        throw new Error("불필요한 하위 조회");
      },
      sync: async () => ({
        issues: [],
        ancestors: [],
        removed: [],
        checkedAt: stamp,
      }),
    },
    filters,
    "me",
  );
  list.restore({
    items: all.slice(0, 30),
    direct: all.slice(0, 30).map((issue) => issue.key),
    matched: all.slice(0, 30).map((issue) => issue.key),
    complete: false,
    pages: [],
    checkedAt: stamp,
    reconciledAt: stamp,
  });
  await list.load();
  assert.equal(calls.length, 0);
  assert.equal(list.items.size, 30);
  await list.load();
  assert.deepEqual(calls, [{ token: "", size: 60 }]);
  assert.equal(list.items.size, 60);
});

test("동기화 실패는 이전 목록과 확인 시점을 유지하고 늦은 삭제는 사용자 수정을 지우지 않는다", async () => {
  const stamp = new Date().toISOString();
  const issue = { ...parent, id: "1", updated: stamp };
  const snapshot: ListSnapshot = {
    items: [issue],
    direct: [issue.key],
    matched: [issue.key],
    complete: true,
    pages: [],
    checkedAt: stamp,
    reconciledAt: stamp,
  };
  let fail = true;
  const waiting = deferred<{
    issues: [];
    ancestors: [];
    removed: string[];
    checkedAt: string;
  }>();
  const list = createListController(
    {
      issues: async () => {
        throw new Error("전체 조회");
      },
      children: async () => {
        throw new Error("하위 조회");
      },
      sync: async () => {
        if (fail) throw new Error("offline");
        return waiting.promise;
      },
    },
    filters,
    "me",
  );
  list.restore(snapshot);
  await list.load();
  assert.equal(list.items.get(issue.key)?.summary, issue.summary);
  assert.equal(list.snapshot().checkedAt, stamp);
  assert.match(list.error, /offline/);
  fail = false;
  const pending = list.load();
  list.update({ ...issue, summary: "내가 수정한 제목" }, true);
  waiting.resolve({
    issues: [],
    ancestors: [],
    removed: [issue.key],
    checkedAt: stamp,
  });
  await pending;
  assert.equal(list.items.get(issue.key)?.summary, "내가 수정한 제목");
});

test("부분 하위도 동기화 후 더 보기를 누를 때만 이전 범위와 새 페이지를 이어 읽는다", async () => {
  const stamp = new Date().toISOString();
  const base = await previous();
  const identify = (issue: ReturnType<typeof emptyIssue>) => ({
    ...issue,
    id: issue.key.split("-")[1] ?? "",
    updated: stamp,
  });
  const snapshot: ListSnapshot = {
    ...base,
    items: base.items.map(identify),
    checkedAt: stamp,
    reconciledAt: stamp,
    pages: base.pages.map(([key, page]) => [
      key,
      {
        ...page,
        complete: false,
        issues: page.issues.slice(0, 10).map(identify),
      },
    ]),
  };
  const calls: string[] = [];
  const list = createListController(
    {
      issues: async () => {
        throw new Error("전체 조회");
      },
      children: async (_key, _filters, _settings, token) => {
        calls.push(token ?? "");
        return { issues: children.map(identify), nextPageToken: null };
      },
      sync: async () => ({
        issues: [],
        ancestors: [],
        removed: [],
        checkedAt: stamp,
      }),
    },
    filters,
    "me",
  );
  list.restore(snapshot);
  await list.load();
  assert.equal(calls.length, 0);
  await list.queueChildren(parent.key);
  assert.deepEqual(calls, [""]);
  assert.equal(list.childPage(parent.key).issues.size, 35);
});

test("주기 동기화 후 루트의 이전 페이지 커서를 보내지 않는다", async () => {
  const stamp = new Date().toISOString();
  const issue = { ...parent, id: "1", updated: stamp };
  const tokens: string[] = [];
  const list = createListController(
    {
      issues: async (_filters, token) => {
        tokens.push(token ?? "");
        return {
          issues: [issue],
          ancestors: [],
          nextPageToken: tokens.length === 1 ? "old-cursor" : null,
        };
      },
      children: async () => ({ issues: [], nextPageToken: null }),
    },
    filters,
    "me",
  );
  await list.load();
  list.applyChanges({
    issues: [],
    ancestors: [],
    removed: [],
    checkedAt: stamp,
  });
  await list.load();
  assert.deepEqual(tokens, ["", ""]);
});

test("키 이동 응답도 같은 고정 ID의 동시 수정을 덮어쓰지 않는다", async () => {
  const stamp = new Date().toISOString();
  const issue = { ...parent, id: "1", updated: stamp };
  const waiting = deferred<{
    issues: ({ matches: boolean } & typeof issue)[];
    ancestors: [];
    removed: string[];
    checkedAt: string;
  }>();
  const list = createListController(
    {
      issues: async () => {
        throw new Error("전체 조회");
      },
      children: async () => ({ issues: [], nextPageToken: null }),
      sync: async () => waiting.promise,
    },
    filters,
    "me",
  );
  list.restore({
    items: [issue],
    direct: [issue.key],
    matched: [issue.key],
    complete: true,
    pages: [],
    checkedAt: stamp,
    reconciledAt: stamp,
  });
  const pending = list.load();
  list.update({ ...issue, summary: "내 수정" }, true);
  waiting.resolve({
    issues: [{ ...issue, key: "TEST-999", matches: true }],
    ancestors: [],
    removed: [issue.key],
    checkedAt: stamp,
  });
  await pending;
  assert.equal(list.items.get(issue.key)?.summary, "내 수정");
  assert.equal(list.items.has("TEST-999"), false);
});

test("정상적인 키 이동은 옛 키를 제거하고 새 키와 펼침 상태를 유지한다", async () => {
  const stamp = new Date().toISOString();
  const issue = { ...parent, id: "1", updated: stamp };
  const list = createListController(
    {
      issues: async () => ({ issues: [], ancestors: [], nextPageToken: null }),
      children: async () => ({ issues: [], nextPageToken: null }),
      sync: async () => ({
        issues: [{ ...issue, key: "TEST-999", matches: true }],
        ancestors: [],
        removed: [issue.key],
        checkedAt: stamp,
      }),
    },
    filters,
    "me",
  );
  list.restore({
    items: [issue],
    direct: [issue.key],
    matched: [issue.key],
    complete: true,
    pages: [],
    checkedAt: stamp,
    reconciledAt: stamp,
  });
  list.toggle(issue.key, true);
  await list.load();
  assert.equal(list.items.has(issue.key), false);
  assert.equal(list.items.get("TEST-999")?.id, "1");
  assert.equal(list.tree.states.get("TEST-999")?.collapsed, true);
});

for (const status of [404, 409])
  test(`동기화 ${status}는 캐시 화면을 유지하며 이전 범위 조회로 복구한다`, async () => {
    const stamp = new Date().toISOString();
    const issue = { ...parent, id: "1", updated: stamp };
    let reads = 0;
    const list = createListController(
      {
        issues: async () => {
          reads++;
          return { issues: [issue], ancestors: [], nextPageToken: null };
        },
        children: async () => ({ issues: [], nextPageToken: null }),
        sync: async () => {
          throw new ApiError("범위 재확인", status);
        },
      },
      filters,
      "me",
    );
    list.restore({
      items: [issue],
      matched: [issue.key],
      direct: [issue.key],
      complete: true,
      pages: [],
      checkedAt: stamp,
      reconciledAt: stamp,
    });
    await list.load();
    assert.equal(reads, 1);
    assert.equal(list.error, "");
    assert.equal(list.items.get(issue.key)?.id, "1");
  });

test("정합성 확인이 6시간 넘은 캐시는 변경분 대신 이전 범위를 재검증한다", async () => {
  const stamp = new Date(Date.now() - 7 * 3600000).toISOString();
  const issue = { ...parent, id: "1", updated: stamp };
  let reads = 0;
  const list = createListController(
    {
      issues: async () => {
        reads++;
        return { issues: [issue], ancestors: [], nextPageToken: null };
      },
      children: async () => ({ issues: [], nextPageToken: null }),
      sync: async () => {
        throw new Error("오래된 캐시를 동기화했다");
      },
    },
    filters,
    "me",
  );
  list.restore({
    items: [issue],
    matched: [issue.key],
    direct: [issue.key],
    complete: true,
    pages: [],
    checkedAt: stamp,
    reconciledAt: stamp,
  });
  await list.load();
  assert.equal(reads, 1);
  assert.equal(list.error, "");
  assert.equal(list.needsReconcile, false);
});

test("표시용 임시 부모가 있어도 실제 자식의 변경·삭제·부모 이동을 묶음 동기화한다", async () => {
  const stamp = new Date().toISOString();
  const child = {
    ...emptyIssue("TEST-2", "이전 제목"),
    id: "2",
    parent: parent.key,
    updated: stamp,
  };
  const removed = {
    ...emptyIssue("TEST-3"),
    id: "3",
    parent: parent.key,
    updated: stamp,
  };
  const destination = {
    ...emptyIssue("TEST-99"),
    id: "99",
    hasChildren: true,
    updated: stamp,
  };
  let syncCalls = 0,
    rootCalls = 0,
    childCalls = 0;
  const api = {
    issues: async () => {
      rootCalls++;
      return { issues: [child], ancestors: [parent], nextPageToken: null };
    },
    children: async () => {
      childCalls++;
      return { issues: [child, removed], nextPageToken: null };
    },
    sync: async (_filters: Filters, known: { id: string; key: string }[]) => {
      syncCalls++;
      assert.deepEqual(known.map((issue) => issue.id).sort(), ["2", "3"]);
      return {
        issues: [
          {
            ...child,
            summary: "변경된 제목",
            parent: destination.key,
            matches: true,
          },
        ],
        ancestors: [destination],
        removed: [removed.key],
        checkedAt: new Date().toISOString(),
      };
    },
  };
  const first = createListController(api, filters, "me");
  await first.load();
  await first.queueChildren(parent.key);
  assert.ok(first.checkpoint, "임시 부모가 정상 자식의 주기 동기화를 막는다");
  assert.deepEqual(
    first
      .syncKnown()
      .map((issue) => issue.key)
      .sort(),
    ["TEST-2", "TEST-3"],
  );
  const restored = createListController(api, filters, "me");
  restored.restore(first.snapshot());
  await restored.load();
  await restored.queueChildren(parent.key);
  assert.equal(syncCalls, 1);
  assert.equal(rootCalls, 1, "캐시 복원 후 전체 재조회가 발생했다");
  assert.equal(childCalls, 1, "캐시 복원 후 하위 재조회가 발생했다");
  assert.equal(restored.error, "");
  assert.equal(
    restored.items.get(parent.key)?.summary,
    parent.summary,
    "표시용 부모를 삭제로 해석했다",
  );
  assert.equal(restored.visibleItems().get(child.key)?.summary, "변경된 제목");
  assert.equal(restored.visibleItems().get(child.key)?.parent, destination.key);
  assert.equal(restored.visibleItems().has(removed.key), false);
  assert.equal(restored.childPage(parent.key).issues.size, 0);
  assert.ok(restored.checkpoint);
  first.destroy();
  restored.destroy();
});

for (const source of ["direct", "matched", "child", "partial-parent"] as const)
  test(`실제 항목의 메타정보가 없는 ${source} 캐시는 기존 재검증을 유지한다`, async () => {
    const stamp = new Date().toISOString();
    const actual = {
      ...emptyIssue("TEST-2"),
      id: "2",
      parent: parent.key,
      updated: stamp,
    };
    const unidentified =
      source === "partial-parent" ? { ...parent, id: "1" } : parent;
    let rootCalls = 0;
    const list = createListController(
      {
        issues: async () => {
          rootCalls++;
          return { issues: [actual], ancestors: [], nextPageToken: null };
        },
        children: async () => ({ issues: [], nextPageToken: null }),
        sync: async () => {
          throw new Error("불완전한 실제 항목을 동기화했다");
        },
      },
      filters,
      "me",
    );
    list.restore({
      items: [unidentified, actual],
      direct: source === "direct" ? [parent.key, actual.key] : [actual.key],
      matched: source === "matched" ? [parent.key, actual.key] : [actual.key],
      complete: true,
      pages:
        source === "child"
          ? [
              [
                "legacy-child",
                {
                  parent: actual.key,
                  issues: [{ ...emptyIssue("TEST-4"), parent: actual.key }],
                  complete: true,
                },
              ],
            ]
          : [],
      checkedAt: stamp,
      reconciledAt: stamp,
    });
    assert.equal(list.checkpoint, "");
    await list.load();
    assert.equal(rootCalls, 1);
    assert.equal(list.error, "");
    list.destroy();
  });

test("다른 탭에서 돌아오면 캐시를 먼저 복원하고 루트 대신 변경분을 검증한다", async () => {
  const stamp = new Date().toISOString();
  const saved = { ...parent, id: "1", updated: stamp };
  const response = deferred<SyncBatch>();
  let roots = 0,
    syncs = 0;
  const list = createListController(
    {
      issues: async () => {
        roots++;
        return { issues: [], ancestors: [], nextPageToken: null };
      },
      children: async () => ({ issues: [], nextPageToken: null }),
      sync: async () => {
        syncs++;
        return response.promise;
      },
    },
    filters,
    "me",
  );
  await list.load({ ...filters, projects: ["OTHER"] });
  const pending = list.load(filters, {
    items: [saved],
    matched: [saved.key],
    direct: [saved.key],
    pages: [],
    complete: true,
    checkedAt: stamp,
    reconciledAt: stamp,
  });
  assert.equal(list.items.get(saved.key)?.summary, saved.summary);
  assert.equal(list.loading, true);
  assert.equal(roots, 1);
  assert.equal(syncs, 1);
  response.resolve({
    issues: [],
    ancestors: [],
    removed: [saved.key],
    checkedAt: stamp,
  });
  await pending;
  assert.equal(list.items.has(saved.key), false);
  list.destroy();
});

test("탭 캐시를 복원한 뒤 예전 탭 응답과 오래된 자체 수정이 다시 섞이지 않는다", async () => {
  const snapshot = await previous();
  const old = deferred<{
    issues: (typeof parent)[];
    ancestors: never[];
    nextPageToken: null;
  }>();
  let reads = 0;
  const list = createListController(
    {
      issues: async () => {
        reads++;
        return reads === 1
          ? old.promise
          : { issues: [parent], ancestors: [], nextPageToken: null };
      },
      children: async () => ({ issues: [], nextPageToken: null }),
    },
    filters,
    "me",
  );
  const waiting = list.load({ ...filters, projects: ["OTHER"] });
  const edited = { ...parent, summary: "방금 수정한 제목" };
  list.update(edited, true);
  const restoring = list.load(filters, snapshot);
  assert.equal(list.items.get(parent.key)?.summary, edited.summary);
  assert.equal(list.childPage(parent.key).issues.size, 35);
  await restoring;
  old.resolve({
    issues: [{ ...parent, key: "OTHER-1" }],
    ancestors: [],
    nextPageToken: null,
  });
  await waiting;
  assert.equal(list.items.has("OTHER-1"), false);
  list.destroy();
});

test("탭 캐시의 하위 목록은 이미 확인한 삭제와 부모 이동을 되돌리지 않는다", async () => {
  const snapshot = await previous();
  const moved = children[0],
    removed = children[1];
  assert.ok(moved && removed);
  const rootReply = deferred<{
    issues: (typeof parent)[];
    ancestors: never[];
    nextPageToken: null;
  }>();
  const list = createListController(
    {
      issues: async () => rootReply.promise,
      children: async () => ({ issues: [], nextPageToken: null }),
    },
    filters,
    "me",
  );
  list.restore(snapshot);
  list.update({ ...moved, parent: "TEST-99" }, false);
  list.applyChanges({
    issues: [],
    ancestors: [],
    removed: [removed.key],
    checkedAt: new Date().toISOString(),
  });
  const loading = list.load(filters, snapshot);
  assert.equal(list.childPage(parent.key).issues.has(moved.key), false);
  assert.equal(list.childPage(parent.key).issues.has(removed.key), false);
  rootReply.resolve({ issues: [parent], ancestors: [], nextPageToken: null });
  await loading;
  list.destroy();
});
