import { isRecord, record, requiredString } from "./validation.ts";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export interface AdfMark {
  type: string;
  attrs?: Record<string, JsonValue>;
}
export interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, JsonValue>;
  marks?: AdfMark[];
  content?: AdfNode[];
}
export interface AdfDocument {
  type: "doc";
  version: 1;
  content: AdfNode[];
}
function jsonValue(value: unknown, depth: number): JsonValue {
  if (depth > 100) throw new Error("작성 내용이 너무 깊게 중첩되어 있습니다.");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value))
    return value.map((value) => jsonValue(value, depth + 1));
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, value]) => [
        key,
        jsonValue(value, depth + 1),
      ]),
    );
  throw new Error("작성 내용의 속성 형식이 올바르지 않습니다.");
}
function attrs(value: unknown, depth: number): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(record(value)).map(([key, value]) => [
      key,
      jsonValue(value, depth + 1),
    ]),
  );
}
function nodes(value: unknown, depth: number): AdfNode[] {
  if (!Array.isArray(value))
    throw new Error("작성 내용의 목록 형식이 올바르지 않습니다.");
  return value.map((value) => decodeAdfNode(value, depth));
}
export function decodeAdfMarks(value: unknown): AdfMark[] {
  if (!Array.isArray(value))
    throw new Error("작성 내용의 서식 형식이 올바르지 않습니다.");
  return value.map((value) => {
    const mark = record(value);
    return {
      type: requiredString(mark.type, "서식 유형"),
      ...(mark.attrs === undefined ? {} : { attrs: attrs(mark.attrs, 0) }),
    };
  });
}
export function decodeAdfNode(value: unknown, depth = 0): AdfNode {
  if (depth > 100) throw new Error("작성 내용이 너무 깊게 중첩되어 있습니다.");
  const node = record(value);
  const type = requiredString(node.type, "노드 유형");
  if (
    (node.text !== undefined || type === "text") &&
    typeof node.text !== "string"
  )
    throw new Error("작성 내용의 문자열 형식이 올바르지 않습니다.");
  // 모르는 Jira 확장 노드도 보존한다. 편집기가 지원하지 않는 노드를 삭제하면 데이터가 손실된다.
  return {
    type,
    ...(typeof node.text === "string" ? { text: node.text } : {}),
    ...(node.attrs === undefined ? {} : { attrs: attrs(node.attrs, depth) }),
    ...(node.marks === undefined ? {} : { marks: decodeAdfMarks(node.marks) }),
    ...(node.content === undefined
      ? {}
      : { content: nodes(node.content, depth + 1) }),
  };
}
export function decodeAdfDocument(value: unknown): AdfDocument {
  const document = record(value);
  if (document.type !== "doc" || document.version !== 1)
    throw new Error("작성 내용의 형식이 올바르지 않습니다.");
  return { type: "doc", version: 1, content: nodes(document.content, 0) };
}
export function textDocument(text: string): AdfDocument {
  if (!text.trim() || text.length > 10000)
    throw new Error("댓글은 1~10000자로 입력하세요.");
  return {
    type: "doc",
    version: 1,
    content: text
      .trim()
      .split(/\n\n+/)
      .map((paragraph) => ({
        type: "paragraph",
        content: paragraph
          .split("\n")
          .flatMap((line, index): AdfNode[] => [
            ...(index ? [{ type: "hardBreak" }] : []),
            { type: "text", text: line },
          ]),
      })),
  };
}
export function commentDocument(value: unknown): AdfDocument {
  const document = decodeAdfDocument(value);
  const pending = [...document.content];
  let length = 0;
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    if (node.type === "mention") {
      const id = node.attrs?.id,
        text = node.attrs?.text;
      if (
        typeof id !== "string" ||
        !id ||
        id.length > 200 ||
        (text !== undefined && typeof text !== "string")
      )
        throw new Error("멘션할 사람 정보가 올바르지 않습니다.");
      length += typeof text === "string" ? text.length : 1;
    } else if (node.type === "text") length += node.text?.trim().length ?? 0;
    if (node.content) pending.push(...node.content);
  }
  if (!length || length > 10000)
    throw new Error("댓글은 1~10000자로 입력하세요.");
  return document;
}
