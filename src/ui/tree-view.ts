import type { ListController } from "../client/list-controller.ts";
import type { TreeCatalog } from "../domain/catalog.ts";
import type { Issue } from "../domain/issue.ts";
import { compareIssues } from "../domain/list.ts";
import {
  branchState,
  groupIssues,
  hierarchyDepth,
  searchAncestors,
} from "../domain/tree.ts";
import type { ViewInfo } from "../domain/view-labels.ts";
import { element, iconButton } from "./dom.ts";
import { issueCard } from "./issue-card.ts";
import { projectIcon } from "./meta.ts";

export interface TreeCallbacks {
  catalog: () => TreeCatalog;
  site: string;
  copied: (message: string) => void;
  selectedKey: () => string;
  compactDone?: () => boolean;
  compactDoneParents?: () => boolean;
  onSelect: (key: string) => void;
  onBranch: (key: string, anchor: HTMLButtonElement) => void;
  viewInfo?: (key: string) => ViewInfo;
  onTreeChange: () => void;
  decorate?: (issue: Issue, card: HTMLElement) => HTMLElement;
}
/** 트리 표시와 스크롤 관측만 담당한다. 페이지·필터·접힘 상태는 controller가 보관한다. */
export function createTreeView(
  host: HTMLElement,
  list: ListController,
  callbacks: TreeCallbacks,
) {
  host.classList.add("issue-list-container");
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting && entry.target instanceof HTMLElement) {
          const parent = entry.target.dataset.parent;
          if (
            entry.target.classList.contains("tree-children") &&
            parent &&
            !list.childPage(parent).restored
          )
            continue;
          if (parent)
            void list.queueChildren(parent, () => branchVisible(parent));
          else if (entry.target.dataset.more === "true") void list.load();
        }
    },
    { rootMargin: "350px" },
  );
  function branchVisible(key: string) {
    return [...host.querySelectorAll<HTMLElement>(".tree-children")].some(
      (region) => region.dataset.parent === key,
    );
  }
  // 키가 같은 행과 하위 목록은 유지한다. 정렬 이동·필터 이탈만 DOM 위치에 반영한다.
  function reconcile(current: HTMLElement, next: HTMLElement) {
    const existing = new Map(
      Array.from(current.children).map((node) => [
        node instanceof HTMLElement ? node.dataset.treeKey : undefined,
        node,
      ]),
    );
    let position = current.firstElementChild;
    for (const node of Array.from(next.children)) {
      const key =
        node instanceof HTMLElement ? node.dataset.treeKey : undefined;
      const old = key ? existing.get(key) : undefined;
      let chosen = node;
      if (old instanceof HTMLElement && node instanceof HTMLElement) {
        if (node.matches(".tree-list")) {
          reconcile(old, node);
          chosen = old;
          existing.delete(key);
          if (chosen !== position) current.insertBefore(chosen, position);
          position = chosen.nextElementSibling;
          continue;
        }
        const oldParts = Array.from(old.children);
        const nextParts = Array.from(node.children);
        for (const [index, part] of nextParts.entries()) {
          const previous = oldParts[index];
          if (!(part instanceof HTMLElement)) continue;
          if (
            previous instanceof HTMLElement &&
            part.matches(".tree-list,.project-tree") &&
            previous.className === part.className
          ) {
            reconcile(previous, part);
          } else if (previous instanceof HTMLElement) {
            if (previous.outerHTML !== part.outerHTML)
              previous.replaceWith(part);
          } else old.append(part);
        }
        for (const extra of oldParts.slice(nextParts.length)) extra.remove();
        chosen = old;
        existing.delete(key);
      }
      if (chosen !== position) current.insertBefore(chosen, position);
      position = chosen.nextElementSibling;
    }
    while (position) {
      const next = position.nextElementSibling;
      position.remove();
      position = next;
    }
  }
  function render() {
    observer.disconnect();
    const catalog = callbacks.catalog(),
      visible = list.visibleItems(),
      groups = groupIssues(visible);
    const forced = list.filters.q
      ? searchAncestors(visible, list.direct)
      : new Set<string>();
    const ancestors = searchAncestors(visible, list.matched);
    const permitted = (issue: Issue) =>
      !issue.parent ||
      ancestors.has(issue.key) ||
      (Boolean(list.filters.q) &&
        (list.direct.has(issue.key) || forced.has(issue.key))) ||
      list.childPasses(issue);
    const positions = new Map(
      catalog.statuses.map((status, index) => [status.id, index]),
    );
    const priorities = new Map(
      catalog.priorities.map((priority, index) => [priority.id, index]),
    );
    const statusOrder = catalog.statuses.map((status) => status.name);
    const sorted = (parent: string) =>
      [...(groups.get(parent) ?? [])].sort((a, b) =>
        compareIssues(
          a,
          b,
          parent ? list.effectiveBranch(parent).sort : list.filters.sort,
          positions,
          priorities,
        ),
      );
    const loadedChildren = new Set(
      [...visible.values()].flatMap((issue) => [
        ...list.childPage(issue.key).issues.keys(),
      ]),
    );
    const context = (issue: Issue) =>
      list.filters.q && !list.direct.has(issue.key)
        ? "관련"
        : list.matched.has(issue.key) || loadedChildren.has(issue.key)
          ? ""
          : "상위";
    function branch(
      parent: string,
      project: string,
      depth: number,
      reset: number,
      unparented = false,
      path = new Set<string>(),
      standaloneTree = unparented,
    ): HTMLUListElement {
      const group = element("ul", "tree-list");
      group.dataset.treeKey = unparented ? "standalone" : "children";
      const completed = element("li", "completed-group");
      completed.dataset.treeKey = "completed";
      completed.style.paddingLeft = `calc(${depth * 24}px + var(--tree-gutter) + 4px)`;
      const tiles = element("ul", "tree-list completed-grid");
      tiles.dataset.treeKey = "tiles";
      tiles.setAttribute("aria-label", "완료된 이슈");
      for (const issue of sorted(parent).filter(
        (issue) =>
          permitted(issue) &&
          (parent ||
            (issue.project === project &&
              hierarchyDepth(issue, catalog.types) > 0 === unparented)),
      )) {
        if (path.has(issue.key)) continue;
        const nextPath = new Set(path);
        nextPath.add(issue.key);
        const item = element("li");
        item.dataset.treeKey = issue.key;
        const row = element("div", "tree-row");
        row.style.paddingLeft = `${(standaloneTree ? depth : hierarchyDepth(issue, catalog.types, depth)) * 24}px`;
        const descendants = groups.get(issue.key) ?? [];
        const hasChildren = issue.hasChildren || descendants.some(permitted);
        const page = list.childPage(issue.key);
        const state = branchState(list.tree.states, issue.key, reset);
        const collapsed = !forced.has(issue.key) && state.collapsed;
        const level =
          issue.hierarchyLevel ??
          catalog.types.find(
            (type) =>
              type.project === issue.project && type.id === issue.issueTypeId,
          )?.hierarchyLevel;
        const compactCompleted =
          issue.statusCategory === "done" &&
          ((level === -1 &&
            parent &&
            !hasChildren &&
            (callbacks.compactDone?.() ?? true)) ||
            (level !== -1 && callbacks.compactDoneParents?.()));
        const info = hasChildren ? callbacks.viewInfo?.(issue.key) : undefined;
        let viewAction: HTMLButtonElement | undefined;
        if (!compactCompleted && info && info.kind !== "default") {
          viewAction = iconButton(`${issue.key} 하위 정렬·필터`, info.icon);
          viewAction.classList.add("row-action", "active", "card-view-button");
          viewAction.append(element("span", "card-view-label", info.label));
          viewAction.dataset.viewKind = info.kind;
          viewAction.title = `하위 뷰 · ${info.label}${info.temporary ? " · 이번만 넓혀 보기" : ""}`;
          const button = viewAction;
          button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            callbacks.onBranch(issue.key, button);
          });
        }
        const card = issueCard(issue, {
          site: callbacks.site,
          copied: callbacks.copied,
          selectedKey: callbacks.selectedKey(),
          context: context(issue),
          statusOrder,
          onSelect: callbacks.onSelect,
          ...(viewAction ? { metaAction: viewAction } : {}),
        });
        const decorated = callbacks.decorate?.(issue, card) ?? card;
        if (compactCompleted) {
          card.title = `${issue.key} · ${issue.summary} · ${issue.status}`;
          row.style.paddingLeft = "0";
          row.append(decorated);
          item.append(row);
          tiles.append(item);
          continue;
        }
        if (hasChildren) {
          if (!collapsed) {
            row.classList.add("tree-parent");
            row.dataset.contextKey = issue.key;
            row.dataset.contextParent = parent;
          }
          row.dataset.depth = String(depth);
          const actions = element("div", "tree-actions");
          const toggle = iconButton(
            `${issue.key} 하위 이슈 ${collapsed ? "펼치기" : "접기"}`,
            "chevron-right",
          );
          toggle.classList.add("tree-toggle", "row-action");
          toggle.dataset.issueKey = issue.key;
          toggle.setAttribute("aria-expanded", String(!collapsed));
          toggle.addEventListener("click", () => {
            list.toggle(issue.key, !collapsed);
            callbacks.onTreeChange();
            host
              .querySelector<HTMLButtonElement>(
                `[data-issue-key="${issue.key}"]`,
              )
              ?.focus();
          });
          actions.append(toggle);
          row.append(actions, decorated);
          item.append(row);
          if (!collapsed) {
            const nested = branch(
              issue.key,
              "",
              depth + 1,
              state.childReset,
              false,
              nextPath,
              standaloneTree,
            );
            nested.classList.add("tree-children");
            nested.dataset.parent = issue.key;
            if (page.loading && !page.restored)
              card
                .querySelector(".list-item")
                ?.setAttribute("aria-busy", "true");
            if (
              !page.loaded ||
              page.restored ||
              page.nextPageToken ||
              page.error
            ) {
              const placeholder = element("li", "child-page");
              const button = element(
                "button",
                page.error
                  ? "secondary child-more"
                  : "page-sentinel child-more",
                page.loading
                  ? "하위 불러오는 중…"
                  : page.error
                    ? "하위 조회 재시도"
                    : page.loaded
                      ? "하위 더 보기"
                      : "하위 불러오기",
              );
              button.type = "button";
              button.disabled = page.loading;
              button.dataset.retry = String(Boolean(page.error));
              button.dataset.parent = issue.key;
              button.addEventListener("click", () => {
                void list.queueChildren(issue.key, () =>
                  branchVisible(issue.key),
                );
              });
              placeholder.append(button);
              nested.append(placeholder);
            } else if (!descendants.some(permitted))
              nested.append(
                element("li", "empty", "조건에 맞는 하위 이슈가 없습니다."),
              );
            item.append(nested);
          }
        } else {
          row.append(element("span", "tree-spacer"), decorated);
          item.append(row);
        }
        group.append(item);
      }
      if (tiles.children.length) {
        completed.append(
          element("h4", "completed-heading", `완료 ${tiles.children.length}개`),
          tiles,
        );
        group.append(completed);
      }
      return group;
    }
    const root = element("ul", "root-tree tree-list");
    for (const key of new Set([
      ...sorted("").map((issue) => issue.project),
      ...(list.loading ? list.filters.projects : []),
    ])) {
      const project = catalog.projects.find((project) => project.key === key);
      const group = element("li", "project-group");
      group.dataset.treeKey = key;
      const head = element("div", "project-heading");
      const icon = project ? projectIcon(project) : null;
      if (icon) head.append(icon);
      head.append(document.createTextNode(project?.name ?? key));
      const projectTree = element("div", "project-tree");
      projectTree.append(branch("", key, 0, 0));
      const standalone = branch("", key, 0, 0, true);
      if (standalone.children.length)
        projectTree.append(
          element("div", "unparented-heading", "상위 연결 없는 작업"),
          standalone,
        );
      const count = element(
        "span",
        "project-count",
        String(projectTree.querySelectorAll(".list-item:not(.context)").length),
      );
      count.title = "현재 표시된 이슈 수";
      head.append(count);
      if (list.loading) {
        const spinner = element("span", "loading-indicator project-loading");
        spinner.setAttribute("role", "status");
        spinner.setAttribute(
          "aria-label",
          `${project?.name ?? key} 목록 불러오는 중`,
        );
        head.append(spinner);
      }
      group.append(head, projectTree);
      root.append(group);
    }
    const message = element(
      "p",
      list.error ? "error" : "empty",
      list.error ||
        (list.loading || root.children.length ? "" : "검색 결과가 없습니다."),
    );
    message.setAttribute("role", "status");
    message.hidden = !message.textContent;
    const previous = host.querySelector<HTMLUListElement>(".root-tree");
    if (previous) {
      reconcile(previous, root);
      host.querySelector(":scope > [role=status]")?.replaceWith(message);
      host.querySelector(":scope > .list-more")?.remove();
    } else host.replaceChildren(message, root);
    if (list.nextPageToken || list.error) {
      const more = element(
        "button",
        list.error ? "secondary list-more" : "page-sentinel list-more",
        list.loading ? "불러오는 중…" : list.error ? "다시 시도" : "더 보기",
      );
      more.type = "button";
      more.disabled = list.loading;
      more.dataset.retry = String(Boolean(list.error));
      more.dataset.more = "true";
      more.addEventListener("click", () => {
        void list.load();
      });
      host.append(more);
    }
    for (const target of host.querySelectorAll<HTMLButtonElement>(
      "[data-parent]:not(:disabled)[data-retry=false],[data-more]:not(:disabled)[data-retry=false]",
    ))
      observer.observe(target);
    for (const target of host.querySelectorAll<HTMLElement>(".tree-children")) {
      const page = list.childPage(target.dataset.parent ?? "");
      if (page.restored && !page.loading && !page.error)
        observer.observe(target);
    }
  }
  return {
    render,
    destroy: () => {
      observer.disconnect();
      host.replaceChildren();
    },
  };
}
