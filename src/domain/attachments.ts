import type { AdfDocument, AdfNode } from "./adf.ts";
import type { Attachment } from "./details.ts";

/** ADF에서 실제 이미지로 표시하는 파일명만 제외한다. 동명 첨부는 숨기지 않는다. */
export function unembeddedImages(
  description: AdfDocument | null,
  files: readonly Attachment[],
): Attachment[] {
  const embedded = new Set<string>();
  const pending: AdfNode[] = description ? [description] : [];
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    if (
      (node.type === "media" || node.type === "mediaInline") &&
      typeof node.attrs?.alt === "string"
    )
      embedded.add(node.attrs.alt);
    if (node.content) pending.push(...node.content);
  }
  const names = new Map<string, number>();
  for (const file of files)
    names.set(file.name, (names.get(file.name) ?? 0) + 1);
  return files.filter(
    (file) =>
      file.mimeType.startsWith("image/") &&
      (!embedded.has(file.name) || (names.get(file.name) ?? 0) > 1),
  );
}
