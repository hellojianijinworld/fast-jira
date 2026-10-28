import { parseIssueKey } from "../domain/validation.ts";
import { element, externalLink, safeHref, uiIcon } from "./dom.ts";
/** AI 본문은 HTML을 실행하지 않는다. 대화와 복원 기록에 같은 표시를 사용한다. */
export function chatMessage(
  role: "user" | "assistant",
  text: string,
  model = "",
  navigation?: { site: string; select(key: string): void },
  executionSummary = "",
) {
  const row = element("article", `chat-message chat-message-${role}`),
    author = element("div", "chat-author", role === "user" ? "나" : "AI"),
    body = element("div", role === "user" ? "command-user" : "command-answer");
  if (role === "assistant") {
    author.prepend(uiIcon("sparkles"));
    if (model) author.append(element("small", "", model));
  }
  function link(url: string, label: string) {
    if (navigation) {
      let key = "";
      try {
        key = parseIssueKey(url, navigation.site);
      } catch {
        /* 외부 링크는 원래 주소로 연다. */
      }
      if (key) {
        const anchor = element(
          "a",
          "chat-issue-link",
          label === url
            ? key
            : label.includes(key)
              ? label
              : `${label} (${key})`,
        );
        anchor.href = `?issue=${encodeURIComponent(key)}`;
        anchor.addEventListener("click", (event) => {
          if (
            event.button ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          navigation.select(key);
        });
        return anchor;
      }
    }
    return externalLink(url, label);
  }
  function inline(block: HTMLElement, value: string) {
    for (const part of value.split(
      /(\[(?:[^[\]\n]|\[[^[\]\n]*\])+\]\(https?:\/\/[^\s<>)]+\)|\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s<>()]+)/g,
    )) {
      const markdown = part.match(
        /^\[((?:[^[\]\n]|\[[^[\]\n]*\])+)\]\((https?:\/\/[^\s<>)]+)\)$/,
      );
      if (markdown?.[1] && markdown[2] && safeHref(markdown[2]))
        block.append(link(markdown[2], markdown[1]));
      else if (part.startsWith("**") && part.endsWith("**")) {
        const strong = element("strong");
        inline(strong, part.slice(2, -2));
        block.append(strong);
      } else if (part.startsWith("`") && part.endsWith("`"))
        block.append(element("code", "", part.slice(1, -1)));
      else if (/^https?:\/\//.test(part) && safeHref(part))
        block.append(link(part, part));
      else block.append(document.createTextNode(part));
    }
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
      inline(block, value);
      body.append(block);
    }
  }
  row.append(author);
  if (executionSummary) {
    const result = element("section", "chat-execution-result");
    result.setAttribute("aria-label", "실행 결과");
    result.append(element("strong", "", "실행 결과"));
    for (const line of executionSummary.split("\n")) {
      const paragraph = element("p");
      inline(paragraph, line);
      result.append(paragraph);
    }
    row.append(result);
  }
  body.hidden = !text;
  row.append(body);
  return row;
}
