import assert from "node:assert/strict";
import { test } from "node:test";
import { activeTreePath } from "../src/domain/tree-context.ts";

test("아직 지나가지 않은 부모는 고정 경로에 표시하지 않는다", () => {
  assert.deepEqual(
    activeTreePath([{ key: "A", parent: "", top: 20, bottom: 600 }], 0),
    [],
  );
});
test("읽고 있는 하위의 실제 조상만 경로 순서대로 선택한다", () => {
  assert.deepEqual(
    activeTreePath(
      [
        { key: "A", parent: "", top: -200, bottom: 800 },
        { key: "ended", parent: "A", top: -100, bottom: -10 },
        { key: "B", parent: "A", top: -40, bottom: 500 },
        { key: "next", parent: "A", top: 300, bottom: 800 },
      ],
      0,
    ),
    ["A", "B"],
  );
});
test("분기를 벗어나면 경로를 지우고 연결 없는 작업은 독립 경로가 된다", () => {
  assert.deepEqual(
    activeTreePath([{ key: "A", parent: "", top: -200, bottom: 0 }], 0),
    [],
  );
  assert.deepEqual(
    activeTreePath([{ key: "B", parent: "missing", top: -20, bottom: 400 }], 0),
    ["B"],
  );
});
test("잘못된 순환 부모가 있어도 경로는 중복되거나 무한 반복하지 않는다", () => {
  assert.deepEqual(
    activeTreePath(
      [
        { key: "A", parent: "B", top: -50, bottom: 500 },
        { key: "B", parent: "A", top: -10, bottom: 400 },
      ],
      0,
    ),
    ["A", "B"],
  );
});
