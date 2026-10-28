import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeExecutions,
  executionReport,
} from "../src/domain/assistant-execution.ts";

test("실행 결과는 생성·적용·건너뛰기·만료·부분 실패를 실제 영수증으로 구분한다", () => {
  const report = executionReport(
    [
      {
        tool: "jira_create_issue",
        label: "이슈 생성 · [창체] 프롬프트 반영",
        status: "applied",
        keys: ["AA-99"],
      },
      {
        tool: "jira_edit_issue",
        label: "제목 수정 · AA-1",
        status: "notApproved",
        keys: ["AA-1"],
        reason: "feedback",
      },
      {
        tool: "jira_update_issues",
        label: "상태 변경",
        status: "partiallyApplied",
        keys: ["AA-2"],
        error: "AA-3: 권한 없음",
      },
      {
        tool: "jira_create_issue",
        label: "승인 시간이 지난 생성",
        status: "notApproved",
        keys: [],
        reason: "expired",
      },
    ],
    "fixture.atlassian.net",
  );
  assert.match(report, /완료.*프롬프트 반영/);
  assert.match(report, /https:\/\/fixture.atlassian.net\/browse\/AA-99/);
  assert.match(report, /의견.*실행하지/);
  assert.match(report, /일부[\s\S]*권한 없음/);
  assert.match(report, /승인 시간이/);
  assert.doesNotMatch(report, /승인.*기다리/);
  assert.equal(executionReport([], "fixture.atlassian.net"), "");
});

test("확인되지 않은 실행 상태와 잘못된 이슈 링크는 실행 결과로 받아들이지 않는다", () => {
  const valid = {
    tool: "jira_create_issue",
    label: "새 작업",
    status: "applied",
    keys: ["AA-1"],
  };
  assert.equal(decodeExecutions([valid])[0]?.status, "applied");
  for (const item of [
    { ...valid, status: "pending" },
    { ...valid, keys: ["javascript:evil"] },
    { ...valid, reason: "approved_by_model" },
  ])
    assert.throws(() => decodeExecutions([item]));
});
