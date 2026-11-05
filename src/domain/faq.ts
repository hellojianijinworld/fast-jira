import data from "./faq.json";

export interface FaqSection {
  title: string;
  items: readonly string[];
}
export interface FaqQuestion {
  id: string;
  question: string;
  keywords: string;
  answer: readonly FaqSection[];
}
export interface FaqTopic {
  id: string;
  title: string;
  icon: string;
  questions: readonly FaqQuestion[];
}
export interface FaqEntry extends FaqQuestion {
  topicId: string;
  category: string;
}
export const faqTopics: readonly FaqTopic[] = data.topics;
export const faqEntries: readonly FaqEntry[] = faqTopics.flatMap((topic) =>
  topic.questions.map((question) => ({
    ...question,
    topicId: topic.id,
    category: topic.title,
  })),
);
/** 표시와 검색은 같은 구조화된 답변을 사용한다. */
export function faqAnswerText(entry: FaqQuestion): string {
  return entry.answer
    .flatMap((section) => [section.title, ...section.items])
    .join(" ");
}
const normalized = (text: string) => text.normalize("NFKC").toLocaleLowerCase();
export function matchingFaq(query: string, topicId = ""): readonly FaqEntry[] {
  const terms = normalized(query).trim().split(/\s+/).filter(Boolean);
  return faqEntries.filter((entry) => {
    if (topicId && entry.topicId !== topicId) return false;
    const text = normalized(
      `${entry.question} ${entry.category} ${entry.keywords} ${faqAnswerText(entry)}`,
    );
    return terms.every((term) => text.includes(term));
  });
}
