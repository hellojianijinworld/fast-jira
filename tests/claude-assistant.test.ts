import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { assistantStatus } from "../src/domain/assistant.ts";
import { executionReport } from "../src/domain/assistant-execution.ts";
import { createAssistantService } from "../src/server/assistant-service.ts";
import { createClaudeAssistant } from "../src/server/claude-assistant.ts";
import {
  claudeEnvironment,
  runClaudeCommand,
} from "../src/server/claude-client.ts";
import { createJiraService } from "../src/server/jira-service.ts";

const context = { projects: ["AA"], issue: "AA-1", keys: [] };
const service = () =>
  createJiraService({
    credentials: {
      site: "fixture.atlassian.net",
      email: "fake@example.com",
      token: "secret-jira",
    },
    fetcher: async (input, init) => {
      assert(!init?.method || init.method === "GET", "Jira 저장 금지");
      return Response.json(
        new URL(String(input)).pathname.endsWith("/field")
          ? []
          : { issues: [], isLast: true },
      );
    },
  });
const loggedIn = {
  loggedIn: true,
  authMethod: "oauth_token",
  apiProvider: "firstParty",
};
const sessions = new Map<string, string>();
const rpc = async (
  url: string,
  headers: Record<string, string>,
  method: string,
  params: Record<string, unknown> = {},
): Promise<Response> => {
  const send = (
    method: string,
    params: Record<string, unknown>,
    id: number | null = 1,
  ) =>
    fetch(url, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(sessions.has(url)
          ? { "Mcp-Session-Id": sessions.get(url) ?? "" }
          : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        ...(id === null ? {} : { id }),
        method,
        params,
      }),
    });
  if (method !== "initialize" && !sessions.has(url)) {
    const initialized = await rpc(url, headers, "initialize");
    if (!initialized.ok) return initialized;
    await send("notifications/initialized", {}, null);
  }
  const result = await send(
    method,
    method === "initialize"
      ? {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
          ...params,
        }
      : params,
  );
  const session = result.headers.get("mcp-session-id");
  if (session) sessions.set(url, session);
  return result;
};

test("Claude는 API 키 없이 OAuth 로그인 상태만 확인하고 공식 별칭을 표시한다", async () => {
  for (const auth of [
    loggedIn,
    { ...loggedIn, authMethod: "claude.ai" },
    { ...loggedIn, loggedIn: false },
    { ...loggedIn, authMethod: "api_key" },
    { ...loggedIn, apiProvider: "bedrock" },
  ]) {
    const jira = service();
    const assistant = createClaudeAssistant(
      () => jira,
      "test",
      async (command) => {
        assert.deepEqual(command.args, ["auth", "status", "--json"]);
        return auth;
      },
    );
    const status = await assistant.status();
    assert.equal(
      status.ready,
      auth.loggedIn &&
        auth.apiProvider === "firstParty" &&
        auth.authMethod !== "api_key",
    );
    assert(status.models.every((model) => model.id.startsWith("claude:")));
    if (!status.ready) assert.match(status.error, /claude auth login/);
    assistant.dispose();
  }
});

