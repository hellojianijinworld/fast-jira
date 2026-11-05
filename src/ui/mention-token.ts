import type { MentionTarget } from "../domain/mention.ts";
import { element, safeHref } from "./dom.ts";

export interface MentionOptions {
  clickable?: boolean;
  select?: ((key: string) => void) | undefined;
}

/** 표시와 이동 정책을 공유한다. 사람 멘션은 클릭 옵션과 무관하게 일반 텍스트다. */
export function mentionToken(
  target: MentionTarget,
  label: string,
  options: MentionOptions & { className?: string; href?: string } = {},
): HTMLElement {
  const key = target.key ?? label.match(/^@?([A-Z][A-Z0-9_]*-\d+)/)?.[1] ?? "";
  const clickable =
    options.clickable !== false &&
    target.kind === "issue" &&
    /^[A-Z][A-Z0-9_]*-\d+$/.test(key);
  const token = element(
    clickable ? "a" : "span",
    options.className ?? "mention",
    label,
  );
  token.dataset.kind = target.kind;
  token.title = target.label;
  if (token instanceof HTMLAnchorElement) {
    token.href = options.select
      ? `?issue=${encodeURIComponent(key)}`
      : (safeHref(options.href ?? "") ?? `?issue=${encodeURIComponent(key)}`);
    if (!options.select) {
      token.target = "_blank";
      token.rel = "noopener noreferrer";
    }
    token.addEventListener("click", (event) => {
      if (
        event.button ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      event.stopPropagation();
      if (options.select) {
        event.preventDefault();
        options.select(key);
      }
    });
  }
  return token;
}
