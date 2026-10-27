import type { Activity } from "../domain/activity.ts";

/** 목록 필터·캐시와 독립적으로 프로젝트별 실제 활동만 관리한다. */
export function createActivityController(
  api: { activity: (projects: readonly string[]) => Promise<Activity[]> },
  changed: () => void,
) {
  let entries: Activity[] = [],
    newIds = new Set<string>(),
    error = "",
    loading = false;
  let scope = "",
    revision = 0,
    loaded = false,
    alive = true;
  let pending: Promise<void> | null = null;
  function check(projects: readonly string[]): Promise<void> {
    if (!alive) return Promise.resolve();
    const key = [...new Set(projects)].sort().join(",");
    if (key !== scope) {
      scope = key;
      revision++;
      pending = null;
      entries = [];
      newIds = new Set();
      error = "";
      loaded = false;
    }
    if (!key) {
      loading = false;
      changed();
      return Promise.resolve();
    }
    if (pending) return pending;
    const version = ++revision;
    loading = true;
    error = "";
    pending = Promise.resolve()
      .then(() => api.activity(key.split(",")))
      .then((incoming) => {
        if (!alive || version !== revision) return;
        const previous = new Set(entries.map((item) => item.id));
        entries = [
          ...new Map(
            incoming
              .filter((item) =>
                key.split(",").includes(item.key.split("-")[0] ?? ""),
              )
              .map((item) => [item.id, item]),
          ).values(),
        ]
          .sort((a, b) => Date.parse(b.created) - Date.parse(a.created))
          .slice(0, 10);
        newIds = new Set(
          loaded
            ? entries
                .filter((item) => !previous.has(item.id))
                .map((item) => item.id)
            : [],
        );
        loaded = true;
      })
      .catch((reason: unknown) => {
        if (!alive || version !== revision) return;
        error =
          reason instanceof Error
            ? reason.message
            : "최근 활동을 불러오지 못했어요.";
        if (
          typeof reason === "object" &&
          reason !== null &&
          "status" in reason &&
          [401, 403].includes(Number(reason.status))
        )
          entries = [];
      })
      .finally(() => {
        if (!alive || version !== revision) return;
        pending = null;
        loading = false;
        changed();
      });
    changed();
    return pending;
  }
  return {
    check,
    get entries() {
      return entries;
    },
    get newIds() {
      return newIds;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    destroy() {
      alive = false;
      revision++;
    },
  };
}
