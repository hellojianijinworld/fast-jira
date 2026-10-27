/** 명령 이름·검색어는 여기에서 관리하고, 실행은 화면의 동작에 연결한다. */
export const commands = [
  {
    id: "create",
    label: "이슈 생성",
    icon: "plus",
    keywords: "create 생성 만들기 등록",
  },
  {
    id: "search",
    label: "이슈 검색",
    icon: "search",
    keywords: "search 찾기 검색",
  },
  {
    id: "ai",
    label: "AI 대화",
    icon: "sparkles",
    keywords: "ai 대화 요청 명령",
  },
] as const;
export type CommandId = (typeof commands)[number]["id"];
export function matchingCommands(query: string) {
  const term = query.trim().toLocaleLowerCase().replace(/^>\s*/, "");
  return commands.filter((item) =>
    `${item.label} ${item.keywords}`.toLocaleLowerCase().includes(term),
  );
}
export type ShortcutCommand = Exclude<CommandId, "create"> | "palette";
const shortcutKeys = { search: "K", palette: "P", ai: "I" } as const;
const isMac = (platform: string) => /Mac|iPhone|iPad/.test(platform);
export function shortcutLabel(
  platform: string,
  command: ShortcutCommand = "search",
): string {
  const key = shortcutKeys[command];
  if (command === "ai") return isMac(platform) ? `⌃⌘${key}` : `Ctrl+Alt+${key}`;
  const shift = command === "palette";
  return isMac(platform)
    ? `⌘${shift ? "⇧" : ""}${key}`
    : `Ctrl+${shift ? "Shift+" : ""}${key}`;
}
export function shortcutAria(
  platform: string,
  command: ShortcutCommand,
): string {
  const key = shortcutKeys[command].toLowerCase();
  if (command === "ai")
    return isMac(platform) ? `Control+Meta+${key}` : `Control+Alt+${key}`;
  return `${isMac(platform) ? "Meta" : "Control"}+${command === "palette" ? "Shift+" : ""}${key}`;
}
export function commandForShortcut(
  event: Pick<
    KeyboardEvent,
    | "key"
    | "code"
    | "metaKey"
    | "ctrlKey"
    | "altKey"
    | "shiftKey"
    | "repeat"
    | "getModifierState"
  >,
  platform: string,
): ShortcutCommand | null {
  if (event.repeat || event.getModifierState("AltGraph")) return null;
  const pressed = (command: ShortcutCommand) =>
    event.code === `Key${shortcutKeys[command]}` ||
    event.key.toUpperCase() === shortcutKeys[command];
  if (
    pressed("ai") &&
    !event.shiftKey &&
    (isMac(platform)
      ? event.ctrlKey && event.metaKey && !event.altKey
      : event.ctrlKey && event.altKey && !event.metaKey)
  )
    return "ai";
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  if (event.shiftKey) return pressed("palette") ? "palette" : null;
  return pressed("search") ? "search" : null;
}
