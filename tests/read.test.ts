import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiraClient } from "../src/server/jira-client.ts";
import { createJiraMetadata } from "../src/server/jira-metadata.ts";
import { createJiraRead } from "../src/server/jira-read.ts";

const site = "example.atlassian.net";
const rawIssue = {
  key: "AA-1",
  fields: {
    summary: "제목",
    reporter: { displayName: "보고자", avatarUrls: { "24x24": "avatar" } },
    created: "2026-10-01T10:00:00Z",
    description: {
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "내용" }] },
      ],
    },
    attachment: [
      { id: "101", filename: "image-a.png", mimeType: "image/png", size: 2 },
      { id: "102", filename: "image-b.png", mimeType: "image/png", size: 2 },
    ],
  },
};
function setup(reply: (url: URL) => Response) {
  const calls: URL[] = [];
  const client = createJiraClient(
    { site, email: "test@example.com", token: "fake" },
    async (value) => {
      const url = new URL(String(value));
      calls.push(url);
      return reply(url);
    },
  );
  return {
    read: createJiraRead(client, createJiraMetadata(client), site),
    calls,
  };
}
test("상세는 보고자·본문·첨부를 정규화하고 이미지가 첨부 목록을 재조회하지 않는다", async () => {
  const { read, calls } = setup((url) =>
    url.pathname.includes("/attachment/content/")
      ? new Response("ok")
      : Response.json(rawIssue),
  );
  const result = await read.lookup("AA-1");
  assert.equal(result.parent.reporter, "보고자");
  assert.equal(result.parent.reporterAvatar, "avatar");
  assert.equal(result.parent.url, `https://${site}/browse/AA-1`);
  assert.deepEqual(result.parent.description, rawIssue.fields.description);
  assert.equal(
    result.parent.attachments[0]?.url,
    `https://${site}/rest/api/3/attachment/content/101`,
  );
  await Promise.all([
    read.image("AA-1", "image-a.png"),
    read.image("AA-1", "image-b.png"),
  ]);
  assert.equal(calls.length, 3);
  assert.ok(
    calls.slice(1).every((url) => url.searchParams.get("redirect") === "false"),
  );
});
test("상세를 열지 않은 이미지 요청도 첨부 목록을 한 번만 조회한다", async () => {
  const { read, calls } = setup((url) =>
    url.pathname.includes("/attachment/content/")
      ? new Response("ok")
      : Response.json({ fields: { attachment: rawIssue.fields.attachment } }),
  );
  const images = await Promise.all([
    read.image("AA-1", "image-a.png"),
    read.image("AA-1", "image-b.png"),
  ]);
  assert.ok(images.every((image) => image.mimeType === "image/png"));
  assert.equal(
    calls.filter((url) => url.searchParams.get("fields") === "attachment")
      .length,
    1,
  );
});
test("미지원 첨부·큰 이미지·잘못된 이름은 바이너리 요청 전 거부한다", async () => {
  const { read, calls } = setup(() =>
    Response.json({
      fields: {
        attachment: [
          {
            id: "1",
            filename: "file.pdf",
            mimeType: "application/pdf",
            size: 2,
          },
          {
            id: "2",
            filename: "big.png",
            mimeType: "image/png",
            size: 21 * 1024 * 1024,
          },
        ],
      },
    }),
  );
  await assert.rejects(read.image("AA-1", "file.pdf"));
  await assert.rejects(read.image("AA-1", "big.png"));
  await assert.rejects(read.image("AA-1", "missing.png"));
  assert.equal(calls.length, 1);
  await assert.rejects(read.image("AA-1", "x".repeat(256)));
  assert.equal(calls.length, 1);
});
test("아이콘은 허용한 Jira 경로·형식·크기만 읽고 같은 주소는 캐시한다", async () => {
  const { read, calls } = setup(
    () =>
      new Response("<svg/>", {
        headers: { "Content-Type": "image/svg+xml; charset=utf-8" },
      }),
  );
  const url = `https://${site}/rest/api/3/universal_avatar/view/type/issuetype/avatar/123`;
  assert.equal((await read.typeIcon(url)).mimeType, "image/svg+xml");
  await read.typeIcon(url);
  assert.equal(calls.length, 1);
  for (const invalid of [
    "http://example.atlassian.net/images/icons/priorities/high.svg",
    "https://other.atlassian.net/images/icons/priorities/high.svg",
    `https://${site}/rest/api/3/myself`,
  ])
    await assert.rejects(read.typeIcon(invalid));
  assert.equal(calls.length, 1);
  const bad = setup(
    () =>
      new Response("not an image", {
        headers: { "Content-Type": "text/html" },
      }),
  );
  await assert.rejects(bad.read.typeIcon(url));
  const big = setup(
    () =>
      new Response("large", {
        headers: { "Content-Type": "image/png", "Content-Length": "262145" },
      }),
  );
  await assert.rejects(big.read.typeIcon(url));
});
