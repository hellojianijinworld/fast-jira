import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantApproval } from "../src/domain/assistant-approval.ts";
import { createAssistantApprovals } from "../src/server/assistant-approvals.ts";
import {
  answerCodexApproval,
  codexToolApprovals,
} from "../src/server/codex-approvals.ts";
import type { CodexClient } from "../src/server/codex-client.ts";

const token = "0123456789abcdef0123456789abcdef";
const request = {
  title: "파일 변경",
  description: "한 번만",
  details: "target.txt",
  fields: [],
};
test("승인은 현재 브라우저 요청에만 한 번 적용되고 거절·종료는 권한을 주지 않는다", async () => {
  const broker = createAssistantApprovals(),
    run = broker.open(token);
  const promise = run.ask(request);
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  const pending = broker.pending(token)[0];
  assert(pending);
  assert.deepEqual(broker.pending("f".repeat(32)), []);
  assert.throws(
    () =>
      broker.respond({
        requestId: "f".repeat(32),
        id: pending.id,
        approved: true,
        values: {},
      }),
    /종료/,
  );
  broker.respond({
    requestId: token,
    id: pending.id,
    approved: true,
    values: { injected: "ignored" },
  });
  assert.deepEqual(
    { ...(await promise) },
    { approved: true, values: Object.create(null) },
  );
  assert.throws(
    () =>
      broker.respond({
        requestId: token,
        id: pending.id,
        approved: true,
        values: {},
      }),
    /종료/,
  );
  const cancelled = run.ask(request);
  run.close();
  assert.equal((await cancelled).approved, false);
  assert.equal((await run.ask(request)).approved, false);
  assert.throws(() => broker.pending("invalid"), /식별자/);
  const other = broker.open(token),
    abandoned = other.ask(request);
  broker.dispose();
  assert.equal((await abandoned).approved, false);
});
test("승인 폼은 필수 값과 선택지를 검사하고 요청한 필드만 반환한다", async () => {
  const broker = createAssistantApprovals(),
    run = broker.open(token);
  const promise = run.ask({
    ...request,
    fields: [
      {
        key: "target",
        label: "대상",
        type: "text",
        required: true,
        options: ["A", "B"],
      },
    ],
  });
  const id = broker.pending(token)[0]?.id;
  for (const values of [{}, { target: "" }, { target: "C" }, { target: 1 }])
    assert.throws(() =>
      broker.respond({ requestId: token, id, approved: true, values }),
    );
  broker.respond({
    requestId: token,
    id,
    approved: true,
    values: { target: "B", extra: "not allowed" },
  });
  assert.deepEqual({ ...(await promise).values }, { target: "B" });
  run.close();
});
test("Codex 명령·파일 승인은 자동 진행하지 않고 이번 실행만 승인한다", async () => {
  let shown: Omit<AssistantApproval, "id"> | undefined;
  const approved = async (r: Omit<AssistantApproval, "id">) => {
    shown = r;
    return { approved: true, values: {} };
  };
  assert.deepEqual(
    await answerCodexApproval(
      "item/commandExecution/requestApproval",
      {
        command: "touch target.txt",
        cwd: "/tmp",
        availableDecisions: ["accept", "decline"],
      },
      approved,
    ),
    { decision: "accept" },
  );
  assert.match(shown?.details ?? "", /touch target.txt/);
  assert.deepEqual(
    await answerCodexApproval(
      "item/commandExecution/requestApproval",
      { availableDecisions: ["decline"] },
      approved,
    ),
    { decision: "decline" },
  );
  assert.deepEqual(
    await answerCodexApproval(
      "item/fileChange/requestApproval",
      {},
      async () => ({ approved: false, values: {} }),
      { changes: [{ path: "target.txt", diff: "-old\n+new" }] },
    ),
    { decision: "decline" },
  );
  assert.deepEqual(
    await answerCodexApproval(
      "item/permissions/requestApproval",
      { permissions: { network: { enabled: true } } },
      approved,
    ),
    { permissions: { network: { enabled: true } }, scope: "turn" },
  );
});
test("MCP 폼은 사용자가 확인한 값만 돌려주고 거절은 원격 승인이 되지 않는다", async () => {
  const params = {
    serverName: "notion",
    mode: "form",
    message: "문서 수정",
    requestedSchema: {
      type: "object",
      properties: { confirm: { type: "boolean" } },
      required: ["confirm"],
    },
  };
  assert.deepEqual(
    await answerCodexApproval(
      "mcpServer/elicitation/request",
      params,
      async (r) => {
        assert.equal(r.fields[0]?.key, "confirm");
        return { approved: true, values: { confirm: true } };
      },
    ),
    { action: "accept", content: { confirm: true }, _meta: null },
  );
  assert.deepEqual(
    await answerCodexApproval(
      "mcpServer/elicitation/request",
      params,
      async () => ({ approved: false, values: {} }),
    ),
    { action: "decline", content: null, _meta: null },
  );
});
test("연결된 앱과 MCP를 끄지 않고 모든 쓰기 도구에 승인 정책을 적용한다", async () => {
  const calls: { method: string; params: unknown }[] = [];
  const native = {
    request: async (method: string, params: unknown) => {
      calls.push({ method, params });
      if (method === "config/read")
        return { config: { mcp_servers: { notion: { command: "native" } } } };
      if (method === "mcpServerStatus/list")
        return {
          data: [{ name: "notion", tools: { read: {}, write: {} } }],
          nextCursor: null,
        };
      if (method === "app/installed")
        return {
          apps: Array.from({ length: 101 }, (_, i) => ({ id: `app${i}` })),
        };
      if (method === "app/read")
        return {
          apps: (params as { appIds: string[] }).appIds.map((id) => ({
            id,
            toolSummaries: [{ name: "search" }, { name: "edit" }],
          })),
        };
      throw new Error(method);
    },
  } as CodexClient;
  const config = await codexToolApprovals(native);
  assert.equal(calls.filter((c) => c.method === "app/read").length, 2);
  assert.equal(
    config["mcp_servers.notion.tools.write.approval_mode"],
    "writes",
  );
  assert.equal(config["mcp_servers.notion.tools.read.approval_mode"], "writes");
  assert.equal(JSON.stringify(config).includes("enabled"), false);
  assert.equal(config["apps.app100.tools.edit.approval_mode"], "writes");
});

