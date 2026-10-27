import assert from "node:assert/strict";
import { test } from "node:test";
import { record } from "../src/domain/validation.ts";
import { createHttpServer } from "../src/server/http.ts";
import { createJiraService } from "../src/server/jira-service.ts";

const doc = {
  type: "doc",
  version: 1,
  content: [{ type: "paragraph", content: [{ type: "text", text: "내용" }] }],
};
const comment = {
  id: "10",
  author: { accountId: "my-account" },
  created: "2026-10-01T10:00:00Z",
  body: doc,
};
async function setup() {
  let jiraCalls = 0;
  const writes: { path: string; method: string; body: unknown }[] = [];
  const service = createJiraService({
    credentials: {
      site: "example.atlassian.net",
      email: "test@example.com",
      token: "fake-secret",
    },
    fetcher: async (value, options) => {
      jiraCalls++;
      const url = new URL(String(value)),
        path = url.pathname;
      if (options?.method === "PUT" || options?.method === "POST") {
        writes.push({
          path,
          method: options.method,
          body: JSON.parse(String(options.body)),
        });
        return path.includes("/comment")
          ? Response.json(comment)
          : new Response(null, { status: 204 });
      }
      if (path.endsWith("/users/search")) return Response.json([]);
      if (path.endsWith("/field")) return Response.json([]);
      if (path.endsWith("/myself"))
        return Response.json({ accountId: "my-account", displayName: "나" });
      if (path.endsWith("/project/search"))
        return Response.json({
          values: [{ key: "AA", name: "프로젝트" }],
          isLast: true,
        });
      if (path.endsWith("/priority/search"))
        return Response.json({ values: [], isLast: true });
      if (path.endsWith("/issuetypes"))
        return Response.json({ issueTypes: [], isLast: true });
      if (path.endsWith("/statuses")) return Response.json([{ statuses: [] }]);
      if (path === "/rest/agile/1.0/board")
        return Response.json({ values: [] });
      if (path.includes("/user/"))
        return Response.json([{ accountId: "my-account", displayName: "나" }]);
      if (path.endsWith("/transitions"))
        return Response.json({
          transitions: [{ id: "1", to: { name: "진행" } }],
        });
      if (path.endsWith("/editmeta"))
        return Response.json({
          fields: { priority: { operations: ["set"], allowedValues: [] } },
        });
      if (path.endsWith("/comment/10")) return Response.json(comment);
      if (path.endsWith("/comment"))
        return Response.json({ total: 0, startAt: 0, comments: [] });
      if (path === "/activity")
        return new Response('<feed xmlns="http://www.w3.org/2005/Atom"/>', {
          headers: { "Content-Type": "application/atom+xml" },
        });
      if (path.endsWith("/changelog"))
        return Response.json(
          url.searchParams.get("maxResults") === "1"
            ? { total: 0 }
            : { values: [] },
        );
      if (path.endsWith("/search/jql")) return Response.json({ issues: [] });
      if (path.includes("/attachment/content/"))
        return new Response("ok", { headers: { "Content-Type": "image/png" } });
      if (path.includes("/universal_avatar/"))
        return new Response("<svg/>", {
          headers: { "Content-Type": "image/svg+xml" },
        });
      return Response.json({
        key: "AA-1",
        fields: {
          summary: "제목",
          description: doc,
          attachment: [
            {
              id: "101",
              filename: "image.png",
              mimeType: "image/png",
              size: 2,
            },
          ],
        },
      });
    },
  });
  const server = createHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("로컬 주소를 찾지 못했습니다.");
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    service,
    server,
    count: () => jiraCalls,
    writes,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
test("HTTP 조회 경로가 새 서비스·JSON·바이너리에 연결된다", async (t) => {
  const app = await setup();
  t.after(app.close);
  for (const path of [
    "/api/projects",
    "/api/issue-types?projects=AA",
    "/api/statuses?projects=AA",
    "/api/assignees?projects=AA",
    "/api/issues?projects=AA",
    "/api/children?key=AA-1&projects=AA",
    "/api/changes?projects=AA",
    "/api/issue?key=AA-1",
    "/api/detail?key=AA-1",
    "/api/options?key=AA-1",
    "/api/transitions?key=AA-1",
    "/api/priority-options?key=AA-1",
    "/api/issue-children?key=AA-1",
    "/api/comments?key=AA-1",
    "/api/history?key=AA-1",
    "/api/mention-users?key=AA-1",
    "/api/matches?key=AA-1&projects=AA",
  ]) {
    const response = await fetch(app.base + path);
    assert.equal(response.status, 200, path);
    assert.ok(
      response.headers.get("content-type")?.startsWith("application/json"),
    );
  }
  const image = await fetch(`${app.base}/api/image?key=AA-1&name=image.png`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  const icon = await fetch(
    app.base +
      "/api/type-icon?url=" +
      encodeURIComponent(
        "https://example.atlassian.net/rest/api/3/universal_avatar/view/type/project/avatar/101",
      ),
  );
  assert.equal(icon.status, 200);
  assert.ok(icon.headers.get("content-security-policy")?.includes("sandbox"));
});
test("HTTP 변경은 허용된 Origin·JSON·입력만 서비스에 전달한다", async (t) => {
  const app = await setup();
  t.after(app.close);
  const post = (path: string, body: object, origin = app.base) =>
    fetch(app.base + path, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await post(
        "/api/update",
        { key: "AA-1", field: "dueDate", value: "" },
        "https://attacker.example",
      )
    ).status,
    403,
  );
  assert.equal(app.count(), 0);
  assert.equal(
    (await post("/api/update", { key: "AA-1", field: "dueDate" })).status,
    400,
  );
  assert.equal(app.count(), 0);
  for (const [path, body] of Object.entries({
    "/api/update": { key: "AA-1", field: "dueDate", value: "2026-10-01" },
    "/api/comment": { key: "AA-1", document: doc },
    "/api/comment-edit": { key: "AA-1", id: "10", document: doc },
    "/api/description": { key: "AA-1", description: doc },
    "/api/bulk-options": { keys: ["AA-1"], field: "status" },
    "/api/bulk-update": {
      keys: ["AA-1"],
      field: "dueDate",
      value: "2026-10-01",
    },
  }))
    assert.equal((await post(path, body)).status, 200, path);
  const bad = await post("/api/comment", { key: "AA-1", document: {} });
  assert.equal(bad.status, 400);
  assert.equal(
    (await post("/api/bulk-undo", { token: "missing" })).status,
    400,
  );
  assert.equal(
    (await post("/api/comment", { key: "AA-1", text: "x".repeat(21000) }))
      .status,
    400,
  );
});
test("빈 댓글은 Jira를 호출하지 않고 400으로 안내한다", async (t) => {
  const app = await setup();
  t.after(app.close);
  const response = await fetch(`${app.base}/api/comment`, {
    method: "POST",
    headers: { Origin: app.base, "Content-Type": "application/json" },
    body: JSON.stringify({
      key: "AA-1",
      document: { type: "doc", version: 1, content: [] },
    }),
  });
  assert.equal(response.status, 400);
  assert.equal(app.count(), 0);
});
test("HTTP 검증 오류·존재하지 않는 경로·정적 빌드 파일을 처리한다", async (t) => {
  const app = await setup();
  t.after(app.close);
  for (const path of [
    "/api/issue?key=invalid",
    "/api/issues?excludeDone=yes",
    "/api/issues?scope=invalid",
    "/api/children?key=AA-1&people=invalid",
  ])
    assert.equal((await fetch(app.base + path)).status, 400, path);
  assert.equal((await fetch(`${app.base}/api/unknown`)).status, 404);
  const response = await fetch(`${app.base}/`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes("Fast Jira"));
  assert.ok(html.includes('rel="icon"'));
  const assets = [
    ...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+\.(?:js|css))"/g),
  ].map((match) => {
    assert.ok(match[1]);
    return match[1];
  });
  assert.equal(assets.length, 2, "Vite 진입 JS·CSS가 빌드되지 않았습니다.");
  for (const path of [...assets, "/assets/icons.svg"]) {
    const asset = await fetch(app.base + path);
    assert.equal(asset.status, 200, path);
    const type = asset.headers.get("content-type") ?? "";
    assert.ok(
      type.includes(
        path.endsWith(".css")
          ? "text/css"
          : path.endsWith(".svg")
            ? "image/svg+xml"
            : "text/javascript",
      ),
      path,
    );
    assert.ok((await asset.text()).length > 0);
  }
});
test("개발자 로그 경로를 제공하거나 Jira를 추가 조회하지 않는다", async (t) => {
  const app = await setup();
  t.after(app.close);
  const before = app.count();
  const response = await fetch(`${app.base}/api/debug`);
  assert.equal(response.status, 404);
  assert.equal(app.count(), before);
});

