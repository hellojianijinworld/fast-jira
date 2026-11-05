import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultSearchFilters,
  type SearchSort,
  searchLocalIssues,
} from "../src/domain/search-results.ts";
import { emptyIssue } from "../src/domain/wire.ts";

const me = "account-me";
const issues = [
  {
    ...emptyIssue("AA-1"),
    project: "AA",
    summary: "검색 개선",
    statusId: "1",
    statusCategory: "indeterminate",
    dueDate: "2026-11-08",
    updated: "2026-11-04",
    assigneeId: "other",
    relatedUserIds: [me],
  },
  {
    ...emptyIssue("BB-2"),
    project: "BB",
    summary: "검색 개선",
    statusId: "2",
    statusCategory: "done",
    dueDate: "",
    updated: "2026-11-05",
  },
  {
    ...emptyIssue("AA-3"),
    project: "AA",
    summary: "검색 개선",
    statusId: "1",
    dueDate: "2026-11-07",
    updated: "2026-11-03",
  },
];
const find = (patch = {}, sort: SearchSort = "recommended", query = "검색") =>
  searchLocalIssues(
    issues,
    query,
    { ...defaultSearchFilters(), ...patch },
    sort,
    me,
    () => false,
    [],
    [],
    [],
  );
test("검색 조건은 프로젝트·사람·단계를 AND로 결합하고 담당자 외 참여자도 찾는다", () => {
  assert.deepEqual(
    find({
      projects: ["AA"],
      scope: "related",
      assignees: [me],
      statuses: ["1"],
    }).map((x) => x.key),
    ["AA-1"],
  );
  assert.equal(find({ scope: "assigned", assignees: [me] }).length, 0);
  assert.deepEqual(
    find({ scope: "related", assignees: ["unassigned"] }).map((x) => x.key),
    ["BB-2", "AA-3"],
  );
});
test("정렬은 로컬 일치 순위보다 우선하며 마감일 미지정은 뒤에 둔다", () => {
  assert.deepEqual(
    find({}, "due").map((x) => x.key),
    ["AA-3", "AA-1", "BB-2"],
  );
  assert.deepEqual(
    find({}, "oldest").map((x) => x.key),
    ["AA-3", "AA-1", "BB-2"],
  );
});
test("빈 검색어로도 조건 조회가 가능하며 단계 선택 없음은 결과 없음이다", () => {
  assert.deepEqual(
    find({ projects: ["AA"] }, "recent", "").map((x) => x.key),
    ["AA-1", "AA-3"],
  );
  assert.equal(find({ statuses: [] }).length, 0);
  assert.equal(
    find({ excludeDone: true }).some((x) => x.key === "BB-2"),
    false,
  );
});
test("조건 필터링은 로컬 후보 제한보다 먼저 적용한다", () => {
  const many = Array.from({ length: 15 }, (_, i) => ({
    ...emptyIssue("AA-0"),
    summary: "검색 개선",
    project: "AA",
    key: `AA-${i + 1}`,
    statusId: i === 14 ? "2" : "1",
  }));
  assert.equal(
    searchLocalIssues(
      many,
      "검색",
      { ...defaultSearchFilters(), statuses: ["2"] },
      "recommended",
      me,
      () => false,
      [],
      [],
      [],
    )[0]?.key,
    "AA-15",
  );
});
