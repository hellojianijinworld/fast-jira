import type { Api } from "../client/api.ts";
import { actionButton, element, iconButton } from "./dom.ts";
import { popoverPosition } from "./geometry.ts";
import { avatar, relativeTime } from "./meta.ts";

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
/** 기록은 요청할 때만 읽는다. 팝오버를 다시 열어도 읽은 페이지는 유지한다. */
export function issueHistory(api: Api, key: string) {
  const trigger = actionButton("변경 기록", "history");
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
  panel.append(head, entries, message, more);
  let before: number | null = null,
    loaded = false,
    loading = false,
    alive = true;
  const seen = new Set<string>();
  async function load() {
    if (loading || !alive) return;
    loading = true;
    more.disabled = true;
    message.textContent = "기록을 불러오는 중…";
    try {
      const page = await api.history(key, before);
      if (!alive) return;
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
          const value = element("p", "history-change");
          value.append(
            element("small", "", fieldLabels[change.field] ?? change.field),
            element("span", "", change.from || "없음"),
            element("span", "", "→"),
            element("span", "", change.to || "없음"),
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
      if (!alive) return;
      message.textContent =
        reason instanceof Error ? reason.message : "기록을 불러오지 못했어요.";
      more.hidden = false;
    } finally {
      loading = false;
      more.disabled = false;
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
    destroy() {
      alive = false;
      if (panel.matches(":popover-open")) panel.hidePopover();
      panel.remove();
    },
  };
}
