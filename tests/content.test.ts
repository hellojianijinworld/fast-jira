import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type AdfDocument,
  commentDocument,
  decodeAdfDocument,
  textDocument,
} from "../src/domain/adf.ts";
import { record } from "../src/domain/validation.ts";
import { createJiraClient } from "../src/server/jira-client.ts";
import { createJiraContent } from "../src/server/jira-content.ts";
import { createJiraMetadata } from "../src/server/jira-metadata.ts";

const document: AdfDocument = {
  type: "doc",
  version: 1,
  content: [
    {
      type: "paragraph",
      content: [
        { type: "mention", attrs: { id: "account-1", text: "@동료" } },
        { type: "text", text: " 확인했습니다." },
      ],
    },
  ],
};
const rawComment = (id = "10", author = "account-1") => ({
  id,
  author: { accountId: author, displayName: "작성자" },
  created: "2026-10-01T10:00:00Z",
  updated: "2026-10-01T10:01:00Z",
  body: document,
});
function setup(
  reply: (url: URL, options: RequestInit | undefined) => Response,
) {
  const calls: { url: URL; method: string; body: unknown }[] = [];
  const client = createJiraClient(
    { site: "example.atlassian.net", email: "test@example.com", token: "fake" },
    async (value, options) => {
      const url = new URL(String(value));
      const body: unknown =
        typeof options?.body === "string" ? JSON.parse(options.body) : null;
      calls.push({ url, method: options?.method ?? "GET", body });
      return reply(url, options);
    },
  );
  return {
    content: createJiraContent(client, createJiraMetadata(client)),
    calls,
  };
}
test("ADF는 표·서식·확장 노드를 손실 없이 보존하고 잘못된 입력을 거부한다", () => {
  const data = {
    type: "doc",
    version: 1,
    content: [
      {
        type: "table",
        attrs: { layout: "default", colwidth: [120, 200] },
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "표",
                        marks: [
                          {
                            type: "link",
                            attrs: { href: "https://example.com" },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      { type: "extension", attrs: { parameters: { enabled: true } } },
    ],
  };
  assert.deepEqual(decodeAdfDocument(data), data);
  assert.throws(() => decodeAdfDocument({ ...data, version: 2 }));
  assert.throws(() =>
    decodeAdfDocument({
      type: "doc",
      version: 1,
      content: [{ type: "text", text: 42 }],
    }),
  );
  assert.deepEqual(commentDocument(document), document);
  assert.throws(() =>
    commentDocument({
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [] }],
    }),
  );
  assert.throws(() =>
    commentDocument({
      type: "doc",
      version: 1,
      content: [{ type: "mention", attrs: { id: "" } }],
    }),
  );
  assert.equal(textDocument("첫 줄\n둘째 줄\n\n다음 문단").content.length, 2);
  assert.equal(
    textDocument("첫 줄\n둘째 줄").content[0]?.content?.[1]?.type,
    "hardBreak",
  );
});
test("답글은 원문 링크를 붙이지 않고 parentId와 ADF로 저장한다", async () => {
  const { content, calls } = setup(() =>
    Response.json({ ...rawComment("11"), parentId: 10 }),
  );
  const reply = await content.addComment("AA-1", { document, parentId: "10" });
  assert.equal(reply.parentId, "10");
  assert.equal(calls[0]?.method, "POST");
  assert.deepEqual(calls[0]?.body, { body: document, parentId: "10" });
  assert.equal(calls[0]?.url.pathname, "/rest/api/3/issue/AA-1/comment");
  await assert.rejects(
    content.addComment("AA-1", { document, parentId: "bad" }),
  );
  assert.equal(calls.length, 1);
});
test("내 댓글만 편집하고 다른 작성자의 댓글에는 PUT을 보내지 않는다", async () => {
  const { content, calls } = setup((url) =>
    Response.json(
      url.pathname.endsWith("/myself")
        ? { accountId: "account-1" }
        : rawComment(),
    ),
  );
  assert.equal((await content.editComment("AA-1", "10", document)).id, "10");
  assert.equal(calls.filter((call) => call.method === "PUT").length, 1);
  const other = setup((url) =>
    Response.json(
      url.pathname.endsWith("/myself")
        ? { accountId: "me" }
        : rawComment("10", "someone-else"),
    ),
  );
  await assert.rejects(
    other.content.editComment("AA-1", "10", document),
    (error) =>
      error instanceof Error && "status" in error && error.status === 403,
  );
  assert.ok(other.calls.every((call) => call.method === "GET"));
});
test("댓글 페이지는 부모 연결·작성자·본문을 정규화한다", async () => {
  const { content, calls } = setup(() =>
    Response.json({
      total: 21,
      startAt: 20,
      comments: [{ ...rawComment(), parentId: "9" }],
    }),
  );
  const page = await content.comments("AA-1", 20);
  assert.equal(page.total, 21);
  assert.equal(page.comments[0]?.parentId, "9");
  assert.equal(page.comments[0]?.authorId, "account-1");
  assert.equal(calls[0]?.url.searchParams.get("orderBy"), "-created");
  await assert.rejects(content.comments("AA-1", -1));
  assert.equal(calls.length, 1);
});
test("변경 기록은 최신 20개부터 읽고 이전 구간은 개수 재조회 없이 이어간다", async () => {
  const rawEntry = (id: string) => ({
    id,
    author: { displayName: "작성자" },
    created: "2026-10-01T10:00:00Z",
    items: [{ field: "status", fromString: null, toString: "진행" }],
  });
  const { content, calls } = setup((url) =>
    url.searchParams.get("maxResults") === "1"
      ? Response.json({ total: 35 })
      : Response.json({ values: [rawEntry("1"), rawEntry("2")] }),
  );
  const page = await content.history("AA-1");
  assert.equal(page.before, 15);
  assert.deepEqual(
    page.entries.map((entry) => entry.id),
    ["2", "1"],
  );
  assert.equal(page.entries[0]?.changes[0]?.from, "");
  assert.equal(calls[1]?.url.searchParams.get("startAt"), "15");
  assert.equal((await content.history("AA-1", page.before)).before, null);
  assert.equal(calls.length, 3);
  assert.equal(calls[2]?.url.searchParams.get("maxResults"), "15");
  await assert.rejects(content.history("AA-1", -1));
  const empty = setup(() => Response.json({ total: 0 }));
  assert.deepEqual((await empty.content.history("AA-1")).entries, []);
  assert.equal(empty.calls.length, 1);
});
test("멘션 검색은 이슈 조회 가능한 사용자 API를 사용하고 비활성 계정은 제외한다", async () => {
  const { content, calls } = setup(() =>
    Response.json([
      { accountId: "active", displayName: "활성" },
      { accountId: "inactive", active: false },
    ]),
  );
  assert.deepEqual(
    (await content.mentionUsers("AA-1", "활성")).map((user) => user.id),
    ["active"],
  );
  assert.equal(calls[0]?.url.pathname, "/rest/api/3/user/viewissue/search");
  assert.equal(calls[0]?.url.searchParams.get("query"), "활성");
  await content.mentionUsers("AA-1");
  assert.equal(calls[1]?.url.pathname, "/rest/api/3/user/assignable/search");
  await assert.rejects(content.mentionUsers("AA-1", "x".repeat(101)));
});
test("본문은 빈 문서도 저장할 수 있으며 204와 Jira 오류를 처리한다", async () => {
  const empty: AdfDocument = { type: "doc", version: 1, content: [] };
  const { content, calls } = setup(() => new Response(null, { status: 204 }));
  assert.deepEqual(
    (await content.updateDescription("AA-1", empty)).description,
    empty,
  );
  assert.deepEqual(record(calls[0]?.body).fields, { description: empty });
  const failed = setup(() =>
    Response.json({ errors: { body: "형식 오류" } }, { status: 400 }),
  );
  await assert.rejects(
    failed.content.addComment("AA-1", { document }),
    (error) => error instanceof Error && error.message.includes("형식 오류"),
  );
});
