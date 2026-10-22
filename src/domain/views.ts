import {
  branchDefaults,
  type Filters,
  MAX_FILTER_SELECTION,
} from "./filters.ts";
import type { BranchOverrides, SelectionFilter } from "./issue.ts";
import { validSort } from "./sort.ts";
import { resolveBranchSettings } from "./tree.ts";
import { isRecord } from "./validation.ts";

export type ViewDefinition = Pick<
  Filters,
  "scope" | "sort" | "statuses" | "assignees" | "excludeDone"
>;
export type ViewBinding =
  | { kind: "default" }
  | { kind: "inline"; definition: ViewDefinition }
  | { kind: "saved"; viewId: string };
export type ViewTarget = { kind: "global" } | { kind: "branch"; key: string };
export interface SavedView {
  id: string;
  name: string;
  definition: ViewDefinition;
}
export interface ViewState {
  version: 1;
  global: Exclude<ViewBinding, { kind: "default" }>;
  saved: readonly SavedView[];
  branches: Readonly<Record<string, ViewBinding>>;
}
const normalizeSelection = (selection: SelectionFilter): SelectionFilter =>
  selection === null ? null : [...new Set(selection)].sort();

/** 선택 항목은 집합, 여러 정렬 기준은 우선순위로 비교한다. */
export function normalizeView(value: ViewDefinition): ViewDefinition {
  if (
    (value.assignees !== null &&
      new Set(value.assignees).size > MAX_FILTER_SELECTION) ||
    (value.statuses !== null &&
      new Set(value.statuses).size > MAX_FILTER_SELECTION) ||
    !validSort(value.sort) ||
    !["all", "assigned", "related"].includes(value.scope)
  )
    throw new Error("뷰 조건이 올바르지 않습니다.");
  return {
    scope:
      value.scope === "all" && value.assignees !== null
        ? "assigned"
        : value.scope,
    sort: value.sort,
    statuses: normalizeSelection(value.statuses),
    assignees: normalizeSelection(value.assignees),
    excludeDone: value.excludeDone,
  };
}
export function sameView(left: ViewDefinition, right: ViewDefinition): boolean {
  return (
    JSON.stringify(normalizeView(left)) === JSON.stringify(normalizeView(right))
  );
}
export function initialViews(definition: ViewDefinition): ViewState {
  return {
    version: 1,
    global: { kind: "inline", definition: normalizeView(definition) },
    saved: [],
    branches: {},
  };
}
export function viewBinding(state: ViewState, target: ViewTarget): ViewBinding {
  return target.kind === "global"
    ? state.global
    : (state.branches[target.key] ?? { kind: "default" });
}
export function resolveBinding(
  state: ViewState,
  binding: ViewBinding,
): ViewDefinition {
  if (binding.kind === "default") return resolveBinding(state, state.global);
  if (binding.kind === "inline") return normalizeView(binding.definition);
  const saved = state.saved.find((view) => view.id === binding.viewId);
  if (!saved) throw new Error("등록된 뷰를 찾을 수 없습니다.");
  return normalizeView(saved.definition);
}
export function resolveView(
  state: ViewState,
  target: ViewTarget,
): ViewDefinition {
  return resolveBinding(state, viewBinding(state, target));
}
export function matchingView(
  state: ViewState,
  definition: ViewDefinition,
  preferredId?: string,
): SavedView | undefined {
  return (
    state.saved.find(
      (view) =>
        view.id === preferredId && sameView(view.definition, definition),
    ) ?? state.saved.find((view) => sameView(view.definition, definition))
  );
}
export function selectView(
  state: ViewState,
  target: ViewTarget,
  binding: ViewBinding,
): ViewState {
  if (target.kind === "global" && binding.kind === "default")
    throw new Error("전체 뷰는 기본 뷰를 참조할 수 없습니다.");
  resolveBinding(state, binding);
  const next =
    binding.kind === "inline"
      ? { ...binding, definition: normalizeView(binding.definition) }
      : { ...binding };
  if (target.kind === "global")
    return { ...state, global: next as ViewState["global"] };
  const branches = { ...state.branches };
  if (next.kind === "default") delete branches[target.key];
  else branches[target.key] = next;
  return { ...state, branches };
}
export function applyView(
  state: ViewState,
  target: ViewTarget,
  definition: ViewDefinition,
): ViewState {
  const current = viewBinding(state, target);
  const match = matchingView(
    state,
    definition,
    current.kind === "saved" ? current.viewId : undefined,
  );
  return selectView(
    state,
    target,
    match
      ? { kind: "saved", viewId: match.id }
      : { kind: "inline", definition },
  );
}
function viewName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80)
    throw new Error("뷰 이름을 1~80자로 입력하세요.");
  return trimmed;
}
export function registerSavedView(
  state: ViewState,
  definition: ViewDefinition,
  name: string,
  id: string,
  preferredId?: string,
): { state: ViewState; viewId: string } {
  const match = matchingView(state, definition, preferredId);
  if (match) return { state, viewId: match.id };
  if (state.saved.some((view) => view.id === id))
    throw new Error("뷰 ID가 중복되었습니다.");
  const saved = {
    id,
    name: viewName(name),
    definition: normalizeView(definition),
  };
  return { state: { ...state, saved: [...state.saved, saved] }, viewId: id };
}
export function registerView(
  state: ViewState,
  target: ViewTarget,
  definition: ViewDefinition,
  name: string,
  id: string,
): ViewState {
  const current = viewBinding(state, target);
  const registered = registerSavedView(
    state,
    definition,
    name,
    id,
    current.kind === "saved" ? current.viewId : undefined,
  );
  return selectView(registered.state, target, {
    kind: "saved",
    viewId: registered.viewId,
  });
}
export function updateView(
  state: ViewState,
  id: string,
  name: string,
  definition: ViewDefinition,
): ViewState {
  if (!state.saved.some((view) => view.id === id))
    throw new Error("등록된 뷰를 찾을 수 없습니다.");
  const next = {
    id,
    name: viewName(name),
    definition: normalizeView(definition),
  };
  return {
    ...state,
    saved: state.saved.map((view) => (view.id === id ? next : view)),
  };
}
export function deleteView(state: ViewState, id: string): ViewState {
  const saved = state.saved.find((view) => view.id === id);
  if (!saved) throw new Error("등록된 뷰를 찾을 수 없습니다.");
  const preserve = (binding: ViewBinding): ViewBinding =>
    binding.kind === "saved" && binding.viewId === id
      ? { kind: "inline", definition: normalizeView(saved.definition) }
      : binding;
  return {
    ...state,
    global: preserve(state.global) as ViewState["global"],
    saved: state.saved.filter((view) => view.id !== id),
    branches: Object.fromEntries(
      Object.entries(state.branches).map(([key, binding]) => [
        key,
        preserve(binding),
      ]),
    ),
  };
}
export function migrateViews(
  filters: Filters,
  legacy: ReadonlyMap<string, BranchOverrides>,
): ViewState {
  let state = initialViews(filters);
  for (const [key, setting] of legacy) {
    if (
      !Object.values(setting).some(
        (value) => value !== undefined && value !== "inherit",
      )
    )
      continue;
    const effective = resolveBranchSettings(setting, branchDefaults(filters));
    const scope =
      setting.people === "all"
        ? "all"
        : setting.people === "mine"
          ? "related"
          : filters.scope;
    state = selectView(
      state,
      { kind: "branch", key },
      {
        kind: "inline",
        definition: {
          scope,
          sort: effective.sort,
          statuses: effective.statuses,
          assignees: effective.assignees,
          excludeDone: effective.excludeDone,
        },
      },
    );
  }
  return state;
}

