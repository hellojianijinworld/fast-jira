import type { AdfNode } from "../domain/adf.ts";
import { element, externalLink, safeHref } from "./dom.ts";

export interface AdfContext {
  key: string;
  url: string;
}
const tags: Record<string, keyof HTMLElementTagNameMap> = {
  paragraph: "p",
  bulletList: "ul",
  orderedList: "ol",
  listItem: "li",
  table: "table",
  tableRow: "tr",
  tableCell: "td",
  tableHeader: "th",
  blockquote: "blockquote",
  codeBlock: "pre",
};
const markTags: Record<string, keyof HTMLElementTagNameMap> = {
  strong: "strong",
  em: "em",
  code: "code",
  strike: "s",
  underline: "u",
};
function children(
  nodes: readonly AdfNode[] | undefined,
  issue: AdfContext,
  images: boolean,
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const node of nodes ?? [])
    fragment.append(renderADF(node, issue, images));
  return fragment;
}
function stringAttr(node: AdfNode, name: string): string {
  const value = node.attrs?.[name];
  return typeof value === "string" ? value : "";
}
/** API가 검증한 ADF만 받는다. 내용은 HTML로 삽입하지 않고 텍스트·허용 링크로 렌더한다. */
export function renderADF(
  node: AdfNode | null,
  issue: AdfContext,
  images = true,
): Node {
  if (!node) return document.createDocumentFragment();
  if (node.type === "text") {
    let content: Node = document.createTextNode(node.text ?? "");
    for (const mark of node.marks ?? []) {
      const tag = markTags[mark.type];
      let wrapper: HTMLElement | undefined = tag ? element(tag) : undefined;
      if (mark.type === "link") {
        const href = mark.attrs?.href;
        const safe =
          typeof href === "string" ? safeHref(href, issue.url) : null;
        if (safe) wrapper = externalLink(safe);
      }
      if (wrapper) {
        wrapper.append(content);
        content = wrapper;
      }
    }
    return content;
  }
  if (node.type === "hardBreak") return element("br");
  if (node.type === "rule") return element("hr");
  if (node.type === "mention")
    return element("span", "mention", stringAttr(node, "text") || "@사용자");
  if (node.type === "emoji")
    return element(
      "span",
      "",
      stringAttr(node, "text") || stringAttr(node, "shortName"),
    );
  if (node.type === "status")
    return element("strong", "", stringAttr(node, "text"));
  if (node.type === "media" || node.type === "mediaInline") {
    const name = stringAttr(node, "alt");
    const figure = element("figure");
    const fallback = externalLink(issue.url, "이미지 (Jira에서 보기)");
    if (images && name) {
      const source = `/api/image?key=${encodeURIComponent(issue.key)}&name=${encodeURIComponent(name)}`;
      const link = externalLink(source);
      const image = element("img");
      const width = node.attrs?.width,
        height = node.attrs?.height;
      if (
        typeof width === "number" &&
        typeof height === "number" &&
        Number.isInteger(width) &&
        Number.isInteger(height) &&
        width > 0 &&
        height > 0 &&
        width <= 10000 &&
        height <= 10000
      ) {
        image.width = width;
        image.height = height;
      }
      image.src = source;
      image.alt = "첨부 이미지";
      image.loading = "eager";
      image.addEventListener("error", () => link.replaceWith(fallback), {
        once: true,
      });
      link.append(image);
      figure.append(link);
    } else figure.append(fallback);
    return figure;
  }
  if (["inlineCard", "blockCard", "embedCard"].includes(node.type)) {
    const url = stringAttr(node, "url");
    const href = safeHref(url, issue.url);
    if (!href) return element("span", "", url);
    const inline = node.type === "inlineCard";
    return externalLink(
      href,
      inline
        ? url
        : `${new URL(href).hostname.replace(/^www\./, "")}에서 열기 ↗`,
      inline ? "" : "smart-link",
    );
  }
  if (["doc", "mediaSingle", "mediaGroup"].includes(node.type))
    return children(node.content, issue, images);
  const headings = ["h3", "h4", "h5", "h6"] as const;
  const level = typeof node.attrs?.level === "number" ? node.attrs.level : 1;
  const tag =
    node.type === "heading"
      ? (headings[Math.max(0, Math.min(3, Math.floor(level) - 1))] ?? "h3")
      : (tags[node.type] ?? "div");
  const container = element(tag);
  container.append(children(node.content, issue, images));
  if (container instanceof HTMLTableCellElement) {
    for (const name of ["colspan", "rowspan"] as const) {
      const value = node.attrs?.[name];
      if (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value > 1 &&
        value <= 20
      )
        container.setAttribute(name, String(value));
    }
  }
  if (node.type === "table") {
    const wrapper = element("div", "table-wrap");
    wrapper.append(container);
    return wrapper;
  }
  return container;
}
