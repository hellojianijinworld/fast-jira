import {
  type AssistantStatus,
  assistantFeatures,
} from "../domain/assistant.ts";

export interface AssistantConnectionSnapshot {
  status?: AssistantStatus;
  checked: boolean;
  checking: boolean;
  chat: boolean;
  voice: boolean;
  error: string;
}
/** AI 상태 확인은 UI 사이에서 공유하고 일시 장애로 기존 기능을 숨기지 않는다. */
export function createAssistantConnection(
  load: () => Promise<AssistantStatus>,
  now = Date.now,
) {
  let snapshot: AssistantConnectionSnapshot = {
    checked: false,
    checking: false,
    chat: false,
    voice: false,
    error: "",
  };
  let pending: Promise<AssistantStatus> | undefined;
  let checkedAt = -Infinity;
  let alive = true;
  const listeners = new Set<(value: AssistantConnectionSnapshot) => void>();
  const notify = () => {
    if (alive) for (const listener of listeners) listener(snapshot);
  };
  function refresh(force = false): Promise<AssistantStatus> {
    if (pending) return pending;
    if (snapshot.status && (!alive || (!force && now() - checkedAt < 60000)))
      return Promise.resolve(snapshot.status);
    snapshot = { ...snapshot, checking: true };
    notify();
    pending = Promise.resolve()
      .then(load)
      .catch(() => ({
        ready: false,
        models: [],
        availability: "unknown" as const,
        error: "AI 연결을 확인하지 못했어요. 다시 시도해 주세요.",
      }))
      .then((status) => {
        if (alive) {
          snapshot = {
            ...assistantFeatures(status, snapshot),
            checked: true,
            checking: false,
            status,
            error: status.ready ? "" : "AI 연결을 확인해 주세요.",
          };
          checkedAt = now();
        }
        return status;
      })
      .finally(() => {
        pending = undefined;
        notify();
      });
    return pending;
  }
  return {
    get snapshot() {
      return snapshot;
    },
    refresh,
    subscribe(listener: (value: AssistantConnectionSnapshot) => void) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    destroy() {
      alive = false;
      listeners.clear();
    },
  };
}
