import type { TreeCatalog } from "../domain/catalog.ts";
import type { Filters } from "../domain/filters.ts";
import {
  decodeListSnapshot,
  type ListSnapshot,
  listCacheKey,
} from "../domain/list-snapshot.ts";
import { isRecord, record } from "../domain/validation.ts";
import { decodeStatuses, decodeTypes } from "../domain/wire.ts";

export interface CachedList {
  data: ListSnapshot;
  catalog: Pick<TreeCatalog, "statuses" | "types">;
}
export interface ListCache {
  read(scope: string, filters: Filters): Promise<CachedList | null>;
  remove(scope: string, filters: Filters): Promise<void>;
  write(scope: string, filters: Filters, value: CachedList): Promise<void>;
}
const maxAge = 7 * 24 * 60 * 60 * 1000;
function cacheMetadata(value: unknown): CachedList {
  const snapshot = record(value);
  const catalog = record(snapshot.catalog);
  return {
    data: decodeListSnapshot(snapshot.data),
    catalog: {
      statuses: decodeStatuses(catalog.statuses),
      types: decodeTypes(catalog.types),
    },
  };
}
/** 실패하면 일반 조회로 복구한다. 토큰·본문·댓글·오래된 커서는 저장하지 않는다. */
export function createListCache(): ListCache {
  let connection: Promise<IDBDatabase | null> | undefined;
  function database(): Promise<IDBDatabase | null> {
    connection ??= new Promise((resolve) => {
      try {
        const request = indexedDB.open("fast-jira-list-cache", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("lists");
        request.onsuccess = () => resolve(request.result);
        request.onerror = request.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return connection;
  }
  const key = (scope: string, filters: Filters) =>
    JSON.stringify([scope, listCacheKey(filters)]);
  return {
    async read(scope, filters) {
      try {
        const db = await database();
        if (!db) return null;
        return await new Promise<CachedList | null>((resolve, reject) => {
          const transaction = db.transaction("lists", "readwrite");
          const store = transaction.objectStore("lists");
          const request = store.get(key(scope, filters));
          let restored: CachedList | null = null;
          request.onsuccess = () => {
            try {
              const value = record(request.result);
              if (
                value.version !== 1 ||
                value.scope !== scope ||
                typeof value.savedAt !== "number" ||
                !Number.isFinite(value.savedAt) ||
                value.savedAt > Date.now() ||
                Date.now() - value.savedAt > maxAge
              )
                return;
              restored = cacheMetadata(value);
              const clean = {
                ...restored,
                version: 1,
                scope,
                savedAt: value.savedAt,
              };
              if (JSON.stringify(value) !== JSON.stringify(clean))
                store.put(clean, key(scope, filters));
            } catch {
              /* 손상된 캐시는 일반 조회로 복구한다. */
            }
          };
          transaction.oncomplete = () => resolve(restored);
          transaction.onerror = transaction.onabort = () =>
            reject(transaction.error);
        });
      } catch {
        return null;
      }
    },
    async remove(scope, filters) {
      try {
        const db = await database();
        if (!db) return;
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction("lists", "readwrite");
          transaction.objectStore("lists").delete(key(scope, filters));
          transaction.oncomplete = () => resolve();
          transaction.onerror = transaction.onabort = () =>
            reject(transaction.error);
        });
      } catch {
        /* 차단된 저장소는 다음 읽기에서도 복원하지 못한다. */
      }
    },
    async write(scope, filters, snapshot) {
      try {
        // 한 계정의 최근 10개 조회만 보관한다. 저장 공간 부족은 조회 실패로 이어지지 않는다.
        const value = {
          ...cacheMetadata(snapshot),
          version: 1,
          scope,
          savedAt: Date.now(),
        };
        if (JSON.stringify(value).length > 5 * 1024 * 1024) return;
        const db = await database();
        if (!db) return;
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction("lists", "readwrite");
          const store = transaction.objectStore("lists");
          store.put(value, key(scope, filters));
          const request = store.openCursor();
          const retained: { key: IDBValidKey; at: number }[] = [];
          request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) {
              const entry = isRecord(cursor.value) ? cursor.value : {};
              const at = typeof entry.savedAt === "number" ? entry.savedAt : 0;
              if (Date.now() - at > maxAge) cursor.delete();
              else if (entry.scope === scope) {
                try {
                  const clean = {
                    ...cacheMetadata(entry),
                    version: 1,
                    scope,
                    savedAt: at,
                  };
                  if (JSON.stringify(entry) !== JSON.stringify(clean))
                    cursor.update(clean);
                  retained.push({ key: cursor.key, at });
                } catch {
                  cursor.delete();
                }
              }
              cursor.continue();
            } else {
              retained.sort((a, b) => b.at - a.at);
              for (const entry of retained.slice(10)) store.delete(entry.key);
            }
          };
          transaction.oncomplete = () => resolve();
          transaction.onerror = transaction.onabort = () =>
            reject(transaction.error);
        });
      } catch {
        /* 메모리 목록은 그대로 유지한다. */
      }
    },
  };
}
