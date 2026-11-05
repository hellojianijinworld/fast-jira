import {
  type CommandId,
  commands,
  createActionCatalog,
  type PaletteAction,
} from "../domain/commands.ts";
import { faqAnswerText, faqEntries } from "../domain/faq.ts";

/** 기본 동작·현재 뷰·FAQ를 같은 목록으로 해석하고 상태 저장은 각 기능에 맡긴다. */
export function createCommandCatalog(options: {
  handlers: Record<CommandId, () => void>;
  createAvailable: () => boolean;
  aiAvailable: () => boolean;
  actions: () => readonly PaletteAction[];
  openFaq: (id: string) => void;
}) {
  return createActionCatalog(() => [
    ...commands.map((item) => ({
      ...item,
      group: "작업",
      visible:
        item.id === "create"
          ? options.createAvailable()
          : item.id === "ai"
            ? options.aiAvailable()
            : true,
      run: options.handlers[item.id],
    })),
    ...options.actions(),
    ...faqEntries.map((entry) => ({
      id: `faq:${entry.id}`,
      label: entry.question,
      icon: "circle-help",
      group: "FAQ",
      description: entry.category,
      keywords: `${entry.keywords} ${faqAnswerText(entry)} FAQ 질문 도움말`,
      run: () => options.openFaq(entry.id),
    })),
  ]);
}
