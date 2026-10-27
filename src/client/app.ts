import type { TreeCatalog } from "../domain/catalog.ts";
import { shortcutAria, shortcutLabel } from "../domain/commands.ts";
import type { LookupResult } from "../domain/details.ts";
import { sameIssue, updateFavorites } from "../domain/favorites.ts";
import { branchDefaults } from "../domain/filters.ts";
import type { Issue } from "../domain/issue.ts";
import { listCacheKey } from "../domain/list-snapshot.ts";
import { withParticipantHydration } from "../domain/sync.ts";
import { parseIssueKey } from "../domain/validation.ts";
import { activityFeed } from "../ui/activity-feed.ts";
import { createBulkSelection } from "../ui/bulk-selection.ts";
import { createCommandPalette } from "../ui/command-palette.ts";
import { connectionForm } from "../ui/connection.ts";
import { createIssueDialog } from "../ui/create-issue.ts";
import { actionButton, element, iconButton } from "../ui/dom.ts";
import { favoriteButton, updateFavoriteButton } from "../ui/favorite-button.ts";
import { createFilterPanel } from "../ui/filter-panel.ts";
import { helpContent } from "../ui/help.ts";
import { issueCard } from "../ui/issue-card.ts";
import { issueDetail } from "../ui/issue-detail.ts";
import { keyedContent } from "../ui/keyed-content.ts";
import { refreshRelativeTimes } from "../ui/meta.ts";
import { showModal } from "../ui/modal.ts";
import { createNotice } from "../ui/notice.ts";
import { createProjectPanel } from "../ui/project-panel.ts";
import { settingsContent } from "../ui/settings.ts";
import { createSplitPane } from "../ui/split-pane.ts";
import { createTreeContext } from "../ui/tree-context.ts";
import { createTreeView } from "../ui/tree-view.ts";
import {
  captureViewportAnchor,
  restoreViewportAnchor,
} from "../ui/viewport-anchor.ts";
import { createActivityController } from "./activity-controller.ts";
import { type Api, ApiError } from "./api.ts";
import type { ListCache } from "./list-cache.ts";
import { createListController } from "./list-controller.ts";
import { createLiveUpdates } from "./live-updates.ts";
import {
  createAccountStore,
  type LocalStore,
  readPreferences,
  writePreferences,
} from "./preferences.ts";
import { createRefreshLoop } from "./refresh-loop.ts";
import { createViewController } from "./view-controller.ts";

