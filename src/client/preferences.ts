import { type Filters, MAX_FILTER_SELECTION } from "../domain/filters.ts";
import type {
  BranchOverrides,
  Issue,
  SelectionFilter,
} from "../domain/issue.ts";
import {
  decodeViewportAnchors,
  type ViewportAnchor,
} from "../domain/list-snapshot.ts";
import { validSort } from "../domain/sort.ts";
import type { CollapseState } from "../domain/tree.ts";
import { isRecord } from "../domain/validation.ts";
import { decodeViews, migrateViews, type ViewState } from "../domain/views.ts";
import { decodeIssue, emptyIssue } from "../domain/wire.ts";

export type LocalStore = Pick<Storage, "getItem" | "setItem">;
export interface Preferences {
  theme: "light" | "dark";
  developerMode: boolean;
  compactView: boolean;
  compactDone: boolean;
  compactDoneParents: boolean;
}
export function readPreferences(storage: LocalStore): Preferences {
  try {
    return {
      theme: storage.getItem("fastJira:theme") === "dark" ? "dark" : "light",
      developerMode: storage.getItem("fastJira:developerMode") === "true",
      compactView: storage.getItem("fastJira:compactView") === "true",
      compactDone: storage.getItem("fastJira:compactDone") !== "false",
      compactDoneParents:
        storage.getItem("fastJira:compactDoneParents") !== "false",
    };
  } catch {
    return {
      theme: "light",
      developerMode: false,
      compactView: false,
      compactDone: true,
      compactDoneParents: true,
    };
  }
}
export function writePreferences(
  storage: LocalStore,
  preferences: Preferences,
): void {
  try {
    storage.setItem("fastJira:theme", preferences.theme);
    storage.setItem(
      "fastJira:developerMode",
      String(preferences.developerMode),
    );
    storage.setItem("fastJira:compactView", String(preferences.compactView));
    storage.setItem("fastJira:compactDone", String(preferences.compactDone));
    storage.setItem(
      "fastJira:compactDoneParents",
      String(preferences.compactDoneParents),
    );
  } catch {
    /* 저장을 거부해도 현재 화면 설정은 적용한다. */
  }
}
export function accountSettingsScope(
  storage: LocalStore,
  site: string,
  accountId: string,
): string {
  const scope = `${site}:${accountId}`;
  try {
    const ownerKey = `fastJira:legacyOwner:${site}`;
    const owner = storage.getItem(ownerKey);
    if (!owner) storage.setItem(ownerKey, accountId);
    // 사이트 단위의 이전 설정은 처음 사용한 계정에만 이식한다. 다른 계정의 담당자 조건을 가져오지 않는다.
    if (!owner || owner === accountId)
      for (const kind of ["filters", "tree", "branches", "recent"]) {
        const previous = storage.getItem(`fastJira:${kind}:${site}`),
          key = `fastJira:${kind}:${scope}`;
        if (previous !== null && storage.getItem(key) === null)
          storage.setItem(key, previous);
      }
  } catch {
    /* 저장소를 사용할 수 없어도 계정별 키는 분리한다. */
  }
  return scope;
}
const statusId = (id: string) => /^\d{1,20}$/.test(id);
const assigneeId = (id: string) =>
  id === "unassigned" || /^[A-Za-z0-9:-]{5,128}$/.test(id);
function selection(
  value: unknown,
  valid: (id: string) => boolean,
): SelectionFilter {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (id): id is string => typeof id === "string" && valid(id),
          ),
        ),
      ].slice(0, MAX_FILTER_SELECTION)
    : null;
}
const issueKey = (key: unknown): key is string =>
  typeof key === "string" && /^[A-Z][A-Z0-9_]*-\d+$/.test(key);
