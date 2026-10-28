import assert from "node:assert/strict";
import { test } from "node:test";
import { createAccountStore } from "../src/client/preferences.ts";
import { createViewController } from "../src/client/view-controller.ts";
import type { Filters } from "../src/domain/filters.ts";
import { initialViews, selectView } from "../src/domain/views.ts";
import {
  activeWorkspace,
  decodeWorkspaces,
  deleteWorkspace,
  initialWorkspaces,
  saveWorkspace,
  selectWorkspace,
} from "../src/domain/workspace-views.ts";

const filters: Filters = {
  projects: ["TEST"],
  q: "",
  scope: "related",
  sort: "recent",
  statuses: null,
  assignees: null,
  excludeDone: false,
};
const base = initialViews(filters);
test("탭은 같은 조건이어도 이름·프로젝트·하위 필터를 독립적으로 보존한다", () => {
  const original = initialWorkspaces(["TEST"], base);
  const branch = selectView(
    base,
    { kind: "branch", key: "TEST-1" },
    { kind: "inline", definition: { ...filters, statuses: ["2"] } },
  );
  const two = saveWorkspace(original, {
    id: "second",
    name: " 디자인 ",
    projects: ["DESIGN", "DESIGN"],
    views: branch,
  });
  assert.equal(two.tabs.length, 2);
  assert.equal(activeWorkspace(two).name, "디자인");
  assert.deepEqual(activeWorkspace(two).projects, ["DESIGN"]);
  assert.equal(
    activeWorkspace(selectWorkspace(two, original.activeId)).views,
    base,
  );
  assert.deepEqual(original.tabs[0]?.views.branches, {});
  assert.deepEqual(deleteWorkspace(two, "second"), original);
  assert.throws(() => deleteWorkspace(original, original.activeId));
  assert.throws(() => selectWorkspace(two, "missing"));
  assert.throws(() =>
    saveWorkspace(two, { ...activeWorkspace(two), name: " " }),
  );
});
test("기존 설정을 첫 탭으로 이식하고 활성 탭·빈 프로젝트를 계정별로 복원한다", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const store = createAccountStore(storage, "jira.atlassian.net", "account");
  const initial = store.workspaces(["TEST", "DESIGN"], filters.projects, base);
  assert.deepEqual(activeWorkspace(initial).projects, ["TEST"]);
  const next = saveWorkspace(initial, {
    id: "empty",
    name: "선택 없음",
    projects: [],
    views: base,
  });
  store.saveWorkspaces(next);
  assert.deepEqual(store.workspaces(["TEST"], ["TEST"], base), next);
  assert.equal(
    createAccountStore(storage, "jira.atlassian.net", "other").workspaces(
      ["TEST"],
      ["TEST"],
      base,
    ).tabs.length,
    1,
  );
  assert.equal(
    createAccountStore(storage, "other.atlassian.net", "account").workspaces(
      ["TEST"],
      ["TEST"],
      base,
    ).tabs.length,
    1,
  );
});
test("복원 시 손상 데이터는 거부하고 권한이 사라진 프로젝트와 유실된 활성 ID를 정리한다", () => {
  const original = initialWorkspaces(["TEST", "OLD"], base);
  const decoded = decodeWorkspaces({ ...original, activeId: "missing" }, [
    "TEST",
  ]);
  assert.equal(decoded?.activeId, original.activeId);
  assert.deepEqual(decoded?.tabs[0]?.projects, ["TEST"]);
  for (const bad of [
    null,
    {},
    { ...original, tabs: [] },
    { ...original, tabs: [original.tabs[0], original.tabs[0]] },
    { ...original, tabs: [{ ...original.tabs[0], views: {} }] },
  ])
    assert.equal(decodeWorkspaces(bad, ["TEST"]), null);
});
test("탭 전환은 임시 필터를 비우고 이후 편집은 새 탭의 실제 필터를 저장한다", () => {
  let stored = base;
  const controller = createViewController(base, {
    save: (state) => {
      stored = state;
    },
    changed: () => {},
    statuses: () => [],
  });
  controller.peek("TEST-1", { people: true });
  assert.equal(
    controller.resolve({ kind: "branch", key: "TEST-1" }).scope,
    "all",
  );
  const next = initialViews({
    ...filters,
    scope: "assigned",
    assignees: ["account-other"],
  });
  controller.replace(next);
  assert.deepEqual(controller.temporary("TEST-1"), {});
  assert.equal(
    controller.resolve({ kind: "branch", key: "TEST-1" }).scope,
    "assigned",
  );
  controller.apply({ kind: "global" }, { ...filters, sort: "due" });
  assert.notEqual(stored, base);
  assert.equal(
    base.global.kind === "inline" && base.global.definition.sort,
    "recent",
  );
});

test("뷰 아이콘은 저장과 복원을 거치며 기존 데이터와 잘못된 아이콘을 안전하게 처리한다", () => {
  const original = initialWorkspaces(["TEST"], base);
  const saved = saveWorkspace(original, {
    ...activeWorkspace(original),
    icon: "circle-check",
  });
  assert.equal(
    decodeWorkspaces(saved, ["TEST"])?.tabs[0]?.icon,
    "circle-check",
  );
  assert.equal(decodeWorkspaces(original, ["TEST"])?.tabs[0]?.icon, undefined);
  const invalid = {
    ...saved,
    tabs: [{ ...saved.tabs[0], icon: "../bad.svg" }],
  };
  assert.equal(decodeWorkspaces(invalid, ["TEST"])?.tabs[0]?.icon, undefined);
});
