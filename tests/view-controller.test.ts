import assert from "node:assert/strict";
import { test } from "node:test";
import { createListController } from "../src/client/list-controller.ts";
import { createAccountStore } from "../src/client/preferences.ts";
import { createViewController } from "../src/client/view-controller.ts";
import { createViewDraft } from "../src/client/view-editor-controller.ts";
import { branchDefaults, type Filters } from "../src/domain/filters.ts";
import { initialViews, type ViewState } from "../src/domain/views.ts";
import { emptyIssue } from "../src/domain/wire.ts";

const filters: Filters = {
  projects: ["TEST"],
  scope: "related",
  excludeDone: false,
  statuses: null,
  assignees: null,
  sort: "recent",
  q: "",
};
const target = { kind: "branch" as const, key: "TEST-1" };
function controller(
  options: {
    save?: (state: ViewState) => void;
    changed?: (conditionsChanged: boolean) => void;
  } = {},
) {
  return createViewController(initialViews(filters), {
    save: options.save ?? (() => {}),
    changed: options.changed ?? (() => {}),
    statuses: () => [
      { id: "3", name: "끝", category: "done", projects: ["TEST"] },
    ],
  });
}
test("보기 초안은 원래 선택을 변경하지 않고 취소·재설정할 수 있다", () => {
  const source = { ...filters, statuses: ["1"] };
  const draft = createViewDraft(source);
  draft.change({ statuses: ["2"], sort: "due,priority" });
  assert.deepEqual(source.statuses, ["1"]);
  assert.equal(draft.dirty, true);
  const exported = draft.value;
  (exported.statuses as string[]).push("99");
  assert.deepEqual(draft.value.statuses, ["2"]);
  draft.reset();
  assert.deepEqual(draft.value.statuses, ["1"]);
  assert.equal(draft.dirty, false);
});
test("저장 실패는 등록과 현재 연결을 모두 보존하고 화면 변경을 알리지 않는다", () => {
  let changed = 0;
  const views = controller({
    save: () => {
      throw new Error("storage full");
    },
    changed: () => {
      changed++;
    },
  });
  assert.throws(
    () => views.register(target, filters, "새 보기"),
    /storage full/,
  );
  assert.equal(views.state.saved.length, 0);
  assert.deepEqual(views.binding(target), { kind: "default" });
  assert.equal(changed, 0);
});
test("일시 확인은 선택 단계에 완료를 합치고 담당자를 넓히며 저장 조건을 건드리지 않는다", () => {
  let saved = 0;
  const views = controller({
    save: () => {
      saved++;
    },
  });
  views.apply(target, {
    ...filters,
    statuses: ["1"],
    assignees: ["person-a"],
    excludeDone: true,
  });
  views.peek(target.key, { done: true, people: true });
  assert.deepEqual(views.resolve(target).statuses, ["1", "3"]);
  assert.equal(views.resolve(target).excludeDone, false);
  assert.equal(views.resolve(target).assignees, null);
  assert.equal(views.resolve(target).scope, "all");
  assert.deepEqual(views.resolve(target, false).statuses, ["1"]);
  assert.equal(saved, 1);
  views.clearPeek(target.key);
  assert.deepEqual(views.resolve(target).assignees, ["person-a"]);
});
test("인라인 등록과 이름 변경은 동일 하위 페이지·커서를 재사용하고 조회를 추가하지 않는다", async () => {
  let calls = 0;
  const views = controller();
  views.apply(target, { ...filters, sort: "due" });
  const list = createListController(
    {
      issues: async () => ({ issues: [], ancestors: [], nextPageToken: null }),
      children: async () => {
        calls++;
        return { issues: [emptyIssue("TEST-2")], nextPageToken: "next" };
      },
    },
    filters,
    "person-a",
    () => {},
    undefined,
    (key) =>
      branchDefaults({ ...filters, ...views.resolve({ kind: "branch", key }) }),
  );
  await list.queueChildren(target.key);
  const page = list.childPage(target.key);
  views.register(target, views.resolve(target, false), "마감 보기");
  assert.equal(list.childPage(target.key), page);
  assert.equal(page.nextPageToken, "next");
  const saved = views.state.saved[0];
  assert.ok(saved);
  views.update(saved.id, "바뀐 이름", saved.definition);
  assert.equal(list.childPage(target.key), page);
  assert.equal(calls, 1);
  views.apply(target, { ...filters, sort: "priority" });
  assert.notEqual(list.childPage(target.key), page);
  assert.equal(list.childPage(target.key).loaded, false);
});
test("계정별 보기 저장은 한 레코드로 복원하고 다른 계정과 섞이지 않는다", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  const store = createAccountStore(storage, "example", "person-a");
  const views = createViewController(store.views(filters), {
    save: store.saveViews,
    changed: () => {},
    statuses: () => [],
  });
  views.register(target, { ...filters, assignees: [] }, "비어 있는 보기");
  const restored = store.views(filters);
  const restoredView = restored.saved[0];
  assert.ok(restoredView);
  assert.deepEqual(restored.branches["TEST-1"], {
    kind: "saved",
    viewId: restoredView.id,
  });
  assert.deepEqual(restored.saved[0]?.definition.assignees, []);
  assert.equal(
    createAccountStore(storage, "example", "person-b").views(filters).saved
      .length,
    0,
  );
});
test("전체 보기만 바꿔도 조건이 같은 공용 하위 페이지와 커서는 유지한다", async () => {
  const views = controller();
  views.apply(target, { ...filters, sort: "due" });
  const list = createListController(
    {
      issues: async () => ({ issues: [], ancestors: [], nextPageToken: null }),
      children: async () => ({
        issues: [emptyIssue("TEST-2")],
        nextPageToken: "next",
      }),
    },
    filters,
    "person-a",
    () => {},
    undefined,
    (key) =>
      branchDefaults({ ...filters, ...views.resolve({ kind: "branch", key }) }),
  );
  await list.queueChildren(target.key);
  const page = list.childPage(target.key);
  views.apply({ kind: "global" }, { ...filters, statuses: ["1"] });
  await list.load({ ...filters, ...views.resolve({ kind: "global" }) });
  assert.equal(list.childPage(target.key), page);
  assert.equal(list.childPage(target.key).nextPageToken, "next");
});
test("보기 선택지는 같은 요청을 합치고 만료되면 단계 설정을 다시 읽는다", async () => {
  const { createViewOptions } = await import("../src/client/view-options.ts");
  let now = 0,
    calls = 0;
  const catalog = {
    projects: [],
    priorities: [],
    types: [],
    statuses: [{ id: "1", name: "이전", category: "new", projects: ["TEST"] }],
  };
  const options = createViewOptions(
    {
      statuses: async () => {
        calls++;
        return [
          {
            id: "2",
            name: "추가",
            category: "indeterminate",
            projects: ["TEST"],
          },
        ];
      },
      users: async () => [],
      types: async () => [],
    },
    () => ({ projects: ["TEST"], catalog }),
    () => now,
  );
  const first = options.load(["TEST"]);
  assert.equal(options.load(["TEST"]), first);
  assert.equal((await first).statuses[0]?.id, "1");
  now = 300001;
  assert.equal((await options.load(["TEST"])).statuses[0]?.id, "2");
  assert.equal(calls, 1);
  await options.load([]);
  assert.equal(calls, 1);
});

