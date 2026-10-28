import assert from "node:assert/strict";
import { test } from "node:test";
import { textDocument } from "../src/domain/adf.ts";
import { createJiraService } from "../src/server/jira-service.ts";
import { createJiraTools } from "../src/server/jira-tools.ts";

function fixture() {
  let writes = 0,
    fail = false;
  const requests: { url: URL; init?: RequestInit }[] = [];
  const service = createJiraService({
    credentials: {
      site: "fixture.atlassian.net",
      email: "fake@example.com",
      token: "fake",
    },
    fetcher: async (input, init) => {
      const url = new URL(String(input));
      requests.push({ url, ...(init ? { init } : {}) });
      if (url.pathname === "/rest/api/3/issue" && init?.method === "POST") {
        writes++;
        if (fail) throw new Error("response lost");
        return Response.json({ key: "AA-11" }, { status: 201 });
      }
      if (url.pathname.endsWith("/issuetypes"))
        return Response.json({
          issueTypes: [
            { id: "1", name: "맞춤 상위", hierarchyLevel: 1 },
            { id: "2", name: "맞춤 작업", hierarchyLevel: 0 },
            { id: "3", name: "맞춤 하위", hierarchyLevel: -1, subtask: true },
          ],
          isLast: true,
        });
      if (/issuetypes\/\d+$/.test(url.pathname))
        return Response.json({
          fields: [
            {
              fieldId: "project",
              name: "프로젝트",
              required: true,
              schema: { type: "project" },
            },
            {
              fieldId: "issuetype",
              name: "유형",
              required: true,
              schema: { type: "issuetype" },
            },
            {
              fieldId: "summary",
              name: "제목",
              required: true,
              schema: { type: "string" },
            },
            {
              fieldId: "description",
              name: "설명",
              schema: { type: "string" },
            },
            {
              fieldId: "customfield_77",
              name: "출시 구분",
              required: true,
              schema: { type: "option" },
              allowedValues: [{ id: "7", value: "배포" }],
              defaultValue: { id: "7" },
            },
            {
              fieldId: "customfield_88",
              name: "기획",
              schema: { type: "array", items: "user" },
            },
          ],
          isLast: true,
        });
      if (url.pathname.startsWith("/rest/api/3/issue/")) {
        const subtask = url.pathname.endsWith("AA-3"),
          other = url.pathname.endsWith("BB-1");
        return Response.json({
          key: subtask ? "AA-3" : other ? "BB-1" : "AA-1",
          fields: {
            project: { key: other ? "BB" : "AA" },
            issuetype: {
              id: subtask ? "3" : "2",
              hierarchyLevel: subtask ? -1 : 0,
            },
          },
        });
      }
      return Response.json({ issues: [], isLast: true });
    },
  });
  return {
    service,
    requests,
    get writes() {
      return writes;
    },
    loseResponse() {
      fail = true;
    },
  };
}
const draft = {
  project: "AA",
  type: "2",
  parent: "",
  fields: {
    summary: "새 작업",
    description: textDocument("원문 https://workspace.slack.com/archives/A/p1"),
  },
};
test("프로젝트·유형 생성 메타정보는 동시 조회를 공유하고 필수값·기본값·사람 필드를 보존한다", async () => {
  const f = fixture();
  const [one, two] = await Promise.all([
    f.service.creationMetadata("AA", "2"),
    f.service.creationMetadata("AA", "2"),
  ]);
  assert.deepEqual(one, two);
  assert.equal(one.level, 0);
  assert.equal(
    one.fields.find((field) => field.id === "customfield_88")?.items,
    "user",
  );
  assert.deepEqual(
    one.fields.find((field) => field.id === "customfield_77")?.defaultValue,
    { id: "7" },
  );
  assert.equal(
    f.requests.filter((item) => item.url.pathname.endsWith("/issuetypes/2"))
      .length,
    1,
  );
});
test("생성은 명시적 요청에서만 저장하고 중복 클릭·응답 유실에도 동일 요청을 재전송하지 않는다", async () => {
  const f = fixture(),
    tools = createJiraTools(f.service);
  assert(!tools.definitions.some((tool) => tool.name === "jira_create_issue"));
  assert.deepEqual(await tools.call("jira_prepare_issue", draft), draft);
  assert.equal(f.writes, 0);
  const results = await Promise.all([
    f.service.createIssue(draft, "request_123"),
    f.service.createIssue(draft, "request_123"),
  ]);
  assert.deepEqual(results, [{ key: "AA-11" }, { key: "AA-11" }]);
  assert.equal(f.writes, 1);
  const saved = f.requests.find((item) => item.init?.method === "POST");
  const body = JSON.parse(String(saved?.init?.body));
  assert.deepEqual(body.fields.project, { key: "AA" });
  assert.deepEqual(body.fields.description, draft.fields.description);
  assert.throws(
    () =>
      f.service.createIssue(
        { ...draft, fields: { summary: "다름" } },
        "request_123",
      ),
    /이전 생성/,
  );
  const lost = fixture();
  lost.loseResponse();
  await assert.rejects(
    lost.service.createIssue(draft, "request_lost"),
    /response lost/,
  );
  await assert.rejects(
    lost.service.createIssue(draft, "request_lost"),
    /response lost/,
  );
  assert.equal(lost.writes, 1);
});
test("서브태스크는 같은 프로젝트의 바로 상위만 허용하며 필수값·유형·필드·선택값을 검증한다", async () => {
  const f = fixture();
  await assert.rejects(
    f.service.createIssue({ ...draft, type: "3" }, "request_no_parent"),
    /상위 이슈/,
  );
  await assert.rejects(
    f.service.validateCreation({ ...draft, type: "3", parent: "BB-1" }, true),
    /같은 프로젝트/,
  );
  await assert.rejects(
    f.service.validateCreation({ ...draft, type: "3", parent: "AA-3" }, true),
    /상위 계층/,
  );
  await assert.rejects(
    f.service.validateCreation({ ...draft, fields: { summary: "" } }, true),
    /제목/,
  );
  await assert.rejects(
    f.service.validateCreation(
      { ...draft, fields: { summary: "제목", customfield_77: { id: "999" } } },
      true,
    ),
    /선택 값/,
  );
  await assert.rejects(
    f.service.validateCreation(
      { ...draft, fields: { summary: "제목", status: { id: "99" } } },
      true,
    ),
    /생성할 수 없는 필드/,
  );
  await assert.rejects(
    f.service.validateCreation({ ...draft, type: "99" }, true),
    /유형/,
  );
  await f.service.createIssue(
    { ...draft, type: "3", parent: "AA-1" },
    "request_subtask",
  );
  assert.equal(f.writes, 1);
});
test("상위 검색은 실제 유형 계층과 프로젝트로 제한하며 키·제목·커서를 전달한다", async () => {
  const f = fixture();
  await f.service.creationParents("AA", "3", '10월 "배포"', "next");
  const url = f.requests.at(-1)?.url;
  assert.match(
    url?.searchParams.get("jql") ?? "",
    /project = AA AND issuetype in \(2\)/,
  );
  assert.equal(url?.searchParams.get("nextPageToken"), "next");
  await f.service.creationParents("AA", "2", "AA-1");
  assert.match(
    f.requests.at(-1)?.url.searchParams.get("jql") ?? "",
    /key = AA-1/,
  );
  assert.match(
    f.requests.at(-1)?.url.searchParams.get("jql") ?? "",
    /issuetype in \(1\)/,
  );
});

