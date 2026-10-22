import type { Filters } from "../domain/filters.ts";
import type { Issue } from "../domain/issue.ts";
import type { KnownIssue } from "../domain/sync.ts";
import type { ChangeBatch } from "../domain/wire.ts";
import type { Api } from "./api.ts";

/** 타이머와 DOM 없이 변경 확인의 중복·필터 세대·저장 경쟁만 조정한다. */
export function createLiveUpdates(config: {
  api: Pick<Api, "changes"> & Partial<Pick<Api, "sync">>;
  checkpoint?: () => string;
  syncKnown?: () => KnownIssue[];
  filters: () => Filters | null;
  known: () => ReadonlyMap<string, Issue>;
  versions: () => ReadonlyMap<string, number>;
  apply: (batch: ChangeBatch) => void | Promise<void>;
  failed: (reason?: unknown) => void;
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
      const checkpoint = config.checkpoint?.();
      const syncing = Boolean(
        checkpoint && config.api.sync && config.syncKnown,
      );
      const batch =
        syncing && config.api.sync && config.syncKnown && checkpoint
          ? await config.api.sync(filters, config.syncKnown(), checkpoint)
          : await config.api.changes(
              filters,
              Math.min(
                7 * 24 * 60,
                Math.max(5, Math.ceil((now() - lastCheck) / 60000) + 2),
              ),
            );
      if (!alive || config.filters() !== filters) return;
      const known = config.known(),
        latest = config.versions();
      const byId = new Map(
        [...known.values()].map((issue) => [issue.id, issue]),
      );
      const changes = batch.issues.filter((issue) => {
        const previousKey = issue.id
          ? (byId.get(issue.id)?.key ?? issue.key)
          : issue.key;
        if ((latest.get(previousKey) ?? 0) !== (versions.get(previousKey) ?? 0))
          return false;
        // 조회 중 저장된 항목은 다음 확인에서 읽는다. 늦은 응답이 저장 결과를 덮어쓰지 않는다.
        if ((latest.get(issue.key) ?? 0) !== (versions.get(issue.key) ?? 0))
          return false;
        const previous = Math.max(
          Date.parse(seen.get(issue.key) ?? "") || 0,
          Date.parse(known.get(issue.key)?.updated ?? "") || 0,
        );
        if (Date.parse(issue.updated) < previous) return false;
        if (Date.parse(issue.updated) === previous) {
          const current = known.get(issue.key);
          if (
            !syncing ||
            (current &&
              Object.entries(issue).every(
                ([field, value]) =>
                  field === "matches" ||
                  JSON.stringify(current[field as keyof Issue]) ===
                    JSON.stringify(value),
              ))
          )
            return false;
        }
        seen.set(issue.key, issue.updated);
        return true;
      });
      lastCheck = now();
      const removed = batch.removed?.filter(
        (key) => (latest.get(key) ?? 0) === (versions.get(key) ?? 0),
      );
      if (changes.length || syncing)
        await config.apply({
          ...batch,
          issues: changes,
          ...(removed ? { removed } : {}),
        });
    } catch (reason) {
      if (alive && config.filters() === filters) config.failed(reason);
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
