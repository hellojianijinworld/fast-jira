export interface TreeViewportRow {
  key: string;
  parent: string;
  top: number;
  bottom: number;
}

/** 화면 위로 지나간 행 중, 현재 읽는 분기의 가장 가까운 부모와 조상만 고른다. */
export function activeTreePath(
  rows: readonly TreeViewportRow[],
  edge: number,
): string[] {
  const candidates = rows.filter((row) => row.top < edge && row.bottom > edge);
  const nearest = candidates.reduce<TreeViewportRow | undefined>(
    (chosen, row) => (!chosen || row.top > chosen.top ? row : chosen),
    undefined,
  );
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const path: string[] = [],
    visited = new Set<string>();
  let current = nearest;
  while (current && !visited.has(current.key)) {
    visited.add(current.key);
    path.unshift(current.key);
    current = byKey.get(current.parent);
  }
  return path;
}