test("생성 메타정보에 계층이 없으면 실제 유형 정보로 보완하고 서브태스크를 식별한다", async () => {
  const service = createJiraService({
    credentials: {
      site: "fixture.atlassian.net",
      email: "fake@example.com",
      token: "fake",
    },
    fetcher: async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/issuetypes"))
        return Response.json({
          issueTypes: [
            { id: "1", name: "에픽" },
            { id: "3", name: "하위", subtask: true },
          ],
          isLast: true,
        });
      if (path.endsWith("/issuetype"))
        return Response.json([
          { id: "1", hierarchyLevel: 1 },
          { id: "3", subtask: true },
        ]);
      return Response.json({
        fields: [
          {
            fieldId: "environment",
            name: "환경",
            required: true,
            schema: { type: "string" },
          },
        ],
        isLast: true,
      });
    },
  });
  assert.deepEqual(
    (await service.creationTypes("AA")).map((type) => type.hierarchyLevel),
    [1, -1],
  );
  const meta = await service.creationMetadata("AA", "3");
  assert.equal(meta.level, -1);
  assert.equal(meta.fields[0]?.type, "textarea");
  await assert.rejects(
    service.validateCreation(
      { project: "AA", type: "3", fields: { summary: "제목" } },
      true,
    ),
    /상위 이슈/,
  );
});

