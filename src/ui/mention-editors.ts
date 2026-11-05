import {
  type MentionLoader,
  type MentionTarget,
  mentionLabel,
  moveMentions,
  type TextMention,
} from "../domain/mention.ts";
import type { AdfEditor } from "./adf-editor.ts";
import { element } from "./dom.ts";
import { mentionPicker } from "./mention-picker.ts";
import { type MentionOptions, mentionToken } from "./mention-token.ts";
export function adfMentionEditor(editor: AdfEditor) {
  return {
    element: editor.element,
    mentionQuery: editor.mentionQuery,
    insertMention(target: MentionTarget, range: Range) {
      if (target.kind === "user")
        editor.insertMention({ id: target.id, name: target.label }, range);
      else editor.insertIssueMention(target, range);
    },
  };
}
export function textareaMentionEditor(
  input: HTMLTextAreaElement,
  options: MentionOptions = {},
) {
  const host = element("div", "mention-input"),
    mirror = element("div", "mention-mirror");
  mirror.setAttribute("aria-hidden", "true");
  input.replaceWith(host);
  host.append(mirror, input);
  function paint() {
    mirror.replaceChildren();
    let offset = 0;
    for (const mention of [...references].sort((a, b) => a.start - b.start)) {
      if (
        input.value.slice(mention.start, mention.end) !==
        mentionLabel(mention.target)
      )
        continue;
      mirror.append(
        document.createTextNode(input.value.slice(offset, mention.start)),
      );
      const token = element(
        "mark",
        "mention-token",
        input.value.slice(mention.start, mention.end),
      );
      token.dataset.kind = mention.target.kind;
      const content = mentionToken(mention.target, token.textContent ?? "", {
        ...options,
        className: "mention-token-content",
      });
      content.tabIndex = -1;
      content.addEventListener("mousedown", (event) => event.preventDefault());
      token.replaceChildren(content);
      mirror.append(token);
      offset = mention.end;
    }
    mirror.append(document.createTextNode(`${input.value.slice(offset)}\n`));
    mirror.scrollTop = input.scrollTop;
    mirror.scrollLeft = input.scrollLeft;
  }
  function resize() {
    const style = getComputedStyle(input);
    for (const property of [
      "font",
      "letter-spacing",
      "line-height",
      "padding",
      "border-width",
      "box-sizing",
      "text-align",
      "text-indent",
      "tab-size",
    ])
      mirror.style.setProperty(property, style.getPropertyValue(property));
    const scrollbar =
      input.offsetWidth -
      input.clientWidth -
      Number.parseFloat(style.borderLeftWidth) -
      Number.parseFloat(style.borderRightWidth);
    mirror.style.paddingRight = `${Number.parseFloat(style.paddingRight) + Math.max(0, scrollbar)}px`;
    mirror.style.width = `${input.offsetWidth}px`;
    mirror.style.height = `${input.offsetHeight}px`;
    paint();
  }
  let before = input.value,
    references: TextMention[] = [];
  function sync() {
    references = moveMentions(before, input.value, references);
    before = input.value;
    paint();
  }
  input.addEventListener("input", sync);
  input.addEventListener("scroll", paint);
  const observer = new ResizeObserver(resize);
  observer.observe(input);
  return {
    element: input,
    host,
    refresh: sync,
    mentionQuery() {
      if (
        input.disabled ||
        input.readOnly ||
        input.selectionStart !== input.selectionEnd
      )
        return null;
      const end = input.selectionStart,
        match = input.value.slice(0, end).match(/(?:^|[\s(])@([^\s@]{0,100})$/);
      if (!match) return null;
      return {
        query: match[1] ?? "",
        range: { start: end - (match[1]?.length ?? 0) - 1, end },
        rect: input.getBoundingClientRect(),
      };
    },
    insertMention(
      target: MentionTarget,
      range: { start: number; end: number },
    ) {
      sync();
      const label = mentionLabel(target);
      input.setRangeText(`${label} `, range.start, range.end, "end");
      sync();
      references.push({
        start: range.start,
        end: range.start + label.length,
        target,
      });
      input.focus();
      input.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "insertText" }),
      );
    },
    references(text = input.value) {
      sync();
      const offset =
        input.value.trim() === text
          ? input.value.length - input.value.trimStart().length
          : 0;
      return structuredClone(
        references.map((mention) => ({
          ...mention,
          start: mention.start - offset,
          end: mention.end - offset,
        })),
      );
    },
    restore(text: string, mentions: readonly TextMention[] = []) {
      input.value = before = text;
      references = structuredClone([...mentions]);
      paint();
    },
    destroy() {
      input.removeEventListener("input", sync);
      input.removeEventListener("scroll", paint);
      observer.disconnect();
      host.replaceWith(input);
    },
  };
}

/** 일반 작성란도 같은 후보·키보드 선택기를 사용한다. */
export function textareaMentions(
  input: HTMLTextAreaElement,
  load: MentionLoader,
  options: MentionOptions = {},
) {
  const editor = textareaMentionEditor(input, options),
    picker = mentionPicker(editor, load);
  editor.host.append(picker.element);
  return {
    ...editor,
    element: editor.host,
    destroy() {
      picker.destroy();
      editor.destroy();
    },
  };
}
