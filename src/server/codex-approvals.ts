import {
  type ApprovalHandler,
  approvalFields,
} from "../domain/assistant-approval.ts";
import { isRecord, record } from "../domain/validation.ts";
import type { CodexClient } from "./codex-client.ts";

export const codexApprovalMethods = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "mcpServer/elicitation/request",
  "item/tool/requestUserInput",
  "tool/requestUserInput",
]);
/** 프로토콜의 이번 실행/턴 승인만 사용한다. 세션·정책 변경 승인은 생성하지 않는다. */
export async function answerCodexApproval(
  method: string,
  params: Record<string, unknown>,
  ask: ApprovalHandler,
  item?: unknown,
  onFeedback?: (text: string) => void,
): Promise<unknown> {
  const confirm: ApprovalHandler = async (request) => {
    const answer = await ask(request);
    const ownConfirmation =
      method === "mcpServer/elicitation/request" &&
      isRecord(params._meta) &&
      params._meta["fast-jira/confirmation"] === true;
    if (
      !ownConfirmation &&
      typeof answer.values.feedback === "string" &&
      answer.values.feedback.trim()
    )
      onFeedback?.(answer.values.feedback.trim());
    return answer;
  };
  const description =
    typeof params.reason === "string"
      ? params.reason
      : typeof params.message === "string"
        ? params.message
        : "실행할 대상과 내용을 확인하세요. 승인 전에는 이 작업을 진행하지 않습니다.";
  const details = JSON.stringify(
    Object.fromEntries(
      Object.entries({ ...params, ...(item ? { change: item } : {}) }).filter(
        ([key]) =>
          !["_meta", "threadId", "turnId", "itemId", "challenge"].includes(key),
      ),
    ),
    null,
    2,
  );
  if (
    method === "item/tool/requestUserInput" ||
    method === "tool/requestUserInput"
  ) {
    const questions = Array.isArray(params.questions)
      ? params.questions.map(record)
      : [];
    const result = await confirm({
      title: "AI가 추가 확인을 요청했어요",
      description,
      details: "",
      fields: questions.map((question) => ({
        key: String(question.id),
        label: String(question.question),
        type: "text",
        required: true,
        ...(Array.isArray(question.options)
          ? {
              options: question.options
                .map(record)
                .map((option) => String(option.label)),
            }
          : {}),
      })),
    });
    return {
      answers: Object.fromEntries(
        questions.map((question) => [
          String(question.id),
          {
            answers: result.approved
              ? [String(result.values[String(question.id)] ?? "")]
              : [],
          },
        ]),
      ),
    };
  }
  if (method === "mcpServer/elicitation/request") {
    if (params.mode === "openai/userVerification") {
      throw new Error(
        "연결 서비스가 추가 인증을 요청했어요. Codex에서 인증을 완료한 뒤 다시 시도해 주세요.",
      );
    }
    const confirmation =
      isRecord(params._meta) && params._meta["fast-jira/confirmation"] === true;
    const fields = approvalFields(params.requestedSchema);
    const answer = await confirm({
      title: `${String(params.serverName ?? "연결 도구")} 실행 확인`,
      description,
      details,
      fields,
      ...(params.mode === "url" && typeof params.url === "string"
        ? { url: params.url }
        : {}),
    });
    const feedbackOnly =
      confirmation &&
      !answer.approved &&
      typeof answer.values.feedback === "string" &&
      answer.values.feedback.trim().length > 0;
    return {
      action: answer.approved || feedbackOnly ? "accept" : "decline",
      content: answer.approved
        ? answer.values
        : feedbackOnly
          ? { feedback: answer.values.feedback }
          : null,
      _meta: answer.reason
        ? { "fast-jira/approval-reason": answer.reason }
        : null,
    };
  }
  const answer = await confirm({
    title: method.includes("fileChange")
      ? "파일 변경 확인"
      : method.includes("permissions")
        ? "추가 접근 권한 확인"
        : "명령 실행 확인",
    description,
    details,
    fields: [],
  });
  if (method === "item/permissions/requestApproval")
    return {
      permissions: answer.approved ? (params.permissions ?? {}) : {},
      scope: "turn",
    };
  if (
    answer.approved &&
    Array.isArray(params.availableDecisions) &&
    !params.availableDecisions.includes("accept")
  )
    return { decision: "decline" };
  return { decision: answer.approved ? "accept" : "decline" };
}
/** 연결을 비활성화하지 않고, 읽기 전용이 아닌 도구의 실행을 사용자 승인으로 보낸다. */
export async function codexToolApprovals(native: CodexClient) {
  // 점 경로만 덮어써 기존 서버의 command·url·인증·활성화 설정을 보존한다.
  const config: Record<string, string> = {
    "apps._default.default_tools_approval_mode": "writes",
    "apps._default.approvals_reviewer": "user",
  };
  const configure = (prefix: string, names: string[]) => {
    config[`${prefix}.default_tools_approval_mode`] = "writes";
    for (const name of names)
      config[`${prefix}.tools.${name}.approval_mode`] = "writes";
  };
  const settings = record(
    record(await native.request("config/read", { includeLayers: false }))
      .config,
  );
  const configured = record(settings.mcp_servers);
  let cursor: string | null = null;
  do {
    const page = record(
      await native.request("mcpServerStatus/list", {
        cursor,
        limit: 100,
        detail: "toolsAndAuthOnly",
      }),
    );
    for (const item of Array.isArray(page.data) ? page.data : []) {
      const server = record(item);
      if (
        typeof server.name === "string" &&
        Object.hasOwn(configured, server.name)
      )
        configure(
          `mcp_servers.${server.name}`,
          Object.keys(isRecord(server.tools) ? server.tools : {}),
        );
    }
    cursor = typeof page.nextCursor === "string" ? page.nextCursor : null;
  } while (cursor);
  const installed = record(
    await native.request("app/installed", { forceRefresh: false }),
  );
  const ids = (Array.isArray(installed.apps) ? installed.apps : [])
    .filter(isRecord)
    .flatMap((app) => (typeof app.id === "string" ? [app.id] : []));
  for (let offset = 0; offset < ids.length; offset += 100) {
    const catalog = record(
      await native.request("app/read", {
        appIds: ids.slice(offset, offset + 100),
        includeTools: true,
      }),
    );
    for (const item of Array.isArray(catalog.apps) ? catalog.apps : []) {
      const app = record(item);
      if (typeof app.id !== "string") continue;
      const prefix = `apps.${app.id}`;
      config[`${prefix}.approvals_reviewer`] = "user";
      configure(
        prefix,
        (Array.isArray(app.toolSummaries) ? app.toolSummaries : [])
          .filter(isRecord)
          .flatMap((tool) =>
            typeof tool.name === "string" ? [tool.name] : [],
          ),
      );
    }
  }
  return config;
}
