/** 같은 메타정보의 동시 요청도 한 번만 보낸다. 실패는 다음 요청에서 재시도한다. */
export function createPromiseCache<T>(now: () => number = Date.now) {
  const entries = new Map<string, { pending: Promise<T>; expires: number }>();
  const get = (key: string, load: () => Promise<T>): Promise<T> => {
    const found = entries.get(key);
    if (found && found.expires > now()) return found.pending;
    if (entries.size >= 128) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
    const entry = {
      pending: Promise.resolve().then(load),
      expires: now() + 300000,
    };
    entries.set(key, entry);
    // 만료 뒤 새 요청이 들어왔다면 과거 실패가 새 캐시를 지우지 않도록 확인한다.
    void entry.pending.catch(() => {
      if (entries.get(key) === entry) entries.delete(key);
    });
    return entry.pending;
  };
  return Object.assign(get, {
    prime(key: string, value: T): void {
      entries.delete(key);
      void get(key, () => Promise.resolve(value));
    },
  });
}
