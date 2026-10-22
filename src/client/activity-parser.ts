import type { Activity } from "../domain/activity.ts";

const atom = "http://www.w3.org/2005/Atom";
const stream = "http://activitystrea.ms/spec/1.0/";
function child(node: Element | undefined, namespace: string, name: string) {
  return [...(node?.children ?? [])].find(
    (item) => item.namespaceURI === namespace && item.localName === name,
  );
}
const text = (node: Element | undefined) => node?.textContent?.trim() ?? "";
export function parseActivityFeed(
  source: string,
  projects: readonly string[],
): Activity[] {
  if (source.length > 1000000 || /<!DOCTYPE|<!ENTITY/i.test(source))
    throw new Error("활동 XML 형식이 올바르지 않습니다.");
  const doc = new DOMParser().parseFromString(source, "application/xml");
  const root = doc.documentElement;
  if (
    root.localName !== "feed" ||
    root.namespaceURI !== atom ||
    doc.querySelector("parsererror")
  )
    throw new Error("Jira 활동 스트림을 읽지 못했습니다.");
  const entries: Activity[] = [];
  for (const entry of [...root.children].filter(
    (node) => node.namespaceURI === atom && node.localName === "entry",
  )) {
    const object = child(entry, stream, "object");
    const target = child(entry, stream, "target");
    const key =
      [target, object]
        .map((node) => text(child(node, atom, "title")))
        .find((value) => /^[A-Z][A-Z0-9_]*-\d+$/.test(value)) ?? "";
    if (!projects.includes(key.split("-")[0] ?? "")) continue;
    const id = text(child(entry, atom, "id"));
    const created = text(child(entry, atom, "published"));
    const authorNode = child(entry, atom, "author");
    const author = text(child(authorNode, atom, "name")) || "알 수 없음";
    const title = child(entry, atom, "title");
    let label = text(title);
    if (title?.getAttribute("type") === "html") {
      // template 내용은 문서에 붙이지 않는다. 피드 HTML의 스크립트·이벤트·이미지를 실행하지 않는다.
      const template = document.createElement("template");
      template.innerHTML = label;
      label = template.content.textContent ?? "";
    }
    label = label.replace(/\s+/g, " ").trim();
    if (!id || !Number.isFinite(Date.parse(created)) || !label)
      throw new Error("Jira 활동 항목이 올바르지 않습니다.");
    const avatar =
      [...(authorNode?.children ?? [])]
        .find(
          (node) =>
            node.namespaceURI === atom &&
            node.localName === "link" &&
            node.getAttribute("rel") === "photo",
        )
        ?.getAttribute("href") ?? "";
    if (!entries.some((item) => item.id === id))
      entries.push({
        id,
        key,
        author,
        avatar: avatar.startsWith("https://") ? avatar : "",
        text: label,
        created,
      });
  }
  return entries
    .sort((a, b) => Date.parse(b.created) - Date.parse(a.created))
    .slice(0, 10);
}