function decodeDefinition(value: unknown): ViewDefinition {
  if (
    !isRecord(value) ||
    typeof value.excludeDone !== "boolean" ||
    typeof value.sort !== "string" ||
    !["all", "assigned", "related"].includes(String(value.scope))
  )
    throw new Error("뷰 조건이 올바르지 않습니다.");
  function selection(
    value: unknown,
    valid: (id: string) => boolean,
  ): SelectionFilter {
    if (value === null) return null;
    if (
      !Array.isArray(value) ||
      value.length > MAX_FILTER_SELECTION ||
      !value.every((id) => typeof id === "string" && valid(id))
    )
      throw new Error("선택 조건이 올바르지 않습니다.");
    return value;
  }
  return normalizeView({
    scope: value.scope as ViewDefinition["scope"],
    sort: value.sort,
    excludeDone: value.excludeDone,
    statuses: selection(value.statuses, (id) => /^\d{1,20}$/.test(id)),
    assignees: selection(
      value.assignees,
      (id) => id === "unassigned" || /^[A-Za-z0-9:-]{5,128}$/.test(id),
    ),
  });
}
export function decodeViews(value: unknown): ViewState | null {
  try {
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      !Array.isArray(value.saved) ||
      !isRecord(value.branches)
    )
      return null;
    const saved: SavedView[] = value.saved.map((entry: unknown) => {
      if (
        !isRecord(entry) ||
        typeof entry.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(entry.id) ||
        typeof entry.name !== "string"
      )
        throw new Error("등록된 뷰가 올바르지 않습니다.");
      return {
        id: entry.id,
        name: viewName(entry.name),
        definition: decodeDefinition(entry.definition),
      };
    });
    if (new Set(saved.map((view) => view.id)).size !== saved.length)
      return null;
    function binding(value: unknown): ViewBinding {
      if (!isRecord(value)) throw new Error("뷰 연결이 올바르지 않습니다.");
      if (value.kind === "default") return { kind: "default" };
      if (value.kind === "inline")
        return {
          kind: "inline",
          definition: decodeDefinition(value.definition),
        };
      if (
        value.kind === "saved" &&
        typeof value.viewId === "string" &&
        saved.some((view) => view.id === value.viewId)
      )
        return { kind: "saved", viewId: value.viewId };
      throw new Error("뷰 연결이 올바르지 않습니다.");
    }
    const global = binding(value.global);
    if (global.kind === "default") return null;
    const branches: Record<string, ViewBinding> = {};
    for (const [key, entry] of Object.entries(value.branches)) {
      if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) return null;
      branches[key] = binding(entry);
    }
    return { version: 1, global, saved, branches };
  } catch {
    return null;
  }
}
