import type { TreeCatalog } from "../domain/catalog.ts";
import { branchDefaults } from "../domain/filters.ts";
import { listCacheKey } from "../domain/list-snapshot.ts";
import type { LogEntry } from "../domain/log.ts";
import { parseIssueKey } from "../domain/validation.ts";
import { createBulkSelection } from "../ui/bulk-selection.ts";
import { connectionForm } from "../ui/connection.ts";
import { developerLog } from "../ui/developer-log.ts";
import { actionButton, element, iconButton } from "../ui/dom.ts";
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
import { type Api, subscribeLogs } from "./api.ts";
import { createListController } from "./list-controller.ts";
import { createLiveUpdates } from "./live-updates.ts";
import {
  createAccountStore,
  type LocalStore,
  readPreferences,
  writePreferences,
} from "./preferences.ts";
import { createViewController } from "./view-controller.ts";

/** 시작과 화면 간 연결만 담당한다. 필터와 상세의 판단은 각 모듈에서 검증한다. */
export async function createApp(
  root: HTMLElement,
  api: Api,
  storage: LocalStore,
  connectLog: (
    listener: (entry: LogEntry) => void,
  ) => () => void = subscribeLogs,
) {
  const nav = element("header", "top-nav"),
    tools = element("div", "nav-tools");
  const searchToggle = iconButton("검색", "search"),
    projects = iconButton("프로젝트 선택", "folder"),
    filters = iconButton("필터 및 뷰", "list-filter"),
    help = iconButton("도움말", "circle-help"),
    settings = iconButton("설정", "settings"),
    selection = iconButton("이슈 선택 모드", "check"),
    logToggle = iconButton("개발자 로그 켜기", "code-xml");
  logToggle.hidden = true;
  tools.append(
    searchToggle,
    projects,
    filters,
    selection,
    help,
    settings,
    logToggle,
  );
  nav.append(element("h1", "", "Fast Jira"), tools);
  const workspace = element("main", "workspace"),
    browse = element("section", "browse"),
    search = element("form", "search-form");
  search.setAttribute("aria-label", "이슈 검색");
  search.hidden = true;
  const input = element("input");
  input.type = "search";
  input.placeholder = "이슈 키 또는 제목 검색";
  input.setAttribute("aria-label", "이슈 키 또는 제목");
  const submit = actionButton("검색", "search");
  submit.type = "submit";
  const reset = actionButton("검색 초기화", "x");
  search.append(input, submit, reset);
  const searchInfo = element("div", "search-info"),
    listHost = element("div", "browse-list");
  const browseContent = element("div", "browse-content");
  browseContent.append(search, searchInfo, listHost);
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
  side.append(dashboard, detailHost);
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
  let recent = store.recent();
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
      if (conditionsChanged) bulk.reset();
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
  let catalogProjects = [...saved.filters.projects];

  let catalog: TreeCatalog = {
    projects: bootstrap.projects,
    priorities: bootstrap.priorities,
    statuses: [],
    types: [],
  };
  nav.removeAttribute("aria-busy");
  for (const button of tools.querySelectorAll("button"))
    button.disabled = false;

  const debug = developerLog(root, logToggle, connectLog);
  const layout = matchMedia("(max-width: 900px)");
  const split = createSplitPane(workspace, splitter, layout, storage);
  let render = () => {};
  const list = createListController(
    api,
    initialFilters,
    bootstrap.me.accountId,
    () => {
      render();
    },
    store.tree(),
    (key, current) =>
      branchDefaults({ ...current, ...views.resolve({ kind: "branch", key }) }),
  );
  let positionQuery = listCacheKey(initialFilters);
  const listScroller = () => (layout.matches ? workspace : browse);
  function persistPosition() {
    if (list.cacheDenied) return;
    const anchors = captureViewportAnchor(listHost, listScroller());
    if (listHost.querySelector("a.list-title"))
      store.savePosition(listCacheKey(list.filters), anchors);
  }
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
    async changed(issues) {
      const versions = new Map<string, number>();
      for (const issue of issues) {
        changedVersions.set(
          issue.key,
          (changedVersions.get(issue.key) ?? 0) + 1,
        );
        versions.set(issue.key, changedVersions.get(issue.key) ?? 0);
        recent = recent.map((item) =>
          item.key === issue.key ? { ...item, ...issue } : item,
        );
      }
      store.saveRecent(recent);
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
            (issue) =>
              changedVersions.get(issue.key) === versions.get(issue.key),
          ),
          matches.keys,
          matches.ancestors,
        );
      if (
        issues.some((issue) => issue.key === selectedKey) &&
        detailView?.canRefresh()
      )
        await select(selectedKey, false, true);
    },
  });
  function applyPreferences() {
    debug.setEnabled(preferences.developerMode);
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.dataset.compact = String(preferences.compactView);
    document.documentElement.dataset.compactDone = String(
      preferences.compactDone,
    );
    writePreferences(storage, preferences);
  }
  applyPreferences();
  const renderDashboard = keyedContent(dashboard);
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
    for (const issue of recent)
      entries.push([
        issue.key,
        bulk.decorate(
          issue,
          issueCard(issue, {
            site: bootstrap.site,
            copied: notice.show,
            statusOrder: catalog.statuses.map((status) => status.name),
            selectedKey,
            onSelect: (key) => {
              void select(key);
            },
          }),
        ),
      ]);
    renderDashboard(entries);
  }
  function placeDetail() {
    if (layout.matches) {
      mobile.append(detailHost, noticeHost);
      debug.place(selectedKey && !bulk.active ? mobile : root);
      if (bulk.active && mobile.open) mobile.close();
      else if (selectedKey && !mobile.open) mobile.showModal();
    } else {
      if (mobile.open) mobile.close();
      side.append(detailHost);
      root.append(noticeHost);
      debug.place(root);
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
    debug.place(root);
    const url = new URL(location.href);
    url.searchParams.delete("issue");
    history.replaceState(null, "", url);
    render();
  }
  async function select(key: string, updateUrl = true, silent = false) {
    if (!silent) {
      detailView?.destroy();
      detailView = null;
    }
    const version = ++detailRevision;
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
    if (updateUrl) {
      const url = new URL(location.href);
      url.searchParams.set("issue", key);
      history.pushState(null, "", url);
    }
    try {
      const result = await api.lookup(key);
      // 선택 순서를 지킨다. 늦은 응답은 현재 상세와 최근 이력을 덮어쓰지 않는다.
      if (destroyed || version !== detailRevision) return;
      // 조회 중 편집을 시작했어도 초안을 지킨다. 종료 후 최신 내용을 다시 확인한다.
      if (silent && detailView && !detailView.canRefresh()) return;
      detailView?.destroy();
      detailView = issueDetail(
        result,
        catalog.statuses.map((status) => status.name),
        closeDetail,
        notice.show,
        api,
        bootstrap.me,
        async (updated) => {
          const changeVersion = (changedVersions.get(updated.key) ?? 0) + 1;
          changedVersions.set(updated.key, changeVersion);
          recent = recent.map((item) =>
            item.key === updated.key ? updated : item,
          );
          store.saveRecent(recent);
          const filters = list.filters;
          list.update(updated, list.direct.has(updated.key));
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
          catalog: () => catalog,
          onFilter: (key, anchor) => panel.open(anchor, key),
          viewInfo: (key) => views.info({ kind: "branch", key }),
        },
      );
      detailHost.replaceChildren(detailView.element);
      recent = [
        result.parent,
        ...recent.filter((issue) => issue.key !== key),
      ].slice(0, 5);
      store.saveRecent(recent);
      dashboardView();
    } catch (reason) {
      if (version !== detailRevision || destroyed) return;
      if (silent) {
        notice.show("상세 변경 확인이 지연되고 있어요.");
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
  const tree = createTreeView(listHost, list, {
    site: bootstrap.site,
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
    },
  });
  render = () => {
    if (destroyed) return;
    const queryKey = listCacheKey(list.filters);
    const anchors =
      queryKey === positionQuery
        ? captureViewportAnchor(listHost, listScroller())
        : [];
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
    detailView?.refreshChildren();
    dashboardView();
    dashboard.hidden = bulk.active || Boolean(selectedKey);
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
    input.value = "";
    void list.load({ ...list.filters, q: "" });
  }
  reset.addEventListener("click", clearSearch);
  searchToggle.addEventListener("click", () => {
    search.hidden = !search.hidden;
    if (!search.hidden) input.focus();
  });
  search.addEventListener("submit", (event) => {
    event.preventDefault();
    if (bulk.busy) return;
    bulk.reset();
    const query = input.value.trim();
    if (
      /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(query) ||
      /^https?:\/\//.test(query)
    ) {
      try {
        void select(parseIssueKey(query, bootstrap.site));
      } catch (reason) {
        notice.show(
          reason instanceof Error ? reason.message : "이슈 키를 확인하세요.",
        );
      }
    } else {
      void list.load({ ...list.filters, q: query });
    }
  });
  projects.addEventListener("click", () => projectPanel.open(projects));
  filters.addEventListener("click", () => panel.open(filters));
  let firstSetup = !saved.configured;
  popup.addEventListener("close", () => {
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
  layout.addEventListener("change", placeDetail);
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
    versions: () => changedVersions,
    known: () => {
      const known = new Map(recent.map((issue) => [issue.key, issue]));
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
          issue.key === selectedKey,
      );
      if (!relevant.length) return;
      for (const issue of relevant) {
        changedVersions.set(
          issue.key,
          (changedVersions.get(issue.key) ?? 0) + 1,
        );
        recent = recent.map((item) =>
          item.key === issue.key ? { ...item, ...issue } : item,
        );
      }
      store.saveRecent(recent);
      list.applyChanges({ ...batch, issues: relevant });
      notice.show(`새 변경 ${relevant.length}건 반영`);
      if (
        relevant.some((issue) => issue.key === selectedKey) &&
        detailView?.canRefresh()
      )
        await select(selectedKey, false, true);
    },
    failed: () => notice.show("변경 확인이 지연되고 있어요."),
  });
  const clock = setInterval(() => {
    if (!document.hidden) refreshRelativeTimes(root);
    void live.check();
  }, 60000);
  const visible = () => {
    if (!document.hidden) void live.check();
  };
  document.addEventListener("visibilitychange", visible);
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
  await Promise.all([list.load(), metadata]);
  const initialKey = new URL(location.href).searchParams.get("issue");
  if (initialKey) {
    try {
      await select(parseIssueKey(initialKey, bootstrap.site), false);
    } catch {
      notice.show("이슈 키를 확인하세요.");
    }
  }
  return {
    list,
    views,
    select,
    closeDetail,
    checkChanges: live.check,
    destroy() {
      persistPosition();
      destroyed = true;
      list.destroy();
      window.removeEventListener("pagehide", persistPosition);
      detailView?.destroy();
      bulk.destroy();
      detailRevision++;
      clearInterval(clock);
      live.destroy();
      document.removeEventListener("visibilitychange", visible);
      layout.removeEventListener("change", placeDetail);
      window.removeEventListener("popstate", popstate);
      panel.destroy();
      projectPanel.destroy();
      treeContext.destroy();
      tree.destroy();
      split.destroy();
      debug.destroy();
      notice.destroy();
      if (popup.open) popup.close();
      if (mobile.open) mobile.close();
      root.replaceChildren();
    },
  };
}
