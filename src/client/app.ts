import type { TreeCatalog } from "../domain/catalog.ts";
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
import { refreshRelativeTimes } from "../ui/meta.ts";
import { showModal } from "../ui/modal.ts";
import { createNotice } from "../ui/notice.ts";
import { settingsContent } from "../ui/settings.ts";
import { createSplitPane } from "../ui/split-pane.ts";
import { createTreeView } from "../ui/tree-view.ts";
import { type Api, subscribeLogs } from "./api.ts";
import { createListController } from "./list-controller.ts";
import { createLiveUpdates } from "./live-updates.ts";
import {
  createAccountStore,
  type LocalStore,
  readPreferences,
  writePreferences,
} from "./preferences.ts";

/** 시작과 화면 간 연결만 담당한다. 필터와 상세의 판단은 각 모듈에서 검증한다. */
export async function createApp(
  root: HTMLElement,
  api: Api,
  storage: LocalStore,
  connectLog: (
    listener: (entry: LogEntry) => void,
  ) => () => void = subscribeLogs,
) {
  root.replaceChildren(element("p", "empty", "Jira 연결을 확인하는 중…"));
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
  let catalog: TreeCatalog = {
    projects: bootstrap.projects,
    priorities: bootstrap.priorities,
    statuses: [],
    types: [],
  };
  const nav = element("header", "top-nav"),
    tools = element("div", "nav-tools");
  const searchToggle = iconButton("검색", "search"),
    filters = iconButton("필터 및 정렬", "list-filter"),
    help = iconButton("도움말", "circle-help"),
    settings = iconButton("설정", "settings"),
    selection = iconButton("이슈 선택 모드", "check"),
    logToggle = iconButton("개발자 로그 켜기", "code-xml");
  tools.append(searchToggle, filters, selection, help, settings, logToggle);
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
  browse.append(search, searchInfo, listHost);
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
  const debug = developerLog(root, logToggle, connectLog);
  const layout = matchMedia("(max-width: 900px)");
  const split = createSplitPane(workspace, splitter, layout, storage);
  let render = () => {};
  const list = createListController(
    api,
    saved.filters,
    bootstrap.me.accountId,
    () => render(),
    { ...store.tree(), branches: store.branches() },
  );
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
  function dashboardView() {
    dashboard.classList.add("issue-list-container");
    dashboard.replaceChildren(element("h2", "", "최근 본 이슈"));
    if (!recent.length)
      dashboard.append(
        element("p", "empty", "이슈를 열면 최근 본 5개가 여기에 남아요."),
      );
    for (const issue of recent)
      dashboard.append(
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
      );
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
    if (!silent) detailHost.replaceChildren();
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
    selectedKey: () => selectedKey,
    onSelect: (key) => {
      void select(key);
    },
    onBranch: (key, anchor) =>
      panel.open(anchor, key, list.tree.branches.get(key)),
    onTreeChange: () => store.saveTree(list.tree.states, list.tree.version),
  });
  const panel = createFilterPanel(api, bootstrap.me, {
    filters: () => list.filters,
    catalog: () => catalog,
    compactDone: () => preferences.compactDone,
    onApply: (filters, next, compactDone) => {
      if (bulk.busy) return;
      bulk.reset();
      catalog = next;
      preferences.compactDone = compactDone;
      applyPreferences();
      store.saveFilters(filters, true);
      if (JSON.stringify(filters) === JSON.stringify(list.filters)) {
        render();
        return;
      }
      void list.load(filters);
    },
    onBranch: (key, overrides) => {
      if (bulk.busy) return;
      bulk.reset();
      list.setBranch(key, overrides);
      store.saveBranches(list.tree.branches);
    },
  });
  render = () => {
    if (destroyed) return;
    loadingIndicator.hidden = !detailLoading;
    loadingIndicator.setAttribute("aria-label", "상세 불러오는 중");
    const detailHeading = detailHost.querySelector(".detail-identity");
    if (detailHeading) detailHeading.append(loadingIndicator);
    else detailHost.prepend(loadingIndicator);
    tree.render();
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
    filters.classList.toggle(
      "active",
      list.filters.scope !== "all" ||
        list.filters.projects.length !== catalog.projects.length ||
        list.filters.excludeDone ||
        list.filters.statuses !== null ||
        list.filters.assignees !== null ||
        list.filters.sort !== "recent",
    );
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
  filters.addEventListener("click", () => panel.open(filters));
  let firstSetup = !saved.configured;
  popup.addEventListener("cancel", (event) => {
    if (firstSetup) event.preventDefault();
  });
  function showSettings(start?: () => void) {
    const content = settingsContent(
      preferences,
      `Jira 사이트: ${bootstrap.site} · 나: ${bootstrap.me.displayName} (로그인 계정)`,
      (next) => {
        preferences = next;
        applyPreferences();
      },
      start
        ? () => {
            firstSetup = false;
            store.saveFilters(list.filters, true);
            popup.close();
            start();
          }
        : undefined,
    );
    content.element.append(connectionForm(api, () => location.reload()));
    showModal(popup, {
      title: start ? "처음 설정" : "설정",
      content: content.element,
      actions: content.actions,
      dismissible: !start,
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
      // 첫 보이는 카드의 위치를 기준으로 재정렬을 보정한다. 모바일은 workspace가 스크롤을 가진다.
      const scroller = layout.matches ? workspace : browse;
      const top = scroller.getBoundingClientRect().top;
      const visibleCards = [
        ...listHost.querySelectorAll<HTMLAnchorElement>("a.list-title"),
      ].filter((card) => card.getBoundingClientRect().bottom > top);
      // 스티키 부모는 스크롤해도 같은 위치다. 실제 흐름에 있는 카드를 먼저 고른다.
      const anchor =
        visibleCards.find((card) => !card.closest(".sticky-parent")) ??
        visibleCards[0];
      const href = anchor?.getAttribute("href"),
        before = anchor?.getBoundingClientRect().top;
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
      if (href && before !== undefined) {
        const after = [
          ...listHost.querySelectorAll<HTMLAnchorElement>("a.list-title"),
        ]
          .find((card) => card.getAttribute("href") === href)
          ?.getBoundingClientRect().top;
        if (after !== undefined) scroller.scrollBy(0, after - before);
      }
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
  if (firstSetup) await new Promise<void>((resolve) => showSettings(resolve));
  render();
  const metadata = Promise.all([
    api.statuses(list.filters.projects),
    api.types(list.filters.projects),
  ])
    .then(([statuses, types]) => {
      if (destroyed) return;
      catalog = { ...catalog, statuses, types };
      render();
    })
    .catch((reason) => {
      if (!destroyed)
        notice.show(
          reason instanceof Error
            ? reason.message
            : "단계 정보를 불러오지 못했어요.",
        );
    });
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
    select,
    closeDetail,
    checkChanges: live.check,
    destroy() {
      destroyed = true;
      detailView?.destroy();
      bulk.destroy();
      detailRevision++;
      clearInterval(clock);
      live.destroy();
      document.removeEventListener("visibilitychange", visible);
      layout.removeEventListener("change", placeDetail);
      window.removeEventListener("popstate", popstate);
      panel.destroy();
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
