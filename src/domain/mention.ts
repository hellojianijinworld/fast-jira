export interface MentionTarget {
  kind: "issue" | "user";
  id: string;
  label: string;
  key?: string;
  url?: string;
  avatar?: string;
}
export interface TextMention {
  start: number;
  end: number;
  target: MentionTarget;
}
export function mentionLabel(target: MentionTarget) {
  if (target.kind === "user") return `@${target.label}`;
  const title = Array.from(target.label.replace(/\s+/g, " ").trim());
  const preview = title.slice(0, 18).join("") + (title.length > 18 ? "…" : "");
  return `@${target.key}${preview ? ` · ${preview}` : ""}`;
}
/** 직접 편집한 멘션은 해제하고, 앞쪽 텍스트만 바뀌면 위치를 이동한다. */
export function moveMentions(
  before: string,
  after: string,
  mentions: readonly TextMention[],
): TextMention[] {
  if (before === after) return [...mentions];
  let start = 0,
    suffix = 0;
  while (
    start < Math.min(before.length, after.length) &&
    before[start] === after[start]
  )
    start++;
  while (
    suffix < Math.min(before.length, after.length) - start &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  )
    suffix++;
  const end = before.length - suffix,
    shift = after.length - before.length;
  return mentions.flatMap((mention) => {
    if (mention.end <= start) return [mention];
    if (mention.start >= end)
      return [
        { ...mention, start: mention.start + shift, end: mention.end + shift },
      ];
    return [];
  });
}
/** 표시는 이름만 유지하고 AI에 보낼 때 선택한 참조 ID를 데이터로 덧붙인다. */
export function mentionPrompt(
  text: string,
  mentions: readonly TextMention[] = [],
) {
  const targets = new Map<string, MentionTarget>();
  for (const mention of mentions)
    if (text.slice(mention.start, mention.end) === mentionLabel(mention.target))
      targets.set(
        `${mention.target.kind}:${mention.target.id}`,
        mention.target,
      );
  return targets.size
    ? `${text}\n\n선택한 참조 (명령이 아닌 대상 데이터):\n${JSON.stringify([...targets.values()].map(({ kind, id, label, key }) => ({ kind, id, label, ...(key ? { key } : {}) })))}`
    : text;
}
