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
    shortcut: "search",
  },
  {
    id: "ai",
    label: "AI 대화",
    icon: "sparkles",
    keywords: "ai 대화 요청 명령",
    shortcut: "ai",
  },
  {
    id: "faq",
    label: "FAQ 검색",
    icon: "circle-help",
    keywords: "faq 도움말 질문 사용법 안내",
    menuLabel: "FAQ",
  },
] as const;
export type CommandId = (typeof commands)[number]["id"];
export interface CommandDescriptor {
  id: string;
  label: string;
  icon: string;
  keywords: string;
  group?: string;
  description?: string;
  current?: boolean;
  viewIcon?: string;
  menuLabel?: string;
  visible?: boolean;
  enabled?: boolean;
  shortcut?: ShortcutCommand;
}
export interface PaletteAction extends CommandDescriptor {
  run: () => void | Promise<void>;
}
const normalizedCommand = (text: string) =>
  text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s'"‘’“”「」]/g, "");
export function matchingCommands(
  query: string,
  aiAvailable = true,
  entries: readonly CommandDescriptor[] = commands,
): CommandDescriptor[] {
  const terms = query
    .trim()
    .replace(/^>\s*/, "")
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizedCommand);
  const exact = normalizedCommand(query.replace(/^>\s*/, ""));
  const rank = (item: CommandDescriptor) => {
    const label = normalizedCommand(item.label);
    return !exact || label === exact
      ? 0
      : label.startsWith(exact)
        ? 1
        : label.includes(exact)
          ? 2
          : 3;
  };
  return entries
    .filter(
      (item) =>
        item.visible !== false &&
        (item.id !== "ai" || aiAvailable) &&
        terms.every((term) =>
          normalizedCommand(
            `${item.label} ${item.keywords} ${item.group ?? ""}`,
          ).includes(term),
        ),
    )
    .sort((a, b) => rank(a) - rank(b));
}
export type ShortcutCommand = "search" | "ai" | "palette" | "settings";
const shortcutKeys = {
  search: "K",
  palette: "P",
  ai: "I",
  settings: ",",
} as const;
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
    event.code ===
      (command === "settings" ? "Comma" : `Key${shortcutKeys[command]}`) ||
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
  return pressed("settings") ? "settings" : pressed("search") ? "search" : null;
}

/** 최신 상태의 정의를 다시 읽어 메뉴·팔레트·단축키의 실행 조건을 함께 검사한다. */
export function createActionCatalog(source: () => readonly PaletteAction[]) {
  function all() {
    const ids = new Set<string>();
    return source().filter((action) => {
      if (ids.has(action.id)) throw new Error(`중복 액션: ${action.id}`);
      ids.add(action.id);
      return action.visible !== false;
    });
  }
  return {
    all,
    async execute(id: string) {
      const action = all().find((action) => action.id === id);
      if (!action || action.enabled === false) return false;
      await action.run();
      return true;
    },
  };
}
export const shortcutCommands = [
  ["이슈 검색", "search"],
  ["AI 대화", "ai"],
  ["명령 팔레트", "palette"],
  ["설정 열기", "settings"],
] as const;

/** 그룹 순서를 명시하고 각 그룹 안에서 검색 관련도를 유지한다. */
export function matchingActions(
  query: string,
  actions: readonly PaletteAction[],
) {
  const groups = ["작업", "뷰", "화면", "설정", "도움말", "FAQ"];
  const order = (action: CommandDescriptor) => {
    const index = groups.indexOf(action.group ?? "작업");
    return index < 0 ? groups.length : index;
  };
  return matchingCommands(query, true, actions).sort(
    (a, b) => order(a) - order(b),
  );
}

export const viewCommands = {
  create: {
    id: "view:create",
    label: "뷰 만들기",
    icon: "plus",
    keywords: "뷰 생성 새 뷰 추가 탭 create view",
    group: "뷰",
  },
  edit: {
    id: "view:edit",
    label: "현재 뷰 편집",
    menuLabel: "뷰 편집",
    icon: "square-pen",
    keywords: "뷰 수정 이름 프로젝트 필터 정렬 edit view",
    group: "뷰",
  },
  duplicate: {
    id: "view:duplicate",
    label: "뷰 복제",
    icon: "copy",
    keywords: "뷰 복사 duplicate",
    group: "뷰",
  },
  names: {
    id: "view:names",
    label: "모든 뷰 이름 표시",
    icon: "check",
    keywords: "뷰 이름 표시 펼침",
    group: "뷰",
  },
} satisfies Record<string, CommandDescriptor>;
