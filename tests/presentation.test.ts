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
    assert.equal(colors[0], statusColor("시작", ["시작"]));
    if (count > 1)
      assert.equal(colors.at(-1), statusColor("완료", ["시작", "완료"]));
  }
  assert.equal(statusColor("새 단계", []), "var(--muted)");
  assert.equal(statusColor("새 단계", ["시작", "완료"]), "var(--muted)");
  assert.notEqual(
    statusColor("진행", ["대기", "진행", "완료"]),
    statusColor("대기", ["대기", "진행", "완료"]),
  );
});

test("공통 분할은 양쪽 20%와 읽을 수 있는 최소 폭을 함께 보장한다", () => {
  for (const available of [300, 640, 1012, 1262, 1920, 3000]) {
    for (const rem of [16, 20]) {
      const minimum = Math.min(
        available / 2,
        Math.max(available * 0.2, 20 * rem),
      );
      for (const ratio of [-0.1, 0, 0.2, 0.34, 0.5, 0.8, 1, 1.1]) {
        const value = splitDimensions(available, rem, ratio);
        assert.equal(value.minimum, minimum);
        assert.equal(value.maximum, available - minimum);
        assert.ok(value.width >= minimum);
        assert.ok(available - value.width >= minimum - 0.0001);
      }
    }
  }
  assert.equal(splitDimensions(1012, 16, 0).width, 320);
  assert.equal(splitDimensions(1012, 16, 1).width, 692);
  assert.equal(splitDimensions(1920, 16, 0).ratio, 0.2);
  assert.equal(splitDimensions(1920, 16, 1).ratio, 0.8);
  assert.equal(splitDimensions(300, 16, 1).width, 150);
});
