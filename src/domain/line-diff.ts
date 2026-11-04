import { diffLines } from "diff";

export interface DiffLine {
  number: number;
  text: string;
  changed: boolean;
}
export interface DiffRow {
  before: DiffLine | undefined;
  after: DiffLine | undefined;
}
const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/** 줄을 맞춰 두 표시 방식이 같은 비교 결과를 사용한다. 긴 비교는 원문 보존으로 종료한다. */
export function lineDifference(from: string, to: string): DiffRow[] {
  const changes = diffLines(from, to, { timeout: 100 }) ?? [
    { value: from, removed: true, added: false },
    { value: to, removed: false, added: true },
  ];
  const rows: DiffRow[] = [];
  let before = 1,
    after = 1;
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    if (!change) continue;
    if (!change.added && !change.removed) {
      for (const text of lines(change.value))
        rows.push({
          before: { number: before++, text, changed: false },
          after: { number: after++, text, changed: false },
        });
      continue;
    }
    const removed = change.removed ? lines(change.value) : [];
    let added = change.added ? lines(change.value) : [];
    if (change.removed && changes[i + 1]?.added)
      added = lines(changes[++i]?.value ?? "");
    for (let j = 0; j < Math.max(removed.length, added.length); j++) {
      const oldLine = removed[j],
        newLine = added[j];
      rows.push({
        before:
          oldLine === undefined
            ? undefined
            : { number: before++, text: oldLine, changed: true },
        after:
          newLine === undefined
            ? undefined
            : { number: after++, text: newLine, changed: true },
      });
    }
  }
  return rows;
}
