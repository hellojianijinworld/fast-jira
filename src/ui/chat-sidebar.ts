import type { Conversation } from "../domain/conversation.ts";
import { element, iconButton } from "./dom.ts";
export function createChatSidebar(actions: {
  choose: (conversation: Conversation) => void;
  remove: (id: string) => void;
  copy: (conversation: Conversation) => void;
  create: () => void;
}) {
  const root = element("aside", "chat-sidebar"),
    head = element("div", "chat-sidebar-head"),
    create = iconButton("대화 시작", "square-pen", { size: "sm" }),
    list = element("div", "chat-conversations");
  root.setAttribute("aria-label", "저장한 대화");
  head.append(element("strong", "", "대화"), create);
  root.append(head, list);
  create.addEventListener("click", actions.create);
  return {
    root,
    render(
      items: readonly Conversation[],
      selected: string,
      disabled: boolean,
      states: ReadonlyMap<string, string> = new Map(),
    ) {
      create.disabled = disabled;
      list.replaceChildren(
        ...items.map((item) => {
          const row = element("div", "chat-conversation"),
            open = element("button", "chat-conversation-open"),
            remove = iconButton("대화 삭제", "trash-2", { size: "sm" });
          open.type = "button";
          open.disabled = disabled;
          remove.disabled =
            disabled ||
            ["답변 중", "확인 필요"].includes(states.get(item.id) ?? "");
          open.setAttribute("aria-current", String(item.id === selected));
          open.append(
            element(
              "span",
              "",
              item.messages.find((message) => message.role === "user")?.text ||
                "대화",
            ),
            element("small", "", item.model),
          );
          const state = states.get(item.id);
          if (state) {
            const indicator = element(
              "small",
              "chat-conversation-state",
              state,
            );
            indicator.dataset.state =
              state === "확인 필요"
                ? "waiting"
                : state === "요청 실패"
                  ? "error"
                  : "active";
            indicator.setAttribute("role", "status");
            open.append(indicator);
          }
          open.title = new Date(item.updated).toLocaleString();
          open.addEventListener("click", () => actions.choose(item));
          remove.addEventListener("click", () => actions.remove(item.id));
          row.append(open);
          const copy = iconButton("대화 내용 복사", "copy", { size: "sm" });
          copy.disabled = !item.messages.length;
          copy.addEventListener("click", () => actions.copy(item));
          row.append(copy);
          row.append(remove);
          return row;
        }),
      );
      if (!items.length)
        list.append(
          element("p", "chat-sidebar-empty", "여기에 대화가 쌓입니다"),
        );
    },
  };
}
