import assert from "node:assert/strict";
import { test } from "node:test";
import { dateLabel, reportedTime } from "../src/domain/dates.ts";
import {
  createDetailState,
  createEditOptions,
} from "../src/domain/detail-state.ts";
import {
  type BranchDefaults,
  fieldValue,
  type Issue,
} from "../src/domain/issue.ts";
import {
  compareIssues,
  passesChild,
  setMembership,
} from "../src/domain/list.ts";
import { sortOrder, sortRules } from "../src/domain/sort.ts";
import {
  branchState,
  type CollapseState,
  groupIssues,
  resolveBranchSettings,
  setBranchState,
} from "../src/domain/tree.ts";

function issue(changes: Partial<Issue> = {}): Issue {
  return {
    id: "",
    key: "TEST-1",
    summary: "",
    project: "TEST",
    parent: "",
    parentSummary: "",
    status: "",
    statusId: "",
    statusCategory: "",
    issueType: "",
    issueTypeId: "task",
    hierarchyLevel: 0,
    issueTypeIcon: "",
    priority: "",
    priorityId: "",
    defaultPriorityId: "",
    priorityIcon: "",
    assignee: "",
    assigneeId: "",
    assigneeAvatar: "",
    updated: "",
    dueDate: "",
    commentCount: 0,
    hasChildren: false,
    ...changes,
  };
}
test("상대 시각 경계와 마감일의 달력 날짜", () => {
  const now = new Date(2026, 9, 1, 12);
  for (const [seconds, expected] of [
    [59, "방금 전"],
    [60, "1분 전"],
    [3599, "59분 전"],
    [3600, "1시간 전"],
    [86399, "23시간 전"],
    [86400, "1일 전"],
    [604800, "09.24 12:00"],
  ] as const)
    assert.equal(
      reportedTime(new Date(now.getTime() - seconds * 1000), now),
      expected,
    );
  assert.equal(reportedTime("invalid", now), "");
  assert.equal(dateLabel("2026-10-02", true, now), "10월 2일 · 내일");
  assert.equal(dateLabel("2026-09-30", true, now), "9월 30일 · 어제 마감");
});
test("부모를 접었다 펼쳐도 이전 하위 펼침은 복원하지 않는다", () => {
  const states = new Map<string, CollapseState>();
  setBranchState(states, "child", false, 1);
  setBranchState(states, "parent", true, 2);
  setBranchState(states, "parent", false, 3);
  const parent = branchState(states, "parent");
  assert.equal(parent.collapsed, false);
  assert.equal(branchState(states, "child", parent.childReset).collapsed, true);
  setBranchState(states, "child", false, 4);
  assert.equal(
    branchState(states, "child", parent.childReset).collapsed,
    false,
  );
});
test("전체·선택 없음·상속의 구분", () => {
  const defaults: BranchDefaults = {
    sort: "recent",
    people: "mine",
    excludeDone: true,
    statuses: ["1"],
    assignees: ["me"],
  };
  assert.equal(
    resolveBranchSettings({ statuses: null }, defaults).statuses,
    null,
  );
  assert.deepEqual(
    resolveBranchSettings({ statuses: [] }, defaults).statuses,
    [],
  );
  assert.deepEqual(
    resolveBranchSettings({ statuses: "inherit" }, defaults).statuses,
    ["1"],
  );
});
test("실제 부모로 묶고 목록에서 빠진 부모의 연결 정보는 유지한다", () => {
  const epic = issue({ key: "TEST-1", hierarchyLevel: 1 });
  const task = issue({ key: "TEST-2", hierarchyLevel: 0 });
  const child = issue({ key: "TEST-3", parent: epic.key, hierarchyLevel: -1 });
  const missingParent = issue({ key: "TEST-4", parent: "TEST-999" });
  const groups = groupIssues(
    new Map([epic, task, child, missingParent].map((row) => [row.key, row])),
  );
  assert.deepEqual(
    groups.get("")?.map((row) => row.key),
    [epic.key, task.key, missingParent.key],
  );
  assert.deepEqual(groups.get(epic.key), [child]);
  assert.equal(missingParent.parent, "TEST-999");
});
test("하위는 나 또는 미지정, 완료 범주와 명시적 체크를 적용한다", () => {
  const settings = {
    sort: "recent",
    projects: ["TEST"],
    people: "mine" as const,
    excludeDone: true,
    statuses: null,
    assignees: null,
  };
  assert(passesChild(issue(), settings, "me"));
  assert(passesChild(issue({ assigneeId: "me" }), settings, "me"));
  assert(!passesChild(issue({ assigneeId: "other" }), settings, "me"));
  assert(!passesChild(issue({ statusCategory: "done" }), settings, "me"));
  assert(!passesChild(issue(), { ...settings, statuses: [] }, "me"));
});
test("다중 정렬은 중복 필드 거부, 누락 날짜·우선순위는 끝에 둔다", () => {
  assert.throws(() => sortRules("recent,oldest"));
  assert.throws(() => sortRules("status; DROP"));
  assert.equal(
    sortOrder("status,due"),
    "status ASC, duedate ASC, updated DESC, key ASC",
  );
  const dated = issue({ dueDate: "2026-10-02" });
  assert(compareIssues(issue(), dated, "due-desc", new Map()) > 0);
  assert(
    compareIssues(
      issue(),
      issue({ priorityId: "low" }),
      "priority-asc",
      new Map(),
      new Map([["low", 0]]),
    ) > 0,
  );
});
test("필터 밖 부모의 비일치 항목을 목록에 새로 넣지 않는다", () => {
  const state = {
    items: new Map<string, Issue>(),
    direct: new Set<string>(),
    matched: new Set<string>(),
    pages: new Map(),
  };
  setMembership(issue({ parent: "OTHER-1" }), false, state, () => true);
  assert.equal(state.items.size, 0);
});
test("편집 보호 해제는 중복 호출에도 한 번만 갱신한다", () => {
  let count = 0;
  const state = createDetailState(() => count++);
  const release = state.hold();
  assert.equal(state.canRefresh(), false);
  release();
  release();
  assert.equal(count, 1);
  assert.equal(state.canRefresh(), true);
});
test("상태 변경 후 담당자는 캐시하고 전환만 새로 조회한다", async () => {
  const paths: string[] = [];
  const options = createEditOptions(async (path) => {
    paths.push(path);
    return path.includes("/options?")
      ? {
          users: [{ id: "me", name: "사용자", avatar: "" }],
          statuses: ["시작"],
        }
      : { statuses: ["완료"] };
  }, "TEST-1");
  await Promise.all([options.get(), options.get()]);
  assert.equal(paths.length, 1);
  options.invalidate();
  assert.deepEqual((await options.get()).statuses, ["완료"]);
  assert.equal(paths.length, 2);
  assert(paths[1]?.includes("/transitions?"));
});

test("편집과 되돌리기의 비교값은 사용자·우선순위의 이름이 아닌 ID를 사용한다", () => {
  const item = issue({
    summary: "제목",
    status: "검토",
    statusId: "status-id",
    assignee: "같은 이름",
    assigneeId: "account-id",
    priority: "높음",
    priorityId: "priority-id",
    dueDate: "2026-10-22",
  });
  assert.deepEqual(
    [
      fieldValue(item, "summary"),
      fieldValue(item, "status"),
      fieldValue(item, "assignee"),
      fieldValue(item, "priority"),
      fieldValue(item, "dueDate"),
    ],
    ["제목", "검토", "account-id", "priority-id", "2026-10-22"],
  );
});
