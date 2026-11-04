import assert from "node:assert/strict";
import { test } from "node:test";
import { lineDifference } from "../src/domain/line-diff.ts";

test("중간 공통 줄을 유지하고 떨어진 변경을 구분한다", () => {
  const rows = lineDifference(
    "첫 줄\n삭제\n유지\n옛 끝",
    "첫 줄\n추가\n유지\n새 끝",
  );
  assert.deepEqual(
    rows
      .filter((row) => row.before && !row.before.changed)
      .map((row) => row.before?.text),
    ["첫 줄\n", "유지\n"],
  );
  assert.equal(rows.filter((row) => row.before?.changed).length, 2);
});
test("빈 값·삽입·삭제·반복 줄·유니코드·마지막 줄바꿈을 보존한다", () => {
  for (const [before, after] of [
    ["", "새 내용\n"],
    ["삭제\n", ""],
    ["a\na\nb\n", "a\nb\nb\n"],
    ["😀\n끝", "😀\n중간\n끝\n"],
    ["동일", "동일"],
  ]) {
    const rows = lineDifference(before ?? "", after ?? "");
    assert.equal(rows.map((row) => row.before?.text ?? "").join(""), before);
    assert.equal(rows.map((row) => row.after?.text ?? "").join(""), after);
    assert.deepEqual(
      rows.flatMap((row) => (row.before ? [row.before.number] : [])),
      Array.from(
        { length: rows.filter((row) => row.before).length },
        (_, i) => i + 1,
      ),
    );
  }
});
