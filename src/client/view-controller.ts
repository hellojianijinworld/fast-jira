import type { StatusOption } from "../domain/catalog.ts";
import { type ViewInfo, viewPresentation } from "../domain/view-labels.ts";
import {
  applyView,
  deleteView,
  matchingView,
  normalizeView,
  registerSavedView,
  registerView,
  resolveView,
  sameView,
  selectView,
  updateView,
  type ViewBinding,
  type ViewDefinition,
  type ViewState,
  type ViewTarget,
  viewBinding,
} from "../domain/views.ts";
export interface TemporaryView {
  done?: boolean;
  people?: boolean;
}
let sequence = 0;

/** 저장 성공 뒤에만 상태를 바꾸고 UI/조회 조정은 호출자에게 알린다. */
export function createViewController(
  initial: ViewState,
  options: {
    save: (state: ViewState) => void;
    changed: (conditionsChanged: boolean) => void;
    beforeChange?: () => void;
    statuses: () => readonly StatusOption[];
  },
) {
  let state = initial;
  const temporary = new Map<string, TemporaryView>();
  function commit(next: ViewState, target?: ViewTarget) {
    options.beforeChange?.();
    const keys = new Set([
      ...Object.keys(state.branches),
      ...Object.keys(next.branches),
      ...temporary.keys(),
    ]);
    const conditionsChanged =
      !sameView(
        resolveView(state, { kind: "global" }),
        resolveView(next, { kind: "global" }),
      ) ||
      [...keys].some((key) => {
        const location = { kind: "branch", key } as const;
        return !sameView(
          resolve(location),
          resolveWithPeek(
            next,
            location,
            target?.kind === "branch" && target.key === key
              ? undefined
              : temporary.get(key),
          ),
        );
      });
    options.save(next);
    state = next;
    if (target?.kind === "branch") temporary.delete(target.key);
    options.changed(conditionsChanged);
  }
  function id() {
    let candidate = "";
    do {
      candidate = `view-${++sequence}`;
    } while (state.saved.some((view) => view.id === candidate));
    return candidate;
  }
  function resolve(
    target: ViewTarget,
    includeTemporary = true,
  ): ViewDefinition {
    return resolveWithPeek(
      state,
      target,
      target.kind === "branch" && includeTemporary
        ? temporary.get(target.key)
        : undefined,
    );
  }
  function resolveWithPeek(
    current: ViewState,
    target: ViewTarget,
    peek?: TemporaryView,
  ): ViewDefinition {
    const definition = resolveView(current, target);
    if (peek?.people) {
      definition.scope = "all";
      definition.assignees = null;
    }
    if (peek?.done) {
      definition.excludeDone = false;
      if (definition.statuses !== null)
        definition.statuses = [
          ...definition.statuses,
          ...options
            .statuses()
            .filter((status) => status.category === "done")
            .map((status) => status.id),
        ];
    }
    return normalizeView(definition);
  }
  function info(target: ViewTarget): ViewInfo {
    const binding = viewBinding(state, target);
    const peek =
      target.kind === "branch" ? temporary.get(target.key) : undefined;
    const savedName =
      binding.kind === "saved"
        ? state.saved.find((view) => view.id === binding.viewId)?.name
        : undefined;
    const { label, icon } = viewPresentation(target, binding, savedName);
    return {
      kind: binding.kind,
      label,
      icon,
      active: binding.kind !== "default",
      temporary: Boolean(peek?.done || peek?.people),
    };
  }
  function peek(key: string, value: TemporaryView) {
    options.beforeChange?.();
    const target = { kind: "branch", key } as const;
    const before = resolve(target);
    if (value.done || value.people) temporary.set(key, { ...value });
    else temporary.delete(key);
    options.changed(!sameView(before, resolve(target)));
  }
  return {
    get state() {
      return state;
    },
    replace(next: ViewState) {
      options.beforeChange?.();
      temporary.clear();
      state = next;
    },
    resolve,
    info,
    binding: (target: ViewTarget) => viewBinding(state, target),
    match: (definition: ViewDefinition, preferredId?: string) =>
      matchingView(state, definition, preferredId),
    select(target: ViewTarget, binding: ViewBinding) {
      commit(selectView(state, target, binding), target);
    },
    apply(target: ViewTarget, definition: ViewDefinition) {
      commit(applyView(state, target, definition), target);
    },
    register(target: ViewTarget, definition: ViewDefinition, name: string) {
      commit(registerView(state, target, definition, name, id()), target);
    },
    create(definition: ViewDefinition, name: string) {
      const registered = registerSavedView(state, definition, name, id());
      commit(registered.state);
      return registered.viewId;
    },
    update(viewId: string, name: string, definition: ViewDefinition) {
      commit(updateView(state, viewId, name, definition));
    },
    delete(viewId: string) {
      commit(deleteView(state, viewId));
    },
    temporary: (key: string) => ({ ...temporary.get(key) }),
    peek,
    clearPeek: (key: string) => peek(key, {}),
  };
}
export type ViewController = ReturnType<typeof createViewController>;
