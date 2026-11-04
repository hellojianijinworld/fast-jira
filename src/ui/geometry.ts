export interface PopoverRect {
  left: number;
  top: number;
  bottom: number;
  width: number;
}
export interface PopoverBounds {
  width: number;
  maxHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  gap?: number;
  margin?: number;
}
export function popoverPosition(rect: PopoverRect, bounds: PopoverBounds) {
  const { viewportWidth, viewportHeight, gap = 6, margin = 12 } = bounds;
  const width = Math.min(bounds.width, Math.max(0, viewportWidth - margin * 2));
  const maxHeight = Math.min(
    bounds.maxHeight,
    Math.max(0, viewportHeight - margin * 2),
  );
  const below = viewportHeight - rect.bottom - gap - margin;
  const above = rect.top - gap - margin;
  // 앵커 아래가 좁으면 위쪽을 사용한다. 패널 자체가 화면 밖으로 밀리지 않게 마지막에 제한한다.
  const useBelow = below >= Math.min(200, maxHeight) || below >= above;
  const height = Math.min(maxHeight, Math.max(0, useBelow ? below : above));
  return {
    width: `${width}px`,
    left: `${Math.max(margin, Math.min(rect.left, viewportWidth - width - margin))}px`,
    top: `${Math.max(margin, Math.min(useBelow ? rect.bottom + gap : rect.top - gap - height, viewportHeight - height - margin))}px`,
    maxHeight: `${height}px`,
  };
}

export function splitDimensions(available: number, rem: number, ratio: number) {
  // 비율만 제한하면 작은 창의 입력·카드가 지나치게 좁아진다.
  const minimum = Math.min(available / 2, Math.max(available * 0.2, 20 * rem));
  const maximum = available - minimum;
  const width = Math.max(minimum, Math.min(maximum, available * ratio));
  return { minimum, maximum, width, ratio: width / available };
}
