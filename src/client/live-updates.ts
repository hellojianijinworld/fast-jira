import type { Filters } from "../domain/filters.ts";
import type { Issue } from "../domain/issue.ts";
import type { ChangeBatch } from "../domain/wire.ts";
import type { Api } from "./api.ts";

/** 타이머와 DOM 없이 변경 확인의 중복·필터 세대·저장 경쟁만 조정한다. */
export function createLiveUpdates(config: {
  api: Pick<Api, "changes">;
  filters: () => Filters | null;
  known: () => ReadonlyMap<string, Issue>;
  versions: () => ReadonlyMap<string, number>;
  apply: (batch: ChangeBatch) => void | Promise<void>;
  failed: () => void;
  now?: () => number;
}) {
  const now = config.now ?? Date.now;
  const seen = new Map<string, string>();
  let lastCheck = now(),
    scope: Filters | null = null,
    busy = false,
    alive = true;
  async function check() {
    const filters = config.filters();
    if (!alive || busy || !filters || !filters.projects.length) return;
    if (scope !== filters) {
      scope = filters;
      seen.clear();
      lastCheck = now();
    }
    busy = true;
    const versions = new Map(config.versions());
    try {
      const batch = await config.api.changes(
        filters,
        Math.min(60, Math.max(5, Math.ceil((now() - lastCheck) / 60000) + 2)),
      );
      if (!alive || config.filters() !== filters) return;
      const known = config.known(),
        latest = config.versions();
      const changes = batch.issues.filter((issue) => {
        // 조회 중 저장된 항목은 다음 확인에서 읽는다. 늦은 응답이 저장 결과를 덮어쓰지 않는다.
        if ((latest.get(issue.key) ?? 0) !== (versions.get(issue.key) ?? 0))
          return false;
        const previous = Math.max(
          Date.parse(seen.get(issue.key) ?? "") || 0,
          Date.parse(known.get(issue.key)?.updated ?? "") || 0,
        );
        if (Date.parse(issue.updated) <= previous) return false;
        seen.set(issue.key, issue.updated);
        return true;
      });
      lastCheck = now();
      if (changes.length) await config.apply({ ...batch, issues: changes });
    } catch {
      if (alive && config.filters() === filters) config.failed();
    } finally {
      busy = false;
    }
  }
  return {
    check,
    destroy() {
      alive = false;
    },
  };
}
