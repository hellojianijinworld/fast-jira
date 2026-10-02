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
  // 창이 작으면 양쪽 최소 폭을 절반으로 줄여 가로 넘침을 만들지 않는다.
  const minimumPane = Math.min(24 * rem, available / 2);
  // 두 영역을 모두 70rem 이하로 채울 수 없는 초광폭 화면은 중앙 분할로 제한한다.
  const maximumPane = Math.max(70 * rem, available / 2);
  const minimum = Math.max(minimumPane, available - maximumPane);
  const maximum = Math.min(maximumPane, available - minimumPane);
  const width = Math.max(minimum, Math.min(maximum, available * ratio));
  return { minimum, maximum, width, ratio: width / available };
}
