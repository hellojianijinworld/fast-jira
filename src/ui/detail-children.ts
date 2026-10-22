import type { Api } from "../client/api.ts";
import type { ListController } from "../client/list-controller.ts";
import type { TreeCatalog } from "../domain/catalog.ts";
import type { LookupResult } from "../domain/details.ts";
import { compareIssues } from "../domain/list.ts";
import { FOLLOW_GLOBAL_VIEW, type ViewInfo } from "../domain/view-labels.ts";
import { element, iconButton, uiIcon } from "./dom.ts";
import { type CardOptions, issueCard } from "./issue-card.ts";
import { keyedContent } from "./keyed-content.ts";

export interface DetailChildOptions {
  favorites?: CardOptions["favorites"];
  list: ListController;
  catalog: () => TreeCatalog;
  onFilter: (key: string, anchor: HTMLButtonElement) => void;
  viewInfo?: (key: string) => ViewInfo;
}
/** 상세와 트리는 같은 하위 필터·정렬·페이지 캐시를 사용한다. */
export function detailChildren(
  result: LookupResult,
  api: Api,
  cards: CardOptions,
  options?: DetailChildOptions,
) {
  if (
    !result.children.length &&
    !(result.deferredChildren && result.parent.hasChildren)
  )
    return null;
  const root = element("details", "detail-children issue-list-container"),
    summary = element("summary"),
    list = element("div");
  root.append(summary, list);
  const section = element("section", "detail-child-section");
  const filter = iconButton("하위 정렬·필터", "list-filter");
  section.append(root);
  if (options) {
    filter.classList.add("detail-child-filter");
    filter.addEventListener("click", () =>
      options.onFilter(result.parent.key, filter),
    );
    section.append(filter);
  }
  const renderCards = keyedContent(list);
  const more = element("button", "secondary");
  more.addEventListener("click", () => {
    if (options)
      void options.list.queueChildren(
        result.parent.key,
        () => alive && root.open,
      );
  });
  let alive = true,
    loaded = !result.deferredChildren,
    loading = false;
  function render(issues: LookupResult["children"], showMore = false) {
    summary.textContent = `하위 이슈 ${issues.length}개`;
    const entries: [string, HTMLElement][] = issues.map((issue) => [
      issue.key,
      issueCard(issue, {
        ...cards,
        ...(options?.favorites ? { favorites: options.favorites } : {}),
      }),
    ]);
    if (showMore) entries.push(["more", more]);
    renderCards(entries);
  }
  if (loaded) render(result.children);
  else summary.textContent = "하위 이슈 보기";
  function refresh() {
    if (!alive || !options) return;
    const key = result.parent.key;
    const info = options.viewInfo?.(key);
    filter.classList.toggle("active", Boolean(info?.active || info?.temporary));
    filter.replaceChildren(uiIcon(info?.icon ?? "list-filter"));
    filter.dataset.viewKind = info?.kind ?? "default";
    filter.title = `하위 뷰 · ${info?.label ?? FOLLOW_GLOBAL_VIEW}${info?.temporary ? " · 이번만 넓혀 보기" : ""}`;
    if (!root.open) return;
    const page = options.list.childPage(key);
    const catalog = options.catalog();
    const statuses = new Map(
      catalog.statuses.map((status, index) => [status.id, index]),
    );
    const priorities = new Map(
      catalog.priorities.map((priority, index) => [priority.id, index]),
    );
    more.textContent = page.error ? "다시 시도" : "하위 더 보기";
    more.disabled = page.loading;
    render(
      [...page.issues.values()]
        .filter((issue) => options.list.childPasses(issue))
        .sort((a, b) =>
          compareIssues(
            a,
            b,
            options.list.effectiveBranch(key).sort,
            statuses,
            priorities,
          ),
        ),
      Boolean(page.nextPageToken || page.error),
    );
    root.setAttribute("aria-busy", String(page.loading));
    if (page.loading && !page.loaded)
      summary.textContent = "하위 이슈 불러오는 중…";
    if (page.loading || ((!page.loaded || page.restored) && !page.error))
      void options.list.queueChildren(key, () => alive && root.open);
  }
  refresh();
  root.addEventListener("toggle", async () => {
    if (options) {
      refresh();
      return;
    }
    if (!root.open || loaded || loading) return;
    loading = true;
    summary.textContent = "하위 이슈 불러오는 중…";
    try {
      const issues = await api.directChildren(result.parent.key);
      if (!alive) return;
      render(issues);
      loaded = true;
    } catch {
      if (!alive) return;
      summary.textContent = "하위 이슈 다시 불러오기";
      root.open = false;
    } finally {
      loading = false;
    }
  });
  return {
    element: section,
    refresh,
    destroy() {
      alive = false;
    },
  };
}
