import {
  branchDefaults,
  cloneFilters,
  type Filters,
} from "../domain/filters.ts";
import type { BranchDefaults, Issue } from "../domain/issue.ts";
import { passesChild, setMembership } from "../domain/list.ts";
import type { ListSnapshot } from "../domain/list-snapshot.ts";
import { type CollapseState, setBranchState } from "../domain/tree.ts";
import type { ChangeBatch } from "../domain/wire.ts";
import type { Api } from "./api.ts";
import { ApiError } from "./api.ts";

export interface ChildPageState {
  parent: string;
  issues: Map<string, Issue>;
  loaded: boolean;
  loading: boolean;
  nextPageToken: string;
  error: string;
  pending: Promise<void> | null;
  restored?: { count: number; complete: boolean } | undefined;
}
export interface TreeSettings {
  states: Map<string, CollapseState>;
  version: number;
}
interface ChildJob {
  key: string;
  page: ChildPageState;
  epoch: number;
  filters: Filters;
  settings: BranchDefaults;
  finish: () => void;
  interested: Set<() => boolean>;
}
const message = (reason: unknown) =>
  reason instanceof Error ? reason.message : "목록을 불러오지 못했어요.";

/** 필터·커서·요청 세대만 조정한다. DOM과 저장소는 호출자가 연결한다. */
export function createListController(
  api: Pick<Api, "issues" | "children">,
  initial: Filters,
  accountId: string,
  onChange: () => void = () => {},
  tree: TreeSettings = { states: new Map(), version: 0 },
  resolveSettings?: (key: string, filters: Filters) => BranchDefaults,
) {
  let filters = cloneFilters(initial),
    epoch = 0,
    loading = false,
    loaded = false,
    error = "",
    nextPageToken = "",
    cacheDenied = false,
    alive = true;
  let restoredRoot: { count: number; complete: boolean } | null = null;
  const items = new Map<string, Issue>(),
    matched = new Set<string>(),
    direct = new Set<string>();
  const pages = new Map<string, ChildPageState>();
  const requests = new Map<ChildPageState, ChildJob>();
  const needed = (job: ChildJob) =>
    [...job.interested].some((interested) => interested());
  let jobs: ChildJob[] = [],
    active = 0,
    changeVersion = 0;
  const changedAt = new Map<string, number>(),
    readValues = new Map<string, Issue>();
  function rememberRead(issue: Issue): Issue {
    const current = readValues.get(issue.key);
    if (current && Date.parse(current.updated) > Date.parse(issue.updated))
      return current;
    readValues.set(issue.key, issue);
    return issue;
  }
  function readIssue(issue: Issue, started: number): Issue | null {
    return (changedAt.get(issue.key) ?? 0) > started
      ? null
      : rememberRead(issue);
  }
  function denyCache() {
    cacheDenied = true;
    items.clear();
    pages.clear();
    direct.clear();
    matched.clear();
    readValues.clear();
    restoredRoot = null;
  }
  function syncPages(issue: Issue) {
    for (const page of pages.values())
      if (page.issues.has(issue.key)) {
        if (page.parent === issue.parent) page.issues.set(issue.key, issue);
        else page.issues.delete(issue.key);
      }
  }
  function pageSize(
    cached: { count: number; complete: boolean } | null | undefined,
    received: number,
    fallback: number,
  ) {
    if (!cached) return fallback;
    return cached.complete
      ? 100
      : Math.min(
          100,
          Math.max(1, cached.count ? cached.count - received : fallback),
        );
  }
  function effectiveBranch(key: string): BranchDefaults {
    return resolveSettings?.(key, filters) ?? branchDefaults(filters);
  }
  function childPasses(issue: Issue): boolean {
    return passesChild(
      issue,
      { ...effectiveBranch(issue.parent), projects: filters.projects },
      accountId,
    );
  }
  function childPage(key: string): ChildPageState {
    const id = JSON.stringify([
      key,
      [...filters.projects].sort(),
      effectiveBranch(key),
    ]);
    let page = pages.get(id);
    if (!page) {
      page = {
        parent: key,
        issues: new Map(),
        loaded: false,
        loading: false,
        nextPageToken: "",
        error: "",
        pending: null,
      };
      pages.set(id, page);
    }
    return page;
  }
  async function load(reset?: Filters): Promise<void> {
    if (!alive || (!reset && loading)) return;
    if (reset) {
      epoch++;
      const sameProjects =
        [...filters.projects].sort().join(",") ===
        [...reset.projects].sort().join(",");
      filters = cloneFilters(reset);
      items.clear();
      matched.clear();
      direct.clear();
      // 표시 범위는 유지하되 다시 펼칠 때 새 커서로 검증한다.
      for (const [id, page] of pages) {
        if (!sameProjects || !page.loaded || page.pending) pages.delete(id);
        else
          page.restored ??= {
            count: page.issues.size,
            complete: !page.nextPageToken,
          };
      }
      for (const job of jobs) {
        requests.delete(job.page);
        job.finish();
      }
      jobs = [];
      loaded = false;
      cacheDenied = false;
      restoredRoot = null;
      nextPageToken = "";
    }
    const generation = epoch,
      query = cloneFilters(filters),
      started = changeVersion;
    loading = true;
    error = "";
    onChange();
    try {
      if (!filters.projects.length) {
        loaded = true;
        return;
      }
      const cached = restoredRoot;
      let token = cached ? "" : nextPageToken;
      const fresh = new Map<string, Issue>(),
        ancestors = new Map<string, Issue>(),
        seenTokens = new Set<string>();
      do {
        if (seenTokens.has(token))
          throw new Error("페이지 커서가 반복되어 검증을 멈췄어요.");
        seenTokens.add(token);
        const data = await api.issues(
          query,
          token,
          pageSize(cached, fresh.size, 30),
        );
        if (generation !== epoch) return;
        for (const issue of data.issues) fresh.set(issue.key, issue);
        for (const issue of data.ancestors) ancestors.set(issue.key, issue);
        token = data.nextPageToken ?? "";
      } while (
        cached &&
        token &&
        (cached.complete || fresh.size < cached.count)
      );
      const data = {
        issues: [...fresh.values()],
        ancestors: [...ancestors.values()],
        nextPageToken: token,
      };
      if (cached) {
        for (const key of items.keys())
          if ((changedAt.get(key) ?? 0) <= started) {
            items.delete(key);
            matched.delete(key);
            direct.delete(key);
          }
        restoredRoot = null;
      }
      // 새 필터의 목록에 이전 페이지를 섞지 않는다. 대기 중인 하위 조회도 같은 세대로 검사한다.
      if (generation !== epoch) return;
      for (const value of data.ancestors) {
        if (items.has(value.key)) continue;
        const issue = readIssue(value, started);
        if (issue) {
          syncPages(issue);
          items.set(issue.key, issue);
        }
      }
      for (const value of data.issues) {
        const issue = readIssue(value, started);
        if (!issue) continue;
        syncPages(issue);
        items.set(issue.key, issue);
        matched.add(issue.key);
        direct.add(issue.key);
      }
      nextPageToken = data.nextPageToken ?? "";
      loaded = true;
      cacheDenied = false;
    } catch (reason) {
      if (generation === epoch) {
        error = message(reason);
        if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
          denyCache();
        }
      }
    } finally {
      if (generation === epoch) {
        loading = false;
        onChange();
      }
    }
  }
  async function runChild(job: ChildJob): Promise<void> {
    const { key, page, settings } = job;
    const started = changeVersion;
    try {
      const cached = page.restored;
      let token = cached ? "" : page.nextPageToken;
      const fresh = new Map<string, Issue>(),
        seenTokens = new Set<string>();
      do {
        if (!needed(job)) return;
        if (seenTokens.has(token))
          throw new Error("페이지 커서가 반복되어 검증을 멈췄어요.");
        seenTokens.add(token);
        const data = await api.children(
          key,
          job.filters,
          settings,
          token,
          pageSize(cached, fresh.size, 25),
        );
        if (job.epoch !== epoch || page !== childPage(key) || !needed(job))
          return;
        for (const issue of data.issues) fresh.set(issue.key, issue);
        token = data.nextPageToken ?? "";
      } while (
        cached &&
        token &&
        (cached.complete || fresh.size < cached.count)
      );
      const data = { issues: [...fresh.values()], nextPageToken: token };
      if (cached) {
        for (const old of page.issues.keys())
          if ((changedAt.get(old) ?? 0) <= started) page.issues.delete(old);
        page.restored = undefined;
      }
      if (job.epoch !== epoch || page !== childPage(key)) return;
      for (const value of data.issues) {
        // 같은 이슈의 최신 표현을 유지해 늦은 페이지가 상태나 부모를 되돌리지 않게 한다.
        const issue = readIssue(value, started) ?? readValues.get(value.key);
        if (!issue) continue;
        syncPages(issue);
        if (items.has(issue.key)) items.set(issue.key, issue);
        if (issue.parent === key) page.issues.set(issue.key, issue);
      }
      page.loaded = true;
      page.nextPageToken = data.nextPageToken ?? "";
      page.error = "";
    } catch (reason) {
      if (job.epoch === epoch && page === childPage(key)) {
        page.error = message(reason);
        if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
          error = message(reason);
          denyCache();
        }
      }
    } finally {
      requests.delete(page);
      page.loading = false;
      page.pending = null;
      job.finish();
      if (job.epoch === epoch) onChange();
    }
  }
  function drain() {
    while (active < 3 && jobs.length) {
      const job = jobs.shift();
      if (!job) break;
      if (
        job.epoch !== epoch ||
        job.page !== childPage(job.key) ||
        !needed(job)
      ) {
        requests.delete(job.page);
        job.page.loading = false;
        job.page.pending = null;
        job.finish();
        continue;
      }
      active++;
      void runChild(job).finally(() => {
        active--;
        drain();
      });
    }
  }
  function queueChildren(
    key: string,
    interested: () => boolean = () => true,
  ): Promise<void> {
    if (!alive) return Promise.resolve();
    const page = childPage(key);
    if (page.pending) {
      requests.get(page)?.interested.add(interested);
      return page.pending;
    }
    if (!interested()) return Promise.resolve();
    if (page.loaded && !page.restored && !page.nextPageToken && !page.error)
      return Promise.resolve();
    page.loading = true;
    let finish: () => void = () => {};
    page.pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const pending = page.pending;
    const job: ChildJob = {
      key,
      page,
      epoch,
      settings: effectiveBranch(key),
      filters: cloneFilters(filters),
      finish,
      interested: new Set([interested]),
    };
    requests.set(page, job);
    jobs.push(job);
    onChange();
    drain();
    return pending;
  }
  function visibleItems(): Map<string, Issue> {
    const visible = new Map(items);
    // 부모가 알려진 뒤 현재 상속·개별 설정의 하위 페이지만 연결한다. 이전 필터의 캐시는 섞지 않는다.
    for (const issue of visible.values())
      for (const child of childPage(issue.key).issues.values())
        if (child.parent === issue.key) visible.set(child.key, child);
    return visible;
  }
  function toggle(key: string, collapsed: boolean) {
    setBranchState(tree.states, key, collapsed, ++tree.version);
    onChange();
  }
  function apply(issue: Issue, matches: boolean) {
    changedAt.set(issue.key, ++changeVersion);
    readValues.set(issue.key, issue);
    syncPages(issue);
    setMembership(
      issue,
      matches,
      { items, direct, matched, pages },
      childPasses,
    );
  }
  function update(issue: Issue, matches: boolean) {
    apply(issue, matches);
    onChange();
  }
  function applyChanges(batch: ChangeBatch) {
    for (const issue of batch.ancestors)
      if (!items.has(issue.key)) items.set(issue.key, issue);
    for (const issue of batch.issues) apply(issue, issue.matches);
    onChange();
  }
  return {
    destroy() {
      if (!alive) return;
      alive = false;
      epoch++;
      loading = false;
      for (const job of requests.values()) {
        job.page.loading = false;
        job.page.pending = null;
        job.finish();
      }
      requests.clear();
      jobs = [];
    },
    items,
    matched,
    direct,
    pages,
    tree,
    load,
    childPage,
    queueChildren,
    effectiveBranch,
    childPasses,
    visibleItems,
    toggle,
    update,
    updateMany(
      issues: Issue[],
      matches: ReadonlySet<string>,
      ancestors: Issue[] = [],
    ) {
      for (const issue of ancestors)
        if (!items.has(issue.key)) items.set(issue.key, issue);
      for (const issue of issues) apply(issue, matches.has(issue.key));
      onChange();
    },
    applyChanges,
    restore(snapshot: ListSnapshot) {
      if (loading || loaded) return;
      for (const issue of snapshot.items) {
        readValues.set(issue.key, issue);
        items.set(issue.key, issue);
      }
      for (const key of snapshot.matched) if (items.has(key)) matched.add(key);
      for (const key of snapshot.direct) if (items.has(key)) direct.add(key);
      restoredRoot = { count: direct.size, complete: snapshot.complete };
      for (const [id, page] of snapshot.pages) {
        pages.set(id, {
          parent: page.parent,
          issues: new Map(
            page.issues.map((issue) => {
              const latest = rememberRead(issue);
              return [latest.key, latest];
            }),
          ),
          loaded: true,
          loading: false,
          nextPageToken: "",
          error: "",
          pending: null,
          restored: { count: page.issues.length, complete: page.complete },
        });
      }
      for (const key of items.keys()) {
        const latest = readValues.get(key);
        if (latest) {
          items.set(key, latest);
          syncPages(latest);
        }
      }
    },
    snapshot(): ListSnapshot {
      return {
        items: [...items.values()],
        matched: [...matched],
        direct: [...direct],
        complete: restoredRoot?.complete ?? (loaded && !nextPageToken),
        pages: [...pages]
          .filter(([, page]) => page.loaded)
          .slice(-100)
          .map(([id, page]) => [
            id,
            {
              parent: page.parent,
              issues: [...page.issues.values()],
              complete: page.restored?.complete ?? !page.nextPageToken,
            },
          ]),
      };
    },
    get cacheDenied() {
      return cacheDenied;
    },
    get filters() {
      return filters;
    },
    get loading() {
      return loading;
    },
    get loaded() {
      return loaded;
    },
    get error() {
      return error;
    },
    get nextPageToken() {
      return nextPageToken;
    },
  };
}
export type ListController = ReturnType<typeof createListController>;