test("Codex 없이도 Claude로 대화·조회·변경안을 만들고 도구와 인증을 격리한다", async () => {
  const jira = service();
  let url = "",
    runCount = 0;
  const claude = createClaudeAssistant(
    () => jira,
    "등록된 도구만 사용",
    async (command) => {
      if (command.args[0] === "auth") return loggedIn;
      runCount++;
      assert(command.args.includes("--no-session-persistence"));
      assert.equal(command.args[command.args.indexOf("--tools") + 1], "");
      assert(!command.args.includes("--strict-mcp-config"));
      assert(command.args.includes("--permission-prompt-tool"));
      assert(command.args.includes("--append-system-prompt"));
      assert(!command.args.some((arg) => arg.includes("secret-jira")));
      assert.equal(
        command.args[command.args.indexOf("--permission-mode") + 1],
        "default",
      );
      const input = JSON.parse(command.input ?? "{}");
      assert.deepEqual(input.previousConversation, [
        { role: "user", text: "이전 요청" },
      ]);
      const config = JSON.parse(
        command.args[command.args.indexOf("--mcp-config") + 1] ?? "{}",
      ).mcpServers.fast_jira;
      url = config.url;
      assert.equal((await rpc(url, {}, "tools/list")).status, 403);
      assert.equal(
        (
          await rpc(
            url,
            { ...config.headers, Origin: "https://evil.example" },
            "tools/list",
          )
        ).status,
        403,
      );
      const init = await rpc(url, config.headers, "initialize", {
        protocolVersion: "2025-06-18",
      }).then((response) => response.json());
      assert(init.result.capabilities.tools);
      const list = await rpc(url, config.headers, "tools/list").then(
        (response) => response.json(),
      );
      assert(
        list.result.tools.some(
          (tool: { name: string }) => tool.name === "jira_search",
        ),
      );
      assert(
        list.result.tools.some(
          (tool: { name: string }) => tool.name === "jira_update_issues",
        ),
      );
      const searched = await rpc(url, config.headers, "tools/call", {
        name: "jira_search",
        arguments: { projects: ["AA"] },
      }).then((response) => response.json());
      assert(!searched.result.isError, "MCP 조회 도구 실패");
      const blocked = await rpc(url, config.headers, "tools/call", {
        name: "jira_update_issues",
        arguments: {},
      }).then((response) => response.json());
      assert.equal(blocked.result.isError, true);
      const proposed = await rpc(url, config.headers, "tools/call", {
        name: "jira_propose_change",
        arguments: { keys: ["AA-1"], field: "assignee", value: "member-1" },
      }).then((response) => response.json());
      assert(!proposed.result.isError);
      return { is_error: false, result: "변경안을 확인하세요." };
    },
  );
  const assistant = createAssistantService(
    () => jira,
    async () => {
      throw new Error("Codex 미설치");
    },
    claude,
  );
  try {
    const status = assistantStatus(await assistant.status());
    assert(status.ready);
    assert.equal(
      status.models.find((model) => model.isDefault)?.id,
      "claude:default",
    );
    assert.equal(
      status.providers?.find((provider) => provider.id === "codex")?.ready,
      false,
    );
    await assert.rejects(
      assistant.run({ prompt: "조회", context, model: "claude:not-real" }),
      /모델/,
    );
    assert.equal(runCount, 0);
    const result = await assistant.run({
      prompt: "담당자 변경안",
      context,
      model: "claude:sonnet",
      history: [{ role: "user", text: "이전 요청" }],
    });
    assert.equal(result.answer, "변경안을 확인하세요.");
    assert(result.conversationId.startsWith("claude:"));
    assert.deepEqual(result.proposals, [
      { keys: ["AA-1"], field: "assignee", value: "member-1" },
    ]);
    await assert.rejects(fetch(url));
  } finally {
    assistant.dispose();
  }
});

test("Jira 연결이 바뀌면 Claude 도구와 완료 응답을 거부하고 MCP를 닫는다", async () => {
  let current = service(),
    url = "";
  const assistant = createClaudeAssistant(
    () => current,
    "test",
    async (command) => {
      const config = JSON.parse(
        command.args[command.args.indexOf("--mcp-config") + 1] ?? "{}",
      ).mcpServers.fast_jira;
      url = config.url;
      current = service();
      const reply = await rpc(url, config.headers, "tools/call", {
        name: "jira_propose_change",
        arguments: { keys: ["AA-1"], field: "priority", value: "1" },
      }).then((response) => response.json());
      assert.equal(reply.result.isError, true);
      return { is_error: false, result: "끝" };
    },
  );
  try {
    await assert.rejects(
      assistant.run({
        prompt: "조회",
        context,
        model: "claude:default",
        history: [],
      }),
      /연결이 바뀌/,
    );
    await assert.rejects(fetch(url));
  } finally {
    assistant.dispose();
  }
});

