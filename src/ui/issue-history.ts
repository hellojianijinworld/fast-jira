import type { Api } from "../client/api.ts";
import type { IssueDetails } from "../domain/details.ts";
import { textDifference } from "../domain/text-diff.ts";
import { actionButton, element, iconButton, uiIcon } from "./dom.ts";
import { popoverPosition } from "./geometry.ts";
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
    variant: "outline",
  });
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
    more = actionButton("이전 기록", "chevron-right");
  const scroll = element("div", "history-scroll");
  const timeline = element("div"),
    comparison = element("section", "history-diff");
  comparison.hidden = true;
  timeline.append(entries, message, more);
  scroll.append(timeline, comparison);
  let previousScroll = 0;
  let comparisonTrigger: HTMLButtonElement | undefined;
  const back = actionButton("변경 기록으로", "undo-2", {
    size: "sm",
    variant: "ghost",
  });
  function closeComparison() {
    comparison.hidden = true;
    timeline.hidden = false;
    scroll.scrollTop = previousScroll;
    comparisonTrigger?.focus({ preventScroll: true });
  }
  back.addEventListener("click", closeComparison);
  function showComparison(
    trigger: HTMLButtonElement,
    label: string,
    from: string,
    to: string,
  ) {
    previousScroll = scroll.scrollTop;
    comparisonTrigger = trigger;
    const diff = textDifference(from, to);
    comparison.replaceChildren(back, element("h4", "", `${label} 변경 내용`));
    for (const [title, value, changed, tag] of [
      ["변경 전", from, diff.before, "del"],
      ["변경 후", to, diff.after, "ins"],
    ] as const) {
      const block = element("section", "history-diff-block");
      const text = element("pre");
      text.append(diff.prefix, element(tag, "", changed), diff.suffix);
      if (!value) text.replaceChildren(element("span", "muted", "없음"));
      block.append(element("h5", "", title), text);
      comparison.append(block);
    }
    timeline.hidden = true;
    comparison.hidden = false;
    scroll.scrollTop = 0;
    back.focus();
  }
  panel.append(head, scroll);
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
          const value = element("button", "history-change");
          value.type = "button";
          value.setAttribute("aria-label", `${label} 변경 비교`);
          value.append(
            element("small", "history-field", label),
            element("span", "history-preview", change.from || "없음"),
            element("span", "history-arrow", "→"),
            element("span", "history-preview", change.to || "없음"),
            uiIcon("chevron-right"),
          );
          value.addEventListener("click", () =>
            showComparison(value, label, change.from, change.to),
          );
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
    if (!comparison.hidden) closeComparison();
    Object.assign(
      panel.style,
      popoverPosition(trigger.getBoundingClientRect(), {
        width: 480,
        maxHeight: 560,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      }),
    );
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
      if (panel.matches(":popover-open")) panel.hidePopover();
      panel.remove();
    },
  };
}
