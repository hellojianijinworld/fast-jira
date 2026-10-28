import { randomUUID } from "node:crypto";
import type { ChangeProposal } from "../domain/agent.ts";
import { agentIssueKeys, changeProposal } from "../domain/agent.ts";
import {
  type AssistantReply,
  type AssistantStatus,
  assistantContext,
} from "../domain/assistant.ts";
import {
  type AssistantExecution,
  decodeExecutions,
} from "../domain/assistant-execution.ts";
import { isChatMessage } from "../domain/conversation.ts";
import { type IssueDraft, issueDraft } from "../domain/create-issue.ts";
import { isRecord, record } from "../domain/validation.ts";
import { createAssistantApprovals } from "./assistant-approvals.ts";
import {
  assistantHistoryNotice,
  assistantInstructions as instructions,
} from "./assistant-instructions.ts";
import {
  type ClaudeAssistant,
  createClaudeAssistant,
} from "./claude-assistant.ts";
import {
  answerCodexApproval,
  codexApprovalMethods,
  codexToolApprovals,
} from "./codex-approvals.ts";
import { type CodexClient, startCodex } from "./codex-client.ts";
import { callApprovedJiraTool, traceExecution } from "./jira-approvals.ts";
import { JiraError } from "./jira-client.ts";
import { projectKeys } from "./jira-metadata.ts";
import type { JiraService } from "./jira-service.ts";
import { createJiraTools } from "./jira-tools.ts";
import { createVoiceService } from "./voice-service.ts";

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "Codex 요청에 실패했어요.";

