import type { AdfNode } from "./adf.ts";

const attrString = (node: AdfNode, key: string) =>
  typeof node.attrs?.[key] === "string" ? node.attrs[key] : "";
export function adfMarkdown(node: AdfNode | null): string {
  if (!node) return "";
  if (node.type === "text") {
    let value = node.text ?? "";
    for (const mark of node.marks ?? []) {
      if (mark.type === "strong") value = `**${value}**`;
      if (mark.type === "em") value = `*${value}*`;
      if (mark.type === "code") value = `\`${value}\``;
      if (mark.type === "strike") value = `~~${value}~~`;
      const href = mark.attrs?.href;
      if (
        mark.type === "link" &&
        typeof href === "string" &&
        /^https?:\/\//.test(href)
      )
        value = `[${value}](${href})`;
    }
    return value;
  }
  if (node.type === "hardBreak") return "\n";
  if (node.type === "media")
    return `[이미지: ${attrString(node, "alt") || attrString(node, "id") || "첨부파일"}]`;
  if (node.type === "mention") return attrString(node, "text");
  if (node.type === "emoji") return attrString(node, "shortName");
  if (["inlineCard", "blockCard", "embedCard"].includes(node.type))
    return attrString(node, "url");
  const content = node.content ?? [],
    body = content.map(adfMarkdown).join("");
  if (node.type === "paragraph") return `${body}\n\n`;
  if (node.type === "heading") {
    const raw = node.attrs?.level;
    const level =
      typeof raw === "number" ? Math.max(1, Math.min(6, Math.floor(raw))) : 3;
    return `${"#".repeat(level)} ${body}\n\n`;
  }
  if (node.type === "bulletList" || node.type === "orderedList")
    return `${content
      .map(
        (item, index) =>
          `${node.type === "bulletList" ? "-" : `${index + 1}.`} ${adfMarkdown(item).trim().replace(/\n/g, "\n  ")}`,
      )
      .join("\n")}\n\n`;
  if (node.type === "table") {
    const rows = content.map((row) =>
      (row.content ?? []).map((cell) =>
        adfMarkdown(cell)
          .trim()
          .replace(/\s*\n+\s*/g, " / ")
          .replaceAll("|", "\\|"),
      ),
    );
    const first = rows[0];
    if (!first) return "";
    const line = (row: string[]) => `| ${row.join(" | ")} |`;
    return `${[
      line(first),
      line(first.map(() => "---")),
      ...rows.slice(1).map(line),
    ].join("\n")}\n\n`;
  }
  if (node.type === "codeBlock") return `\`\`\`\n${body.trim()}\n\`\`\`\n\n`;
  if (node.type === "blockquote")
    return `${body
      .trim()
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")}\n\n`;
  if (node.type === "rule") return "---\n\n";
  return body;
}
