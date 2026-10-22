import type { Api } from "../client/api.ts";
import type { Issue } from "../domain/issue.ts";
import { element, uiIcon } from "./dom.ts";
import { issueTypeIcon } from "./meta.ts";

/** 목록에서 받은 상위를 재사용하고, 없는 경로만 필요할 때 보강한다. */
export function issueBreadcrumbs(
  issue: Issue,
  known: ReadonlyMap<string, Issue>,
  api: Pick<Api, "ancestors">,
  select: (key: string) => void,
  currentItem?: HTMLElement,
) {
  const root = element("nav", "detail-breadcrumbs");
  root.setAttribute("aria-label", "상위 이슈 경로");
  const items = new Map(known);
  let alive = true;
  function render() {
    root.replaceChildren();
    const path: (Pick<Issue, "key" | "summary"> &
      Partial<Pick<Issue, "issueType" | "issueTypeIcon">>)[] = [];
    const visited = new Set([issue.key]);
    let current = issue;
    let missing = "";
    while (current.parent && !visited.has(current.parent)) {
      visited.add(current.parent);
      const parent = items.get(current.parent);
      path.unshift(
        parent ?? { key: current.parent, summary: current.parentSummary },
      );
      if (!parent) {
        missing = current.parent;
        break;
      }
      current = parent;
    }
    root.hidden = !path.length && !currentItem;
    for (const parent of path) {
      const link = element("a");
      if (parent.issueType)
        link.append(
          issueTypeIcon({
            issueType: parent.issueType,
            issueTypeIcon: parent.issueTypeIcon ?? "",
          }),
        );
      link.append(
        element(
          "span",
          "breadcrumb-label",
          `${parent.key} · ${parent.summary || parent.key}`,
        ),
      );
      link.href = `?issue=${encodeURIComponent(parent.key)}`;
      link.title = link.textContent ?? "";
      link.addEventListener("click", (event) => {
        event.preventDefault();
        select(parent.key);
      });
      root.append(link, uiIcon("chevron-right"));
    }
    if (path.length || currentItem) {
      const current = currentItem ?? element("span", "", issue.key);
      current.setAttribute("aria-current", "page");
      root.append(current);
    }
    return missing;
  }
  const missing = render();
  if (missing)
    void api
      .ancestors(missing)
      .then((parents) => {
        if (!alive) return;
        for (const parent of parents) items.set(parent.key, parent);
        render();
      })
      .catch(() => {
        if (alive)
          root.title =
            "상위 경로를 모두 불러오지 못했어요. 이슈를 다시 열면 재시도해요.";
      });
  return {
    element: root,
    destroy: () => {
      alive = false;
    },
  };
}
