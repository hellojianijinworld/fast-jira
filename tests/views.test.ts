import assert from "node:assert/strict";
import { test } from "node:test";
import type { Filters } from "../src/domain/filters.ts";
import {
  applyView,
  decodeViews,
  deleteView,
  initialViews,
  migrateViews,
  normalizeView,
  registerSavedView,
  registerView,
  resolveView,
  sameView,
  selectView,
  updateView,
  type ViewDefinition,
} from "../src/domain/views.ts";

const definition: ViewDefinition = {
  scope: "related",
  sort: "recent",
  statuses: null,
  assignees: null,
  excludeDone: false,
};
const filters: Filters = { ...definition, projects: ["TEST"], q: "찾기" };
const target = { kind: "branch" as const, key: "TEST-1" };
const global = { kind: "global" as const };

test("담당자·단계 선택 순서와 중복은 같은 보기이고 정렬 순위는 다르다", () => {
  const left = {
    ...definition,
    statuses: ["2", "1", "2"],
    assignees: ["person-a", "unassigned"],
  };
  assert.equal(
    sameView(left, {
      ...left,
      statuses: ["1", "2"],
      assignees: ["unassigned", "person-a"],
    }),
    true,
  );
  assert.equal(sameView({ ...definition, statuses: [] }, definition), false);
  assert.equal(sameView({ ...definition, assignees: [] }, definition), false);
  assert.equal(
    sameView(
      { ...definition, sort: "due,recent" },
      { ...definition, sort: "recent,due" },
    ),
    false,
  );
  assert.deepEqual(normalizeView(left).statuses, ["1", "2"]);
});
test("전체 탐색 프로젝트와 검색어는 등록된 보기의 조건에 들어가지 않는다", () => {
  const state = initialViews(filters);
  assert.deepEqual(resolveView(state, global), definition);
  assert.equal("q" in resolveView(state, global), false);
  assert.equal("projects" in resolveView(state, global), false);
});
test("새 인라인 적용은 같은 등록 보기를 자동 참조하고 다른 묶음은 바꾸지 않는다", () => {
  const custom = { ...definition, scope: "all" as const, statuses: ["2", "1"] };
  const saved = registerView(
    initialViews(definition),
    target,
    custom,
    "QA 확인",
    "qa",
  );
  const applied = applyView(
    saved,
    { kind: "branch", key: "TEST-2" },
    { ...custom, statuses: ["1", "2", "1"] },
  );
  assert.deepEqual(applied.branches["TEST-2"], { kind: "saved", viewId: "qa" });
  assert.deepEqual(applied.branches["TEST-1"], { kind: "saved", viewId: "qa" });
  assert.equal(applied.saved.length, 1);
  assert.deepEqual(saved.branches["TEST-2"], undefined);
});
test("같은 조건 등록은 이름·ID를 새로 만들지 않고 기존 참조를 연결한다", () => {
  const first = registerView(
    initialViews(definition),
    target,
    definition,
    "내 보기",
    "first",
  );
  const repeated = registerView(first, global, definition, "", "second");
  assert.equal(repeated.saved.length, 1);
  assert.deepEqual(repeated.global, { kind: "saved", viewId: "first" });
});
test("등록된 보기의 위치 편집은 그 묶음만 전용 보기로 분리한다", () => {
  let state = registerView(
    initialViews(definition),
    target,
    definition,
    "같이 보기",
    "common",
  );
  state = selectView(
    state,
    { kind: "branch", key: "TEST-2" },
    { kind: "saved", viewId: "common" },
  );
  const changed = applyView(state, target, { ...definition, assignees: [] });
  assert.deepEqual(changed.branches["TEST-1"], {
    kind: "inline",
    definition: { ...definition, assignees: [] },
  });
  assert.deepEqual(
    resolveView(changed, { kind: "branch", key: "TEST-2" }),
    definition,
  );
  assert.deepEqual(state.saved[0]?.definition, definition);
});
test("명시적 기본 참조는 전체 조건 변경을 따르고 전용 보기는 유지한다", () => {
  let state = applyView(initialViews(definition), target, {
    ...definition,
    sort: "due",
  });
  state = selectView(
    state,
    { kind: "branch", key: "TEST-2" },
    { kind: "default" },
  );
  state = applyView(state, global, { ...definition, sort: "priority" });
  assert.equal(resolveView(state, target).sort, "due");
  assert.equal(
    resolveView(state, { kind: "branch", key: "TEST-2" }).sort,
    "priority",
  );
  assert.throws(() => selectView(state, global, { kind: "default" }));
});
test("공용 수정은 연결된 묶음에 반영하고 이름만 바꿔도 조건은 같다", () => {
  const state = registerView(
    initialViews(definition),
    target,
    definition,
    "처음 이름",
    "shared",
  );
  const changed = updateView(state, "shared", "새 이름", {
    ...definition,
    sort: "due,priority",
  });
  assert.equal(resolveView(changed, target).sort, "due,priority");
  assert.equal(state.saved[0]?.name, "처음 이름");
  const shared = changed.saved[0];
  assert.ok(shared);
  const renamed = updateView(
    changed,
    "shared",
    "마지막 이름",
    shared.definition,
  );
  assert.equal(
    sameView(resolveView(changed, target), resolveView(renamed, target)),
    true,
  );
});
test("사용 중인 보기 삭제는 전체와 부모의 마지막 조건을 전용 보기로 보존한다", () => {
  let state = registerView(
    initialViews(definition),
    global,
    { ...definition, sort: "due" },
    "마감 보기",
    "due",
  );
  state = selectView(state, target, { kind: "saved", viewId: "due" });
  const removed = deleteView(state, "due");
  assert.deepEqual(removed.saved, []);
  assert.deepEqual(removed.global, {
    kind: "inline",
    definition: { ...definition, sort: "due" },
  });
  assert.deepEqual(removed.branches["TEST-1"], {
    kind: "inline",
    definition: { ...definition, sort: "due" },
  });
  assert.equal(
    resolveView(removed, { kind: "branch", key: "TEST-2" }).sort,
    "due",
  );
});
test("옛 부분 상속은 당시의 적용 조건으로 이전하고 빈 선택·정렬 순서를 보존한다", () => {
  const state = migrateViews(
    filters,
    new Map([
      [
        "TEST-1",
        {
          sort: "due,priority",
          statuses: [],
          assignees: null,
          people: "all" as const,
          done: "exclude" as const,
        },
      ],
      ["TEST-2", { sort: "inherit", statuses: "inherit" as const }],
    ]),
  );
  assert.deepEqual(resolveView(state, target), {
    ...definition,
    scope: "all",
    sort: "due,priority",
    statuses: [],
    excludeDone: true,
  });
  assert.equal(state.branches["TEST-2"], undefined);
});
test("저장된 보기 경계는 끊긴 참조·중복 ID·잘못된 조건을 거부한다", () => {
  const state = registerView(
    initialViews(definition),
    target,
    definition,
    "보기",
    "saved",
  );
  assert.deepEqual(decodeViews(JSON.parse(JSON.stringify(state))), state);
  assert.equal(decodeViews({ ...state, global: { kind: "default" } }), null);
  assert.equal(
    decodeViews({ ...state, saved: [...state.saved, ...state.saved] }),
    null,
  );
  assert.equal(
    decodeViews({
      ...state,
      branches: { "TEST-1": { kind: "saved", viewId: "gone" } },
    }),
    null,
  );
  assert.equal(
    decodeViews({
      ...state,
      global: { kind: "inline", definition: { ...definition, sort: "manual" } },
    }),
    null,
  );
  assert.throws(() =>
    registerView(initialViews(definition), target, definition, "  ", "bad"),
  );
});

