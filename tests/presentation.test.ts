import assert from "node:assert/strict";
import { test } from "node:test";
import { popoverPosition, splitDimensions } from "../src/ui/geometry.ts";

test("팝오버는 좁은 화면과 하단 앵커에서도 화면 안에 배치한다", () => {
  const rect = { left: 280, top: 570, bottom: 604, width: 120 };
  const result = popoverPosition(rect, {
    width: 420,
    maxHeight: 320,
    viewportWidth: 360,
    viewportHeight: 640,
  });
  assert.equal(result.width, "336px");
  assert.equal(result.left, "12px");
  assert.equal(result.top, "244px");
  assert.equal(result.maxHeight, "320px");
  const tiny = popoverPosition(rect, {
    width: 420,
    maxHeight: 320,
    viewportWidth: 20,
    viewportHeight: 20,
  });
  assert.equal(tiny.width, "0px");
  assert.equal(tiny.maxHeight, "0px");
});

import { safeHref } from "../src/ui/dom.ts";
import { statusColor } from "../src/ui/meta.ts";

test("본문 링크는 스크립트·데이터 URL을 거부하고 상대 링크만 안전하게 해결한다", () => {
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("data:text/html,<script>"), null);
  assert.equal(
    safeHref("/browse/TEST-1", "https://example.atlassian.net/browse/TEST-2"),
    "https://example.atlassian.net/browse/TEST-1",
  );
  assert.equal(safeHref("not a URL"), null);
});
test("동적 상태 개수와 순서가 바뀌어도 같은 색상 경로를 균등하게 사용한다", () => {
  for (const count of [1, 5, 9, 15]) {
    const order = Array.from({ length: count }, (_, index) => `상태 ${index}`);
    const colors = order.map((name) => statusColor(name, order));
    assert.equal(new Set(colors).size, count);
    assert.equal(colors[0], statusColor(order[0] ?? "", ["시작"]));
    if (count > 1)
      assert.equal(colors.at(-1), statusColor("완료", ["시작", "완료"]));
  }
  assert.equal(statusColor("새 단계", []), statusColor("시작", ["시작"]));
});

test("분할 너비는 작은 창과 초광폭에서도 유효한 최소·최대 범위를 유지한다", () => {
  for (const available of [640, 1262, 2200, 3000]) {
    for (const ratio of [0, 0.5, 1]) {
      const value = splitDimensions(available, 16, ratio);
      assert.ok(value.minimum <= value.maximum);
      assert.ok(value.width >= value.minimum && value.width <= value.maximum);
      assert.ok(value.width <= available);
    }
  }
  assert.equal(splitDimensions(1262, 16, 0).width, 384);
  assert.equal(splitDimensions(1262, 16, 1).width, 878);
  assert.equal(splitDimensions(3000, 16, 0.8).width, 1500);
});