test("Claude 실패·요청 취소·서비스 종료는 성공으로 처리하지 않는다", async () => {
  for (const outcome of ["failure", "abort", "dispose"]) {
    const abort = new AbortController();
    let url = "";
    const jira = service();
    const assistant = createClaudeAssistant(
      () => jira,
      "test",
      async (command) => {
        const config = JSON.parse(
          command.args[command.args.indexOf("--mcp-config") + 1] ?? "{}",
        ).mcpServers.fast_jira;
        url = config.url;
        if (outcome === "abort") abort.abort();
        if (outcome === "dispose") assistant.dispose();
        return { is_error: outcome === "failure", result: "실패 후 응답" };
      },
    );
    try {
      await assert.rejects(
        assistant.run(
          { prompt: "조회", context, model: "claude:default", history: [] },
          abort.signal,
        ),
        outcome === "failure" ? /완료하지 못/ : /취소/,
      );
      await assert.rejects(fetch(url));
    } finally {
      assistant.dispose();
    }
  }
});

test("Claude 프로세스는 JSON·취소를 처리하고 Jira·API 인증 환경을 전달하지 않는다", async () => {
  const previous = process.env.JIRA_TEST_SECRET;
  process.env.JIRA_TEST_SECRET = "secret";
  try {
    assert.equal(claudeEnvironment().JIRA_TEST_SECRET, undefined);
    assert.equal(claudeEnvironment().ANTHROPIC_API_KEY, undefined);
  } finally {
    if (previous === undefined) delete process.env.JIRA_TEST_SECRET;
    else process.env.JIRA_TEST_SECRET = previous;
  }
  const launch = (source: string) => () =>
    spawn(process.execPath, ["-e", source], { stdio: "pipe" });
  assert.deepEqual(
    await runClaudeCommand(
      { args: [] },
      launch(
        'process.stdin.resume();process.stdin.on("end",()=>console.log(JSON.stringify({result:"ok",is_error:false})))',
      ),
    ),
    { result: "ok", is_error: false },
  );
  await assert.rejects(
    runClaudeCommand({ args: [] }, launch('console.log("broken")')),
    /형식/,
  );
  const controller = new AbortController();
  const pending = runClaudeCommand(
    { args: [], signal: controller.signal },
    launch("setInterval(()=>{},1000)"),
  );
  const rejected = assert.rejects(pending, /취소/);
  controller.abort();
  await rejected;
});

test("한글 바이트 중간에서 나뉜 MCP 요청도 원문을 유지한다", async () => {
  const { createAssistantMcp } = await import("../src/server/assistant-mcp.ts");
  const { request } = await import("node:http");
  const jira = service();
  const { createJiraTools } = await import("../src/server/jira-tools.ts");
  let received: unknown;
  const bridge = await createAssistantMcp(
    createJiraTools(jira).definitions,
    async (_name, args) => {
      received = args;
      return {};
    },
  );
  try {
    const body = Buffer.from(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "jira_search", arguments: { query: "한글" } },
      }),
    );
    await rpc(bridge.config.url, bridge.config.headers, "initialize");
    const split = body.indexOf(Buffer.from("한")) + 1;
    await new Promise<void>((resolve, reject) => {
      const req = request(
        bridge.config.url,
        {
          method: "POST",
          headers: {
            ...bridge.config.headers,
            Accept: "application/json, text/event-stream",
            "Mcp-Session-Id": sessions.get(bridge.config.url) ?? "",
            "Content-Type": "application/json",
          },
        },
        (res) => {
          res.resume();
          res.on("end", resolve);
        },
      );
      req.on("error", reject);
      req.write(body.subarray(0, split));
      setTimeout(() => req.end(body.subarray(split)), 20);
    });
    assert.deepEqual(received, { query: "한글" });
  } finally {
    bridge.close();
  }
});

test("종료 신호를 무시하는 Claude도 취소 완료 전에 강제 종료한다", async () => {
  let child: ReturnType<typeof spawn> | undefined;
  let markReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  const controller = new AbortController();
  const pending = runClaudeCommand(
    { args: [], signal: controller.signal },
    () => {
      const childProcess = spawn(
        process.execPath,
        [
          "-e",
          'process.on("SIGTERM",()=>{});console.log("ready");setInterval(()=>{},1000)',
        ],
        { stdio: "pipe" },
      );
      child = childProcess;
      childProcess.stdout.once("data", markReady);
      return childProcess;
    },
  );
  const rejected = assert.rejects(pending, /취소/);
  try {
    await ready;
    controller.abort();
    await rejected;
    assert.equal(child?.signalCode, "SIGKILL");
  } finally {
    child?.kill("SIGKILL");
  }
});

