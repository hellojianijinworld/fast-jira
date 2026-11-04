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
/** 로컬 작업과 연결 도구의 추가 승인은 기존 확인 UI로 전달하고 영구 권한은 부여하지 않는다. */
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
  if (method === "item/permissions/requestApproval") {
    if (!isRecord(params.permissions))
      return { permissions: {}, scope: "turn" };
    const permissions = structuredClone(params.permissions);
    const answer = await confirm({
      title: "이 작업에 필요한 접근을 허용할까요?",
      description: `${description}\n표시된 접근 권한은 이번 요청이 끝나면 만료돼요.`,
      details,
      fields: [],
    });
    return { permissions: answer.approved ? permissions : {}, scope: "turn" };
  }
  if (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval"
  ) {
    const answer = await confirm({
      title:
        method === "item/commandExecution/requestApproval"
          ? "이 명령을 실행할까요?"
          : "이 파일 변경을 적용할까요?",
      description: `${description}\n표시된 작업만 승인해요. 이후 작업의 자동 승인 규칙은 추가하지 않아요.`,
      details,
      fields: [],
    });
    return { decision: answer.approved ? "accept" : "decline" };
  }
  if (
    method === "item/tool/requestUserInput" ||
    method === "tool/requestUserInput"
  ) {
    const questions = Array.isArray(params.questions)
      ? params.questions.map(record)
      : [];
    const answers: Record<string, { answers: string[] }> = {};
    for (const [index, question] of questions.entries()) {
      const key = String(question.id);
      const result = await confirm({
        title: String(question.question),
        description:
          questions.length > 1 ? `${index + 1}/${questions.length}` : "",
        details: "",
        fields: [
          {
            key,
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
          },
        ],
      });
      answers[key] = {
        answers: result.approved ? [String(result.values[key] ?? "")] : [],
      };
      if (!result.approved) {
        for (const remaining of questions.slice(index + 1))
          answers[String(remaining.id)] = { answers: [] };
        break;
      }
    }
    return { answers };
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
    const metadata = isRecord(params._meta) ? params._meta : {};
    const question =
      confirmation && isRecord(metadata["fast-jira/question"])
        ? metadata["fast-jira/question"]
        : {};
    const answer = await confirm({
      title:
        typeof question.title === "string"
          ? question.title
          : `${String(params.serverName ?? "연결 도구")} 실행 확인`,
      description:
        typeof question.description === "string"
          ? question.description
          : description,
      details:
        typeof question.details === "string" ? question.details : details,
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
  return { decision: "decline" };
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
