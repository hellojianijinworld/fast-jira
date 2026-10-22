import type { Activity } from "../src/domain/activity.ts";

const xmlEscape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export function activityXML(
  items: readonly (Activity & { comment?: boolean; html?: boolean })[],
) {
  return `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:activity="http://activitystrea.ms/spec/1.0/">${items.map((item) => `<entry><id>${xmlEscape(item.id)}</id><published>${xmlEscape(item.created)}</published><title type="${item.html ? "html" : "text"}">${xmlEscape(item.text)}</title><author><name>${xmlEscape(item.author)}</name></author><activity:${item.comment ? "target" : "object"}><title>${xmlEscape(item.key)}</title></activity:${item.comment ? "target" : "object"}></entry>`).join("")}</feed>`;
}