test("Codex와 Claude 모두 생성 도구 결과를 초안으로만 반환한다", async () => {
  const { createAssistantService } = await import(
    "../src/server/assistant-service.ts"
  );
  const { createClaudeAssistant } = await import(
    "../src/server/claude-assistant.ts"
  );
  const f = fixture();
  type Message = import("../src/server/codex-client.ts").CodexMessage;
  let listener: (message: Message) => void = () => {};
  const assistant = createAssistantService(
    () => f.service,
    async () => ({
      async request(method) {
        if (method === "account/read") return { account: { type: "chatgpt" } };
        if (method === "model/list")
          return { data: [{ model: "test", isDefault: true }] };
        if (method === "config/read") return { config: { mcp_servers: {} } };
        if (method === "app/installed") return { apps: [] };
        if (method === "mcpServerStatus/list")
          return { data: [], nextCursor: null };
        if (method === "thread/start") return { thread: { id: "new" } };
        if (method === "turn/start") {
          setTimeout(
            () =>
              listener({
                id: 1,
                method: "item/tool/call",
                params: {
                  threadId: "new",
                  tool: "jira_prepare_issue",
                  arguments: draft,
                },
              }),
            0,
          );
          return {};
        }
        return {};
      },
      respond(_id, result) {
        assert.equal((result as { success: boolean }).success, true);
        listener({
          method: "turn/completed",
          params: { threadId: "new", turn: { status: "completed" } },
        });
      },
      listen(next) {
        listener = next;
        return () => {};
      },
      close() {},
    }),
    {
      status: async () => ({ ready: false, models: [], error: "offline" }),
      run: async () => {
        throw new Error("offline");
      },
      dispose() {},
    },
  );
  const reply = await assistant.run({
    prompt: "작업 만들어줘",
    model: "test",
    context: { projects: ["AA"], issue: "", keys: [] },
  });
  assert.deepEqual(reply.creations, [draft]);
  assert.equal(f.writes, 0);
  assistant.dispose();
  const claude = createClaudeAssistant(
    () => f.service,
    "test",
    async (command) => {
      if (command.args[0] === "auth")
        return {
          loggedIn: true,
          authMethod: "claude.ai",
          apiProvider: "firstParty",
        };
      const config = JSON.parse(
        command.args[command.args.indexOf("--mcp-config") + 1] ?? "{}",
      );
      const { url, headers } = config.mcpServers.fast_jira;
      const { Client } = await import(
        "@modelcontextprotocol/sdk/client/index.js"
      );
      const { StreamableHTTPClientTransport } = await import(
        "@modelcontextprotocol/sdk/client/streamableHttp.js"
      );
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers },
      });
      const client = new Client({ name: "test", version: "1" });
      try {
        await client.connect(transport);
        const result = await client.callTool({
          name: "jira_prepare_issue",
          arguments: draft,
        });
        assert(!result.isError);
      } finally {
        await transport.terminateSession();
        await client.close();
      }
      return { is_error: false, result: "생성안을 확인하세요." };
    },
  );
  const other = await claude.run({
    prompt: "작업 만들어줘",
    model: "claude:sonnet",
    context: { projects: ["AA"], issue: "", keys: [] },
    history: [],
  });
  assert.deepEqual(other.creations, [draft]);
  assert.equal(f.writes, 0);
  claude.dispose();
});

test("새 하위 이슈는 전체 재조회 없이 현재 페이지에 추가하고 기존 커서를 유지한다", async () => {
  const { createListController } = await import(
    "../src/client/list-controller.ts"
  );
  const { emptyIssue } = await import("../src/domain/wire.ts");
  let reads = 0;
  const parent = { ...emptyIssue("AA-1"), project: "AA", hasChildren: true };
  const list = createListController(
    {
      issues: async () => {
        reads++;
        return { issues: [parent], ancestors: [], nextPageToken: "root-next" };
      },
      children: async () => {
        reads++;
        return { issues: [], nextPageToken: "child-next" };
      },
    },
    {
      projects: ["AA"],
      scope: "all",
      excludeDone: false,
      statuses: null,
      assignees: null,
      sort: "recent",
      q: "",
    },
    "me",
  );
  await list.load();
  await list.queueChildren("AA-1");
  const created = { ...emptyIssue("AA-11"), project: "AA", parent: "AA-1" };
  list.insertCreated(created, true);
  assert.equal(list.childPage("AA-1").issues.get("AA-11"), created);
  assert.equal(list.childPage("AA-1").nextPageToken, "child-next");
  assert.equal(reads, 2);
  list.destroy();
});

test("HTTP 생성 경로는 동일 출처 JSON만 허용하고 같은 요청 ID를 재전송하지 않는다", async (t) => {
  const { createHttpServer } = await import("../src/server/http.ts");
  const { once } = await import("node:events");
  const f = fixture(),
    server = createHttpServer(f.service);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const send = (from: string) =>
    fetch(`${origin}/api/create-issue`, {
      method: "POST",
      headers: { Origin: from, "Content-Type": "application/json" },
      body: JSON.stringify({ draft, requestId: "http_create_1" }),
    });
  assert.equal((await send("https://other.example")).status, 403);
  assert.equal(f.writes, 0);
  for (let index = 0; index < 2; index++) {
    const response = await send(origin);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { key: "AA-11" });
  }
  assert.equal(f.writes, 1);
});
