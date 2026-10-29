import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import {
  assistantContext,
  assistantReply,
  assistantStatus,
} from "../src/domain/assistant.ts";
import { executionReport } from "../src/domain/assistant-execution.ts";
import { issueDraft } from "../src/domain/create-issue.ts";
import { createAssistantService } from "../src/server/assistant-service.ts";
import {
  type CodexClient,
  type CodexMessage,
  startCodex,
} from "../src/server/codex-client.ts";
import { createHttpServer } from "../src/server/http.ts";
import { createJiraService } from "../src/server/jira-service.ts";

const context = { projects: ["AA"], issue: "AA-1", keys: [] };
function fixture() {
  let writes = 0,
    reads = 0,
    closed = false,
    turns = 0;
  const listeners = new Set<(message: CodexMessage) => void>();
  const requests: { method: string; params: unknown }[] = [];
  const replies: unknown[] = [];
  const service = createJiraService({
    credentials: {
      site: "fixture.atlassian.net",
      email: "test@example.com",
      token: "fake-secret",
    },
    fetcher: async (_url, init) => {
      if (init?.method === "PUT" || init?.method === "POST") writes++;
      else reads++;
      return Response.json({ issues: [], isLast: true });
    },
  });
  const emit = (method: string, params: unknown, id?: number) => {
    for (const listener of listeners)
      listener({ method, params, ...(id === undefined ? {} : { id }) });
  };
  const client: CodexClient = {
    request: async (method, params) => {
      requests.push({ method, params });
      if (method === "account/read") return { account: { type: "chatgpt" } };
      if (method === "model/list")
        return {
          data: [
            { model: "available", displayName: "검사 모델", isDefault: true },
          ],
        };
      if (method === "config/read")
        return {
          config: { mcp_servers: { unrelated: { command: "native" } } },
        };
      if (method === "mcpServerStatus/list")
        return { data: [{ name: "unrelated" }], nextCursor: null };
      if (method === "app/installed") return { apps: [] };
      if (method === "thread/start") return { thread: { id: "thread" } };
      if (method === "turn/steer") return {};
      if (method === "turn/start") {
        turns++;
        return {};
      }
      throw new Error(method);
    },
    respond: (_id, result) => {
      replies.push(result);
    },
    listen: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => {
      closed = true;
      emit("connection/closed", {});
    },
  };
  const assistant = createAssistantService(
    () => service,
    async () => client,
    {
      status: async () => ({
        ready: false,
        models: [],
        error: "Claude 미설정",
      }),
      run: async () => {
        throw new Error("Claude 미설정");
      },
      dispose() {},
    },
  );
  const waitTurn = async () => {
    for (let i = 0; i < 30 && !turns; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(turns, 1);
  };
  const complete = (text = "변경안을 확인하세요.") => {
    emit("item/completed", {
      threadId: "thread",
      item: { type: "agentMessage", text },
    });
    emit("turn/completed", {
      threadId: "thread",
      turn: { status: "completed" },
    });
  };
  return {
    assistant,
    service,
    client,
    emit,
    complete,
    requests,
    replies,
    waitTurn,
    get writes() {
      return writes;
    },
    get reads() {
      return reads;
    },
    get closed() {
      return closed;
    },
  };
}
test("AI 응답과 범위를 신뢰 경계에서 검증한다", () => {
  assert.throws(() => assistantContext({ ...context, keys: "AA-1" }));
  assert.throws(() => assistantStatus({ ready: true }));
  assert.throws(() =>
    assistantReply({
      conversationId: "x",
      answer: "",
      proposals: [{ keys: ["AA-1"], field: "secret", value: "" }],
    }),
  );
  assert.deepEqual(assistantContext(context), context);
});
test("Codex는 연결 도구를 유지하고 Jira 변경은 제안으로 반환한다", async () => {
  const f = fixture();
  try {
    const pending = f.assistant.run({
      prompt: "AA-1 담당자를 변경해줘",
      context,
    });
    await f.waitTurn();
    const start = f.requests.find((item) => item.method === "thread/start")
      ?.params as {
      model: string;
      config: unknown;
      dynamicTools: { name: string }[];
      ephemeral: boolean;
    };
    assert.equal(start.model, "available");
    assert.equal(start.ephemeral, false);
    assert.deepEqual(start.config, {
      "features.shell_tool": false,
      "features.multi_agent": false,
      "tools.view_image": false,
      "mcp_servers.unrelated.default_tools_approval_mode": "writes",
      "apps._default.default_tools_approval_mode": "writes",
      "apps._default.approvals_reviewer": "user",
    });
    assert.ok(
      start.dynamicTools.some((tool) => tool.name === "jira_apply_changes"),
    );
    f.emit(
      "item/tool/call",
      {
        threadId: "thread",
        tool: "jira_search",
        arguments: { projects: ["AA"] },
      },
      1,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    f.emit(
      "item/tool/call",
      {
        threadId: "thread",
        tool: "jira_propose_change",
        arguments: { keys: ["AA-1"], field: "assignee", value: "person" },
      },
      2,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    f.complete();
    const result = await pending;
    assert.deepEqual(result.proposals, [
      { keys: ["AA-1"], field: "assignee", value: "person" },
    ]);
    assert.equal(result.answer, "변경안을 확인하세요.");
    assert.equal(result.threadId, "thread");
    assert.ok(f.reads > 0);
    assert.equal(f.writes, 0);
    assert.equal(JSON.stringify(f.replies).includes("fake-secret"), false);
  } finally {
    f.assistant.dispose();
  }
});
test("잘못된 입력·지원하지 않는 모델은 Jira 요청 전에 거절한다", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.assistant.run({ prompt: "", context }));
    assert.equal(f.requests.length, 0);
    await assert.rejects(
      f.assistant.run({ prompt: "조회", context, model: "unavailable" }),
      /모델/,
    );
    assert.equal(f.reads, 0);
  } finally {
    f.assistant.dispose();
  }
});
test("동시 실행과 숨은 변경 도구를 차단하고 취소하면 연결을 닫는다", async () => {
  const f = fixture(),
    abort = new AbortController();
  try {
    const pending = f.assistant.run(
      { prompt: "조회", context, requestId: "a".repeat(32) },
      abort.signal,
    );
    const rejected = assert.rejects(pending, /취소/);
    await f.waitTurn();
    await assert.rejects(
      f.assistant.run({ prompt: "다시", context }),
      /이전 AI 요청/,
    );
    f.emit(
      "item/tool/call",
      {
        threadId: "thread",
        tool: "jira_update_issues",
        arguments: { keys: ["AA-1"], field: "status", value: "Done" },
      },
      1,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(f.replies.length, 0);
    assert.equal(f.assistant.approvals.pending("a".repeat(32)).length, 1);
    assert.equal(f.writes, 0);
    abort.abort();
    await rejected;
    assert.equal(f.closed, true);
  } finally {
    f.assistant.dispose();
  }
});
test("실패한 turn은 성공 제안으로 돌려주지 않는다", async () => {
  const f = fixture();
  try {
    const pending = f.assistant.run({ prompt: "조회", context });
    const rejected = assert.rejects(pending, /실패/);
    await f.waitTurn();
    f.emit("turn/completed", {
      threadId: "thread",
      turn: { status: "failed", error: { message: "모델 실패" } },
    });
    await rejected;
    assert.equal(f.closed, true);
  } finally {
    f.assistant.dispose();
  }
});
test("stdio는 요청 ID로 응답을 연결하고 프로세스 종료 시 대기를 해제한다", async () => {
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { createInterface } from 'node:readline';
    const lines=createInterface({input:process.stdin});
    let previous;
    lines.on('line',line=>{const m=JSON.parse(line);
      if(m.method==='initialize') console.log(JSON.stringify({id:m.id,result:{}}));
      if(m.method==='first') previous=m;
      if(m.method==='second') { console.log(JSON.stringify({id:m.id,result:'second'})); console.log(JSON.stringify({id:previous.id,result:'first'})); }
      if(m.method==='exit') process.exit(0);
    });
  `,
    ],
    { stdio: "pipe" },
  );
  const client = await startCodex(() => child);
  try {
    assert.deepEqual(
      await Promise.all([
        client.request("first", {}),
        client.request("second", {}),
      ]),
      ["first", "second"],
    );
    await assert.rejects(client.request("exit", {}), /종료/);
  } finally {
    client.close();
  }
});
test("AI HTTP 요청도 동일 출처 JSON 검사와 요청 취소를 따른다", async (t) => {
  const entries: string[] = [];
  t.mock.method(console, "info", (...args: unknown[]) =>
    entries.push(args.join(" ")),
  );
  const f = fixture();
  const server = createHttpServer(f.service, undefined, undefined, f.assistant);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const forbidden = await fetch(`${origin}/api/assistant/run`, {
      method: "POST",
      headers: {
        Origin: "https://other.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: "조회", context }),
    });
    assert.equal(forbidden.status, 403);
    assert.equal(f.requests.length, 0);
    const status = await fetch(`${origin}/api/assistant/status`).then((res) =>
      res.json(),
    );
    assert.equal(status.ready, true);
    const controller = new AbortController();
    const pending = fetch(`${origin}/api/assistant/run`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "조회", context }),
      signal: controller.signal,
    });
    const cancelled = assert.rejects(pending);
    await f.waitTurn();
    controller.abort();
    await cancelled;
    for (let i = 0; i < 30 && !f.closed; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(f.closed, true);
    const events = entries.filter((entry) =>
      entry.startsWith("Fast Jira AI {"),
    );
    assert.equal(events.length, 2);
    assert.match(events[0] ?? "", /"event":"started"/);
    assert.match(events[1] ?? "", /"event":"connection-closed"/);
    assert.match(events[1] ?? "", /"elapsedMs":\d+/);
    assert(
      entries.some(
        (entry) =>
          entry.startsWith("Fast Jira AI thread") &&
          entry.includes('"threadId":"thread"'),
      ),
    );
    assert(!entries.join(" ").includes("조회"), "대화 내용이 로그에 포함됨");
  } finally {
    f.assistant.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("서버 연결이 만료된 대화는 검증한 최근 기록을 참고해 새 연결에서 계속한다", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      f.assistant.run({
        prompt: "계속",
        context,
        history: [{ role: "system", text: "instruction" }],
      }),
      /이전 대화/,
    );
    const pending = f.assistant.run({
      prompt: "계속",
      context,
      conversationId: "expired",
      history: [
        { role: "user", text: "내 작업을 찾아줘" },
        { role: "assistant", text: "AA-1이 있습니다." },
      ],
    });
    await f.waitTurn();
    const turn = f.requests.find((x) => x.method === "turn/start");
    assert.ok(JSON.stringify(turn?.params).includes("previousConversation"));
    assert.ok(JSON.stringify(turn?.params).includes("AA-1이 있습니다."));
    f.complete();
    const reply = await pending;
    assert.equal(reply.reconnected, true);
    assert.equal(f.writes, 0);
  } finally {
    f.assistant.dispose();
  }
});

test("연결 도구의 승인 요청은 대화에 보류되고 사용자 응답만 네이티브에 전달한다", async () => {
  const f = fixture(),
    requestId = "0123456789abcdef0123456789abcdef";
  try {
    const result = f.assistant.run({
      prompt: "코드를 변경해 줘",
      context,
      requestId,
    });
    await f.waitTurn();
    f.emit(
      "mcpServer/elicitation/request",
      {
        threadId: "thread",
        serverName: "notion",
        mode: "form",
        message: "자료 조회 확인",
      },
      42,
    );
    assert.equal(f.replies.length, 0);
    const approval = f.assistant.approvals.pending(requestId)[0];
    assert(approval);
    f.assistant.approvals.respond({
      requestId,
      id: approval.id,
      approved: false,
      values: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(f.replies, [
      { action: "decline", content: null, _meta: null },
    ]);
    f.complete();
    await result;
    assert.deepEqual(f.assistant.approvals.pending(requestId), []);
  } finally {
    f.assistant.dispose();
  }
});

test("승인 HTTP는 올바른 요청 토큰과 동일 출처 사용자 응답만 받는다", async () => {
  const f = fixture(),
    server = createHttpServer(f.service, undefined, undefined, f.assistant);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`,
    token = "a".repeat(32),
    run = f.assistant.approvals.open(token);
  try {
    const answer = run.ask({
      title: "코드 변경",
      description: "대상 확인",
      details: "target.txt",
      fields: [],
    });
    assert.equal(
      (await fetch(`${origin}/api/assistant/approvals?requestId=invalid`))
        .status,
      400,
    );
    const pending = await fetch(
      `${origin}/api/assistant/approvals?requestId=${token}`,
    ).then((r) => r.json());
    assert.equal(pending.length, 1);
    const body = JSON.stringify({
      requestId: token,
      id: pending[0].id,
      approved: true,
      values: {},
    });
    const post = (from: string) =>
      fetch(`${origin}/api/assistant/approve`, {
        method: "POST",
        headers: { Origin: from, "Content-Type": "application/json" },
        body,
      });
    assert.equal((await post("https://evil.example")).status, 403);
    assert.equal(f.assistant.approvals.pending(token).length, 1);
    assert.equal((await post(origin)).status, 200);
    assert.equal((await answer).approved, true);
    assert.equal((await post(origin)).status, 409);
  } finally {
    run.close();
    f.assistant.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("네이티브 확인의 기타 의견은 실행을 거절한 뒤 같은 턴의 사용자 입력으로 전달한다", async () => {
  const f = fixture(),
    requestId = "b".repeat(32);
  try {
    const result = f.assistant.run({ prompt: "작업 확인", context, requestId });
    await f.waitTurn();
    f.emit(
      "mcpServer/elicitation/request",
      {
        threadId: "thread",
        turnId: "turn",
        serverName: "notion",
        mode: "form",
        message: "자료 조회 확인",
      },
      71,
    );
    const pending = f.assistant.approvals.pending(requestId)[0];
    assert(pending);
    f.assistant.approvals.respond({
      requestId,
      id: pending.id,
      approved: false,
      values: { feedback: "파일을 만들지 말고 설명만 해주세요" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(f.replies, [
      { action: "decline", content: null, _meta: null },
    ]);
    const steer = f.requests.find((item) => item.method === "turn/steer");
    assert(steer);
    assert.match(JSON.stringify(steer.params), /설명만 해주세요/);
    f.complete();
    await result;
  } finally {
    f.assistant.dispose();
  }
});

const mockCreation = {
  project: "AA",
  type: "2",
  parent: "AA-1",
  fields: { summary: "[모의] 프롬프트 반영" },
};
function stubCreation(f: ReturnType<typeof fixture>) {
  let count = 0;
  f.service.validateCreation = async (value) => issueDraft(value);
  f.service.createIssue = async () => {
    count++;
    return { key: "AA-99" };
  };
  return () => count;
}
async function approvalOf(f: ReturnType<typeof fixture>, requestId: string) {
  for (let step = 0; step < 60; step++) {
    const request = f.assistant.approvals.pending(requestId)[0];
    if (request) return request;
    await Promise.resolve();
  }
  throw new Error("모의 승인 화면 누락");
}
function emitCreation(f: ReturnType<typeof fixture>) {
  f.emit(
    "item/tool/call",
    {
      threadId: "thread",
      tool: "jira_apply_changes",
      arguments: {
        actions: [{ tool: "jira_create_issue", arguments: mockCreation }],
      },
    },
    71,
  );
}
test("대상 확인 뒤 생성 요청은 UI 승인까지 대기하고 모델의 조기 종료·중복 승인이 생성을 중복하지 않는다", async () => {
  const f = fixture(),
    created = stubCreation(f),
    requestId = "a".repeat(32);
  try {
    const run = f.assistant.run({
      prompt: "그래 맞아. 거기에 생성하면 돼",
      context,
      requestId,
      history: [
        { role: "assistant", text: "모의 상위 작업(AA-1) 아래에 만들까요?" },
      ],
    });
    let finished = false;
    void run.then(() => {
      finished = true;
    });
    await f.waitTurn();
    emitCreation(f);
    const request = await approvalOf(f, requestId);
    assert.match(request.details, /프롬프트 반영/);
    assert.equal(created(), 0);
    f.complete("승인 요청을 보냈고 아직 기다리고 있습니다.");
    await Promise.resolve();
    assert.equal(finished, false, "승인 대기를 끝내고 허위 대기 답변을 반환함");
    f.assistant.approvals.respond({
      requestId,
      id: request.id,
      approved: true,
      values: {},
    });
    const reply = assistantReply(await run);
    assert.equal(created(), 1);
    assert.equal(reply.execution?.[0]?.status, "applied");
    assert.match(
      executionReport(reply.execution ?? [], "fixture.atlassian.net"),
      /완료.*프롬프트 반영/,
    );
    assert.equal(reply.answer, "", "도구 완료 전의 오래된 안내가 표시됨");
    assert.doesNotMatch(reply.answer, /기다리고/);
    assert.throws(
      () =>
        f.assistant.approvals.respond({
          requestId,
          id: request.id,
          approved: true,
          values: {},
        }),
      /종료/,
    );
    assert.equal(created(), 1);
  } finally {
    f.assistant.dispose();
  }
});
for (const decision of ["skip", "feedback", "expire"] as const)
  test(`생성 승인 ${decision}는 저장하지 않고 모델 답변과 별도로 실제 미실행 결과를 반환한다`, async (t) => {
    const f = fixture(),
      created = stubCreation(f),
      requestId = "b".repeat(32);
    try {
      const run = f.assistant.run({
        prompt: "하위 작업 생성",
        context,
        requestId,
      });
      await f.waitTurn();
      if (decision === "expire") t.mock.timers.enable({ apis: ["setTimeout"] });
      emitCreation(f);
      const request = await approvalOf(f, requestId);
      if (decision === "expire") {
        t.mock.timers.tick(300000);
        t.mock.timers.reset();
      } else
        f.assistant.approvals.respond({
          requestId,
          id: request.id,
          approved: false,
          values:
            decision === "feedback"
              ? { feedback: "다른 상위로 바꿔주세요" }
              : {},
        });
      for (let step = 0; step < 20; step++) await Promise.resolve();
      f.complete(
        decision === "feedback"
          ? "상위는 모의 상위 작업(AA-1)입니다. 어떤 상위로 바꿀지 알려 주세요."
          : "이슈를 생성했습니다.",
      );
      const reply = await run;
      assert.equal(created(), 0);
      assert.equal(reply.execution?.[0]?.status, "notApproved");
      assert.match(
        executionReport(reply.execution ?? [], "fixture.atlassian.net"),
        /미실행/,
      );
      if (decision === "feedback") assert.match(reply.answer, /모의 상위 작업/);
      assert.equal(
        reply.execution?.[0]?.reason,
        decision === "expire"
          ? "expired"
          : decision === "feedback"
            ? "feedback"
            : undefined,
      );
    } finally {
      f.assistant.dispose();
    }
  });
test("승인 대기 중 취소하면 뒤늦은 승인이나 후속 변경을 실행하지 않는다", async () => {
  const f = fixture(),
    created = stubCreation(f),
    requestId = "c".repeat(32),
    abort = new AbortController();
  try {
    const run = f.assistant.run(
      { prompt: "생성", context, requestId },
      abort.signal,
    );
    const rejected = assert.rejects(run, /취소/);
    await f.waitTurn();
    emitCreation(f);
    const request = await approvalOf(f, requestId);
    abort.abort();
    await rejected;
    assert.equal(created(), 0);
    assert.deepEqual(f.assistant.approvals.pending(requestId), []);
    assert.throws(
      () =>
        f.assistant.approvals.respond({
          requestId,
          id: request.id,
          approved: true,
          values: {},
        }),
      /종료/,
    );
  } finally {
    f.assistant.dispose();
  }
});
test("연결 MCP의 생성도 완료 이벤트 전에는 종료하지 않고 확인된 실행 결과를 표시한다", async () => {
  const f = fixture();
  try {
    const run = f.assistant.run({ prompt: "모의 생성", context });
    await f.waitTurn();
    f.emit("item/started", {
      threadId: "thread",
      item: {
        id: "mcp-1",
        type: "mcpToolCall",
        tool: "jira_create_issue",
        status: "inProgress",
      },
    });
    let finished = false;
    void run.then(() => {
      finished = true;
    });
    f.complete("승인 결과를 기다리는 중입니다.");
    await Promise.resolve();
    assert.equal(finished, false);
    const execution = [
      {
        tool: "jira_create_issue",
        label: "이슈 생성 · 모의 작업",
        status: "applied",
        keys: ["AA-99"],
      },
    ];
    f.emit("item/completed", {
      threadId: "thread",
      item: {
        id: "mcp-1",
        type: "mcpToolCall",
        tool: "jira_create_issue",
        status: "completed",
        result: {
          content: [{ type: "text", text: JSON.stringify({ execution }) }],
        },
      },
    });
    const reply = await run;
    assert.match(
      executionReport(reply.execution ?? [], "fixture.atlassian.net"),
      /완료.*모의 작업/,
    );
    assert.equal(reply.execution?.[0]?.keys[0], "AA-99");
    assert.doesNotMatch(reply.answer, /기다리는/);
  } finally {
    f.assistant.dispose();
  }
});

test("한 작업을 실행한 뒤 남은 작업의 필수 질문도 함께 반환한다", async () => {
  const f = fixture(),
    created = stubCreation(f),
    requestId = "d".repeat(32);
  try {
    const run = f.assistant.run({
      prompt: "하위 작업 두 개를 만들어줘",
      context,
      requestId,
    });
    await f.waitTurn();
    emitCreation(f);
    const request = await approvalOf(f, requestId);
    f.assistant.approvals.respond({
      requestId,
      id: request.id,
      approved: true,
      values: {},
    });
    for (let i = 0; i < 40; i++) await Promise.resolve();
    f.complete("둘째 작업의 상위는 Alpha(AA-1)와 Beta(AA-2) 중 어느 것인가요?");
    const reply = await run;
    assert.equal(created(), 1);
    assert.equal(reply.execution?.[0]?.status, "applied");
    assert.match(reply.answer, /Alpha.*Beta/);
  } finally {
    f.assistant.dispose();
  }
});
