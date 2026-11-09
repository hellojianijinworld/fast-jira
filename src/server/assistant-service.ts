import { randomUUID } from "node:crypto";
import type { ChangeProposal } from "../domain/agent.ts";
import { agentIssueKeys, changeProposal } from "../domain/agent.ts";
import {
  type AssistantProgress,
  type AssistantReply,
  type AssistantStatus,
  assistantContext,
} from "../domain/assistant.ts";
import { toolActivity } from "../domain/assistant-activity.ts";
import {
  type AssistantExecution,
  decodeExecutions,
} from "../domain/assistant-execution.ts";
import {
  type ChatMessage,
  isChatMessage,
  MAX_RESTORE_CHARACTERS,
  MAX_RESTORE_MESSAGES,
} from "../domain/conversation.ts";
import { type IssueDraft, issueDraft } from "../domain/create-issue.ts";
import { isRecord, record } from "../domain/validation.ts";
import { createAssistantApprovals } from "./assistant-approvals.ts";
import {
  AssistantUnavailableError,
  assistantFailure,
} from "./assistant-errors.ts";
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
  checkVoice?: () => Promise<boolean>,
) {
  const voice = createVoiceService();
  const approvals = createAssistantApprovals();
  let connection: Promise<CodexClient> | undefined,
    disposed = false;
  const activeRequests = new Map<
    string,
    {
      id: string;
      service: JiraService;
      stop: () => void;
      done: Promise<void>;
      steer?: (prompt: string) => Promise<void>;
    }
  >();
  const activeConversations = new Set<string>();
  const activeSessions = new Set<string>();
  async function control(value: unknown) {
    const input = record(value);
    if (
      typeof input.requestId !== "string" ||
      !/^[a-f0-9]{32}$/.test(input.requestId) ||
      !["stop", "steer"].includes(String(input.action))
    )
      throw new JiraError("진행 중인 요청을 확인하세요.", 400);
    const active = activeRequests.get(input.requestId);
    if (!active) {
      if (input.action === "stop") return;
      if (activeRequests.size)
        throw new JiraError("현재 대화의 요청만 제어할 수 있어요.", 409);
      throw new JiraError(
        "이미 답변이 끝났어요. 다음 요청으로 보내 주세요.",
        409,
      );
    }
    if (active.service !== getService())
      throw new JiraError("현재 대화의 요청만 제어할 수 있어요.", 409);
    if (input.action === "stop") {
      active.stop();
      await active.done;
      return;
    }
    if (
      typeof input.prompt !== "string" ||
      !input.prompt.trim() ||
      input.prompt.length > 10000
    )
      throw new JiraError("요청을 1~10,000자 입력하세요.", 400);
    if (!active.steer)
      throw new JiraError(
        "아직 연결을 준비하고 있어요. 대기열로 보관해 주세요.",
        409,
      );
    await active.steer(input.prompt);
  }
  const sessions = new Map<
    string,
    {
      threadId: string;
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
        throw new AssistantUnavailableError(
          "login_required",
          "Codex에서 로그인해 주세요.",
        );
      const models = record(catalog).data;
      if (!Array.isArray(models))
        throw new Error("Codex 모델 목록을 읽지 못했어요.");
      const available = models.flatMap((value) => {
        const model = record(value);
        const efforts = Array.isArray(model.supportedReasoningEfforts)
          ? model.supportedReasoningEfforts.flatMap((value) =>
              isRecord(value) && typeof value.reasoningEffort === "string"
                ? [value.reasoningEffort]
                : [],
            )
          : [];
        return typeof model.model === "string" && model.model.trim()
          ? [
              {
                id: model.model,
                name:
                  typeof model.displayName === "string"
                    ? model.displayName
                    : model.model,
                isDefault: model.isDefault === true,
                ...(efforts.length ? { efforts } : {}),
                ...(typeof model.defaultReasoningEffort === "string" &&
                efforts.includes(model.defaultReasoningEffort)
                  ? { defaultEffort: model.defaultReasoningEffort }
                  : {}),
              },
            ]
          : [];
      });
      return {
        ready: available.length > 0,
        availability: available.length > 0 ? "ready" : "unavailable",
        error:
          available.length > 0 ? "" : "사용 가능한 Codex 모델을 찾지 못했어요.",
        models: available,
      };
    } catch (error) {
      return { ready: false, models: [], ...assistantFailure(error) };
    }
  }
  async function status(): Promise<AssistantStatus> {
    const [codex, other] = await Promise.all([codexStatus(), claude.status()]);
    const ready = codex.ready || other.ready;
    const availability = ready
      ? "ready"
      : [codex, other].every(
            (provider) => provider.availability === "unavailable",
          )
        ? "unavailable"
        : "unknown";
    const voiceReady = ready
      ? await (checkVoice ?? voice.available)().catch(() => false)
      : false;
    return {
      availability,
      voice: { ready: voiceReady },
      ready,
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
        {
          id: "codex",
          ...(codex.reason ? { reason: codex.reason } : {}),
          ready: codex.ready,
          error: codex.error,
          availability:
            codex.availability ?? (codex.ready ? "ready" : "unknown"),
        },
        {
          id: "claude",
          ...(other.reason ? { reason: other.reason } : {}),
          ready: other.ready,
          error: other.error,
          availability:
            other.availability ?? (other.ready ? "ready" : "unknown"),
        },
      ],
    };
  }
  async function run(
    value: unknown,
    upstream?: AbortSignal,
    progress?: (event: AssistantProgress) => void,
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
      history.length >
        (String(input.model).startsWith("claude:")
          ? 20
          : MAX_RESTORE_MESSAGES) ||
      !history.every(
        (message) =>
          isChatMessage(message) &&
          (message.role === "user" || message.role === "assistant"),
      ) ||
      history.reduce((total, message) => total + message.text.length, 0) >
        (String(input.model).startsWith("claude:")
          ? 20_000
          : MAX_RESTORE_CHARACTERS)
    )
      throw new JiraError("이전 대화의 형식이나 길이를 확인하세요.", 400);
    if (input.hasHistory === true && !history.length)
      throw new JiraError(
        "대화 연결 방식이 바뀌었어요. 화면을 새로고침한 뒤 다시 보내 주세요. 보관된 대화는 그대로 남아 있어요.",
        409,
      );
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
    if (
      input.threadId !== undefined &&
      (typeof input.threadId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(input.threadId))
    )
      throw new JiraError("원본 대화를 확인하세요.", 400);
    const requestedConversation =
      typeof input.conversationId === "string" ? input.conversationId : "";
    if (requestedConversation && activeConversations.has(requestedConversation))
      throw new JiraError(
        "이 대화의 이전 AI 요청이 끝난 뒤 다시 요청하세요.",
        409,
      );
    if (upstream?.aborted) throw new JiraError("AI 요청을 취소했어요.", 499);
    const approvalScope = approvals.open(input.requestId);
    if (requestedConversation) activeConversations.add(requestedConversation);
    const controller = new AbortController(),
      signal = controller.signal;
    const cancel = () => controller.abort();
    upstream?.addEventListener("abort", cancel, { once: true });
    if (upstream?.aborted) cancel();
    let completed!: () => void;
    const active = {
      id: approvalScope.id,
      service: getService(),
      stop: cancel,
      done: new Promise<void>((resolve) => {
        completed = resolve;
      }),
    };
    activeRequests.set(active.id, active);
    let activeSession = "";
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
      const selected = available.models.find((item) => item.id === model);
      if (
        input.effort !== undefined &&
        (typeof input.effort !== "string" ||
          !selected?.efforts?.includes(input.effort))
      )
        throw new JiraError(
          "이 모델에서 지원하는 추론 강도를 선택하세요.",
          400,
        );
      const effort = input.effort ?? selected?.defaultEffort;
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
        if (
          Date.now() - session.updated > 30 * 60_000 &&
          id !== input.conversationId &&
          !activeSessions.has(id)
        ) {
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
        previous?.service === service &&
        previous.drafting === Boolean(context.creation)
          ? previous
          : undefined;
      const conversationId =
        session && typeof input.conversationId === "string"
          ? input.conversationId
          : randomUUID();
      activeSession = conversationId;
      activeSessions.add(conversationId);
      const reconnected =
        !session && (input.hasHistory === true || history.length > 0);
      if (!session) {
        const toolApprovals = await codexToolApprovals(native);
        const started = record(
          await native.request("thread/start", {
            ephemeral: true,
            model,
            sandbox: "read-only",
            approvalPolicy: "on-request",
            approvalsReviewer: "user",
            config: {
              ...toolApprovals,
              "features.shell_tool": true,
              "features.multi_agent": false,
              "tools.view_image": false,
            },
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
          throw new Error("AI 대화를 연결하지 못했어요.");
        session = {
          threadId,
          service,
          updated: Date.now(),
          drafting: Boolean(context.creation),
        };
        if (sessions.size >= 12) {
          const oldest = [...sessions.entries()].find(
            ([id]) => !activeSessions.has(id),
          );
          if (oldest) {
            sessions.delete(oldest[0]);
            void native
              .request("thread/unsubscribe", { threadId: oldest[1].threadId })
              .catch(() => {});
          }
        }
        sessions.set(conversationId, session);
      }
      session.updated = Date.now();
      const activity: ChatMessage[] = [];
      const messages = new Map<string, string>();
      const threadId = session.threadId;
      const screenContext = () => ({
        ...(reconnected && history.length
          ? {
              "fast-jira-history": {
                kind: "untrusted",
                value: JSON.stringify({
                  previousConversation: history,
                  historyNotice: assistantHistoryNotice,
                }),
              },
            }
          : {}),
        "fast-jira-screen": {
          kind: "untrusted",
          value: JSON.stringify({
            ...context,
            site: service.site,
            now: new Date().toISOString(),
          }),
        },
      });
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
        let activeTurnId = "";
        const steer = async (prompt: string) => {
          if (ended || !activeTurnId || signal.aborted)
            throw new JiraError(
              "이미 답변이 끝났거나 아직 준비 중이에요.",
              409,
            );
          await native.request("turn/steer", {
            threadId,
            expectedTurnId: activeTurnId,
            additionalContext: screenContext(),
            input: [
              {
                type: "text",
                text: prompt,
                text_elements: [],
              },
            ],
          });
        };
        activeRequests.set(active.id, { ...active, steer });
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
            if (activeRequests.size === 1) native.close();
            else if (activeTurnId)
              void native
                .request("turn/interrupt", { threadId, turnId: activeTurnId })
                .catch(() => {});
            reject(error);
          } else {
            const finalAnswer =
              prematureCompletion && execution.length
                ? ""
                : [...messages.values()].at(-1) || answer || deltas;
            const reply = {
              conversationId,
              answer: finalAnswer,
              intermediate: [...messages.values()].filter(
                (text) => text && text !== finalAnswer,
              ),
              execution,
              activity,
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
              message.method === "item/completed" &&
              isRecord(params.item) &&
              params.item.type === "mcpToolCall"
            ) {
              const item = params.item;
              const started = items.get(String(item.id));
              activity.push(
                toolActivity(
                  String(item.tool ?? ""),
                  item.arguments ??
                    (isRecord(started) ? started.arguments : undefined),
                  item.result,
                  item.status === "failed" || Boolean(item.error),
                ),
              );
            }
            if (
              message.method === "item/completed" &&
              isRecord(params.item) &&
              ["commandExecution", "fileChange"].includes(
                String(params.item.type),
              )
            ) {
              const item = params.item;
              const state =
                item.status === "declined"
                  ? "미실행"
                  : item.status === "failed" ||
                      item.error ||
                      (typeof item.exitCode === "number" && item.exitCode !== 0)
                    ? "실패"
                    : item.status === "completed"
                      ? "완료"
                      : "결과 확인 필요";
              activity.push({
                role: "event",
                text: `${item.type === "commandExecution" ? "명령 실행" : "파일 변경"} · ${state}`,
                created: Date.now(),
              });
            }
            if (
              message.method === "turn/started" &&
              isRecord(params.turn) &&
              typeof params.turn.id === "string"
            )
              activeTurnId = params.turn.id;
            if (
              message.method === "item/started" &&
              isRecord(params.item) &&
              typeof params.item.id === "string"
            ) {
              items.set(params.item.id, params.item);
              if (params.item.type === "mcpToolCall") {
                pendingMcp.add(params.item.id);
                progress?.({
                  type: "activity",
                  text: "연결 도구를 실행하고 있어요…",
                });
              }
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
              progress?.({
                type: "activity",
                text: tools.definitions.find(
                  (tool) => tool.name === params.tool,
                )?.annotations.readOnlyHint
                  ? "Jira 정보를 확인하고 있어요…"
                  : "변경을 처리하고 있어요…",
              });
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
                    activity.push(
                      toolActivity(
                        String(params.tool),
                        params.arguments,
                        result,
                      ),
                    );
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
                    activity.push(
                      toolActivity(
                        String(params.tool),
                        params.arguments,
                        undefined,
                        true,
                      ),
                    );
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
            ) {
              deltas += params.delta;
              const id = String(params.itemId ?? "answer");
              messages.set(id, (messages.get(id) ?? "") + params.delta);
              progress?.({
                type: "message",
                id,
                text: params.delta,
                replace: false,
              });
            } else if (
              message.method === "item/completed" &&
              isRecord(params.item) &&
              params.item.type === "agentMessage" &&
              typeof params.item.text === "string"
            ) {
              answer = params.item.text;
              const id = String(params.item.id ?? "answer");
              messages.set(id, params.item.text);
              progress?.({
                type: "message",
                id,
                text: params.item.text,
                replace: true,
              });
            } else if (message.method === "turn/completed") {
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
            model,
            ...(effort ? { effort } : {}),
            additionalContext: screenContext(),
            input: [
              {
                type: "text",
                text: input.prompt,
                text_elements: [],
              },
            ],
          })
          .then((value) => {
            const turn = record(value).turn;
            if (isRecord(turn) && typeof turn.id === "string") {
              activeTurnId = turn.id;
              if (ended && signal.aborted)
                void native
                  .request("turn/interrupt", { threadId, turnId: activeTurnId })
                  .catch(() => {});
            }
          })
          .catch(finish);
      });
    } finally {
      upstream?.removeEventListener("abort", cancel);
      approvalScope.close();
      activeRequests.delete(active.id);
      if (activeSession) activeSessions.delete(activeSession);
      if (requestedConversation)
        activeConversations.delete(requestedConversation);
      completed();
    }
  }
  return {
    voice,
    approvals,
    status,
    control,
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
