import { element, externalLink, safeHref, uiIcon } from "./dom.ts";
/** AI 본문은 HTML을 실행하지 않는다. 대화와 복원 기록에 같은 표시를 사용한다. */
export function chatMessage(
  role: "user" | "assistant",
  text: string,
  model = "",
) {
  const row = element("article", `chat-message chat-message-${role}`),
    author = element("div", "chat-author", role === "user" ? "나" : "AI"),
    body = element("div", role === "user" ? "command-user" : "command-answer");
  if (role === "assistant") {
    author.prepend(uiIcon("sparkles"));
    if (model) author.append(element("small", "", model));
  }
  if (role === "user") body.textContent = text;
  else {
    let code: HTMLElement | undefined;
    for (const line of text.split("\n")) {
      if (line.startsWith("```")) {
        if (code) code = undefined;
        else {
          code = element("code");
          const pre = element("pre");
          pre.append(code);
          body.append(pre);
        }
        continue;
      }
      if (code) {
        code.textContent += `${line}\n`;
        continue;
      }
      const block = element(/^#{1,3}\s/.test(line) ? "h3" : "p");
      const value = line.replace(/^#{1,3}\s/, "");
      if (!line.trim()) {
        block.className = "chat-break";
        body.append(block);
        continue;
      }
      for (const part of value.split(
        /(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s<>]+)/g,
      )) {
        if (part.startsWith("**") && part.endsWith("**"))
          block.append(element("strong", "", part.slice(2, -2)));
        else if (part.startsWith("`") && part.endsWith("`"))
          block.append(element("code", "", part.slice(1, -1)));
        else if (/^https?:\/\//.test(part) && safeHref(part))
          block.append(externalLink(part, part));
        else block.append(document.createTextNode(part));
      }
      body.append(block);
    }
  }
  row.append(author, body);
  return row;
}
