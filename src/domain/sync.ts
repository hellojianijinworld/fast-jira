import type { Issue } from "./issue.ts";
import { record } from "./validation.ts";
import {
  type ChangeBatch,
  decodeChanges,
  wireArray,
  wireString,
} from "./wire.ts";

export interface KnownIssue {
  id: string;
  key: string;
  updated: string;
  parent?: string;
  project?: string;
}
export interface SyncBatch extends ChangeBatch {
  removed: string[];
  checkedAt: string;
}
export function decodeSync(value: unknown): SyncBatch {
  const data = record(value),
    checkedAt = wireString(data.checkedAt);
  if (!Number.isFinite(Date.parse(checkedAt)))
    throw new Error("동기화 시각이 올바르지 않습니다.");
  return {
    ...decodeChanges(value),
    checkedAt,
    removed: wireArray(data.removed, (value) => {
      const key = wireString(value);
      if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key))
        throw new Error("제거 이슈 키가 올바르지 않습니다.");
      return key;
    }),
  };
}
export function knownIssues(issues: Iterable<Issue>): KnownIssue[] {
  return [
    ...new Map(
      [...issues].map((issue) => [
        issue.id,
        {
          id: issue.id,
          key: issue.key,
          updated: issue.updated,
          parent: issue.parent,
          project: issue.project,
        },
      ]),
    ).values(),
  ];
}