test("오래된 승인 요청은 자동 거절되고 재사용할 수 없다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const broker = createAssistantApprovals(),
    run = broker.open(token),
    pending = run.ask(request);
  const id = broker.pending(token)[0]?.id;
  t.mock.timers.tick(300000);
  assert.equal((await pending).approved, false);
  assert.throws(
    () => broker.respond({ requestId: token, id, approved: true, values: {} }),
    /종료/,
  );
  run.close();
});

test("다른 의견은 승인하지 않고 허용한 의견 값만 보존한다", async () => {
  const broker = createAssistantApprovals(),
    run = broker.open(token),
    answer = run.ask(request);
  const id = broker.pending(token)[0]?.id;
  broker.respond({
    requestId: token,
    id,
    approved: false,
    values: { approve: true, feedback: "본문을 다시 제안해주세요" },
  });
  const result = await answer;
  assert.equal(result.approved, false);
  assert.deepEqual(
    { ...result.values },
    { feedback: "본문을 다시 제안해주세요" },
  );
  run.close();
});
test("MCP 확인 질문의 기타 의견은 실행 없이 전달된다", async () => {
  const result = await answerCodexApproval(
    "mcpServer/elicitation/request",
    {
      serverName: "fast_jira",
      mode: "form",
      _meta: { "fast-jira/confirmation": true },
      requestedSchema: {
        type: "object",
        properties: { feedback: { type: "string" } },
      },
    },
    async () => ({
      approved: false,
      values: { feedback: "다시 제안해 주세요" },
    }),
  );
  assert.deepEqual(result, {
    action: "accept",
    content: { feedback: "다시 제안해 주세요" },
    _meta: null,
  });
});
