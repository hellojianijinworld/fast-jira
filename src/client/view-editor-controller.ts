import {
  normalizeView,
  sameView,
  type ViewDefinition,
} from "../domain/views.ts";

/** 적용 상태와 분리된 초안. 화면은 복사본만 받아 편집한다. */
export function createViewDraft(initial: ViewDefinition) {
  const original = normalizeView(initial);
  let value = normalizeView(original);
  return {
    get value() {
      return normalizeView(value);
    },
    get dirty() {
      return !sameView(original, value);
    },
    change(patch: Partial<ViewDefinition>) {
      value = normalizeView({ ...value, ...patch });
    },
    reset() {
      value = normalizeView(original);
    },
  };
}
export type ViewDraft = ReturnType<typeof createViewDraft>;
