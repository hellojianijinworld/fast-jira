/** 기본 SVG 원본을 재사용해 탭 아이콘의 업데이트 표시만 바꾼다. */
export function createFaviconBadge() {
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  const original = icon?.getAttribute("href");
  const prefix = "data:image/svg+xml,";
  if (!icon || !original?.startsWith(prefix)) return (_visible: boolean) => {};
  const svg = decodeURIComponent(original.slice(prefix.length));
  const marked =
    prefix +
    encodeURIComponent(
      svg.replace(
        "</svg>",
        '<circle data-update-badge="true" cx="52" cy="12" r="10" fill="#f97316" stroke="#fff" stroke-width="3"/></svg>',
      ),
    );
  return (visible: boolean) => {
    const href = visible ? marked : original;
    if (icon.getAttribute("href") !== href) icon.setAttribute("href", href);
  };
}
