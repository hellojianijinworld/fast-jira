import type { ProjectOption } from "../domain/catalog.ts";
import type { Issue } from "../domain/issue.ts";
import { activeTreePath } from "../domain/tree-context.ts";
import { element, uiIcon } from "./dom.ts";
import { issueTypeIcon, projectIcon } from "./meta.ts";

/** 목록 높이를 바꾸지 않는 고정 경로. 이미 표시한 행과 이슈만 사용한다. */
export function createTreeContext(
  pane: HTMLElement,
  host: HTMLElement,
  options: {
    scroller: () => HTMLElement;
    items: () => ReadonlyMap<string, Issue>;
    projects: () => readonly ProjectOption[];
    select: (key: string) => void;
  },
) {
  const slot = element("div", "tree-context-slot"),
    nav = element("nav", "tree-context");
  nav.setAttribute("aria-label", "현재 읽는 목록의 상위 경로");
  nav.hidden = true;
  slot.append(nav);
  pane.prepend(slot);
  const targets = [pane, pane.parentElement].filter(
    (target): target is HTMLElement => Boolean(target),
  );
  let frame = 0,
    force = true,
    pathKey = "",
    signature = "";
  function link(issue: Issue, ancestor: boolean) {
    const anchor = element(
      "a",
      ancestor ? "tree-context-ancestor" : "tree-context-current",
    );
    anchor.href = `?issue=${encodeURIComponent(issue.key)}`;
    anchor.title = `${issue.key} · ${issue.summary}`;
    if (issue.issueType) anchor.append(issueTypeIcon(issue));
    anchor.append(
      element("span", "tree-context-key", issue.key),
      element("span", "tree-context-label", issue.summary),
    );
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      options.select(issue.key);
    });
    return anchor;
  }
  function update() {
    frame = 0;
    const scroller = options.scroller(),
      edge = scroller.getBoundingClientRect().top;
    const path = activeTreePath(
      [...host.querySelectorAll<HTMLElement>(".tree-parent")].map((row) => ({
        key: row.dataset.contextKey ?? "",
        parent: row.dataset.contextParent ?? "",
        top: row.getBoundingClientRect().top,
        bottom: row.parentElement?.getBoundingClientRect().bottom ?? 0,
      })),
      edge,
    );
    const nextPathKey = JSON.stringify(path);
    if (force || pathKey !== nextPathKey) {
      pathKey = nextPathKey;
      force = false;
      const items = options.items(),
        known = path.flatMap((key) => {
          const issue = items.get(key);
          return issue ? [issue] : [];
        });
      const current = known.at(-1);
      const project = options
        .projects()
        .find((project) => project.key === current?.project);
      const next = JSON.stringify([
        project,
        known.map((issue) => [
          issue.key,
          issue.summary,
          issue.issueType,
          issue.issueTypeIcon,
        ]),
      ]);
      if (signature !== next) {
        signature = next;
        const ancestors = element("div", "tree-context-ancestors");
        ancestors.hidden = !current;
        if (current) {
          const label = element("span", "tree-context-project");
          const icon = project ? projectIcon(project) : null;
          if (icon) label.append(icon);
          label.append(
            element(
              "span",
              "tree-context-label",
              project?.name ?? current.project,
            ),
          );
          ancestors.append(label, uiIcon("chevron-right"));
        }
        for (const issue of known.slice(0, -1))
          ancestors.append(link(issue, true), uiIcon("chevron-right"));
        nav.replaceChildren(
          ancestors,
          ...(current ? [link(current, false)] : []),
        );
        nav.hidden = !current;
      }
    }
    const height = nav.hidden
      ? 0
      : Math.ceil(nav.getBoundingClientRect().height);
    for (const target of targets) {
      const value = `${target === scroller ? height : 0}px`;
      if (target.style.getPropertyValue("--tree-context-height") !== value)
        target.style.setProperty("--tree-context-height", value);
    }
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }
  for (const target of targets)
    target.addEventListener("scroll", schedule, { passive: true });
  const resize = new ResizeObserver(schedule);
  resize.observe(pane);
  resize.observe(pane.querySelector(".browse-content") ?? host);
  resize.observe(nav);
  return {
    refresh() {
      force = true;
      schedule();
    },
    destroy() {
      cancelAnimationFrame(frame);
      resize.disconnect();
      for (const target of targets) {
        target.removeEventListener("scroll", schedule);
        target.style.removeProperty("--tree-context-height");
      }
      slot.remove();
    },
  };
}