const finiteVersion = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
function tuples(value: unknown): [string, Record<string, unknown>][] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) =>
    Array.isArray(entry) && issueKey(entry[0]) && isRecord(entry[1])
      ? [[entry[0], entry[1]]]
      : [],
  );
}
export function createAccountStore(
  storage: LocalStore,
  site: string,
  accountId: string,
) {
  const scope = accountSettingsScope(storage, site, accountId);
  function read(kind: string): unknown {
    try {
      const text = storage.getItem(`fastJira:${kind}:${scope}`);
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }
  function write(kind: string, value: unknown) {
    try {
      storage.setItem(`fastJira:${kind}:${scope}`, JSON.stringify(value));
    } catch {
      /* 현재 화면은 저장 실패와 무관하게 유지한다. */
    }
  }
  function filters(projects: readonly string[]): {
    filters: Filters;
    configured: boolean;
  } {
    const value = read("filters"),
      saved = isRecord(value) ? value : {};
    const previous =
      saved.selectedProjects ?? saved.configuredProjects ?? saved.projects;
    const selected = Array.isArray(previous)
      ? previous.filter(
          (key): key is string =>
            typeof key === "string" && projects.includes(key),
        )
      : [...projects];
    return {
      configured:
        saved.configured === true ||
        (isRecord(saved.me) && typeof saved.me.accountId === "string"),
      filters: {
        projects: selected.length ? selected : [...projects],
        scope:
          saved.scope === "all" || saved.scope === "assigned"
            ? saved.scope
            : "related",
        excludeDone: saved.excludeDone === true,
        sort: validSort(saved.sort) ? saved.sort : "recent",
        statuses: selection(saved.statuses, statusId),
        assignees: selection(saved.assignees, assigneeId),
        q: "",
      },
    };
  }
  function tree(): { version: number; states: Map<string, CollapseState> } {
    const value = read("tree"),
      saved = isRecord(value) ? value : {};
    const states = new Map<string, CollapseState>();
    let version = finiteVersion(saved.version);
    for (const [key, state] of tuples(saved.states)) {
      const openedAt = finiteVersion(state.openedAt),
        resetAt = finiteVersion(state.resetAt);
      version = Math.max(version, openedAt, resetAt);
      states.set(key, {
        collapsed: state.collapsed === true,
        openedAt,
        resetAt,
      });
    }
    return { version, states };
  }
  function branches(): Map<string, BranchOverrides> {
    return new Map(
      tuples(read("branches")).map(([key, value]) => [
        key,
        {
          sort: validSort(value.sort) ? value.sort : "inherit",
          people:
            value.people === "all" || value.people === "mine"
              ? value.people
              : "inherit",
          done:
            value.done === "exclude" || value.done === "include"
              ? value.done
              : "inherit",
          statuses:
            value.statuses === null || Array.isArray(value.statuses)
              ? selection(value.statuses, statusId)
              : "inherit",
          assignees:
            value.assignees === null || Array.isArray(value.assignees)
              ? selection(value.assignees, assigneeId)
              : "inherit",
        },
      ]),
    );
  }
  function recent(): Issue[] {
    const value = read("recent");
    if (!Array.isArray(value)) return [];
    const found: Issue[] = [];
    for (const item of value) {
      if (
        !isRecord(item) ||
        !issueKey(item.key) ||
        typeof item.summary !== "string" ||
        found.some((issue) => issue.key === item.key)
      )
        continue;
      try {
        found.push(
          decodeIssue({ ...emptyIssue(item.key, item.summary), ...item }),
        );
      } catch {
        /* 손상된 항목만 제외하고 나머지 이력은 사용한다. */
      }
      if (found.length === 5) break;
    }
    return found;
  }
  return {
    scope,
    position: (query: string): ViewportAnchor[] => {
      const value = read("position");
      return isRecord(value) && value.query === query
        ? decodeViewportAnchors(value.anchors)
        : [];
    },
    savePosition: (query: string, anchors: readonly ViewportAnchor[]) =>
      write("position", { query, anchors }),
    views: (filters: Filters) =>
      decodeViews(read("views")) ?? migrateViews(filters, branches()),
    saveViews: (state: ViewState) =>
      storage.setItem(`fastJira:views:${scope}`, JSON.stringify(state)),
    filters,
    tree,
    recent,
    saveFilters: (filters: Filters, configured: boolean) =>
      write("filters", {
        ...filters,
        selectedProjects: filters.projects,
        configured,
      }),
    saveTree: (states: ReadonlyMap<string, CollapseState>, version: number) =>
      write("tree", { states: [...states], version }),
    saveRecent: (issues: readonly Issue[]) =>
      write("recent", issues.slice(0, 5)),
  };
}
