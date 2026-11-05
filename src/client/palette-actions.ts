import { type PaletteAction, viewCommands } from "../domain/commands.ts";
import type { WorkspaceView } from "../domain/workspace-views.ts";
import type { Preferences } from "./preferences.ts";

type SettingsTab = "Jira 연결" | "화면 표시" | "관리";
/** 명령은 기존 앱 동작에 연결한다. 실행·저장 로직이나 별도 설정 상태를 만들지 않는다. */
export function applicationCommands(options: {
  theme: Preferences["theme"];
  views: readonly Pick<WorkspaceView, "id" | "name" | "icon">[];
  activeView: string;
  setTheme: (theme: Preferences["theme"]) => void;
  selectView: (id: string) => void;
  createView: () => void;
  editView: () => void;
  settings: (tab?: SettingsTab) => void;
  help: () => void;
  onboarding: () => void;
  feedback: () => void;
  updatesAvailable?: boolean;
  selection?: { active: boolean; busy?: boolean; toggle: () => void };
}): PaletteAction[] {
  const actions: PaletteAction[] = [
    {
      id: "settings",
      label: "설정 열기",
      menuLabel: "설정",
      shortcut: "settings",
      icon: "settings",
      keywords: "환경 설정 preferences settings",
      group: "설정",
      run: () => options.settings(),
    },
    {
      id: "settings:display",
      label: "화면 표시 설정 열기",
      icon: "monitor",
      keywords: "테마 제목 줄바꿈 완료 타일 간단히 보기 옵션",
      group: "설정",
      run: () => options.settings("화면 표시"),
    },
    {
      id: "settings:connection",
      label: "Jira 연결 설정 열기",
      icon: "external-link",
      keywords: "인증 이메일 토큰 연결 jira",
      group: "설정",
      run: () => options.settings("Jira 연결"),
    },
    {
      id: "settings:management",
      label: "AI·접속 주소 연결 관리 열기",
      icon: "settings",
      keywords: "codex claude 로그인 도메인 간편 주소 localhost 관리",
      group: "설정",
      run: () => options.settings("관리"),
    },
    {
      id: "update",
      visible: options.updatesAvailable ?? false,
      label: "업데이트 확인",
      icon: "circle-arrow-up",
      keywords: "버전 최신 update version",
      description: "설정의 버전 정보를 열어요.",
      group: "설정",
      run: () => options.settings("관리"),
    },
    { ...viewCommands.create, run: options.createView },
    { ...viewCommands.edit, run: options.editView },
    {
      id: "help",
      label: "이용 안내 열기",
      menuLabel: "이용 안내",
      icon: "circle-help",
      keywords: "도움말 보안 정보 help",
      group: "도움말",
      run: options.help,
    },
    {
      id: "onboarding",
      label: "시작 안내 다시 보기",
      icon: "list",
      keywords: "온보딩 처음 설정 가이드 onboarding",
      group: "도움말",
      run: options.onboarding,
    },
    {
      id: "feedback",
      label: "의견 보내기",
      icon: "message-circle",
      keywords: "버그 제보 오류 문의 개선 기능 제안 feedback",
      group: "도움말",
      run: options.feedback,
    },
  ];
  for (const [value, label, icon] of [
    ["light", "화이트", "sun"],
    ["dark", "다크", "moon"],
    ["system", "시스템", "monitor"],
  ] as const)
    actions.push({
      id: `theme:${value}`,
      label: `${label} 모드로 전환`,
      icon,
      keywords: `테마 ${value} ${value === "light" ? "라이트 밝게" : value === "dark" ? "어둡게" : "자동 OS 따르기"} theme mode`,
      group: "화면",
      current: options.theme === value,
      run: () => options.setTheme(value),
    });
  for (const view of options.views)
    actions.push({
      id: `view:${view.id}`,
      label: `${view.name} 뷰로 전환`,
      icon: "layers",
      viewIcon: view.icon ?? "",
      keywords: `${view.name} 뷰 열기 탭 이동 switch view`,
      group: "뷰",
      current: view.id === options.activeView,
      run: () => options.selectView(view.id),
    });
  if (options.selection) {
    const selection = options.selection;
    actions.push({
      id: "selection",
      label: selection.active ? "이슈 선택 모드 종료" : "이슈 선택 모드 시작",
      icon: "check",
      keywords: "선택 체크박스 일괄 변경 다중 selection",
      group: "작업",
      enabled: !selection.busy,
      run: selection.toggle,
    });
  }
  return actions;
}
