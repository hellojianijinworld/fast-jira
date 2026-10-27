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
  needsParticipants?: boolean;
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
          ...(issue.participantFields === undefined
            ? { needsParticipants: true }
            : {}),
        },
      ]),
    ).values(),
  ];
}

/** 목록 밖에 저장된 카드의 예전 캐시도 기존 묶음 검증에 포함한다. */
export function withParticipantHydration(
  known: KnownIssue[],
  saved: Iterable<Issue>,
): KnownIssue[] {
  const merged = new Map(known.map((issue) => [issue.id, issue]));
  for (const issue of knownIssues(saved)) {
    if (merged.size >= 10000) break;
    if (
      issue.needsParticipants &&
      !merged.has(issue.id) &&
      /^\d{1,20}$/.test(issue.id) &&
      Number.isFinite(Date.parse(issue.updated))
    )
      merged.set(issue.id, issue);
  }
  return [...merged.values()];
}
