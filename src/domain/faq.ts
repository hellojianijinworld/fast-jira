import data from "./faq.json";

export interface FaqQuestion {
  id: string;
  question: string;
  keywords: string;
  answer: string;
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
const normalized = (text: string) => text.normalize("NFKC").toLocaleLowerCase();
export function matchingFaq(query: string, topicId = ""): readonly FaqEntry[] {
  const terms = normalized(query).trim().split(/\s+/).filter(Boolean);
  return faqEntries.filter((entry) => {
    if (topicId && entry.topicId !== topicId) return false;
    const text = normalized(
      `${entry.question} ${entry.category} ${entry.keywords} ${entry.answer}`,
    );
    return terms.every((term) => text.includes(term));
  });
}
