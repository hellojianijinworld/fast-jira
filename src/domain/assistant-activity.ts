import type { ChatMessage } from "./conversation.ts";
import { isRecord } from "./validation.ts";

const labels: Record<string, string> = {
  jira_catalog: "프로젝트 설정 확인",
  jira_search: "이슈 검색",
  jira_issue: "이슈 확인",
  jira_members: "작업참여자 확인",
  jira_options: "변경 가능한 값 확인",
  jira_creation_options: "이슈 생성 조건 확인",
  jira_prepare_issue: "이슈 생성안 준비",
  jira_propose_change: "변경안 준비",
  jira_create_issue: "이슈 생성 요청 처리",
  jira_apply_changes: "일괄 변경 요청 처리",
  jira_update_issues: "이슈 변경 요청 처리",
  jira_edit_issue: "이슈 수정 요청 처리",
  jira_description: "본문 수정 요청 처리",
  jira_comment: "댓글 요청 처리",
  jira_undo: "되돌리기 요청 처리",
};
function short(value: unknown) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, 180)
    : "";
}
function inputRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return isRecord(parsed) ? parsed : {};
    } catch {
      /* 연결 도구의 불완전한 인자는 기록하지 않는다. */
    }
  }
  return {};
}
/** 작업 기록에는 대상·검색 조건·개수만 남기고 원본 인자나 응답은 저장하지 않는다. */
export function toolActivity(
  name: string,
  args: unknown,
  result?: unknown,
  failed = false,
): ChatMessage {
  const input = inputRecord(args),
    output = isRecord(result)
      ? isRecord(result.structuredContent)
        ? result.structuredContent
        : result
      : {};
  const label =
    labels[name] ??
    (/slack/i.test(name)
      ? `Slack ${/search|get|fetch|read/i.test(name) ? "조회" : "작업"}`
      : /notion/i.test(name)
        ? `Notion ${/search|get|fetch|read/i.test(name) ? "조회" : "작업"}`
        : "연결 도구 실행");
  const details: string[] = [];
  if (labels[name]) {
    const projects = Array.isArray(input.projects)
      ? input.projects
          .filter((x) => typeof x === "string")
          .slice(0, 5)
          .map(short)
          .join(", ")
      : "";
    const key = short(output.key) || short(input.key);
    const keys = Array.isArray(input.keys)
      ? input.keys
          .filter((x) => typeof x === "string")
          .slice(0, 5)
          .map(short)
          .join(", ")
      : "";
    const parent = short(input.parent);
    const query = short(input.query);
    const scope =
      input.scope === "assigned"
        ? "내 담당 작업"
        : input.scope === "related"
          ? "내 관련 작업"
          : "";
    const target = [
      projects,
      parent && `${parent} 하위`,
      query && `“${query}”`,
      scope,
      input.excludeDone === true && "완료 제외",
    ]
      .filter(Boolean)
      .join(" · ");
    if (name === "jira_search") {
      if (target) details.push(target);
      if (!failed && Array.isArray(output.issues))
        details.push(
          `${output.issues.length}건 확인${output.nextPageToken ? " · 다음 결과 있음" : ""}`,
        );
    } else {
      const issue = [key || keys, short(output.summary), short(output.status)]
        .filter(Boolean)
        .join(" · ");
      if (issue) details.push(issue);
      else if (target) details.push(target);
    }
  }
  return {
    role: "event",
    text: `${label} · ${failed ? "실패" : "완료"}`,
    ...(details.length ? { details: details.join("\n") } : {}),
    created: Date.now(),
  };
}