/** 시작과 화면 간 연결만 담당한다. 필터와 상세의 판단은 각 모듈에서 검증한다. */
export async function createApp(
  root: HTMLElement,
  api: Api,
  storage: LocalStore,
  cache?: ListCache,
  updates?: HTMLElement,
) {
  const nav = element("header", "top-nav"),
    tools = element("div", "nav-tools");
  const searchToggle = iconButton("검색", "search"),
    aiToggle = iconButton("AI 대화", "sparkles"),
    projects = iconButton("프로젝트 선택", "folder"),
    filters = iconButton("필터 및 뷰", "list-filter"),
    help = iconButton("도움말", "circle-help"),
    settings = iconButton("설정", "settings"),
    selection = iconButton("이슈 선택 모드", "check");
  searchToggle.title = `이슈 검색 (${shortcutLabel(navigator.platform)})`;
  searchToggle.setAttribute("aria-keyshortcuts", "Control+k Meta+k");
  aiToggle.title = `AI 대화 (${shortcutLabel(navigator.platform, "ai")})`;
  aiToggle.setAttribute(
    "aria-keyshortcuts",
    shortcutAria(navigator.platform, "ai"),
  );
  tools.append(
    searchToggle,
    aiToggle,
    projects,
    filters,
    selection,
    help,
    settings,
  );
  nav.append(element("h1", "", "Fast Jira"), tools);
  const workspace = element("main", "workspace"),
    browse = element("section", "browse");
  const searchInfo = element("div", "search-info"),
    listHost = element("div", "browse-list");
  const browseContent = element("div", "browse-content");
  browseContent.append(searchInfo, listHost);
  browse.append(browseContent);
  const side = element("aside", "detail-pane"),
    splitter = element("div", "splitter"),
    dashboard = element("section", "dashboard"),
    detailHost = element("div", "detail-content");
  const loadingIndicator = element("span", "loading-indicator detail-loading");
  loadingIndicator.setAttribute("role", "status");
  loadingIndicator.setAttribute("aria-label", "이슈 불러오는 중");
  loadingIndicator.hidden = true;
  let detailLoading = false;
  const layout = matchMedia("(max-width: 600px)");
  const dashboardFold = element("details", "dashboard-fold");
  dashboardFold.open = !layout.matches;
  dashboardFold.append(
    element("summary", "dashboard-summary", "즐겨찾기 · 최근 이슈 · 활동"),
    dashboard,
  );
  side.append(dashboardFold, detailHost);
  detailHost.hidden = true;
  const mobile = element("dialog", "detail-modal");
  mobile.setAttribute("aria-label", "이슈 상세");
  const popup = element("dialog", "settings-modal");
  const noticeHost = element("div"),
    notice = createNotice(noticeHost);
  workspace.append(browse, splitter, side);
  root.replaceChildren(nav, workspace, noticeHost, mobile, popup);
  nav.setAttribute("aria-busy", "true");
  for (const button of tools.querySelectorAll("button")) button.disabled = true;
  const checking = element("p", "empty", "Jira 연결을 확인하는 중…");
  checking.setAttribute("role", "status");
  listHost.append(checking);
  const bootstrap = await api.bootstrap(),
    store = createAccountStore(storage, bootstrap.site, bootstrap.me.accountId);
  let preferences = readPreferences(storage),
    selectedKey = "",
    detailRevision = 0,
    destroyed = false;
  let detailView: ReturnType<typeof issueDetail> | null = null;
  let detailOpener: { host: HTMLElement; href: string } | null = null;
  let recent = store.recent();
  let favorites = store.favorites();
  const collapsedGroups = store.collapsedGroups();
  const changedVersions = new Map<string, number>();
  const saved = store.filters(bootstrap.projects.map((project) => project.key));
  const globalView = { kind: "global" } as const;
  let syncingViews = false;
  const views = createViewController(store.views(saved.filters), {
    beforeChange: () => {
      if (bulk.busy) throw new Error("일괄 변경이 끝난 뒤 뷰를 변경하세요.");
    },
    save: store.saveViews,
    statuses: () => catalog.statuses,
    changed: (conditionsChanged) => {
      if (syncingViews || destroyed) return;
      if (conditionsChanged) {
        bulk.reset();
      }
      const next = { ...list.filters, ...views.resolve(globalView, false) };
      store.saveFilters(next, true);
      if (JSON.stringify(next) !== JSON.stringify(list.filters)) {
        bulk.reset();
        void list.load(next);
      } else render();
    },
  });
  const initialFilters = {
    ...saved.filters,
    ...views.resolve(globalView, false),
  };
  const cached = await cache?.read(store.scope, initialFilters);
  let catalogProjects = [...saved.filters.projects];

  let catalog: TreeCatalog = {
    projects: bootstrap.projects,
    priorities: bootstrap.priorities,
    statuses: cached?.catalog.statuses ?? [],
    types: cached?.catalog.types ?? [],
  };
  nav.removeAttribute("aria-busy");
  for (const button of tools.querySelectorAll("button"))
    button.disabled = false;

  const split = createSplitPane(workspace, splitter, layout, storage);
  let render = () => {};
  const list = createListController(
    api,
    initialFilters,
    bootstrap.me.accountId,
    () => {
      render();
      scheduleCache();
    },
    store.tree(),
    (key, current) =>
      branchDefaults({ ...current, ...views.resolve({ kind: "branch", key }) }),
  );
  if (cached) list.restore(cached.data);
  let cacheTimer: ReturnType<typeof setTimeout> | undefined;
  let cacheWrites = Promise.resolve(),
    deniedCache = "";
  function persistCache() {
    if (cacheTimer) clearTimeout(cacheTimer);
    cacheTimer = undefined;
    if (!cache) return;
    if (list.cacheDenied) {
      const query = { ...list.filters },
        key = listCacheKey(query);
      if (deniedCache !== key) {
        deniedCache = key;
        cacheWrites = cacheWrites.then(() =>
          cache.remove(store.scope, query).catch(() => {}),
        );
      }
      return;
    }
    deniedCache = "";
    if (!list.loaded) return;
    const query = { ...list.filters },
      snapshot = {
        data: list.snapshot(),
        catalog: { statuses: catalog.statuses, types: catalog.types },
      };
    cacheWrites = cacheWrites.then(() =>
      cache.write(store.scope, query, snapshot).catch(() => {}),
    );
  }
  function scheduleCache() {
    if (!cache || destroyed) return;
    if (list.cacheDenied) {
      persistCache();
      return;
    }
    if (!list.loaded) return;
    if (cacheTimer) clearTimeout(cacheTimer);
    cacheTimer = setTimeout(persistCache, 500);
  }
  let positionQuery = listCacheKey(initialFilters);
  let restoredPosition = cached ? store.position(positionQuery) : [];
  const listScroller = () => (layout.matches ? workspace : browse);
  function persistPosition() {
    if (list.cacheDenied) return;
    const anchors = captureViewportAnchor(listHost, listScroller());
    if (listHost.querySelector("a.list-title"))
      store.savePosition(listCacheKey(list.filters), anchors);
  }
  window.addEventListener("pagehide", persistCache);
  window.addEventListener("pagehide", persistPosition);
  const bulk = createBulkSelection({
    host: root,
    mount: side,
    site: bootstrap.site,
    toggle: selection,
    api,
    order: () => catalog.statuses.map((status) => status.name),
    render: () => {
      placeDetail();
      render();
    },
    notice: notice.show,
    changed: applyChangedIssues,
  });
  async function applyChangedIssues(issues: Issue[]) {
    const versions = new Map<string, number>();
    for (const issue of issues) {
      changedVersions.set(issue.key, (changedVersions.get(issue.key) ?? 0) + 1);
      versions.set(issue.key, changedVersions.get(issue.key) ?? 0);
      recent = recent.map((item) =>
        item.key === issue.key ? { ...item, ...issue } : item,
      );
    }
    store.saveRecent(recent);
    refreshFavorites(issues);
    if (!issues.length) return;
    const filters = list.filters,
      visible = list.visibleItems();
    const matches = await api
      .matchesMany(
        issues.map((issue) => issue.key),
        filters,
        [
          ...new Set(
            issues
              .map((issue) => issue.parent)
              .filter((key) => key && !visible.has(key)),
          ),
        ],
      )
      .catch(() => ({
        ancestors: [],
        keys: new Set(
          issues
            .filter((issue) => list.direct.has(issue.key))
            .map((issue) => issue.key),
        ),
      }));
    // 목록·하위 커서를 유지한다. 변경한 키만 묶음 판정하고 한 번 갱신한다.
    if (!destroyed && list.filters === filters)
      list.updateMany(
        issues.filter(
          (issue) => changedVersions.get(issue.key) === versions.get(issue.key),
        ),
        matches.keys,
        matches.ancestors,
      );
    if (
      issues.some((issue) => issue.key === selectedKey) &&
      detailView?.canRefresh()
    )
      await select(selectedKey, false, true);
  }

  function applyPreferences() {
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.dataset.compact = String(preferences.compactView);
    document.documentElement.dataset.compactDone = String(
      preferences.compactDone,
    );
    writePreferences(storage, preferences);
  }
  applyPreferences();
  function refreshFavorites(
    incoming: readonly Issue[],
    removed: readonly string[] = [],
  ) {
    const next = updateFavorites(favorites, incoming, removed);
    if (
      next.length !== favorites.length ||
      next.some((issue, index) => issue !== favorites[index])
    ) {
      favorites = next;
      store.saveFavorites(favorites);
    }
  }
  function setFavorite(issue: Issue, selected: boolean) {
    favorites = favorites.filter((saved) => !sameIssue(saved, issue));
    if (selected) favorites.unshift(issue);
    store.saveFavorites(favorites);
    render();
  }
  const cardFavorites = {
    has: (issue: Issue) => favorites.some((saved) => sameIssue(saved, issue)),
    change: setFavorite,
  };
  function renderCard(issue: Issue) {
    return bulk.decorate(
      issue,
      issueCard(issue, {
        site: bootstrap.site,
        currentUserId: bootstrap.me.accountId,
        copied: notice.show,
        statusOrder: catalog.statuses.map((status) => status.name),
        selectedKey,
        onSelect: (key) => {
          void select(key);
        },
        favorites: cardFavorites,
      }),
    );
  }
  const renderDashboard = keyedContent(dashboard);
  const activity = createActivityController(api, () => render());
  const activities = activityFeed(
    (key) => {
      void select(key);
    },
    () => {
      void activity.check(list.filters.projects);
    },
  );
  dashboard.classList.add("issue-list-container");
  function dashboardView() {
    const entries: [string, HTMLElement][] = [
      ["heading", element("h2", "", "최근 본 이슈")],
    ];
    if (!recent.length)
      entries.push([
        "empty",
        element("p", "empty", "이슈를 열면 최근 본 5개가 여기에 남아요."),
      ]);
    const current = list.visibleItems();
    const byId = new Map(
      [...current.values()]
        .filter((issue) => issue.id)
        .map((issue) => [issue.id, issue]),
    );
    if (favorites.length) {
      const section = element("section", "favorites");
      section.setAttribute("aria-label", "즐겨찾기");
      section.append(element("h2", "", "즐겨찾기"));
      for (const saved of favorites) {
        const currentIssue = current.get(saved.key) ?? byId.get(saved.id);
        const issue =
          currentIssue &&
          (Date.parse(currentIssue.updated) || 0) >=
            (Date.parse(saved.updated) || 0)
            ? currentIssue
            : saved;
        section.append(renderCard(issue));
      }
      entries.unshift(["favorites", section]);
    }
    for (const saved of recent) {
      const issue = current.get(saved.key) ?? byId.get(saved.id) ?? saved;
      entries.push([issue.key, renderCard(issue)]);
    }
    activities.render(
      activity.entries,
      activity.newIds,
      activity.loading,
      activity.error,
      list.filters.projects,
    );
    entries.push(["activity-feed", activities.element]);
    renderDashboard(entries);
  }
  function placeDetail() {
    const commandOpen = Boolean(root.querySelector(".command-modal[open]"));
    if (layout.matches) {
      if (detailHost.parentElement !== mobile) mobile.append(detailHost);
      if (!commandOpen && noticeHost.parentElement !== mobile)
        mobile.append(noticeHost);
      if (bulk.active && mobile.open) mobile.close();
      else if (selectedKey && !mobile.open && !commandOpen && !popup.open)
        mobile.showModal();
    } else {
      if (mobile.open) mobile.close();
      if (detailHost.parentElement !== side) side.append(detailHost);
      if (!commandOpen) root.append(noticeHost);
    }
  }
  function closeDetail() {
    detailView?.destroy();
    detailView = null;
    selectedKey = "";
    detailRevision++;
    detailLoading = false;
    detailHost.hidden = true;
    dashboard.hidden = false;
    if (mobile.open) mobile.close();
    root.append(noticeHost);
    const url = new URL(location.href);
    url.searchParams.delete("issue");
    history.replaceState(null, "", url);
    render();
    detailOpener?.host
      .querySelector<HTMLElement>(
        `.list-title[href="${CSS.escape(detailOpener.href)}"]`,
      )
      ?.focus({ preventScroll: true });
    detailOpener = null;
  }
  async function select(
    key: string,
    updateUrl = true,
    silent = false,
    created?: LookupResult,
  ) {
    const active = document.activeElement;
    const keyboard =
      !silent &&
      active instanceof HTMLAnchorElement &&
      active.matches(".list-title:focus-visible");
    if (!silent && !detailHost.contains(active)) {
      const host = keyboard
        ? active.closest<HTMLElement>(".browse,.dashboard")
        : null;
      detailOpener = host
        ? { host, href: active?.getAttribute("href") ?? "" }
        : null;
    }
    if (!silent) {
      detailView?.destroy();
      detailView = null;
    }
    const version = ++detailRevision;
    const displayedIssue = detailView?.issue;
    selectedKey = key;
    detailHost.hidden = false;
    dashboard.hidden = true;
    detailLoading = true;
    if (!silent) {
      const pending = element("div", "detail-pending");
      const close = iconButton("이슈 상세 닫기", "x");
      close.addEventListener("click", closeDetail);
      pending.append(close);
      detailHost.replaceChildren(pending);
    }
    placeDetail();
    render();
    if (keyboard)
      detailHost
        .querySelector<HTMLElement>(".detail-pending button")
        ?.focus({ preventScroll: true });
    if (updateUrl) {
      const url = new URL(location.href);
      url.searchParams.set("issue", key);
      history.pushState(null, "", url);
    }
    try {
      const result = created ?? (await api.lookup(key));
      // 선택 순서를 지킨다. 늦은 응답은 현재 상세와 최근 이력을 덮어쓰지 않는다.
      if (destroyed || version !== detailRevision) return;
      // 조회 시작 이후 이 화면에서 저장한 내용은 이전 응답으로 덮지 않는다.
      if (silent && detailView?.issue !== displayedIssue) return;
      // 조회 중 편집을 시작했어도 초안을 지킨다. 종료 후 최신 내용을 다시 확인한다.
      if (silent && detailView && !detailView.canRefresh()) return;
      detailView?.destroy();
      refreshFavorites([result.parent]);
      detailView = issueDetail(
        result,
        catalog.statuses.map((status) => status.name),
        closeDetail,
        notice.show,
        api,
        bootstrap.me,
        async (updated, content) => {
          const changeVersion = (changedVersions.get(updated.key) ?? 0) + 1;
          changedVersions.set(updated.key, changeVersion);
          if (content === "description") return;
          if (content === "commentCount") {
            const current =
              list.visibleItems().get(updated.key) ??
              recent.find((item) => item.key === updated.key) ??
              favorites.find((item) => item.key === updated.key) ??
              updated;
            updated = {
              ...updated,
              ...current,
              commentCount: updated.commentCount,
            };
          }
          recent = recent.map((item) =>
            item.key === updated.key ? updated : item,
          );
          store.saveRecent(recent);
          refreshFavorites([updated]);
          const filters = list.filters;
          list.update(updated, list.direct.has(updated.key));
          if (content) return;
          const matches = await api.matches(updated.key, filters);
          // 이전 저장의 느린 필터 판정이 더 최근 저장 결과를 덮어쓰지 않는다.
          if (
            list.filters === filters &&
            changedVersions.get(updated.key) === changeVersion
          )
            list.update(updated, matches);
        },
        () => {
          if (!destroyed && selectedKey === key) void select(key, false, true);
        },
        (childKey) => {
          void select(childKey);
        },
        list.visibleItems(),
        {
          list,
          favorites: cardFavorites,
          catalog: () => catalog,
          onFilter: (key, anchor) => panel.open(anchor, key),
          viewInfo: (key) => views.info({ kind: "branch", key }),
        },
        favoriteButton(
          favorites.some((saved) => sameIssue(saved, result.parent)),
          (selected) => {
            setFavorite(detailView?.issue ?? result.parent, selected);
          },
        ),
        store.people,
        (parent) => {
          void creator.open({ parent });
        },
      );
      const focusTitle =
        keyboard && detailHost.contains(document.activeElement);
      detailHost.replaceChildren(detailView.element);
      if (focusTitle)
        detailHost
          .querySelector<HTMLElement>(".detail-title")
          ?.focus({ preventScroll: true });
      recent = [
        result.parent,
        ...recent.filter((issue) => issue.key !== key),
      ].slice(0, 5);
      store.saveRecent(recent);
      dashboardView();
    } catch (reason) {
      if (version !== detailRevision || destroyed) return;
      if (silent) {
        notice.showBackground("상세 변경 확인이 지연되고 있어요.");
        return;
      }
      const retry = actionButton("다시 시도", "refresh-cw");
      retry.addEventListener("click", () => {
        void select(key, false);
      });
      const close = actionButton("닫기", "x");
      close.addEventListener("click", closeDetail);
      detailHost.replaceChildren(
        element(
          "p",
          "error",
          reason instanceof Error
            ? reason.message
            : "내용을 불러오지 못했어요.",
        ),
        retry,
        close,
      );
    } finally {
      if (version === detailRevision && !destroyed) {
        detailLoading = false;
        render();
      }
    }
  }
  const creator = createIssueDialog({
    host: root,
    api,
    projects: () => catalog.projects,
    site: bootstrap.site,
    me: {
      id: bootstrap.me.accountId,
      name: bootstrap.me.displayName,
      avatar: "",
    },
    recents: store.people,
    storage,
    scope: store.scope,
    notice: notice.show,
    async created(key) {
      const result = await api.lookup(key);
      if (destroyed) return;
      const parent = list.visibleItems().get(result.parent.parent);
      if (parent)
        list.update(
          { ...parent, hasChildren: true },
          list.direct.has(parent.key),
        );
      await applyChangedIssues([result.parent]);
      if (destroyed) return;
      list.insertCreated(result.parent, list.direct.has(key));
      const hidden =
        !list.direct.has(key) &&
        !(result.parent.parent && list.childPasses(result.parent));
      await select(key, true, false, result);
      if (hidden)
        notice.show(
          `${key} 생성 완료 · 현재 뷰 조건에서는 목록에 표시되지 않습니다.`,
        );
    },
  });
  const tree = createTreeView(listHost, list, {
    onCreate: (project) => {
      void creator.open({ project });
    },
    collapsedGroups,
    onGroupChange: () => {
      store.saveCollapsedGroups(collapsedGroups);
      treeContext.refresh();
    },
    favorites: cardFavorites,
    site: bootstrap.site,
    currentUserId: bootstrap.me.accountId,
    copied: notice.show,
    catalog: () => catalog,
    decorate: bulk.decorate,
    compactDone: () => preferences.compactDone,
    compactDoneParents: () => preferences.compactDoneParents,
    selectedKey: () => selectedKey,
    onSelect: (key) => {
      void select(key);
    },
    onBranch: (key, anchor) => panel.open(anchor, key),
    viewInfo: (key) => views.info({ kind: "branch", key }),
    onTreeChange: () => store.saveTree(list.tree.states, list.tree.version),
  });
  const treeContext = createTreeContext(browse, listHost, {
    scroller: () => (layout.matches ? workspace : browse),
    items: list.visibleItems,
    projects: () => catalog.projects,
    select: (key) => {
      void select(key);
    },
  });
  const panel = createFilterPanel(api, bootstrap.me, {
    filters: () => list.filters,
    catalog: () => catalog,
    catalogProjects: () => catalogProjects,
    views,
    onCatalog: (next, projects) => {
      if (
        [...projects].sort().join(",") !==
        [...list.filters.projects].sort().join(",")
      )
        return;
      catalog = next;
      catalogProjects = [...projects];
      render();
    },
    onApply: (filters, nextCatalog, commit) => {
      if (bulk.busy) throw new Error("일괄 변경이 끝난 뒤 뷰를 변경하세요.");
      syncingViews = true;
      try {
        commit();
      } finally {
        syncingViews = false;
      }
      const next = { ...filters, ...views.resolve(globalView, false) };
      catalog = nextCatalog;
      store.saveFilters(next, true);
      if (JSON.stringify(next) !== JSON.stringify(list.filters)) {
        bulk.reset();
        void list.load(next);
      } else render();
    },
  });
  const projectPanel = createProjectPanel({
    projects: () => catalog.projects,
    selected: () => list.filters.projects,
    apply: (projects) => {
      if (bulk.busy)
        throw new Error("일괄 변경이 끝난 뒤 프로젝트를 변경하세요.");
      if (
        [...projects].sort().join(",") ===
        [...list.filters.projects].sort().join(",")
      )
        return;
      const next = { ...list.filters, projects };
      store.saveFilters(next, true);
      bulk.reset();
      void list.load(next);
      void refreshCatalog(projects);
      void activity.check(projects);
    },
  });
  render = () => {
    if (destroyed) return;
    const queryKey = listCacheKey(list.filters);
    const anchors = restoredPosition.length
      ? restoredPosition
      : queryKey === positionQuery
        ? captureViewportAnchor(listHost, listScroller())
        : [];
    restoredPosition = [];
    positionQuery = queryKey;
    loadingIndicator.hidden = !detailLoading;
    loadingIndicator.setAttribute("aria-label", "상세 불러오는 중");
    const detailHeading = detailHost.querySelector(".detail-identity");
    if (detailHeading) detailHeading.append(loadingIndicator);
    else {
      const pending = detailHost.querySelector(".detail-pending");
      (pending ?? detailHost).prepend(loadingIndicator);
    }
    tree.render();
    treeContext.refresh();
    const detailFavorite = detailHost.querySelector<HTMLButtonElement>(
      ".detail-head-actions > .favorite-button",
    );
    if (detailFavorite && detailView)
      updateFavoriteButton(detailFavorite, cardFavorites.has(detailView.issue));
    detailView?.refreshChildren();
    dashboardView();
    dashboard.hidden = bulk.active || Boolean(selectedKey);
    dashboardFold.hidden = dashboard.hidden;
    detailHost.hidden = bulk.active || !selectedKey;
    const query = list.filters.q;
    searchInfo.replaceChildren();
    searchInfo.hidden = !query;
    if (query) {
      const clear = actionButton("초기화", "x");
      clear.addEventListener("click", clearSearch);
      searchInfo.append(element("span", "", `검색: ${query}`), clear);
    }
    projects.classList.toggle(
      "active",
      list.filters.projects.length !== catalog.projects.length,
    );
    filters.classList.toggle(
      "active",
      list.filters.scope !== "all" ||
        list.filters.excludeDone ||
        list.filters.statuses !== null ||
        list.filters.assignees !== null ||
        list.filters.sort !== "recent",
    );
    if (anchors.length)
      restoreViewportAnchor(listHost, listScroller(), anchors);
  };
  function clearSearch() {
    if (bulk.busy) return;
    bulk.reset();
    void list.load({ ...list.filters, q: "" });
  }
  const commands = createCommandPalette({
    create: (draft) => {
      void creator.open(draft ? { draft } : {});
    },
    host: root,
    api,
    site: bootstrap.site,
    currentUserId: bootstrap.me.accountId,
    storage,
    scope: store.scope,
    unread: (value) => {
      aiToggle.classList.toggle("ai-has-update", value);
      aiToggle.setAttribute(
        "aria-label",
        value ? "AI 대화 · 새 답변" : "AI 대화",
      );
    },
    context: () => ({
      projects: list.filters.projects,
      issue: selectedKey,
      keys: bulk.keys,
    }),
    recent: () => recent,
    localIssues: () =>
      list.cacheDenied
        ? []
        : [
            ...favorites,
            ...recent,
            ...[...list.pages.values()].flatMap((page) => [
              ...page.issues.values(),
            ]),
            ...list.items.values(),
          ],
    order: () => catalog.statuses.map((status) => status.name),
    favorites: cardFavorites,
    select: (key) => {
      if (!bulk.busy) {
        bulk.reset();
        void select(key);
      }
    },
    changed: applyChangedIssues,
    canMutate: () => !bulk.busy && !destroyed,
    notice: notice.show,
    noticeHost,
    restoreNotice: placeDetail,
  });
  searchToggle.addEventListener("click", () => commands.open("search"));
  aiToggle.addEventListener("click", () => commands.open("ai"));
  projects.addEventListener("click", () => projectPanel.open(projects));
  filters.addEventListener("click", () => panel.open(filters));
  let firstSetup = !saved.configured;
  popup.addEventListener("close", () => {
    if (!destroyed && !popup.open) placeDetail();
    if (!firstSetup) return;
    firstSetup = false;
    store.saveFilters(list.filters, true);
  });
  function showSettings() {
    const content = settingsContent(
      preferences,
      `현재 인증된 계정: ${bootstrap.me.displayName} · Jira 사이트: ${bootstrap.site}`,
      (next) => {
        preferences = next;
        applyPreferences();
        render();
      },
      firstSetup ? () => popup.close() : undefined,
      connectionForm(api, () => location.reload()),
      updates,
    );
    showModal(popup, {
      title: firstSetup ? "처음 설정" : "설정",
      content: content.element,
      actions: content.actions,
    });
  }
  settings.addEventListener("click", () => showSettings());
  help.addEventListener("click", () => {
    showModal(popup, { title: "Fast Jira 이용 안내", content: helpContent() });
  });
  mobile.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDetail();
  });
  function changeLayout() {
    dashboardFold.open = !layout.matches;
    placeDetail();
  }
  layout.addEventListener("change", changeLayout);
  function popstate() {
    const key = new URL(location.href).searchParams.get("issue");
    if (key) {
      try {
        void select(parseIssueKey(key, bootstrap.site), false);
      } catch {
        closeDetail();
      }
    } else closeDetail();
  }
  window.addEventListener("popstate", popstate);
  const live = createLiveUpdates({
    api,
    filters: () =>
      !destroyed &&
      !document.hidden &&
      list.loaded &&
      !list.loading &&
      !bulk.busy
        ? list.filters
        : null,
    checkpoint: () => list.checkpoint,
    syncKnown: () =>
      withParticipantHydration(list.syncKnown(), [...favorites, ...recent]),
    versions: () => changedVersions,
    known: () => {
      const known = new Map(
        [...favorites, ...recent].map((issue) => [issue.key, issue]),
      );
      for (const [key, issue] of list.visibleItems()) known.set(key, issue);
      if (detailView) known.set(detailView.issue.key, detailView.issue);
      return known;
    },
    async apply(batch) {
      const known = list.visibleItems();
      const relevant = batch.issues.filter(
        (issue) =>
          issue.matches ||
          known.has(issue.key) ||
          known.has(issue.parent) ||
          recent.some((item) => item.key === issue.key) ||
          favorites.some((item) => sameIssue(item, issue)) ||
          issue.key === selectedKey,
      );
      if (!relevant.length && !batch.checkedAt) return;
      for (const issue of relevant) {
        changedVersions.set(
          issue.key,
          (changedVersions.get(issue.key) ?? 0) + 1,
        );
        recent = recent.map((item) =>
          item.key === issue.key ? { ...item, ...issue } : item,
        );
      }
      if (batch.removed?.length) {
        for (const key of batch.removed)
          changedVersions.set(key, (changedVersions.get(key) ?? 0) + 1);
        recent = recent.filter((issue) => !batch.removed?.includes(issue.key));
        if (batch.removed.includes(selectedKey)) closeDetail();
      }
      store.saveRecent(recent);
      refreshFavorites(relevant, batch.removed ?? []);
      list.applyChanges({ ...batch, issues: relevant });
      if (relevant.length)
        notice.showBackground(`새 변경 ${relevant.length}건 반영`);
      else if (batch.removed?.length)
        notice.showBackground(`열 수 없는 이슈 ${batch.removed.length}개 반영`);
      if (
        relevant.some((issue) => issue.key === selectedKey) &&
        detailView?.canRefresh()
      )
        await select(selectedKey, false, true);
    },
    failed: (reason) => {
      if (reason instanceof ApiError && reason.status === 409) {
        void list.revalidate();
        return;
      }
      list.syncFailed(reason);
      notice.showBackground("변경 확인이 지연되고 있어요.");
    },
  });
  const checkListChanges = async () => {
    if (
      !destroyed &&
      !document.hidden &&
      list.loaded &&
      !list.loading &&
      !bulk.busy &&
      list.needsReconcile
    )
      await list.revalidate();
    else await live.check();
  };
  const checkChanges = async () => {
    if (destroyed || document.hidden) return;
    await Promise.all([
      checkListChanges(),
      activity.check(list.filters.projects),
    ]);
  };
  if (firstSetup) showSettings();
  render();
  let metadataRevision = 0;
  async function refreshCatalog(projects: readonly string[]) {
    const revision = ++metadataRevision;
    try {
      const [statuses, types] = await Promise.all([
        api.statuses(projects),
        api.types(projects),
      ]);
      if (destroyed || revision !== metadataRevision) return;
      catalogProjects = [...projects];
      catalog = { ...catalog, statuses, types };
      render();
      scheduleCache();
    } catch (reason) {
      if (!destroyed && revision === metadataRevision)
        notice.show(
          reason instanceof Error
            ? reason.message
            : "단계 정보를 불러오지 못했어요.",
        );
    }
  }
  const metadata = refreshCatalog(list.filters.projects);
  await Promise.all([
    list.load(),
    metadata,
    activity.check(list.filters.projects),
  ]);
  const initialKey = new URL(location.href).searchParams.get("issue");
  if (initialKey) {
    try {
      await select(parseIssueKey(initialKey, bootstrap.site), false);
    } catch {
      notice.show("이슈 키를 확인하세요.");
    }
  }
  const active = () => !destroyed && !document.hidden && document.hasFocus();
  const polling = createRefreshLoop({
    active,
    refresh: async () => {
      refreshRelativeTimes(root);
      await checkChanges();
    },
    failed: () => notice.showBackground("변경 확인이 지연되고 있어요."),
  });
  const resume = () => {
    if (active()) refreshRelativeTimes(root);
    polling.update();
  };
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("focus", resume);
  window.addEventListener("blur", resume);
  resume();
  return {
    list,
    views,
    select,
    closeDetail,
    checkChanges,
    destroy() {
      persistPosition();
      destroyed = true;
      persistCache();
      list.destroy();
      window.removeEventListener("pagehide", persistCache);
      window.removeEventListener("pagehide", persistPosition);
      detailView?.destroy();
      bulk.destroy();
      commands.destroy();
      creator.destroy();
      detailRevision++;
      polling.destroy();
      live.destroy();
      activity.destroy();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("blur", resume);
      layout.removeEventListener("change", changeLayout);
      window.removeEventListener("popstate", popstate);
      panel.destroy();
      projectPanel.destroy();
      treeContext.destroy();
      tree.destroy();
      split.destroy();
      notice.destroy();
      if (popup.open) popup.close();
      if (mobile.open) mobile.close();
      root.replaceChildren();
    },
  };
}
