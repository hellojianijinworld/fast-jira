import assert from "node:assert/strict";
import { test } from "node:test";
import { commentThreads } from "../src/domain/comment-tree.ts";
import type { Comment } from "../src/domain/content.ts";
import { decodeCommentPage } from "../src/domain/wire.ts";

const comment = (
  id: string,
  parentId = "",
  created = "2026-10-01T00:00:00Z",
): Comment => ({
  id,
  parentId,
  created,
  updated: created,
  authorId: "me",
  author: "작성자",
  avatar: "",
  body: {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text: id }] }],
  },
});
test("페이지에서 부모가 뒤늦게 와도 답글을 모으고 루트는 최신순·답글은 오래된순이다", () => {
  const reply = comment("2", "1", "2026-10-02T00:00:00Z");
  assert.equal(commentThreads([reply])[0]?.comment.id, "2");
  const tree = commentThreads([
    reply,
    comment("3", "1", "2026-10-03T00:00:00Z"),
    comment("1"),
    comment("4", "", "2026-10-04T00:00:00Z"),
  ]);
  assert.deepEqual(
    tree.map((item) => item.comment.id),
    ["4", "1"],
  );
  assert.deepEqual(
    tree[1]?.replies.map((item) => item.comment.id),
    ["2", "3"],
  );
});
test("중복 ID·없는 부모·순환 부모가 댓글을 숨기거나 무한 재귀를 만들지 않는다", () => {
  const tree = commentThreads([
    comment("1", "2"),
    comment("2", "1"),
    comment("3", "missing"),
    comment("3", "missing"),
  ]);
  const ids = (items: typeof tree): string[] =>
    items.flatMap((item) => [item.comment.id, ...ids(item.replies)]);
  assert.deepEqual(ids(tree).sort(), ["1", "2", "3"]);
});
test("댓글 HTTP 페이지는 ADF·페이지 위치·문자열 ID를 경계에서 검증한다", () => {
  const page = decodeCommentPage({
    total: 1,
    startAt: 0,
    comments: [comment("1")],
  });
  assert.equal(page.comments[0]?.body.content[0]?.content?.[0]?.text, "1");
  assert.throws(() =>
    decodeCommentPage({ total: -1, startAt: 0, comments: [] }),
  );
  assert.throws(() =>
    decodeCommentPage({
      total: 1,
      startAt: 0,
      comments: [{ ...comment("1"), body: null }],
    }),
  );
});
