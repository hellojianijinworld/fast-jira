import assert from "node:assert/strict";
import { test } from "node:test";
import { branchDefaults, type Filters } from "../src/domain/filters.ts";
import { passesChild } from "../src/domain/list.ts";
import { personFilter, personSelection } from "../src/domain/people.ts";
import { emptyIssue } from "../src/domain/wire.ts";

const filters: Filters = {
  projects: ["TEST"],
  scope: "related",
  assignees: null,
  statuses: null,
  excludeDone: false,
  sort: "recent",
  q: "",
};
test("사람 조건은 담당자·작업 관계자 기준과 나·전체·직접 선택을 구분한다", () => {
  assert.deepEqual(personFilter(filters), { basis: "related", mode: "me" });
  assert.deepEqual(personFilter({ ...filters, scope: "assigned" }), {
    basis: "assigned",
    mode: "me",
  });
  assert.deepEqual(
    personFilter({ ...filters, scope: "all", assignees: ["member-a"] }),
    { basis: "assigned", mode: "custom" },
  );
  assert.deepEqual(personSelection("related", "custom", ["member-a"]), {
    scope: "related",
    assignees: ["member-a"],
  });
  assert.deepEqual(personSelection("assigned", "me", ["member-a"]), {
    scope: "assigned",
    assignees: null,
  });
  assert.deepEqual(personSelection("related", "all", ["member-a"]), {
    scope: "all",
    assignees: null,
  });
});
test("하위도 관계자 필드의 계정으로 판정하고 내 담당만은 미지정을 포함하지 않는다", () => {
  const child = {
    ...emptyIssue("TEST-2"),
    assigneeId: "other",
    relatedUserIds: ["me", "other"],
  };
  assert(
    passesChild(
      child,
      { ...branchDefaults(filters), projects: filters.projects },
      "me",
    ),
  );
  assert(
    !passesChild(
      child,
      {
        ...branchDefaults({ ...filters, scope: "assigned" }),
        projects: filters.projects,
      },
      "me",
    ),
  );
  assert(
    passesChild(
      child,
      {
        ...branchDefaults({ ...filters, assignees: ["other"] }),
        projects: filters.projects,
      },
      "me",
    ),
  );
  assert(
    !passesChild(
      child,
      {
        ...branchDefaults({ ...filters, assignees: [] }),
        projects: filters.projects,
      },
      "me",
    ),
  );
  assert(
    !passesChild(
      emptyIssue("TEST-2"),
      {
        ...branchDefaults({ ...filters, scope: "assigned" }),
        projects: filters.projects,
      },
      "me",
    ),
  );
});

test("미지정 대상은 두 기준에서 저장·복원되고 직접 선택과 구분한다", () => {
  for (const basis of ["assigned", "related"] as const) {
    const selection = personSelection(basis, "unassigned", ["member-a"]);
    assert.deepEqual(selection, { scope: basis, assignees: ["unassigned"] });
    assert.deepEqual(personFilter(selection), { basis, mode: "unassigned" });
    assert.deepEqual(personSelection(basis, "me", selection.assignees), {
      scope: basis,
      assignees: null,
    });
  }
  assert.equal(
    personFilter({ scope: "assigned", assignees: ["unassigned", "member-a"] })
      .mode,
    "custom",
  );
  assert.equal(
    personFilter({ scope: "related", assignees: [] }).mode,
    "custom",
  );
});
test("담당자 미지정과 모든 작업 관계자 미지정은 서로 다른 작업을 찾는다", () => {
  const empty = emptyIssue("TEST-2");
  const relatedOnly = { ...empty, relatedUserIds: ["member-a"] };
  const assigned = {
    ...empty,
    assigneeId: "member-a",
    relatedUserIds: ["member-a"],
  };
  for (const [basis, expected] of [
    ["assigned", [true, true, false]],
    ["related", [true, false, false]],
  ] as const) {
    const settings = {
      ...branchDefaults({
        ...filters,
        scope: basis,
        assignees: ["unassigned"],
      }),
      projects: filters.projects,
    };
    assert.deepEqual(
      [empty, relatedOnly, assigned].map((issue) =>
        passesChild(issue, settings, "me"),
      ),
      expected,
    );
  }
});

test("관계자 미지정에서 직접 선택으로 바꿔도 보이지 않는 선택을 남기지 않는다", () => {
  assert.deepEqual(personSelection("related", "custom", ["unassigned"]), {
    scope: "related",
    assignees: [],
  });
  assert.deepEqual(
    personSelection("related", "custom", ["unassigned", "member-a"]),
    { scope: "related", assignees: ["member-a"] },
  );
  assert.deepEqual(personSelection("assigned", "custom", ["unassigned"]), {
    scope: "assigned",
    assignees: ["unassigned"],
  });
});
