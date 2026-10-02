import type { EditOptions, UserOption } from "./issue.ts";

export function createDetailState(onReady: () => void = () => {}): {
  hold(): () => void;
  canRefresh(): boolean;
} {
  let holds = 0,
    pending = false;
  return {
    hold() {
      holds++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (--holds === 0 && pending) {
          pending = false;
          onReady();
        }
      };
    },
    canRefresh() {
      if (!holds) return true;
      pending = true;
      return false;
    },
  };
}
export type EditOptionsRequest = (
  path: string,
) => Promise<{ statuses: string[]; users?: UserOption[] }>;
export function createEditOptions(
  request: EditOptionsRequest,
  key: string,
): { get(): Promise<EditOptions>; invalidate(): void } {
  let users: UserOption[] | undefined,
    statuses: string[] | undefined,
    pending: Promise<EditOptions> | undefined;
  let revision = 0;
  return {
    async get() {
      if (statuses) return { users: users ?? [], statuses };
      if (pending) return pending;
      const version = revision;
      const loading = request(
        `${users ? "/api/transitions?key=" : "/api/options?key="}${encodeURIComponent(key)}`,
      ).then((data) => {
        if (data.users) users = data.users;
        // 저장 후 바뀐 상태에 이전 비동기 응답의 선택지를 되돌려 넣지 않는다.
        if (version === revision) statuses = data.statuses;
        return { users: users ?? [], statuses: data.statuses };
      });
      pending = loading;
      try {
        return await loading;
      } finally {
        if (pending === loading) pending = undefined;
      }
    },
    invalidate() {
      revision++;
      statuses = undefined;
      pending = undefined;
    },
  };
}
