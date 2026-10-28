import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import {
  assistantContext,
  assistantReply,
  assistantStatus,
} from "../src/domain/assistant.ts";
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
  const complete = () => {
    emit("item/completed", {
      threadId: "thread",
      item: { type: "agentMessage", text: "변경안을 확인하세요." },
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
    assert.equal(start.ephemeral, true);
    assert.deepEqual(start.config, {
      "mcp_servers.unrelated.default_tools_approval_mode": "writes",
      "apps._default.default_tools_approval_mode": "writes",
      "apps._default.approvals_reviewer": "user",
    });
    assert.ok(
      !start.dynamicTools.some((tool) => tool.name === "jira_update_issues"),
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
    const pending = f.assistant.run({ prompt: "조회", context }, abort.signal);
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
    assert.equal((f.replies[0] as { success: boolean }).success, false);
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
test("AI HTTP 요청도 동일 출처 JSON 검사와 요청 취소를 따른다", async () => {
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
      "item/commandExecution/requestApproval",
      {
        threadId: "thread",
        itemId: "command",
        command: "touch target.txt",
        cwd: "/tmp",
        availableDecisions: ["accept", "decline"],
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
    assert.deepEqual(f.replies, [{ decision: "decline" }]);
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
