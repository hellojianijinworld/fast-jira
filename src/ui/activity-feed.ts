import type { Activity } from "../domain/activity.ts";
import { actionButton, element } from "./dom.ts";
import { keyedContent } from "./keyed-content.ts";
import { personPill, relativeTime } from "./meta.ts";

export function activityFeed(select: (key: string) => void, retry: () => void) {
  const root = element("section", "activity-feed");
  root.setAttribute("aria-label", "최근 활동");
  const heading = element("div", "activity-heading");
  const spinner = element("span", "loading-indicator");
  spinner.setAttribute("role", "status");
  spinner.setAttribute("aria-label", "최근 활동 불러오는 중");
  heading.append(element("h2", "", "최근 활동"), spinner);
  const description = element(
    "p",
    "activity-description",
    "선택한 프로젝트 · 최신 10건",
  );
  const content = element("div");
  const message = element("p", "activity-message");
  const again = actionButton("다시 시도", "refresh-cw");
  again.addEventListener("click", retry);
  root.append(heading, description, content, message, again);
  const update = keyedContent(content);
  return {
    element: root,
    render(
      entries: readonly Activity[],
      newIds: ReadonlySet<string>,
      loading: boolean,
      error: string,
      projects: readonly string[],
    ) {
      description.textContent = projects.length
        ? `${projects.join(" · ")} · 최신 10건`
        : "프로젝트를 선택해 주세요.";
      spinner.hidden = !loading;
      again.hidden = !error;
      again.disabled = loading;
      message.hidden = !error && (loading || entries.length > 0);
      message.textContent = error
        ? `${entries.length ? "이전 내역을 표시하고 있어요. " : ""}${error}`
        : "최근 활동이 없어요.";
      update(
        entries.map((entry) => {
          const row = element("a", "activity-row");
          row.href = `?issue=${encodeURIComponent(entry.key)}`;
          const meta = element("span", "activity-meta");
          meta.append(
            personPill({ name: entry.author, avatar: entry.avatar }),
            relativeTime(entry.created, "", "활동 시각"),
          );
          if (newIds.has(entry.id))
            meta.append(element("span", "activity-new", "새 활동"));
          const label = entry.text.startsWith(entry.author)
            ? entry.text.slice(entry.author.length).trim()
            : entry.text;
          row.append(meta, element("span", "activity-text", label));
          row.addEventListener("click", (event) => {
            if (
              event.button ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            select(entry.key);
          });
          return [entry.id, row];
        }),
      );
    },
  };
}
