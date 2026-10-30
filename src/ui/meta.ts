import type { ProjectOption } from "../domain/catalog.ts";
import { dateLabel, reportedTime } from "../domain/dates.ts";
import type { Issue, UserOption } from "../domain/issue.ts";
import { element, safeHref, uiIcon } from "./dom.ts";

export function statusColor(status: string, order: readonly string[]): string {
  const index = order.indexOf(status);
  if (index < 0) return "var(--muted)";
  const position = index / Math.max(1, order.length - 1);
  return `hsl(${44 + 183 * position} ${73 - 19 * position}% ${46 + 10 * position}%)`;
}
export function statusPill(
  status: string,
  order: readonly string[],
): HTMLSpanElement {
  const pill = element("span", "status-pill");
  const dot = element("span", "status-dot");
  dot.style.setProperty("--status-color", statusColor(status, order));
  const name = element("span", "status-name", status || "없음");
  name.dataset.tooltipOverflow = status || "없음";
  pill.append(dot, name);
  return pill;
}
export function avatar(
  user: Pick<UserOption, "name" | "avatar">,
): HTMLSpanElement {
  const node = element("span", "avatar", Array.from(user.name)[0] ?? "");
  const url = safeHref(user.avatar);
  if (url?.startsWith("https:")) {
    const image = element("img");
    image.src = url;
    image.alt = "";
    image.addEventListener("error", () => image.remove(), { once: true });
    node.append(image);
  }
  return node;
}
export function personPill(
  user: Pick<UserOption, "name" | "avatar">,
): HTMLSpanElement {
  const pill = element("span", "person-pill");
  if (user.name) pill.append(avatar(user));
  const name = element("span", "person-name", user.name || "미지정");
  name.dataset.tooltipOverflow = user.name || "미지정";
  pill.append(name);
  return pill;
}
export function issueTypeIcon(
  issue: Pick<Issue, "issueType" | "issueTypeIcon">,
): HTMLElement {
  const url = safeHref(issue.issueTypeIcon);
  if (url?.startsWith("https:")) {
    const image = element("img", "issue-type-icon");
    image.src = `/api/type-icon?url=${encodeURIComponent(url)}`;
    image.alt = issue.issueType;
    image.title = issue.issueType;
    return image;
  }
  const icon = element(
    "span",
    "issue-type-icon",
    Array.from(issue.issueType)[0] ?? "",
  );
  icon.setAttribute("role", "img");
  icon.setAttribute("aria-label", issue.issueType);
  icon.title = issue.issueType;
  return icon;
}
export function priorityPill(
  issue: Pick<Issue, "priority" | "priorityIcon">,
  showName = false,
): HTMLSpanElement {
  const pill = element("span", "priority-pill");
  pill.title = `우선순위: ${issue.priority}`;
  const icon = element("span", "priority-icon");
  icon.setAttribute("role", "img");
  icon.setAttribute("aria-label", pill.title);
  const url = safeHref(issue.priorityIcon);
  if (url?.startsWith("https:")) {
    const image = element("img");
    image.src = `/api/type-icon?url=${encodeURIComponent(url)}`;
    image.alt = "";
    image.addEventListener(
      "error",
      () => icon.replaceChildren(uiIcon("flag")),
      { once: true },
    );
    icon.append(image);
  } else icon.append(uiIcon("flag"));
  pill.append(icon);
  if (showName) pill.append(element("span", "priority-name", issue.priority));
  return pill;
}
export function relativeTime(
  value: string,
  className = "",
  label = "",
  now = new Date(),
): HTMLTimeElement {
  const time = element("time", className, reportedTime(value, now));
  time.dateTime = value;
  time.dataset.relative = "elapsed";
  time.title = `${label ? `${label} · ` : ""}${new Date(value).toLocaleString("ko-KR")}`;
  return time;
}
export function dueTime(value: string, now = new Date()): HTMLTimeElement {
  const time = element("time", "date-pill", dateLabel(value, true, now));
  time.dateTime = value;
  time.dataset.relative = "due";
  time.title = `마감일: ${value}`;
  return time;
}
export function refreshRelativeTimes(root: ParentNode, now = new Date()): void {
  for (const time of root.querySelectorAll<HTMLTimeElement>(
    "time[data-relative]",
  ))
    time.textContent =
      time.dataset.relative === "due"
        ? dateLabel(time.dateTime, true, now)
        : reportedTime(time.dateTime, now);
}

export function projectIcon(project: ProjectOption): HTMLImageElement | null {
  const url = safeHref(project.avatar);
  if (!url?.startsWith("https:")) return null;
  const icon = element("img", "project-icon");
  icon.src = `/api/type-icon?url=${encodeURIComponent(url)}`;
  icon.alt = "";
  icon.addEventListener(
    "error",
    () => {
      icon.src = "/assets/project-fallback.svg";
    },
    { once: true },
  );
  return icon;
}