test("HTTP 활동 조회는 프로젝트만 받아 단일 Atom 피드를 반환한다", async (t) => {
  const app = await setup();
  t.after(app.close);
  const before = app.count();
  const response = await fetch(`${app.base}/api/activity?projects=AA`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    feed: '<feed xmlns="http://www.w3.org/2005/Atom"/>',
  });
  assert.equal(app.count() - before, 1);
  const invalid = await fetch(`${app.base}/api/activity?projects=AA%26bad`);
  assert.equal(invalid.status, 400);
  assert.equal(app.count() - before, 1);
});

test("HTTP 되돌리기는 기대값을 서버 검사로 전달하고 잘못된 값은 Jira 호출 전에 거부한다", async (t) => {
  const app = await setup();
  t.after(app.close);
  const post = (expected: unknown) =>
    fetch(`${app.base}/api/update`, {
      method: "POST",
      headers: { Origin: app.base, "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "AA-1",
        field: "summary",
        value: "원래 제목",
        expected,
      }),
    });
  assert.equal((await post(null)).status, 400);
  assert.equal(app.count(), 0);
  const conflict = await post("내 제목");
  assert.equal(conflict.status, 409);
  assert.match(String(record(await conflict.json()).error), /이후 변경/);
});

test("허용 글자수 안의 한글·이모지·멘션 댓글은 작성·답글·편집 모두 원문 그대로 전송한다", async (t) => {
  const app = await setup();
  t.after(app.close);
  const post = (path: string, body: object) =>
    fetch(app.base + path, {
      method: "POST",
      headers: { Origin: app.base, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const documents = [
    {
      ...doc,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "한".repeat(10000) }],
        },
      ],
    },
    {
      ...doc,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "🙂".repeat(5000) }],
        },
      ],
    },
    {
      ...doc,
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "한".repeat(9997),
              marks: [{ type: "strong" }],
            },
            { type: "mention", attrs: { id: "my-account", text: "@동료" } },
          ],
        },
      ],
    },
  ];
  for (const document of documents)
    for (const kind of ["add", "reply", "edit"] as const) {
      const input = {
        key: "AA-1",
        document,
        ...(kind === "reply" ? { parentId: "10" } : {}),
        ...(kind === "edit" ? { id: "10" } : {}),
      };
      assert.ok(Buffer.byteLength(JSON.stringify(input)) > 20000);
      const before = app.writes.length;
      const response = await post(
        kind === "edit" ? "/api/comment-edit" : "/api/comment",
        input,
      );
      assert.equal(response.status, 200, kind);
      assert.equal(app.writes.length, before + 1);
      assert.deepEqual(app.writes.at(-1), {
        path:
          kind === "edit"
            ? "/rest/api/3/issue/AA-1/comment/10"
            : "/rest/api/3/issue/AA-1/comment",
        method: kind === "edit" ? "PUT" : "POST",
        body: {
          body: document,
          ...(kind === "reply" ? { parentId: "10" } : {}),
        },
      });
    }
  const response = await post("/api/comment", {
    key: "AA-1",
    text: "한".repeat(10000),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(app.writes.at(-1)?.body, { body: documents[0] });
});

