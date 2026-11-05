import { shortcutCommands, shortcutLabel } from "../domain/commands.ts";
import { faqEntries, faqTopics, matchingFaq } from "../domain/faq.ts";
import { element, uiIcon } from "./dom.ts";
import { modalScrollRegion, showModal } from "./modal.ts";

/** 질문 목록을 유지한 채 답변을 펼치고 검색·주제 변경에도 개폐 상태를 보존한다. */
export function createFaqDialog(host: HTMLElement) {
  const dialog = element("dialog", "settings-modal faq-dialog");
  const body = element("section", "faq-content");
  host.append(dialog);
  let alive = true;
  function browse(id?: string) {
    const expanded = new Set(id ? [id] : []);
    let topicId = "";
    const form = element("form", "faq-search");
    const input = element("input");
    input.type = "search";
    input.placeholder = "궁금한 내용을 검색하세요";
    input.setAttribute("aria-label", "FAQ 질문 검색");
    form.append(uiIcon("search"), input);
    const layout = element("div", "faq-layout");
    const topics = element("nav", "faq-topics");
    topics.setAttribute("aria-label", "FAQ 주제");
    const results = modalScrollRegion(element("div", "faq-results"));
    results.setAttribute("aria-label", "FAQ 질문 목록");
    const count = element("small", "faq-count");
    count.setAttribute("role", "status");
    function render() {
      for (const item of results.querySelectorAll<HTMLDetailsElement>(
        "details",
      )) {
        if (item.open) expanded.add(item.dataset.faqId ?? "");
        else expanded.delete(item.dataset.faqId ?? "");
      }
      const found = matchingFaq(input.value, topicId);
      topics.replaceChildren();
      for (const topic of [
        {
          id: "",
          title: "전체 질문",
          icon: "list-filter",
          questions: faqEntries,
        },
        ...faqTopics,
      ]) {
        const button = element("button", "faq-topic");
        button.type = "button";
        button.setAttribute("aria-pressed", String(topicId === topic.id));
        button.append(
          uiIcon(topic.icon),
          element("span", "", topic.title),
          element("small", "", String(topic.questions.length)),
        );
        button.addEventListener("click", () => {
          topicId = topic.id;
          render();
          results.scrollTop = 0;
          topics
            .querySelector<HTMLButtonElement>('[aria-pressed="true"]')
            ?.focus();
        });
        topics.append(button);
      }
      count.textContent = `${found.length}개 질문`;
      results.replaceChildren();
      for (const topic of faqTopics) {
        const questions = found.filter((entry) => entry.topicId === topic.id);
        if (!questions.length) continue;
        const group = element("section", "faq-group");
        group.append(element("h3", "", topic.title));
        for (const entry of questions) {
          const item = element("details", "faq-item");
          item.dataset.faqId = entry.id;
          item.open = expanded.has(entry.id);
          const summary = element("summary", "faq-result");
          const arrow = uiIcon("chevron-down");
          arrow.classList.add("faq-result-icon");
          summary.append(
            element("span", "faq-result-copy", entry.question),
            arrow,
          );
          const answer = element("div", "faq-answer");
          for (const section of entry.answer) {
            const block = element("section");
            const list = element("ul");
            for (const text of section.items)
              list.append(element("li", "", text));
            block.append(
              element("h4", "faq-answer-heading", section.title),
              list,
            );
            answer.append(block);
          }
          if (entry.id === "shortcuts") {
            const list = element("dl", "faq-shortcuts");
            for (const [label, command] of shortcutCommands)
              list.append(
                element("dt", "", label),
                element("dd", "", shortcutLabel(navigator.platform, command)),
              );
            answer.append(list);
          }
          item.append(summary, answer);
          item.addEventListener("toggle", () => {
            if (!item.isConnected) return;
            if (item.open) expanded.add(entry.id);
            else expanded.delete(entry.id);
          });
          group.append(item);
        }
        results.append(group);
      }
      if (!found.length)
        results.append(
          element(
            "p",
            "muted",
            "일치하는 질문이 없어요. 다른 단어로 검색하거나 주제를 바꿔보세요.",
          ),
        );
    }
    input.addEventListener("input", render);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const item = results.querySelector<HTMLDetailsElement>("details");
      if (item) {
        item.open = true;
        item.querySelector("summary")?.focus();
      }
    });
    input.addEventListener("keydown", (event) => {
      if (!event.isComposing && event.key === "ArrowDown") {
        event.preventDefault();
        results.querySelector("summary")?.focus();
      }
    });
    results.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault();
      const summaries = [...results.querySelectorAll("summary")];
      const index = summaries.indexOf(document.activeElement as HTMLElement);
      if (index === 0 && event.key === "ArrowUp") input.focus();
      else summaries[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
    });
    layout.append(topics, results);
    body.replaceChildren(form, count, layout);
    render();
    const selected = [
      ...results.querySelectorAll<HTMLDetailsElement>("details"),
    ].find((item) => item.dataset.faqId === id);
    if (selected) {
      selected.querySelector("summary")?.focus({ preventScroll: true });
      selected.scrollIntoView({ block: "nearest" });
    } else input.focus();
  }
  return {
    open(id?: string) {
      if (!alive) return;
      showModal(dialog, { title: "FAQ", content: body });
      browse(id);
    },
    close() {
      if (dialog.open) dialog.close();
    },
    destroy() {
      alive = false;
      if (dialog.open) dialog.close();
      dialog.remove();
    },
  };
}
