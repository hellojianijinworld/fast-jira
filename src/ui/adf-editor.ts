import type {
  AdfDocument,
  AdfMark,
  AdfNode,
  JsonValue,
} from "../domain/adf.ts";
import { decodeAdfMarks } from "../domain/adf.ts";
import type { UserOption } from "../domain/issue.ts";
import { type AdfContext, renderADF } from "./adf-render.ts";
import { element, safeHref } from "./dom.ts";

const blocks: Record<string, keyof HTMLElementTagNameMap> = {
  paragraph: "p",
  heading: "h3",
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
const blockTypes: Record<string, string> = {
  P: "paragraph",
  UL: "bulletList",
  OL: "orderedList",
  LI: "listItem",
  TABLE: "table",
  TR: "tableRow",
  TD: "tableCell",
  TH: "tableHeader",
  BLOCKQUOTE: "blockquote",
  PRE: "codeBlock",
};
const markTypes: Record<string, string> = {
  STRONG: "strong",
  B: "strong",
  EM: "em",
  I: "em",
  CODE: "code",
  S: "strike",
  U: "underline",
};
const inlineAtoms = new Set([
  "mention",
  "emoji",
  "date",
  "status",
  "inlineCard",
  "mediaInline",
]);

/** DOM은 편집 화면, ADF는 저장 형식이다. 미지원 노드는 수정 불가 상태로 원본을 유지한다. */
export function adfEditor(
  document: AdfDocument | null,
  issue: AdfContext,
  imageEnabled: boolean,
) {
  const atoms = new WeakMap<Node, AdfNode>(),
    attributes = new WeakMap<Node, Record<string, JsonValue>>(),
    originalMarks = new WeakMap<Node, AdfMark[]>();
  const root = element("div", "adf description-edit");
  root.contentEditable = "true";
  root.setAttribute("role", "textbox");
  root.setAttribute("aria-label", "이슈 본문");
  root.setAttribute("aria-multiline", "true");
  let savedRange: Range | undefined;
  function rememberSelection() {
    const selection = getSelection();
    if (
      selection?.rangeCount &&
      root.contains(selection.anchorNode) &&
      root.contains(selection.focusNode)
    )
      savedRange = selection.getRangeAt(0).cloneRange();
  }
  for (const event of ["keyup", "mouseup", "input", "focusout"])
    root.addEventListener(event, rememberSelection);
  function render(node: AdfNode): Node {
    if (node.type === "text" && node.marks?.length) {
      const wrapper = element("span");
      wrapper.append(renderADF(node, issue, imageEnabled));
      originalMarks.set(wrapper, node.marks);
      // 브라우저가 서식 요소를 복제해도 Jira 확장 서식을 복구할 수 있게 메타정보를 둔다.
      wrapper.dataset.adfMarks = JSON.stringify(node.marks);
      return wrapper;
    }
    if (node.type === "text" || node.type === "hardBreak")
      return renderADF(node, issue, imageEnabled);
    if (node.type === "doc") {
      const fragment = window.document.createDocumentFragment();
      for (const child of node.content ?? []) fragment.append(render(child));
      return fragment;
    }
    const tag = blocks[node.type];
    if (!tag) {
      const wrapper = element(
        node.type === "mediaSingle" || node.type === "mediaGroup"
          ? "div"
          : "span",
        "adf-atom",
      );
      wrapper.contentEditable = "false";
      wrapper.append(renderADF(node, issue, imageEnabled));
      atoms.set(wrapper, structuredClone(node));
      return wrapper;
    }
    const level = typeof node.attrs?.level === "number" ? node.attrs.level : 1;
    const headings = ["h3", "h4", "h5", "h6"] as const;
    const block = element(
      node.type === "heading"
        ? (headings[Math.min(3, Math.max(0, level - 1))] ?? "h3")
        : tag,
    );
    if (node.type === "table") block.className = "adf-edit-table";
    if (node.attrs) attributes.set(block, structuredClone(node.attrs));
    if (block instanceof HTMLTableCellElement) {
      if (typeof node.attrs?.colspan === "number")
        block.colSpan = node.attrs.colspan;
      if (typeof node.attrs?.rowspan === "number")
        block.rowSpan = node.attrs.rowspan;
    }
    for (const child of node.content ?? []) block.append(render(child));
    return block;
  }
  function inline(nodes: Iterable<Node>, marks: AdfMark[] = []): AdfNode[] {
    const content: AdfNode[] = [];
    for (const node of nodes) {
      if (node instanceof Text) {
        if (node.textContent)
          content.push({
            type: "text",
            text: node.textContent,
            ...(marks.length ? { marks } : {}),
          });
      } else if (node instanceof HTMLElement) {
        const atom = atoms.get(node);
        if (atom) content.push(structuredClone(atom));
        else if (node.tagName === "BR") content.push({ type: "hardBreak" });
        else {
          const type = markTypes[node.tagName];
          const href =
            node instanceof HTMLAnchorElement ? safeHref(node.href) : null;
          const mark: AdfMark | null = type
            ? { type }
            : href
              ? { type: "link", attrs: { href } }
              : null;
          let preserved = originalMarks.get(node) ?? [];
          if (!preserved.length && node.dataset.adfMarks) {
            try {
              preserved = decodeAdfMarks(JSON.parse(node.dataset.adfMarks));
            } catch {
              /* 손상된 편집 메타정보는 저장하지 않는다. */
            }
          }
          const combined = [
            ...marks,
            ...preserved.filter(
              (item) => !marks.some((existing) => existing.type === item.type),
            ),
          ];
          if (mark && !combined.some((existing) => existing.type === mark.type))
            combined.push(mark);
          content.push(...inline(node.childNodes, combined));
        }
      }
    }
    return content;
  }
  function block(node: HTMLElement): AdfNode {
    const atom = atoms.get(node);
    if (atom) return structuredClone(atom);
    const type =
      blockTypes[node.tagName] ??
      (/^H[3-6]$/.test(node.tagName) ? "heading" : "paragraph");
    const attrs =
      attributes.get(node) ??
      (type === "heading" ? { level: Number(node.tagName[1]) - 2 } : undefined);
    let content: AdfNode[];
    if (node instanceof HTMLTableElement) content = [...node.rows].map(block);
    else if (["bulletList", "orderedList", "tableRow"].includes(type))
      content = [...node.children]
        .filter((child): child is HTMLElement => child instanceof HTMLElement)
        .map(block);
    else if (
      ["listItem", "tableCell", "tableHeader", "blockquote"].includes(type)
    )
      content = blockContent(node.childNodes);
    else content = inline(node.childNodes);
    return {
      type,
      ...(attrs ? { attrs: structuredClone(attrs) } : {}),
      content,
    };
  }
  function blockContent(nodes: Iterable<Node>): AdfNode[] {
    const content: AdfNode[] = [];
    let pending: Node[] = [];
    const flush = () => {
      if (pending.length)
        content.push({ type: "paragraph", content: inline(pending) });
      pending = [];
    };
    for (const node of nodes) {
      if (!(node instanceof Text) && !(node instanceof HTMLElement)) continue;
      const atom = atoms.get(node);
      const isBlock = atom
        ? !inlineAtoms.has(atom.type)
        : node instanceof HTMLElement &&
          (node.tagName === "DIV" ||
            Boolean(blockTypes[node.tagName]) ||
            /^H[3-6]$/.test(node.tagName));
      if (isBlock && node instanceof HTMLElement) {
        flush();
        content.push(block(node));
      } else pending.push(node);
    }
    flush();
    return content;
  }
  const initial: AdfDocument = document ?? {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [] }],
  };
  root.append(render(structuredClone(initial)));
  return {
    element: root,
    rememberSelection,
    document: (): AdfDocument =>
      structuredClone({
        type: "doc",
        version: 1,
        content: blockContent(root.childNodes),
      }),
    mentionQuery() {
      const selection = getSelection(),
        node = selection?.anchorNode;
      if (
        !selection?.isCollapsed ||
        !(node instanceof Text) ||
        !root.contains(node) ||
        node.parentElement?.closest("pre, code, .adf-atom")
      )
        return null;
      // ponytail: 같은 텍스트 노드의 @이름만 감지한다. 서식 경계를 넘는 검색은 이후 확장한다.
      const match = node.textContent
        ?.slice(0, selection.anchorOffset)
        .match(/(?:^|[\s(])@([^\s@]{0,100})$/);
      if (!match) return null;
      const query = match[1] ?? "",
        range = window.document.createRange();
      range.setStart(node, selection.anchorOffset - query.length - 1);
      range.setEnd(node, selection.anchorOffset);
      return {
        query,
        range,
        rect: selection.getRangeAt(0).getBoundingClientRect(),
      };
    },
    insertMention(user: Pick<UserOption, "id" | "name">, replaceRange?: Range) {
      if (replaceRange && !root.contains(replaceRange.commonAncestorContainer))
        throw new Error("멘션 입력 위치가 편집기 밖에 있습니다.");
      root.focus();
      const range =
        replaceRange ??
        (savedRange && root.contains(savedRange.commonAncestorContainer)
          ? savedRange
          : window.document.createRange());
      if (!replaceRange && range !== savedRange) {
        let paragraph = root.lastElementChild;
        if (
          !(paragraph instanceof HTMLElement) ||
          paragraph.contentEditable === "false"
        ) {
          paragraph = element("p");
          root.append(paragraph);
        }
        range.selectNodeContents(paragraph);
        range.collapse(false);
      }
      const mention = render({
        type: "mention",
        attrs: { id: user.id, text: `@${user.name}` },
      });
      range.deleteContents();
      range.insertNode(mention);
      const space = window.document.createTextNode(" ");
      mention.parentNode?.insertBefore(space, mention.nextSibling);
      range.setStartAfter(space);
      range.collapse(true);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      rememberSelection();
    },
  };
}
export type AdfEditor = ReturnType<typeof adfEditor>;
