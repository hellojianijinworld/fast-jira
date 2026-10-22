import assert from "node:assert/strict";
import { test } from "node:test";
import { createAccountStore } from "../src/client/preferences.ts";
import { emptyIssue } from "../src/domain/wire.ts";

const metadata = {
  ...emptyIssue("TEST-1", "보존할 제목"),
  id: "123",
  assigneeId: "member-1",
  relatedUserIds: ["member-2"],
  commentCount: 3,
  priorityId: "2",
  updated: "2026-10-22T00:00:00Z",
};
const details = {
  ...metadata,
  description: { type: "doc", content: ["비공개 본문"] },
  attachments: [{ filename: "첨부 이름", content: "파일 주소" }],
  comments: [{ body: "댓글 본문" }],
  reporter: { name: "보고자" },
  token: "저장하면 안 되는 값",
};
function localStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
test("최근·즐겨찾기는 상세 객체를 받아도 목록 메타정보만 저장한다", () => {
  const local = localStorage();
  const store = createAccountStore(local, "example", "me");
  store.saveFavorites([details]);
  store.saveRecent(
    Array.from({ length: 7 }, (_, i) => ({ ...details, key: `TEST-${i + 1}` })),
  );
  assert.deepEqual(
    JSON.parse(local.getItem(`fastJira:favorites:${store.scope}`) ?? "null"),
    [metadata],
  );
  assert.deepEqual(
    JSON.parse(local.getItem(`fastJira:recent:${store.scope}`) ?? "null"),
    Array.from({ length: 5 }, (_, i) => ({
      ...metadata,
      key: `TEST-${i + 1}`,
    })),
  );
});
test("기존 최근·즐겨찾기는 손상·중복·상세를 정리하고 다른 계정과 설정을 보존한다", () => {
  const local = localStorage();
  const raw = JSON.stringify([details, { key: "BAD" }, details]);
  local.setItem("fastJira:recent:example", raw);
  local.setItem("fastJira:favorites:example:me", raw);
  local.setItem("fastJira:favorites:example:other", raw);
  local.setItem("fastJira:views:example:me", "보존할 뷰");
  local.setItem("fastJira:tree:example:me", "보존할 접힘");
  const store = createAccountStore(local, "example", "me");
  assert.deepEqual(store.recent(), [metadata]);
  assert.deepEqual(store.favorites(), [metadata]);
  for (const key of [
    "fastJira:recent:example",
    "fastJira:recent:example:me",
    "fastJira:favorites:example:me",
  ])
    assert.deepEqual(JSON.parse(local.getItem(key) ?? "null"), [metadata]);
  assert.equal(local.getItem("fastJira:favorites:example:other"), raw);
  assert.equal(local.getItem("fastJira:views:example:me"), "보존할 뷰");
  assert.equal(local.getItem("fastJira:tree:example:me"), "보존할 접힘");
  const writes: string[] = [];
  const readonly = createAccountStore(
    {
      getItem: local.getItem,
      setItem: (key) => {
        writes.push(key);
        throw new Error("blocked");
      },
    },
    "example",
    "me",
  );
  local.setItem("fastJira:favorites:example:me", raw);
  assert.deepEqual(readonly.favorites(), [metadata]);
  assert.ok(writes.includes("fastJira:favorites:example:me"));
});
