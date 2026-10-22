import assert from "node:assert/strict";
import { test } from "node:test";
import { updateFavorites } from "../src/domain/favorites.ts";
import { emptyIssue } from "../src/domain/wire.ts";

test("이전 번호 제거와 새 번호가 함께 와도 고유 ID가 같은 즐겨찾기는 유지한다", () => {
  const saved = { ...emptyIssue("TEST-1", "내 작업"), id: "101" };
  const moved = {
    ...saved,
    key: "OTHER-7",
    project: "OTHER",
    summary: "이동한 작업",
  };
  assert.deepEqual(updateFavorites([saved], [moved], [saved.key]), [moved]);
  assert.deepEqual(updateFavorites([saved], [], [saved.key]), []);
  assert.deepEqual(updateFavorites([saved], [emptyIssue("TEST-2")]), [saved]);
});
