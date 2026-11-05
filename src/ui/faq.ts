import { shortcutLabel } from "../domain/commands.ts";
import {
  type FaqEntry,
  faqEntries,
  faqTopics,
  matchingFaq,
} from "../domain/faq.ts";
import { actionButton, element, uiIcon } from "./dom.ts";
import { showModal } from "./modal.ts";

/** 주제별로 질문을 둘러보고 검색하는 독립 FAQ 화면이다. */
export function createFaqDialog(host: HTMLElement) {
  const dialog = element("dialog", "settings-modal faq-dialog");
  const body = element("section", "faq-content");
  host.append(dialog);
  let query = "",
    topicId = "",
    alive = true;
  function question(entry: FaqEntry) {
    const back = actionButton("질문 목록", "chevron-right", {
      purpose: "quiet",
      size: "sm",
    });
    back.classList.add("faq-back");
    back.querySelector("svg")?.classList.add("faq-back-icon");
    back.addEventListener("click", () => search());
    const answer = element("article", "faq-answer");
    const title = element("h3", "", entry.question);
    title.tabIndex = -1;
    answer.append(
      element("small", "muted", entry.category),
      title,
      element("p", "", entry.answer),
    );
    if (entry.id === "shortcuts") {
      const list = element("dl", "faq-shortcuts");
      for (const [label, command] of [
        ["이슈 검색", "search"],
        ["AI 대화", "ai"],
        ["명령 팔레트", "palette"],
      ] as const)
        list.append(
          element("dt", "", label),
          element("dd", "", shortcutLabel(navigator.platform, command)),
        );
      answer.append(list);
    }
    body.replaceChildren(back, answer);
    title.focus();
  }
  function search() {
    const form = element("form", "faq-search");
    const input = element("input");
    input.type = "search";
    input.placeholder = "궁금한 내용을 검색하세요";
    input.setAttribute("aria-label", "FAQ 질문 검색");
    input.value = query;
    form.append(uiIcon("search"), input);
    const layout = element("div", "faq-layout");
    const topics = element("nav", "faq-topics");
    topics.setAttribute("aria-label", "FAQ 주제");
    const results = element("div", "faq-results");
    results.setAttribute("aria-label", "FAQ 질문 목록");
    const count = element("small", "faq-count");
    count.setAttribute("role", "status");
    function render() {
      query = input.value;
      const found = matchingFaq(query, topicId);
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
          const button = element("button", "faq-result");
          button.type = "button";
          button.append(
            element("span", "faq-result-copy", entry.question),
            uiIcon("chevron-right"),
          );
          button.addEventListener("click", () => question(entry));
          group.append(button);
        }
        results.append(group);
      }
      if (!found.length)
        results.append(
          element(
            "p",
            "muted",
            "일치하는 질문이 없어요. ‘참여자’, ‘저장’, ‘프로젝트’처럼 짧게 검색해 보세요.",
          ),
        );
    }
    input.addEventListener("input", render);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      results.querySelector<HTMLButtonElement>("button")?.click();
    });
    input.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        results.querySelector<HTMLButtonElement>("button")?.focus();
      }
    });
    results.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...results.querySelectorAll("button")],
        index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (index === 0 && event.key === "ArrowUp") input.focus();
      else buttons[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
    });
    layout.append(topics, results);
    body.replaceChildren(form, count, layout);
    render();
    input.focus();
  }
  return {
    open(id?: string) {
      if (!alive) return;
      query = "";
      topicId = "";
      showModal(dialog, { title: "FAQ", content: body });
      const entry = faqEntries.find((entry) => entry.id === id);
      if (entry) question(entry);
      else search();
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
