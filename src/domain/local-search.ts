import type { Issue } from "./issue.ts";

const normalize = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase().trim();
/** 일치도가 먼저이며 같은 일치도 안에서 즐겨찾기·최근 방문·수정 시각을 비교한다. */
export function localSearch(
  issues: readonly Issue[],
  query: string,
  projects: readonly string[],
  favorite: (issue: Issue) => boolean,
  recent: readonly Issue[],
): Issue[] {
  const term = normalize(query);
  if (!term) return [];
  const words = term.split(/\s+/);
  const visits = new Map(recent.map((issue, index) => [issue.key, index]));
  return [...new Map(issues.map((issue) => [issue.key, issue])).values()]
    .filter((issue) => projects.includes(issue.project))
    .map((issue) => {
      const key = normalize(issue.key),
        title = normalize(issue.summary);
      const hits = words.filter((word) =>
        `${key} ${title}`.includes(word),
      ).length;
      const rank =
        key === term
          ? 0
          : title === term
            ? 1
            : hits === words.length
              ? 2
              : hits
                ? 3
                : 4;
      return {
        issue,
        rank,
        favorite: favorite(issue),
        visit: visits.get(issue.key) ?? Infinity,
      };
    })
    .filter((item) => item.rank < 4)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(b.favorite) - Number(a.favorite) ||
        (a.visit === b.visit ? 0 : a.visit - b.visit) ||
        (Date.parse(b.issue.updated) || 0) -
          (Date.parse(a.issue.updated) || 0) ||
        a.issue.key.localeCompare(b.issue.key),
    )
    .slice(0, 8)
    .map((item) => item.issue);
}