test("관리 화면의 새 보기는 현재 전체·부모 조건을 적용하지 않고 등록만 한다", () => {
  const state = initialViews(definition);
  const registered = registerSavedView(
    state,
    { ...definition, sort: "due" },
    "마감 보기",
    "due",
  );
  assert.equal(registered.viewId, "due");
  assert.equal(registered.state.saved.length, 1);
  assert.deepEqual(registered.state.global, state.global);
  assert.deepEqual(registered.state.branches, {});
  const repeated = registerSavedView(
    registered.state,
    { ...definition, sort: "due" },
    "다른 이름",
    "unused",
  );
  assert.equal(repeated.viewId, "due");
  assert.equal(repeated.state.saved.length, 1);
});

test("선택 상한을 넘는 보기는 저장하기 전에 거부한다", () => {
  assert.throws(() =>
    registerSavedView(
      initialViews(definition),
      {
        ...definition,
        assignees: Array.from({ length: 201 }, (_, n) => `account-${n}`),
      },
      "과다 선택",
      "too-many",
    ),
  );
});

test("이전 담당자 직접 선택과 새 담당자 기준은 같은 등록 보기를 참조한다", () => {
  const old = {
    ...definition,
    scope: "all" as const,
    assignees: ["account-id"],
  };
  const current = { ...old, scope: "assigned" as const };
  assert(sameView(old, current));
  const registered = registerView(
    initialViews(definition),
    target,
    old,
    "담당자 보기",
    "assigned-view",
  );
  assert.deepEqual(applyView(registered, global, current).global, {
    kind: "saved",
    viewId: "assigned-view",
  });
});
