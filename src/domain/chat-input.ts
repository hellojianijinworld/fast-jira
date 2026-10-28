export type ChatSendMode = "enter" | "shortcut";
/** Shift/Alt+Enter와 IME 확정은 보내기로 처리하지 않는다. */
export function sendsChatMessage(
  mode: ChatSendMode,
  event: {
    key: string;
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    isComposing: boolean;
    keyCode?: number;
  },
) {
  return (
    event.key === "Enter" &&
    !event.isComposing &&
    event.keyCode !== 229 &&
    !event.shiftKey &&
    !event.altKey &&
    (mode === "enter" || event.ctrlKey || event.metaKey)
  );
}
