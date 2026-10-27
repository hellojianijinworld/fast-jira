import assert from "node:assert/strict";
import { test } from "node:test";
import { textDifference } from "../src/domain/text-diff.ts";

test("공통 앞뒤 문장은 유지하고 바뀐 범위를 분리한다", () => {
  assert.deepEqual(
    textDifference("작업 상태: 대기입니다", "작업 상태: 완료입니다"),
    {
      prefix: "작업 상태: ",
      before: "대기",
      after: "완료",
      suffix: "입니다",
    },
  );
});
test("추가·삭제·동일 값은 원문을 그대로 재구성할 수 있다", () => {
  for (const [from, to] of [
    ["", "새 내용"],
    ["삭제", ""],
    ["동일", "동일"],
    ["a", "aa"],
    ["😀 내용\n끝", "😁 내용\n끝"],
  ]) {
    const diff = textDifference(from ?? "", to ?? "");
    assert.equal(diff.prefix + diff.before + diff.suffix, from);
    assert.equal(diff.prefix + diff.after + diff.suffix, to);
    assert(
      !/[\uD800-\uDBFF]$/.test(diff.prefix),
      "서로게이트 문자를 쪼개지 않는다",
    );
  }
});
