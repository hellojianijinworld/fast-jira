import type { TreeCatalog } from "../domain/catalog.ts";
import type { IssueType, UserOption } from "../domain/issue.ts";
import type { Api } from "./api.ts";
export interface ViewOptions {
  statuses: TreeCatalog["statuses"];
  users: UserOption[];
  loadUsers?: () => Promise<UserOption[]>;
  types: readonly IssueType[];
}
/** 같은 프로젝트의 편집 선택지는 함께 읽고 재사용한다. 팝오버 선택 자체에는 조회가 없다. */
export function createViewOptions(
  api: Pick<Api, "statuses" | "users" | "types">,
  known: () => { projects: readonly string[]; catalog: TreeCatalog },
  now: () => number = Date.now,
) {
  const createdAt = now();
  let members: { pending: Promise<UserOption[]>; expires: number } | undefined;
  function loadUsers(projects: readonly string[]) {
    if (members && members.expires > now()) return members.pending;
    const pending = api.users(projects).catch((reason) => {
      if (members?.pending === pending) members = undefined;
      throw reason;
    });
    members = { pending, expires: now() + 300000 };
    return pending;
  }
  const cache = new Map<
    string,
    { expires: number; pending: Promise<ViewOptions> }
  >();
  return {
    load(projects: readonly string[], force = false): Promise<ViewOptions> {
      if (!projects.length)
        return Promise.resolve({ statuses: [], users: [], types: [] });
      const key = [...projects].sort().join(",");
      const found = cache.get(key);
      if (!force && found && found.expires > now()) return found.pending;
      const seed = known();
      const reuse =
        !force &&
        !found &&
        now() - createdAt < 300000 &&
        [...seed.projects].sort().join(",") === key &&
        seed.catalog.statuses.length > 0;
      const pending = Promise.all([
        reuse ? Promise.resolve(seed.catalog.statuses) : api.statuses(projects),
        reuse
          ? Promise.resolve(seed.catalog.types)
          : api.types(projects).catch(() => []),
      ])
        .then(([statuses, types]) => ({
          statuses,
          users: [],
          types,
          loadUsers: () => loadUsers(projects),
        }))
        .catch((reason) => {
          if (cache.get(key)?.pending === pending) cache.delete(key);
          throw reason;
        });
      cache.set(key, { expires: now() + 300000, pending });
      return pending;
    },
  };
}
