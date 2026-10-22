import type { Issue } from "./issue.ts";

export const sameIssue = (a: Issue, b: Issue) =>
  Boolean(a.id && a.id === b.id) || a.key === b.key;

export function updateFavorites(
  favorites: readonly Issue[],
  incoming: readonly Issue[],
  removed: readonly string[] = [],
): Issue[] {
  return favorites.flatMap((saved) => {
    const replacement = incoming.find((issue) => sameIssue(saved, issue));
    return replacement
      ? [replacement]
      : removed.includes(saved.key)
        ? []
        : [saved];
  });
}