test("조건 변경만 선택 초기화를 알리고 등록·이름 변경·삭제 보존은 유지한다", () => {
  const notifications: boolean[] = [];
  const views = controller({ changed: (value) => notifications.push(value) });
  views.apply(target, { ...filters, statuses: ["1"] });
  views.register(target, views.resolve(target, false), "대기");
  const saved = views.state.saved[0];
  assert.ok(saved);
  views.update(saved.id, "대기 작업", saved.definition);
  views.update(saved.id, "대기 작업", { ...saved.definition, statuses: [] });
  views.delete(saved.id);
  views.peek(target.key, { done: true });
  views.clearPeek(target.key);
  assert.deepEqual(notifications, [
    true,
    false,
    false,
    true,
    false,
    true,
    true,
  ]);
});
test("적용할 때 일시 확인이 해제되는 조건 변경도 알린다", () => {
  const notifications: boolean[] = [];
  const views = controller({ changed: (value) => notifications.push(value) });
  views.apply(target, { ...filters, assignees: ["person-a"] });
  views.peek(target.key, { people: true });
  notifications.length = 0;
  views.apply(target, views.resolve(target, false));
  assert.deepEqual(notifications, [true]);
});

test("변경이 금지된 동안에는 임시 범위와 등록 상태도 그대로 유지한다", () => {
  let blocked = false;
  const views = createViewController(initialViews(filters), {
    save: () => {},
    beforeChange: () => {
      if (blocked) throw new Error("busy");
    },
    changed: () => {},
    statuses: () => [],
  });
  blocked = true;
  assert.throws(() => views.peek(target.key, { people: true }), /busy/);
  assert.throws(() => views.register(target, filters, "등록"), /busy/);
  assert.equal(views.state.saved.length, 0);
  assert.deepEqual(views.temporary(target.key), {});
});

test("편집 선택지의 사용자 목록은 직접 선택할 때 조회하고 다른 프로젝트에서도 재사용한다", async () => {
  const { createViewOptions } = await import("../src/client/view-options.ts");
  let calls = 0;
  const options = createViewOptions(
    {
      statuses: async () => [],
      types: async () => [],
      users: async () => {
        calls++;
        return [{ id: "member-id", name: "관계자", avatar: "" }];
      },
    },
    () => ({
      projects: [],
      catalog: { projects: [], statuses: [], types: [], priorities: [] },
    }),
  );
  const first = await options.load(["TEST"]);
  assert.equal(calls, 0);
  assert.equal((await first.loadUsers?.())?.[0]?.name, "관계자");
  const second = await options.load(["OTHER"]);
  await second.loadUsers?.();
  assert.equal(calls, 1);
});
