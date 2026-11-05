import type { Api } from "../client/api.ts";
import type { IssueDetails } from "../domain/details.ts";
import { actionButton, element, iconButton, uiIcon } from "./dom.ts";
import { popoverPosition } from "./geometry.ts";
import { historyDiff } from "./history-diff.ts";
import { avatar, personPill, relativeTime } from "./meta.ts";

const fieldLabels: Record<string, string> = {
  status: "상태",
  assignee: "담당자",
  reporter: "보고자",
  resolution: "해결",
  attachment: "첨부 파일",
  description: "설명",
  summary: "제목",
  duedate: "마감일",
  priority: "우선순위",
  labels: "라벨",
  IssueParentAssociation: "상위 이슈",
};
/** 변경 전에는 읽은 페이지를 재사용하고, 수정 뒤에는 다음 열기에 최신 페이지부터 확인한다. */
export function issueHistory(
  api: Pick<Api, "history">,
  key: string,
  reporter?: Pick<IssueDetails, "reporter" | "reporterAvatar" | "created">,
) {
  const trigger = actionButton("기록", "history", {
    size: "sm",
    purpose: "quiet",
  });
  trigger.classList.add("history-trigger");
  trigger.setAttribute("aria-label", "변경 기록");
  trigger
    .querySelector("span")
    ?.prepend(element("span", "history-prefix", "변경 "));
  const panel = element("section", "history-panel");
  panel.popover = "auto";
  panel.id = `history-${key}`;
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-controls", panel.id);
  trigger.setAttribute("aria-expanded", "false");
  panel.addEventListener("toggle", () =>
    trigger.setAttribute(
      "aria-expanded",
      String(panel.matches(":popover-open")),
    ),
  );
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", `${key} 변경 기록`);
  const head = element("div", "dialog-head");
  const close = iconButton("변경 기록 닫기", "x");
  function dismiss() {
    closeComparison(false);
    panel.hidePopover();
    trigger.focus();
  }
  close.addEventListener("click", dismiss);
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
    }
  });
  head.append(element("h3", "", "변경 기록"), close);
  const entries = element("div"),
    message = element("p", "empty"),
    more = actionButton("이전 기록", "chevron-right", {
      purpose: "quiet",
      size: "sm",
    });
  const scroll = element("div", "history-scroll");
  const timeline = element("div"),
    comparison = element(
      "section",
      "history-diff history-diff-popover popover-surface",
    );
  comparison.popover = "auto";
  comparison.id = `history-diff-${key}`;
  comparison.setAttribute("role", "dialog");
  timeline.append(entries, message, more);
  scroll.append(timeline);
  let comparisonTrigger: HTMLButtonElement | undefined;
  let comparisonScroll = 0;
  function position(width: number) {
    Object.assign(
      panel.style,
      popoverPosition(trigger.getBoundingClientRect(), {
        width,
        maxHeight: 560,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      }),
    );
  }
  function closeComparison(restoreFocus = true) {
    if (comparison.matches(":popover-open")) comparison.hidePopover();
    comparisonTrigger?.setAttribute("aria-expanded", "false");
    if (restoreFocus) comparisonTrigger?.focus({ preventScroll: true });
  }
  comparison.addEventListener("toggle", () => {
    comparisonTrigger?.setAttribute(
      "aria-expanded",
      String(comparison.matches(":popover-open")),
    );
  });
  comparison.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeComparison();
  });
  function showComparison(
    anchor: HTMLButtonElement,
    label: string,
    from: string,
    to: string,
  ) {
    if (comparisonTrigger === anchor && comparison.matches(":popover-open"))
      return closeComparison();
    closeComparison(false);
    comparisonTrigger = anchor;
    comparisonScroll = scroll.scrollTop;
    const heading = element("div", "dialog-head");
    const dismissDiff = iconButton("변경 비교 닫기", "x");
    dismissDiff.setAttribute("aria-label", "변경 비교 닫기");
    dismissDiff.addEventListener("click", () => closeComparison());
    heading.append(element("h4", "", `${label} 변경 내용`), dismissDiff);
    comparison.replaceChildren(heading, historyDiff(from, to));
    comparison.setAttribute("aria-label", `${label} 변경 비교`);
    const anchorRect = anchor.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const width = Math.min(1200, viewportWidth - 24),
      height = Math.min(innerHeight * 0.8, innerHeight - 24);
    const dx = anchorRect.left + anchorRect.width / 2 - viewportWidth / 2;
    const dy = anchorRect.top + anchorRect.height / 2 - innerHeight / 2;
    const horizontal = Math.abs(dx / width) > Math.abs(dy / height);
    comparison.dataset.tailSide = horizontal
      ? dx >= 0
        ? "right"
        : "left"
      : dy >= 0
        ? "bottom"
        : "top";
    const length = horizontal ? height : width;
    const target = (horizontal ? dy : dx) + length / 2;
    comparison.style.setProperty(
      "--diff-tail-position",
      `${Math.max(20, Math.min(length - 20, target))}px`,
    );
    comparison.showPopover();
    anchor.setAttribute("aria-expanded", "true");
    dismissDiff.focus({ preventScroll: true });
  }
  const closeOnMove = (event: Event) => {
    if (event.type === "scroll" && scroll.scrollTop === comparisonScroll)
      return;
    closeComparison(false);
  };
  scroll.addEventListener("scroll", closeOnMove, { passive: true });
  window.addEventListener("resize", closeOnMove);
  panel.append(head, scroll, comparison);
  if (reporter) {
    const footer = element("footer", "history-footer");
    footer.append(
      element("small", "field-label", "보고자"),
      personPill({ name: reporter.reporter, avatar: reporter.reporterAvatar }),
    );
    if (reporter.created)
      footer.append(relativeTime(reporter.created, "", "보고 시점"));
    panel.append(footer);
  }
  let before: number | null = null,
    loaded = false,
    loading = false,
    alive = true,
    revision = 0;
  const seen = new Set<string>();
  async function load() {
    if (loading || !alive) return;
    loading = true;
    const generation = revision;
    more.disabled = true;
    message.textContent = "기록을 불러오는 중…";
    try {
      const page = await api.history(key, before);
      if (!alive || generation !== revision) return;
      if (!loaded) {
        seen.clear();
        entries.replaceChildren();
      }
      for (const entry of page.entries) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        const row = element("article", "history-entry"),
          author = element("div", "history-author");
        author.append(
          avatar({ name: entry.author, avatar: entry.avatar }),
          element("strong", "", entry.author),
          relativeTime(entry.created),
        );
        row.append(author);
        for (const change of entry.changes) {
          const label = fieldLabels[change.field] ?? change.field;
          const value = element(
            change.field === "description" ? "button" : "p",
            "history-change",
          );
          value.append(
            element("small", "history-field", label),
            element("span", "history-preview", change.from || "없음"),
            element("span", "history-arrow", "→"),
            element("span", "history-preview", change.to || "없음"),
          );
          if (value instanceof HTMLButtonElement) {
            value.type = "button";
            value.setAttribute("aria-label", `${label} 변경 비교`);
            value.setAttribute("aria-haspopup", "dialog");
            value.setAttribute("aria-controls", comparison.id);
            value.setAttribute("aria-expanded", "false");
            value.append(uiIcon("chevron-right"));
            value.addEventListener("click", () =>
              showComparison(value, label, change.from, change.to),
            );
          }
          row.append(value);
        }
        entries.append(row);
      }
      loaded = true;
      before = page.before;
      more.hidden = before === null;
      message.textContent = seen.size ? "" : "변경 기록이 없습니다.";
    } catch (reason) {
      if (!alive || generation !== revision) return;
      message.textContent =
        reason instanceof Error ? reason.message : "기록을 불러오지 못했어요.";
      more.hidden = false;
    } finally {
      if (alive && generation === revision) {
        loading = false;
        more.disabled = false;
      }
    }
  }
  more.hidden = true;
  more.addEventListener("click", () => {
    void load();
  });
  trigger.addEventListener("click", () => {
    if (panel.matches(":popover-open")) {
      panel.hidePopover();
      return;
    }
    closeComparison(false);
    position(480);
    panel.showPopover();
    close.focus();
    if (!loaded) void load();
  });
  return {
    trigger,
    panel,
    invalidate() {
      if (!alive) return;
      revision++;
      loaded = loading = false;
      before = null;
      more.hidden = true;
      more.disabled = false;
      if (panel.matches(":popover-open"))
        message.textContent = "수정된 기록은 다시 열면 확인할 수 있어요.";
    },
    destroy() {
      alive = false;
      window.removeEventListener("resize", closeOnMove);
      closeComparison(false);
      if (panel.matches(":popover-open")) panel.hidePopover();
      panel.remove();
    },
  };
}