test("서비스 종료는 진행 중인 Claude 로그인 확인도 취소한다", async () => {
  let started: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let signal: AbortSignal | undefined;
  const assistant = createClaudeAssistant(
    service,
    "test",
    (command) =>
      new Promise((_resolve, reject) => {
        signal = command.signal;
        signal?.addEventListener(
          "abort",
          () => reject(new Error("로그인 확인 취소")),
          { once: true },
        );
        started();
      }),
  );
  const pending = assistant.status();
  await ready;
  assistant.dispose();
  const state = await pending;
  assert.equal(signal?.aborted, true);
  assert.equal(state.ready, false);
});

test("Claude 권한 콜백은 사용자가 승인할 때까지 대기하고 영구 권한을 추가하지 않는다", async () => {
  const jira = service();
  let resolveApproval:
    | ((result: { approved: boolean; values: Record<string, never> }) => void)
    | undefined;
  let notified: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    notified = resolve;
  });
  const assistant = createClaudeAssistant(
    () => jira,
    "test",
    async (command) => {
      const config = JSON.parse(
        command.args[command.args.indexOf("--mcp-config") + 1] ?? "{}",
      ).mcpServers.fast_jira;
      let completed = false;
      const reply = rpc(config.url, config.headers, "tools/call", {
        name: "fast_jira_confirm",
        arguments: {
          tool_name: "Write",
          input: { file_path: "/tmp/target.txt", content: "changed" },
        },
      })
        .then((r) => r.json())
        .then((r) => {
          completed = true;
          return r;
        });
      await ready;
      assert.equal(completed, false);
      resolveApproval?.({ approved: true, values: {} });
      const answer = await reply;
      const value = JSON.parse(answer.result.content[0].text);
      assert.deepEqual(value, {
        behavior: "allow",
        updatedInput: { file_path: "/tmp/target.txt", content: "changed" },
        updatedPermissions: [],
      });
      return { is_error: false, result: "확인 완료" };
    },
  );
  try {
    await assistant.run(
      { prompt: "파일 변경", context, model: "claude:default", history: [] },
      undefined,
      (request) =>
        new Promise((resolve) => {
          assert.match(request.details, /target.txt/);
          resolveApproval = resolve;
          notified();
        }),
    );
  } finally {
    assistant.dispose();
  }
});

for (const approved of [true, false])
  test(`Claude 생성 모의 실행도 승인 ${approved} 결과로 최종 답변을 확정한다`, async () => {
    const jira = service();
    let writes = 0,
      prompts = 0;
    jira.validateCreation = async () => ({
      project: "AA",
      type: "2",
      parent: "AA-1",
      fields: { summary: "모의 하위 작업" },
    });
    jira.createIssue = async () => {
      writes++;
      return { key: "AA-99" };
    };
    const claude = createClaudeAssistant(
      () => jira,
      "모의 실행",
      async ({ args }) => {
        const config = JSON.parse(
          args[args.indexOf("--mcp-config") + 1] ?? "{}",
        ).mcpServers.fast_jira;
        const response = await rpc(config.url, config.headers, "tools/call", {
          name: "jira_apply_changes",
          arguments: {
            actions: [
              {
                tool: "jira_create_issue",
                arguments: {
                  project: "AA",
                  type: "2",
                  parent: "AA-1",
                  fields: { summary: "모의 하위 작업" },
                },
              },
            ],
          },
        }).then((r) => r.json());
        assert.equal(response.result.isError, approved ? undefined : true);
        return {
          is_error: false,
          result: "승인 결과를 아직 기다리고 있습니다.",
        };
      },
    );
    try {
      const reply = await claude.run(
        {
          prompt: "하위 작업 생성",
          context,
          model: "claude:sonnet",
          history: [],
        },
        undefined,
        async () => {
          prompts++;
          return { approved, values: {} };
        },
      );
      assert.equal(prompts, 1);
      assert.equal(writes, approved ? 1 : 0);
      assert.equal(
        reply.execution?.[0]?.status,
        approved ? "applied" : "notApproved",
      );
      assert.match(
        executionReport(reply.execution ?? [], "fixture.atlassian.net"),
        approved ? /완료.*모의 하위 작업/ : /미실행/,
      );
    } finally {
      claude.dispose();
    }
  });
