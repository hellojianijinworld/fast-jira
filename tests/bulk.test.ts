import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type BulkDependencies,
  createBulkService,
} from "../src/server/bulk-service.ts";
import { decodeIssue } from "../src/server/jira-decode.ts";

function setup(now: () => number = Date.now) {
  const issues = new Map(
    ["AA-1", "AA-2", "AA-3"].map((key) => [
      key,
      decodeIssue({ key, fields: { status: { name: "대기" } } }),
    ]),
  );
  const writes: string[] = [];
  const service: BulkDependencies = {
    detail: async (key) => {
      const issue = issues.get(key);
      if (!issue) throw new Error("찾지 못함");
      return { ...issue };
    },
    applyUpdate: async (key, field, value) => {
      const issue = issues.get(key);
      if (!issue || key === "AA-2") throw new Error("권한 없음");
      writes.push(key);
      if (field === "priority") issue.priorityId = value;
      if (field === "dueDate") issue.dueDate = value;
      if (field === "status") issue.status = value;
      if (field === "assignee") issue.assigneeId = value;
    },
    priorityOptions: async (key) =>
      key === "AA-2"
        ? [{ id: "normal", name: "Normal", icon: "" }]
        : [
            { id: "normal", name: "Normal", icon: "" },
            { id: "high", name: "High", icon: "" },
          ],
    transitionOptions: async (key) => ({
      statuses: key === "AA-2" ? ["대기"] : ["대기", "완료"],
    }),
    assigneeOptions: async (key) =>
      key === "AA-2"
        ? [{ id: "user-a", name: "A", avatar: "" }]
        : [
            { id: "user-a", name: "A", avatar: "" },
            { id: "user-b", name: "B", avatar: "" },
          ],
  };
  return { bulk: createBulkService(service, now), service, issues, writes };
}
test("일괄 선택지는 실제 이슈의 공통 전환·담당자만 제공한다", async () => {
  const { bulk } = setup();
  assert.deepEqual((await bulk.options(["AA-1", "AA-2"], "status")).statuses, [
    "대기",
  ]);
  assert.deepEqual(
    (await bulk.options(["AA-1", "AA-2"], "assignee")).users.map(
      (user) => user.id,
    ),
    ["user-a"],
  );
});
test("부분 실패·중복 선택을 구분하고 성공만 되돌리며 이후 변경은 덮어쓰지 않는다", async () => {
  const { bulk, issues, writes } = setup();
  const changed = await bulk.apply(
    ["AA-1", "AA-1", "AA-2", "AA-3"],
    "dueDate",
    "2026-10-03",
  );
  assert.equal(changed.issues.length, 2);
  assert.equal(changed.failures.length, 1);
  assert.equal(writes.length, 2);
  const issue = issues.get("AA-3");
  if (issue) issue.dueDate = "2026-10-04";
  const undone = await bulk.undo(changed.undoToken);
  assert.equal(undone.issues.length, 1);
  assert.equal(undone.failures.length, 1);
  assert.equal(issues.get("AA-1")?.dueDate, "");
  assert.equal(issues.get("AA-3")?.dueDate, "2026-10-04");
  await assert.rejects(bulk.undo(changed.undoToken));
});
test("쓰기 뒤 재조회 실패도 성공과 경고로 보존하고 되돌릴 수 있다", async () => {
  const { service, issues } = setup();
  let reads = 0;
  const detail = service.detail;
  service.detail = async (key) => {
    if (++reads === 2) throw new Error("후속 조회 실패");
    return detail(key);
  };
  const bulk = createBulkService(service);
  const result = await bulk.apply(["AA-1"], "status", "완료");
  assert.equal(result.issues.length, 1);
  assert.equal(result.failures.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.equal((await bulk.undo(result.undoToken)).issues.length, 1);
  assert.equal(issues.get("AA-1")?.status, "대기");
});
test("변경 없는 요청은 저장하지 않고 되돌리기는 10분 뒤 만료된다", async () => {
  let time = 0;
  const { bulk, writes } = setup(() => time);
  assert.equal((await bulk.apply(["AA-1"], "status", "대기")).undoToken, "");
  assert.equal(writes.length, 0);
  const result = await bulk.apply(["AA-1"], "status", "완료");
  time = 600000;
  await assert.rejects(bulk.undo(result.undoToken));
});
test("선택 수·필드·부모 상호 연결은 변경 요청 전에 검증한다", async () => {
  const { bulk, writes } = setup();
  await assert.rejects(bulk.apply([], "status", "완료"));
  await assert.rejects(
    bulk.apply(
      Array.from({ length: 51 }, (_, n) => `AA-${n}`),
      "status",
      "완료",
    ),
  );
  await assert.rejects(bulk.apply(["AA-1"], "summary", "제목"));
  await assert.rejects(bulk.apply(["AA-1", "AA-3"], "parent", "AA-3"));
  assert.equal(writes.length, 0);
});

test("일괄 우선순위는 공통 선택지를 사용하고 ID를 보존해 되돌린다", async () => {
  const { bulk, issues } = setup();
  const issue = issues.get("AA-1");
  assert(issue);
  issue.priorityId = "normal";
  assert.deepEqual(
    (await bulk.options(["AA-1", "AA-2"], "priority")).priorities.map(
      (p) => p.id,
    ),
    ["normal"],
  );
  const changed = await bulk.apply(["AA-1"], "priority", "high");
  assert.equal(changed.issues[0]?.priorityId, "high");
  await bulk.undo(changed.undoToken);
  assert.equal(issues.get("AA-1")?.priorityId, "normal");
});
