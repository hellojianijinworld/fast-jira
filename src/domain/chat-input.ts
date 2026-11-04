export type ChatFollowupMode = "queue" | "steer";
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

export function chatKeyboardAction(
  mode: ChatSendMode,
  followup: ChatFollowupMode,
  busy: boolean,
  event: Parameters<typeof sendsChatMessage>[1],
): "send" | ChatFollowupMode | null {
  if (
    event.key !== "Enter" ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.altKey
  )
    return null;
  const modified = event.ctrlKey || event.metaKey;
  if (busy && modified && (mode === "enter" ? !event.shiftKey : event.shiftKey))
    return followup === "queue" ? "steer" : "queue";
  return sendsChatMessage(mode, event) ? (busy ? followup : "send") : null;
}
export function chatShortcutHints(
  mode: ChatSendMode,
  followup: ChatFollowupMode,
  busy: boolean,
  mac: boolean,
) {
  const modifier = mac ? "⌘" : "Ctrl+";
  const primary = mode === "enter" ? "Enter" : `${modifier}Enter`;
  const alternate =
    mode === "enter"
      ? `${modifier}Enter`
      : `${modifier}${mac ? "⇧" : "Shift+"}Enter`;
  const label = (value: ChatFollowupMode) =>
    value === "queue" ? "대기열" : "즉시 전달";
  return {
    primary,
    followup: `${primary} ${label(followup)} · ${alternate} ${label(followup === "queue" ? "steer" : "queue")}`,
    composer: `${busy ? `${primary} ${label(followup)} · ${alternate} ${label(followup === "queue" ? "steer" : "queue")}` : `${primary} 전송`} · ${mode === "enter" ? "Shift+Enter" : "Enter"} 줄바꿈`,
  };
}
