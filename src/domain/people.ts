import type { Filters } from "./filters.ts";
import type { SelectionFilter } from "./issue.ts";
export type PersonBasis = "assigned" | "related";
export type PersonMode = "all" | "me" | "unassigned" | "custom";
export function personFilter(value: Pick<Filters, "scope" | "assignees">): {
  basis: PersonBasis;
  mode: PersonMode;
} {
  return {
    basis: value.scope === "related" ? "related" : "assigned",
    mode:
      value.assignees?.length === 1 && value.assignees[0] === "unassigned"
        ? "unassigned"
        : value.assignees !== null
          ? "custom"
          : value.scope === "all"
            ? "all"
            : "me",
  };
}
export function personSelection(
  basis: PersonBasis,
  mode: PersonMode,
  selected: SelectionFilter,
): Pick<Filters, "scope" | "assignees"> {
  return {
    scope: mode === "all" ? "all" : basis,
    assignees:
      mode === "unassigned"
        ? ["unassigned"]
        : mode === "custom"
          ? (selected ?? []).filter(
              (id) => basis !== "related" || id !== "unassigned",
            )
          : null,
  };
}