/** AI 대화와 도구 실행을 연결한다. 내장 Jira 도구는 변경안을 준비하고 저장은 사용자가 UI에서 적용한다. */
export function createAssistantService(
  getService: () => JiraService,
  connect: () => Promise<CodexClient> = startCodex,
  claude: ClaudeAssistant = createClaudeAssistant(getService, instructions),
) {
  const voice = createVoiceService();
  const approvals = createAssistantApprovals();
  let connection: Promise<CodexClient> | undefined,
    disposed = false,
    busy = false;
  const sessions = new Map<
    string,
    {
      threadId: string;
      model: string;
      service: JiraService;
      updated: number;
      drafting: boolean;
    }
  >();
  async function client() {
    if (disposed) throw new Error("AI 연결이 종료됐어요.");
    if (!connection) {
      const pending = connect().then((value) => {
        if (disposed) {
          value.close();
          throw new Error("AI 연결이 종료됐어요.");
        }
        value.listen((message) => {
          if (message.method === "connection/closed") {
            connection = undefined;
            sessions.clear();
          }
        });
        return value;
      });
      connection = pending;
      void pending.catch(() => {
        if (connection === pending) connection = undefined;
      });
    }
    return connection;
  }
  async function codexStatus(): Promise<AssistantStatus> {
    try {
      const native = await client();
      const [account, catalog] = await Promise.all([
        native.request("account/read", { refreshToken: false }),
        native.request("model/list", { includeHidden: false }),
      ]);
      if (!isRecord(record(account).account))
        throw new Error("Codex CLI에서 codex login을 먼저 실행해 주세요.");
      const models = record(catalog).data;
      if (!Array.isArray(models))
        throw new Error("Codex 모델 목록을 읽지 못했어요.");
      return {
        ready: true,
        error: "",
        models: models.flatMap((value) => {
          const model = record(value);
          return typeof model.model === "string"
            ? [
                {
                  id: model.model,
                  name:
                    typeof model.displayName === "string"
                      ? model.displayName
                      : model.model,
                  isDefault: model.isDefault === true,
                },
              ]
            : [];
        }),
      };
    } catch (error) {
      return { ready: false, models: [], error: messageOf(error) };
    }
  }
  async function status(): Promise<AssistantStatus> {
    const [codex, other] = await Promise.all([codexStatus(), claude.status()]);
    return {
      ready: codex.ready || other.ready,
      models: [
        ...codex.models.map((model) => ({
          ...model,
          name: `Codex · ${model.name}`,
        })),
        ...other.models.map((model) => ({
          ...model,
          isDefault: !codex.ready && model.isDefault,
        })),
      ],
      error:
        codex.ready || other.ready
          ? ""
          : [codex.error, other.error].filter(Boolean).join(" · "),
      providers: [
        { id: "codex", ready: codex.ready, error: codex.error },
        { id: "claude", ready: other.ready, error: other.error },
      ],
    };
  }
  async function run(
    value: unknown,
    signal?: AbortSignal,
  ): Promise<AssistantReply> {
    const input = record(value);
    if (
      typeof input.prompt !== "string" ||
      !input.prompt.trim() ||
      input.prompt.length > 10000
    )
      throw new JiraError("요청을 1~10,000자 입력하세요.", 400);
    const history = input.history ?? [];
    if (
      !Array.isArray(history) ||
      history.length > 20 ||
      !history.every(isChatMessage) ||
      history.reduce((total, message) => total + message.text.length, 0) >
        20_000
    )
      throw new JiraError("이전 대화의 형식이나 길이를 확인하세요.", 400);
    const context = assistantContext(input.context);
    projectKeys(context.projects.join(","));
    if (context.issue) agentIssueKeys([context.issue], "");
    if (context.keys.length) agentIssueKeys(context.keys, "");
    if (input.model !== undefined && typeof input.model !== "string")
      throw new JiraError("모델을 확인하세요.", 400);
    if (
      input.conversationId !== undefined &&
      (typeof input.conversationId !== "string" ||
        input.conversationId.length > 100)
    )
      throw new JiraError("대화를 확인하세요.", 400);
    if (busy)
      throw new JiraError("이전 AI 요청이 끝난 뒤 다시 요청하세요.", 409);
    if (signal?.aborted) throw new JiraError("AI 요청을 취소했어요.", 499);
    const approvalScope = approvals.open(input.requestId);
    busy = true;
    try {
      const requested = typeof input.model === "string" ? input.model : "";
      const available = requested
        ? await (requested.startsWith("claude:")
            ? claude.status()
            : codexStatus())
        : await status();
      if (!available.ready) throw new Error(available.error);
      const model =
        input.model ||
        available.models.find((item) => item.isDefault)?.id ||
        available.models[0]?.id;
      if (
        typeof model !== "string" ||
        !available.models.some((item) => item.id === model)
      )
        throw new JiraError("사용 가능한 AI 모델을 선택하세요.", 400);
      if (model.startsWith("claude:"))
        return await claude.run(
          {
            prompt: input.prompt,
            model,
            context,
            history,
            requestId: approvalScope.id,
            ...(typeof input.conversationId === "string"
              ? { conversationId: input.conversationId }
              : {}),
          },
          signal,
          approvalScope.ask,
        );
      const native = await client(),
        service = getService(),
        tools = createJiraTools(service, { allowMutations: !context.creation });
      const execution: AssistantExecution[] = [];
      function recordExecution(result: AssistantExecution) {
        execution.push(result);
        traceExecution(approvalScope.id, result);
      }
      for (const [id, session] of sessions)
        if (Date.now() - session.updated > 30 * 60_000) {
          sessions.delete(id);
          void native
            .request("thread/unsubscribe", { threadId: session.threadId })
            .catch(() => {});
        }
      const previous =
        typeof input.conversationId === "string"
          ? sessions.get(input.conversationId)
          : undefined;
      let session =
        previous?.model === model &&
        previous.service === service &&
        previous.drafting === Boolean(context.creation)
          ? previous
          : undefined;
      const conversationId = session
        ? String(input.conversationId)
        : randomUUID();
      const reconnected = !session && history.length > 0;
      if (!session) {
        const toolApprovals = await codexToolApprovals(native);
        const started = record(
          await native.request("thread/start", {
            model,
            ephemeral: false,
            sandbox: "read-only",
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            config: toolApprovals,
            developerInstructions: instructions,
            dynamicTools: tools.definitions.map(
              ({ name, description, inputSchema }) => ({
                type: "function",
                name,
                description,
                inputSchema,
              }),
            ),
          }),
        );
        const threadId = record(started.thread).id;
        if (typeof threadId !== "string")
          throw new Error("Codex 대화를 시작하지 못했어요.");
        session = {
          threadId,
          model,
          service,
          updated: Date.now(),
          drafting: Boolean(context.creation),
        };
        if (sessions.size >= 12) {
          const oldest = sessions.entries().next().value;
          if (oldest) {
            sessions.delete(oldest[0]);
            void native
              .request("thread/unsubscribe", { threadId: oldest[1].threadId })
              .catch(() => {});
          }
        }
        sessions.set(conversationId, session);
      }
      const threadId = session.threadId;
      console.info(
        "Fast Jira AI thread",
        JSON.stringify({ requestId: approvalScope.id, threadId }),
      );
      session.updated = Date.now();
      return await new Promise<AssistantReply>((resolve, reject) => {
        let ended = false,
          turnCompleted = false,
          prematureCompletion = false,
          pendingWork = 0,
          answer = "",
          deltas = "";
        const proposals: ChangeProposal[] = [];
        const creations: IssueDraft[] = [];
        const items = new Map<string, unknown>();
        const pendingMcp = new Set<string>();
        const changedKeys = new Set<string>();
        let unlisten = () => {};
        function finish(error?: unknown) {
          if (ended) return;
          ended = true;
          clearTimeout(timer);
          unlisten();
          signal?.removeEventListener("abort", abort);
          if (error) {
            sessions.delete(conversationId);
            native.close();
            reject(error);
          } else {
            const reply = {
              conversationId,
              threadId,
              answer:
                prematureCompletion && execution.length ? "" : answer || deltas,
              execution,
              proposals,
              reconnected,
              creations,
            };
            if (!changedKeys.size) resolve(reply);
            else
              void service
                .issuesByKeys([...changedKeys])
                .then((issues) => resolve({ ...reply, issues }))
                .catch(() => resolve(reply));
          }
        }
        function track(work: Promise<unknown>) {
          pendingWork++;
          void work.catch(finish).finally(() => {
            pendingWork--;
            if (turnCompleted && pendingWork === 0 && pendingMcp.size === 0)
              finish();
          });
        }
        const abort = () => finish(new Error("AI 요청을 취소했어요."));
        const timer = setTimeout(
          () =>
            finish(
              new Error(
                "AI 응답 시간이 초과됐어요. 요청 범위를 줄여 다시 시도해 주세요.",
              ),
            ),
          600_000,
        );
        unlisten = native.listen((message) => {
          if (ended) return;
          try {
            if (message.method === "connection/closed") {
              finish(new Error("Codex 연결이 종료됐어요. 다시 요청해 주세요."));
              return;
            }
            const params = isRecord(message.params) ? message.params : {};
            if (params.threadId !== threadId) return;
            if (
              message.method === "item/started" &&
              isRecord(params.item) &&
              typeof params.item.id === "string"
            ) {
              items.set(params.item.id, params.item);
              if (params.item.type === "mcpToolCall")
                pendingMcp.add(params.item.id);
            }
            if (
              message.method === "item/completed" &&
              isRecord(params.item) &&
              params.item.type === "mcpToolCall"
            ) {
              const item = params.item;
              pendingMcp.delete(String(item.id));
              if (
                typeof item.tool === "string" &&
                tools.definitions.some(
                  (tool) =>
                    !tool.annotations.readOnlyHint &&
                    (item.tool === tool.name ||
                      String(item.tool).endsWith(`__${tool.name}`)),
                ) &&
                isRecord(item.result)
              ) {
                const content = Array.isArray(item.result.content)
                  ? item.result.content
                  : [];
                for (const part of content) {
                  if (!isRecord(part) || typeof part.text !== "string")
                    continue;
                  try {
                    const result = record(JSON.parse(part.text));
                    if (result.execution === undefined) continue;
                    const entries = decodeExecutions(result.execution);
                    entries.forEach(recordExecution);
                    for (const entry of entries)
                      if (
                        entry.status === "applied" ||
                        entry.status === "partiallyApplied"
                      )
                        for (const key of entry.keys) changedKeys.add(key);
                  } catch {
                    // 다른 MCP 결과를 Fast Jira의 실행 결과로 해석하지 않는다.
                  }
                }
              }
              if (turnCompleted && pendingWork === 0 && pendingMcp.size === 0)
                finish();
            }
            if (
              typeof message.method === "string" &&
              codexApprovalMethods.has(message.method) &&
              (typeof message.id === "number" || typeof message.id === "string")
            ) {
              const id = message.id;
              let feedback = "";
              track(
                answerCodexApproval(
                  message.method,
                  params,
                  approvalScope.ask,
                  items.get(String(params.itemId)),
                  (value) => {
                    feedback = value;
                  },
                ).then(async (result) => {
                  if (ended) return;
                  native.respond(id, result);
                  if (feedback) {
                    if (typeof params.turnId !== "string")
                      throw new Error(
                        "의견을 다음 메시지로 다시 입력해 주세요. 현재 연결에서 의견 전달을 지원하지 않습니다.",
                      );
                    await native.request("turn/steer", {
                      threadId,
                      expectedTurnId: params.turnId,
                      input: [
                        {
                          type: "text",
                          text: `사용자가 실행을 승인하지 않고 다음 의견을 전달했습니다. 변경은 다시 확인받으세요.\n${feedback}`,
                          text_elements: [],
                        },
                      ],
                    });
                  }
                }),
              );
              return true;
            }
            if (
              message.method === "item/tool/call" &&
              (typeof message.id === "string" || typeof message.id === "number")
            ) {
              const id = message.id;
              track(
                (async () => {
                  let result: unknown;
                  try {
                    if (getService() !== service)
                      throw new Error(
                        "Jira 연결이 바뀌었어요. 새 요청으로 시작하세요.",
                      );
                    result = await callApprovedJiraTool(
                      {
                        ...tools,
                        onResult: recordExecution,
                        call: async (name, args) => {
                          if (ended || signal?.aborted)
                            throw new Error("AI 요청이 종료됐어요.");
                          if (getService() !== service)
                            throw new Error("Jira 연결이 바뀌었어요.");
                          return tools.call(name, args);
                        },
                      },
                      String(params.tool),
                      params.arguments,
                      approvalScope.ask,
                    );
                    if (isRecord(result) && Array.isArray(result.changedKeys))
                      for (const key of result.changedKeys)
                        if (typeof key === "string") changedKeys.add(key);
                    if (params.tool === "jira_prepare_issue") {
                      if (creations.length >= 5)
                        throw new Error(
                          "생성안은 한 번에 5개까지 준비할 수 있습니다.",
                        );
                      creations.push(issueDraft(result));
                    }
                    if (params.tool === "jira_propose_change") {
                      const plan = changeProposal(result, service.site);
                      if (proposals.length >= 10)
                        throw new Error(
                          "한 요청에서 변경안은 10개까지 만들 수 있습니다.",
                        );
                      if (
                        !proposals.some(
                          (item) =>
                            JSON.stringify(item) === JSON.stringify(plan),
                        )
                      )
                        proposals.push(plan);
                    }
                    if (!ended)
                      native.respond(id, {
                        success: true,
                        contentItems: [
                          {
                            type: "inputText",
                            text: JSON.stringify(result) ?? "null",
                          },
                        ],
                      });
                  } catch (error) {
                    if (!ended)
                      native.respond(id, {
                        success: false,
                        contentItems: [
                          { type: "inputText", text: messageOf(error) },
                        ],
                      });
                  }
                })(),
              );
              return true;
            } else if (
              message.method === "item/agentMessage/delta" &&
              typeof params.delta === "string"
            )
              deltas += params.delta;
            else if (
              message.method === "item/completed" &&
              isRecord(params.item) &&
              params.item.type === "agentMessage" &&
              typeof params.item.text === "string"
            )
              answer = params.item.text;
            else if (message.method === "turn/completed") {
              const turn = record(params.turn);
              if (turn.status !== "completed")
                throw new Error(
                  isRecord(turn.error) && typeof turn.error.message === "string"
                    ? turn.error.message
                    : "Codex 요청이 완료되지 않았어요.",
                );
              if (getService() !== service)
                throw new Error(
                  "Jira 연결이 바뀌었어요. 새 요청으로 시작하세요.",
                );
              prematureCompletion = pendingWork > 0 || pendingMcp.size > 0;
              turnCompleted = true;
              if (pendingWork === 0 && pendingMcp.size === 0) finish();
            }
          } catch (error) {
            finish(error);
          }
        });
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) {
          abort();
          return;
        }
        void native
          .request("turn/start", {
            threadId,
            input: [
              {
                type: "text",
                text: JSON.stringify({
                  request: input.prompt,
                  ...(reconnected
                    ? {
                        previousConversation: history,
                        historyNotice: assistantHistoryNotice,
                      }
                    : {}),
                  context: {
                    ...context,
                    site: service.site,
                    now: new Date().toISOString(),
                  },
                }),
                text_elements: [],
              },
            ],
          })
          .catch(finish);
      });
    } finally {
      approvalScope.close();
      busy = false;
    }
  }
  return {
    voice,
    approvals,
    status,
    run,
    dispose() {
      disposed = true;
      voice.dispose();
      approvals.dispose();
      claude.dispose();
      sessions.clear();
      void connection?.then((value) => value.close()).catch(() => {});
      connection = undefined;
    },
  };
}
export type AssistantService = ReturnType<typeof createAssistantService>;
