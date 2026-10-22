import type { ViewportAnchor } from "../domain/list-snapshot.ts";

function cards(host: HTMLElement) {
  return [...host.querySelectorAll<HTMLAnchorElement>("a.list-title")].map(
    (node) => ({
      node,
      key: new URL(node.href).searchParams.get("issue") ?? "",
    }),
  );
}
/** 카드가 사라지면 다음 이웃, 그마저 없으면 이전 이웃의 화면 위치를 지킨다. */
export function captureViewportAnchor(
  host: HTMLElement,
  scroller: HTMLElement,
): ViewportAnchor[] {
  if (scroller.scrollTop === 0) return [];
  const rows = cards(host),
    top = scroller.getBoundingClientRect().top;
  const inset = parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0;
  const index = rows.findIndex(
    ({ node }) =>
      (node.closest(".list-item") ?? node).getBoundingClientRect().bottom >
      top + inset,
  );
  if (index < 0) return [];
  return [index, index + 1, index + 2, index - 1].flatMap((index) => {
    const row = rows[index];
    return row
      ? [{ key: row.key, offset: row.node.getBoundingClientRect().top - top }]
      : [];
  });
}
export function restoreViewportAnchor(
  host: HTMLElement,
  scroller: HTMLElement,
  anchors: readonly ViewportAnchor[],
): boolean {
  const rows = cards(host),
    top = scroller.getBoundingClientRect().top;
  for (const anchor of anchors) {
    const row = rows.find((row) => row.key === anchor.key);
    if (!row) continue;
    scroller.scrollTop +=
      row.node.getBoundingClientRect().top - top - anchor.offset;
    return true;
  }
  return false;
}
