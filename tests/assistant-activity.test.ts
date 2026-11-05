import assert from "node:assert/strict";
import test from "node:test";
import { toolActivity } from "../src/domain/assistant-activity.ts";

test("이슈 조회 기록은 실제 제목·상태만 요약하고 본문과 비밀값은 남기지 않는다", () => {
  const event = toolActivity(
    "jira_issue",
    { key: "AA-1", token: "secret" },
    {
      key: "AA-1",
      summary: "조회 경합 수정",
      status: "개발 중",
      description: "private body",
    },
  );
  assert.equal(event.text, "이슈 확인 · 완료");
  assert.match(event.details ?? "", /AA-1 · 조회 경합 수정 · 개발 중/);
  assert.doesNotMatch(JSON.stringify(event), /secret|private body/);
});
test("검색 조건·실제 반환 개수와 다음 페이지를 구분한다", () => {
  const event = toolActivity(
    "jira_search",
    { projects: ["AA"], parent: "AA-1", query: "경합" },
    {
      issues: [{ key: "AA-2" }, { key: "AA-3" }],
      nextPageToken: "secret-cursor",
    },
  );
  assert.match(event.details ?? "", /AA · AA-1 하위 · “경합”/);
  assert.match(event.details ?? "", /2건 확인 · 다음 결과 있음/);
  assert.doesNotMatch(JSON.stringify(event), /secret-cursor/);
});
test("실패는 성공 건수로 보고하지 않고 알 수 없는 도구의 인자를 노출하지 않는다", () => {
  assert.equal(
    toolActivity("jira_search", {}, { issues: [] }, true).text,
    "이슈 검색 · 실패",
  );
  const unknown = toolActivity(
    "mcp__slack__search",
    { token: "secret" },
    { content: "private" },
  );
  assert.equal(unknown.text, "Slack 조회 · 완료");
  assert.doesNotMatch(JSON.stringify(unknown), /secret|private/);
});

test("MCP의 구조화 결과도 동일한 대상 요약을 사용한다", () => {
  const event = toolActivity("jira_issue", '{"key":"AA-1"}', {
    structuredContent: { key: "AA-1", summary: "상태 동기화", status: "완료" },
    content: [{ text: "private body" }],
  });
  assert.equal(event.details, "AA-1 · 상태 동기화 · 완료");
  assert.doesNotMatch(JSON.stringify(event), /private body/);
});
