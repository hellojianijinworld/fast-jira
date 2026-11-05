import MarkdownIt from "markdown-it";
import type { ChatMessage } from "../domain/conversation.ts";
import { mentionLabel, type TextMention } from "../domain/mention.ts";
import { parseIssueKey } from "../domain/validation.ts";
import { element, safeHref } from "./dom.ts";
import { mentionToken } from "./mention-token.ts";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
}).disable("image");
/** AI 본문은 HTML을 실행하지 않는다. 대화와 복원 기록에 같은 표시를 사용한다. */
export function chatMessage(
  role: "user" | "assistant",
  text: string,
  model = "",
  navigation?: { site: string; select(key: string): void },
  executionSummary = "",
  mentions: readonly TextMention[] = [],
) {
  const row = element("article", `chat-message chat-message-${role}`),
    body = element("div", role === "user" ? "command-user" : "command-answer");
  row.setAttribute("aria-label", role === "user" ? "내 메시지" : "AI 답변");
  if (role === "assistant" && model)
    row.setAttribute("aria-description", model);
  function renderMarkdown(container: HTMLElement, source: string) {
    // 원문 HTML과 이미지 문법을 끄고, 라이브러리가 이스케이프한 결과만 삽입한다.
    container.innerHTML = markdown.render(source);
    for (const anchor of container.querySelectorAll<HTMLAnchorElement>("a")) {
      const raw = anchor.getAttribute("href") ?? "";
      const url = safeHref(raw);
      if (!url) {
        anchor.replaceWith(...anchor.childNodes);
        continue;
      }
      let key = "";
      if (navigation) {
        try {
          key = parseIssueKey(url, navigation.site);
        } catch {
          /* 일반 외부 링크는 새 탭에서 연다. */
        }
      }
      if (key && navigation) {
        const label = anchor.textContent ?? "";
        if (label === raw || label === url) anchor.textContent = key;
        else if (!label.includes(key)) anchor.append(` (${key})`);
        anchor.classList.add("chat-issue-link");
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
      } else {
        anchor.href = url;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
      }
    }
    for (const table of container.querySelectorAll("table")) {
      const wrap = element("div", "chat-table-wrap");
      wrap.tabIndex = 0;
      wrap.setAttribute("role", "region");
      wrap.setAttribute("aria-label", "답변 표");
      table.replaceWith(wrap);
      wrap.append(table);
    }
  }
  if (role === "user") {
    // 이전 기록은 ID를 추정하지 않고 명시된 이슈 키만 표시상 복구한다.
    const tokens = mentions.length
      ? mentions
      : [...text.matchAll(/@[A-Z][A-Z0-9_]*-\d+(?: · [^\n]*?…)?/g)].map(
          (match) => ({
            start: match.index,
            end: match.index + match[0].length,
            target: { kind: "issue" as const, id: "", label: match[0] },
          }),
        );
    let offset = 0;
    for (const token of [...tokens].sort((a, b) => a.start - b.start)) {
      if (
        token.start < offset ||
        token.end > text.length ||
        (token.target.id &&
          text.slice(token.start, token.end) !== mentionLabel(token.target))
      )
        continue;
      body.append(document.createTextNode(text.slice(offset, token.start)));
      const badge = mentionToken(
        token.target,
        text.slice(token.start, token.end),
        {
          className: "mention chat-mention",
          select: navigation?.select,
        },
      );
      body.append(badge);
      offset = token.end;
    }
    body.append(document.createTextNode(text.slice(offset)));
  } else {
    body.classList.add("chat-markdown");
    renderMarkdown(body, text);
  }
  if (executionSummary) {
    const result = element("section", "chat-execution-result");
    result.setAttribute("aria-label", "실행 결과");
    result.append(element("strong", "", "실행 결과"));
    const content = element("div", "chat-markdown");
    renderMarkdown(content, executionSummary);
    result.append(content);
    row.append(result);
  }
  body.hidden = !text;
  row.append(body);
  return row;
}

export function chatEvent({
  text,
  details,
  created,
}: Pick<ChatMessage, "text" | "details" | "created">) {
  const event = element(details ? "details" : "div", "chat-event");
  event.append(element(details ? "summary" : "span", "", text));
  if (details) {
    const entries = element("div", "chat-event-entries");
    for (const block of details.split(/\n\s*\n/).filter(Boolean)) {
      const [title, ...lines] = block.split("\n");
      const entry = element("div", "chat-event-entry");
      entry.append(element("p", "chat-event-title", title));
      for (const line of lines)
        entry.append(element("p", "chat-event-detail", line));
      entries.append(entry);
    }
    event.append(entries);
  }
  if (created) event.title = new Date(created).toLocaleString();
  return event;
}

/** 전송·연결 오류는 AI 답변이나 모델 출력으로 표시하지 않는다. */
export function chatError({
  text,
  executionNote,
}: Pick<ChatMessage, "text" | "executionNote">) {
  const row = element("section", "chat-error");
  row.setAttribute("role", "alert");
  row.setAttribute("aria-label", "요청 오류");
  row.append(
    element("strong", "", "요청을 완료하지 못했어요"),
    element("p", "", text),
  );
  if (executionNote)
    row.append(element("p", "chat-execution-note", executionNote));
  return row;
}