test("댓글 전송 한도가 늘어도 글자수·멘션·용량 오류는 Jira 호출 전에 차단한다", async (t) => {
  const app = await setup();
  t.after(app.close);
  const post = (path: string, body: object, origin = app.base) =>
    fetch(app.base + path, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  for (const path of ["/api/comment", "/api/comment-edit"]) {
    const base = { key: "AA-1", id: "10" };
    const tooLong = await post(path, {
      ...base,
      document: {
        ...doc,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "한".repeat(10001) }],
          },
        ],
      },
    });
    assert.equal(tooLong.status, 400);
    assert.match(String(record(await tooLong.json()).error), /10000/);
    const badMention = await post(path, {
      ...base,
      document: {
        ...doc,
        content: [
          {
            type: "paragraph",
            content: [{ type: "mention", attrs: { id: "" } }],
          },
        ],
      },
    });
    assert.equal(badMention.status, 400);
    assert.match(String(record(await badMention.json()).error), /멘션/);
    const tooLarge = await post(path, {
      ...base,
      document: {
        ...doc,
        content: [
          {
            type: "paragraph",
            attrs: { data: "x".repeat(500000) },
            content: [{ type: "text", text: "내용" }],
          },
        ],
      },
    });
    assert.equal(tooLarge.status, 400);
    assert.match(String(record(await tooLarge.json()).error), /너무 큽니다/);
  }
  const textTooLong = await post("/api/comment", {
    key: "AA-1",
    text: "한".repeat(10001),
  });
  assert.equal(textTooLong.status, 400);
  assert.match(String(record(await textTooLong.json()).error), /10000/);
  assert.equal(
    (
      await post(
        "/api/comment",
        { key: "AA-1", document: doc },
        "https://attacker.example",
      )
    ).status,
    403,
  );
  const ordinaryTooLarge = await post("/api/update", {
    key: "AA-1",
    field: "summary",
    value: "x".repeat(21000),
  });
  assert.equal(ordinaryTooLarge.status, 400);
  assert.match(
    String(record(await ordinaryTooLarge.json()).error),
    /너무 큽니다/,
  );
  assert.equal(app.count(), 0);
  assert.deepEqual(app.writes, []);
});

test("설치 상태 확인은 인증 없이 서비스 식별 정보를 반환하고 Jira를 조회하지 않는다", async (t) => {
  const app = await setup();
  t.after(app.close);
  const response = await fetch(`${app.base}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    app: "fast-jira",
    pid: process.pid,
    instance: process.env.FAST_JIRA_INSTANCE ?? "",
  });
  assert.equal(app.count(), 0);
});
