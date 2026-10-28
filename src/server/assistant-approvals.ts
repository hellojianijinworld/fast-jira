import { randomBytes, randomUUID } from "node:crypto";
import type { JsonValue } from "../domain/adf.ts";
import {
  type ApprovalDecision,
  type ApprovalHandler,
  type AssistantApproval,
  approvalRunId,
} from "../domain/assistant-approval.ts";
import { isRecord, record } from "../domain/validation.ts";
import { JiraError } from "./jira-client.ts";

/** 승인 토큰은 모델 입력·도구에 전달하지 않고 요청한 브라우저와 서버 사이에만 보관한다. */
export function createAssistantApprovals() {
  const runs = new Map<
    string,
    Map<
      string,
      { request: AssistantApproval; finish: (answer: ApprovalDecision) => void }
    >
  >();
  function runId(value: unknown) {
    try {
      return approvalRunId(value);
    } catch {
      throw new JiraError("AI 요청 식별자를 확인하세요.", 400);
    }
  }
  function open(value?: unknown) {
    const id =
      value === undefined ? randomBytes(16).toString("hex") : runId(value);
    if (runs.has(id)) throw new JiraError("이미 진행 중인 AI 요청입니다.", 409);
    const pending = new Map<
      string,
      { request: AssistantApproval; finish: (answer: ApprovalDecision) => void }
    >();
    runs.set(id, pending);
    let closed = false;
    const ask: ApprovalHandler = (request) => {
      if (closed) return Promise.resolve({ approved: false, values: {} });
      return new Promise((resolve) => {
        const approval = {
          ...request,
          fields: request.fields.some((field) => field.key === "feedback")
            ? request.fields
            : [
                ...request.fields,
                {
                  key: "feedback",
                  label: "기타 의견",
                  type: "text" as const,
                  required: false,
                },
              ],
          id: randomUUID(),
        };
        const timer = setTimeout(
          () => finish({ approved: false, values: {} }),
          5 * 60_000,
        );
        function finish(answer: ApprovalDecision) {
          clearTimeout(timer);
          pending.delete(approval.id);
          resolve(answer);
        }
        pending.set(approval.id, { request: approval, finish });
      });
    };
    return {
      id,
      ask,
      close() {
        closed = true;
        for (const item of pending.values())
          item.finish({ approved: false, values: {} });
        runs.delete(id);
      },
    };
  }
  return {
    open,
    pending(value: unknown) {
      const id = runId(value);
      return [...(runs.get(id)?.values() ?? [])].map((item) => item.request);
    },
    respond(value: unknown) {
      const data = record(value),
        id = runId(data.requestId);
      const item =
        typeof data.id === "string" ? runs.get(id)?.get(data.id) : undefined;
      if (!item)
        throw new JiraError(
          "승인 요청이 종료됐어요. 현재 요청을 다시 확인하세요.",
          409,
        );
      if (typeof data.approved !== "boolean" || !isRecord(data.values))
        throw new JiraError("승인 응답을 확인하세요.", 400);
      const values: Record<string, JsonValue> = Object.create(null);
      for (const field of item.request.fields) {
        if (!data.approved && field.key !== "feedback") continue;
        const input = data.values[field.key];
        if (input === undefined) {
          if (field.required)
            throw new JiraError(`${field.label} 값을 입력하세요.`, 400);
          continue;
        }
        if (
          (field.type === "text" &&
            (typeof input !== "string" || (field.required && !input.trim()))) ||
          (field.type === "boolean" && typeof input !== "boolean") ||
          (field.type === "number" &&
            (typeof input !== "number" || !Number.isFinite(input))) ||
          (field.options && !field.options.includes(String(input)))
        )
          throw new JiraError(`${field.label} 값을 확인하세요.`, 400);
        values[field.key] = input as JsonValue;
      }
      if (typeof values.feedback === "string" && values.feedback.length > 4000)
        throw new JiraError("의견은 4,000자 이내로 입력하세요.", 400);
      item.finish({
        approved:
          data.approved &&
          !(typeof values.feedback === "string" && values.feedback.trim()),
        values,
      });
    },
    dispose() {
      for (const pending of runs.values())
        for (const item of pending.values())
          item.finish({ approved: false, values: {} });
      runs.clear();
    },
  };
}
