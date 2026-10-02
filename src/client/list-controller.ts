import {
  branchDefaults,
  cloneFilters,
  type Filters,
} from "../domain/filters.ts";
import type {
  BranchDefaults,
  BranchOverrides,
  Issue,
} from "../domain/issue.ts";
import { passesChild, setMembership } from "../domain/list.ts";
import {
  type CollapseState,
  resolveBranchSettings,
  setBranchState,
} from "../domain/tree.ts";
import type { ChangeBatch } from "../domain/wire.ts";
import type { Api } from "./api.ts";

export interface ChildPageState {
  parent: string;
  issues: Map<string, Issue>;
  loaded: boolean;
  loading: boolean;
  nextPageToken: string;
  error: string;
  pending: Promise<void> | null;
}
export interface TreeSettings {
  states: Map<string, CollapseState>;
  version: number;
  branches: Map<string, BranchOverrides>;
}
interface ChildJob {
  key: string;
  page: ChildPageState;
  epoch: number;
  filters: Filters;
  settings: BranchDefaults;
  finish: () => void;
}
const message = (reason: unknown) =>
  reason instanceof Error ? reason.message : "목록을 불러오지 못했어요.";

/** 필터·커서·요청 세대만 조정한다. DOM과 저장소는 호출자가 연결한다. */
export function createListController(
  api: Pick<Api, "issues" | "children">,
  initial: Filters,
  accountId: string,
  onChange: () => void = () => {},
  tree: TreeSettings = { states: new Map(), version: 0, branches: new Map() },
) {
  let filters = cloneFilters(initial),
    epoch = 0,
    loading = false,
    loaded = false,
    error = "",
    nextPageToken = "";
  const items = new Map<string, Issue>(),
    matched = new Set<string>(),
    direct = new Set<string>();
  const pages = new Map<string, ChildPageState>();
  let jobs: ChildJob[] = [],
    active = 0,
    changeVersion = 0;
  const changedAt = new Map<string, number>();
  function effectiveBranch(key: string): BranchDefaults {
    return resolveBranchSettings(
      tree.branches.get(key),
      branchDefaults(filters),
    );
  }
  function childPasses(issue: Issue): boolean {
    return passesChild(
      issue,
      { ...effectiveBranch(issue.parent), projects: filters.projects },
      accountId,
    );
  }
  function childPage(key: string): ChildPageState {
    const id = JSON.stringify([key, effectiveBranch(key)]);
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
    if (!reset && loading) return;
    if (reset) {
      epoch++;
      filters = cloneFilters(reset);
      items.clear();
      matched.clear();
      direct.clear();
      pages.clear();
      for (const job of jobs) job.finish();
      jobs = [];
      loaded = false;
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
      const data = await api.issues(query, nextPageToken);
      // 새 필터의 목록에 이전 페이지를 섞지 않는다. 대기 중인 하위 조회도 같은 세대로 검사한다.
      if (generation !== epoch) return;
      for (const issue of data.ancestors)
        if (!items.has(issue.key) && (changedAt.get(issue.key) ?? 0) <= started)
          items.set(issue.key, issue);
      for (const issue of data.issues) {
        if ((changedAt.get(issue.key) ?? 0) > started) continue;
        items.set(issue.key, issue);
        matched.add(issue.key);
        direct.add(issue.key);
      }
      nextPageToken = data.nextPageToken ?? "";
      loaded = true;
    } catch (reason) {
      if (generation === epoch) error = message(reason);
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
      const data = await api.children(
        key,
        job.filters,
        settings,
        page.nextPageToken,
      );
      if (job.epoch !== epoch || page !== childPage(key)) return;
      for (const issue of data.issues) {
        // 주기 갱신이나 저장 뒤 늦게 도착한 하위 페이지가 이전 값을 되돌리지 않게 한다.
        if ((changedAt.get(issue.key) ?? 0) > started) continue;
        page.issues.set(issue.key, issue);
      }
      page.loaded = true;
      page.nextPageToken = data.nextPageToken ?? "";
      page.error = "";
    } catch (reason) {
      if (job.epoch === epoch && page === childPage(key))
        page.error = message(reason);
    } finally {
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
      if (job.epoch !== epoch || job.page !== childPage(job.key)) {
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
  function queueChildren(key: string): Promise<void> {
    const page = childPage(key);
    if (page.pending) return page.pending;
    if (page.loaded && !page.nextPageToken && !page.error)
      return Promise.resolve();
    page.loading = true;
    let finish: () => void = () => {};
    page.pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const pending = page.pending;
    jobs.push({
      key,
      page,
      epoch,
      settings: effectiveBranch(key),
      filters: cloneFilters(filters),
      finish,
    });
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
  function setBranch(key: string, overrides: BranchOverrides) {
    if (
      Object.values(overrides).every(
        (value) => value === undefined || value === "inherit",
      )
    )
      tree.branches.delete(key);
    else tree.branches.set(key, { ...overrides });
    onChange();
  }
  function apply(issue: Issue, matches: boolean) {
    changedAt.set(issue.key, ++changeVersion);
    for (const page of pages.values())
      if (page.issues.has(issue.key)) {
        if (page.parent === issue.parent) page.issues.set(issue.key, issue);
        else page.issues.delete(issue.key);
      }
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
    setBranch,
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
