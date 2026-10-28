import { randomUUID } from "node:crypto";
import { decodeAdfDocument } from "../domain/adf.ts";
import { adfMarkdown } from "../domain/adf-markdown.ts";
import type { ApprovalHandler } from "../domain/assistant-approval.ts";
import type { AssistantExecution } from "../domain/assistant-execution.ts";
import { isRecord, record } from "../domain/validation.ts";
import type { ToolService } from "./mcp-server.ts";

export function changedJiraKeys(
  name: string,
  args: unknown,
  result: unknown,
): string[] {
  if (!Object.hasOwn(labels, name)) return [];
  const input = isRecord(args) ? args : {},
    output = isRecord(result) ? result : {};
  return [
    ...new Set(
      [
        ...(Array.isArray(output.failures) ? [] : [input.key]),
        ...(Array.isArray(output.failures)
          ? []
          : Array.isArray(input.keys)
            ? input.keys
            : []),
        output.key,
        ...(Array.isArray(output.issues)
          ? output.issues.filter(isRecord).map((issue) => issue.key)
          : []),
      ].filter(
        (key): key is string =>
          typeof key === "string" && /^[A-Z][A-Z0-9_]*-\d+$/.test(key),
      ),
    ),
  ];
}
const labels: Record<string, string> = {
  jira_create_issue: "이슈 생성",
  jira_edit_issue: "필드 수정",
  jira_description: "본문 수정",
  jira_update_issues: "필드 일괄 수정",
  jira_comment: "댓글 작성·수정",
  jira_undo: "변경 되돌리기",
};
/** 원본 요청을 고정한 뒤 선택된 작업만 실행한다. 의견은 실행 인자가 아닌 모델 피드백이다. */
export async function callApprovedJiraTool(
  tools: ToolService,
  name: string,
  args: unknown,
  ask: ApprovalHandler,
) {
  const definition = tools.definitions.find((tool) => tool.name === name);
  if (!definition) throw new Error("지원하지 않는 도구입니다.");
  if (definition.annotations.readOnlyHint) return tools.call(name, args);
  const frozen = JSON.parse(JSON.stringify(args ?? {}));
  const input = record(frozen);
  const supplied =
    name === "jira_apply_changes"
      ? input.actions
      : [{ tool: name, arguments: input }];
  if (!Array.isArray(supplied) || !supplied.length || supplied.length > 50)
    throw new Error("변경 작업을 1~50개 지정하세요.");
  const actions = supplied.flatMap((value) => {
    const action = record(value),
      tool = String(action.tool),
      data = record(action.arguments);
    if (
      tool === "jira_apply_changes" ||
      !tools.definitions.some(
        (item) => item.name === tool && !item.annotations.readOnlyHint,
      )
    )
      throw new Error("지원하는 변경 도구만 지정하세요.");
    if (
      tool === "jira_update_issues" &&
      (!Array.isArray(data.keys) ||
        !data.keys.length ||
        data.keys.length > 50 ||
        data.keys.some((key) => typeof key !== "string"))
    )
      throw new Error("이슈 키를 1~50개 지정하세요.");
    return [
      {
        tool,
        arguments:
          tool === "jira_create_issue"
            ? { ...data, requestId: data.requestId ?? randomUUID() }
            : data,
      },
    ];
  });
  if (actions.length > 50)
    throw new Error("확인할 작업이 50개를 넘어요. 요청을 나눠 주세요.");
  const previews = actions.map((action) => {
    const data = action.arguments as Record<string, unknown>;
    const preview = record(
      tools.describeChange ? tools.describeChange(action.tool, data) : data,
    );
    const readable = { ...preview };
    delete readable.requestId;
    for (const key of ["document", "description"])
      if (readable[key]) {
        try {
          readable[key] = adfMarkdown(decodeAdfDocument(readable[key]));
        } catch {
          /* 원문 형식을 유지한다. */
        }
      }
    if (readable.fields) {
      readable.fields = { ...record(readable.fields) };
      const fields = record(readable.fields);
      if (fields.description) {
        try {
          fields.description = adfMarkdown(
            decodeAdfDocument(fields.description),
          );
        } catch {
          /* 검증은 생성 서비스가 담당한다. */
        }
      }
    }
    const target =
      data.key ??
      (Array.isArray(data.keys)
        ? data.keys.join(", ")
        : (data.project ?? "Jira"));
    if (readable.fields) {
      Object.assign(readable, record(readable.fields));
      delete readable.fields;
    }
    const fieldNames: Record<string, string> = {
      project: "프로젝트",
      type: "이슈 유형 ID",
      parent: "상위 이슈",
      summary: "제목",
      description: "본문",
      document: "본문",
      key: "이슈",
      keys: "이슈",
      field: "변경 필드",
      value: "변경할 값",
      expected: "현재 값",
      text: "댓글 내용",
      action: "동작",
    };
    return {
      label: `${String(target)} · ${labels[action.tool] ?? action.tool}`,
      description: Object.entries(readable)
        .map(
          ([key, value]) =>
            `${fieldNames[key] ?? key}\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`,
        )
        .join("\n\n"),
    };
  });
  if (JSON.stringify(previews).length > 100000)
    throw new Error("확인할 변경 내용이 너무 길어요. 요청을 나눠 주세요.");
  const results: Record<string, unknown>[] = [];
  const execution: AssistantExecution[] = [];
  function recordResult(result: Record<string, unknown>) {
    results.push(result);
    const index = Number(result.index),
      action = actions[index];
    if (!action) return;
    const input = action.arguments as Record<string, unknown>;
    const summary = isRecord(input.fields) ? input.fields.summary : undefined;
    const output = isRecord(result.result) ? result.result : {};
    const failures = Array.isArray(output.failures)
      ? output.failures.filter(isRecord)
      : [];
    const keys =
      result.status === "applied" || result.status === "partiallyApplied"
        ? changedJiraKeys(action.tool, action.arguments, result.result)
        : [input.key, ...(Array.isArray(input.keys) ? input.keys : [])].filter(
            (key): key is string =>
              typeof key === "string" && /^[A-Z][A-Z0-9_]*-\d+$/.test(key),
          );
    const error =
      typeof result.error === "string"
        ? result.error
        : failures
            .map(
              (item) =>
                `${String(item.key ?? "이슈")}: ${String(item.error ?? "실행 실패")}`,
            )
            .join("; ");
    const entry: AssistantExecution = {
      tool: action.tool,
      label: `${labels[action.tool] ?? action.tool}${typeof summary === "string" ? ` · ${summary}` : ""}`,
      status: result.status as AssistantExecution["status"],
      keys,
      ...(typeof input.requestId === "string"
        ? { requestId: input.requestId }
        : {}),
      ...(result.reason
        ? { reason: result.reason as AssistantExecution["reason"] & string }
        : {}),
      ...(error ? { error } : {}),
    };
    execution.push(entry);
    tools.onResult?.(entry);
  }
  const changedKeys = new Set<string>();
  let feedback = "";
  for (const [index, action] of actions.entries()) {
    const input = action.arguments as Record<string, unknown>;
    const receipt =
      typeof input.requestId === "string" ? { requestId: input.requestId } : {};
    if (feedback) {
      recordResult({
        index,
        tool: action.tool,
        ...receipt,
        status: "notApproved",
        reason: "paused",
      });
      continue;
    }
    const preview = previews[index];
    const answer = await ask({
      title:
        actions.length > 1
          ? `이 작업을 진행할까요? (${index + 1}/${actions.length})`
          : "이 작업을 진행할까요?",
      description: preview?.label ?? "요청한 변경",
      details: preview?.description ?? "",
      fields: [
        { key: "feedback", label: "기타 의견", type: "text", required: false },
      ],
    });
    feedback =
      typeof answer.values.feedback === "string"
        ? answer.values.feedback.trim()
        : "";
    if (!answer.approved || feedback) {
      recordResult({
        index,
        tool: action.tool,
        ...receipt,
        status: "notApproved",
        ...(feedback
          ? { reason: "feedback" }
          : answer.reason
            ? { reason: answer.reason }
            : {}),
      });
      continue;
    }
    try {
      const result = await tools.call(action.tool, action.arguments);
      for (const key of changedJiraKeys(action.tool, action.arguments, result))
        changedKeys.add(key);
      const partial =
        isRecord(result) &&
        Array.isArray(result.failures) &&
        result.failures.length > 0;
      recordResult({
        index,
        tool: action.tool,
        ...receipt,
        status: partial
          ? isRecord(result) &&
            Array.isArray(result.issues) &&
            result.issues.length
            ? "partiallyApplied"
            : "failed"
          : "applied",
        result,
      });
    } catch (error) {
      recordResult({
        index,
        tool: action.tool,
        ...receipt,
        status: "failed",
        error: error instanceof Error ? error.message : "실행하지 못했어요.",
      });
    }
  }
  return {
    results,
    execution,
    changedKeys: [...changedKeys],
    feedback,
    notice:
      "이 요청의 승인 대기는 끝났습니다. results의 applied·partiallyApplied·notApproved·failed를 구분해 보고하세요. 승인되지 않은 작업은 실행하지 않았습니다. 새 사용자 요청이나 의견으로 작업을 수정하면 해당 작업만 도구로 다시 제출해 새 UI 승인을 받으세요. 생성 재시도는 반환된 requestId로 확인하세요.",
  };
}

/** 본문·필드 값·자격 증명 없이 연결이 끊긴 작업도 요청별로 추적한다. */
export function traceExecution(
  requestId: string | undefined,
  result: AssistantExecution,
) {
  const { tool, status, keys, reason } = result;
  console.info(
    "Fast Jira AI execution",
    JSON.stringify({ requestId, tool, status, keys, reason }),
  );
}
