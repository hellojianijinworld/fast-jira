import { isRecord } from "./validation.ts";
import { decodeViews, type ViewState } from "./views.ts";

/** 저장한 이모지는 단일 글자 묶음으로 제한하고 텍스트로만 표시한다. */
export function workspaceEmoji(value: string): string | null {
  if (!value.startsWith("emoji:")) return null;
  const emoji = value.slice(6);
  if (
    !emoji ||
    emoji.length > 64 ||
    !/(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3)/u.test(emoji)
  )
    return null;
  return [
    ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
      emoji,
    ),
  ].length === 1
    ? emoji
    : null;
}

export interface WorkspaceView {
  id: string;
  name: string;
  icon?: string;
  projects: string[];
  views: ViewState;
}
export interface WorkspaceViews {
  version: 1;
  activeId: string;
  tabs: WorkspaceView[];
}
export function activeWorkspace(state: WorkspaceViews): WorkspaceView {
  const tab = state.tabs.find((tab) => tab.id === state.activeId);
  if (!tab) throw new Error("선택한 뷰를 찾을 수 없습니다.");
  return tab;
}
export function workspaceName(name: string): string {
  const value = name.trim();
  if (!value || value.length > 80)
    throw new Error("뷰 이름을 1~80자로 입력하세요.");
  return value;
}
export function initialWorkspaces(
  projects: readonly string[],
  views: ViewState,
): WorkspaceViews {
  return {
    version: 1,
    activeId: "workspace-1",
    tabs: [
      { id: "workspace-1", name: "내 작업", projects: [...projects], views },
    ],
  };
}
/** 계정에 저장된 탭만 복구하고 현재 접근할 수 없는 프로젝트는 제외한다. */
export function decodeWorkspaces(
  value: unknown,
  projects: readonly string[],
): WorkspaceViews | null {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.tabs) ||
    !value.tabs.length
  )
    return null;
  try {
    const ids = new Set<string>();
    const tabs = value.tabs.map((item): WorkspaceView => {
      if (
        !isRecord(item) ||
        typeof item.id !== "string" ||
        !/^[\w-]{1,100}$/.test(item.id) ||
        ids.has(item.id) ||
        typeof item.name !== "string" ||
        !Array.isArray(item.projects) ||
        !item.projects.every((key) => typeof key === "string")
      )
        throw new Error("Invalid workspace");
      const views = decodeViews(item.views);
      if (!views) throw new Error("Invalid filters");
      ids.add(item.id);
      return {
        id: item.id,
        name: workspaceName(item.name),
        ...(typeof item.icon === "string" &&
        (workspaceEmoji(item.icon) !== null ||
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.icon)) &&
        item.icon.length <= 100
          ? { icon: item.icon }
          : {}),
        projects: [
          ...new Set(item.projects.filter((key) => projects.includes(key))),
        ],
        views,
      };
    });
    const first = tabs[0];
    if (!first) return null;
    return {
      version: 1,
      activeId: tabs.some((tab) => tab.id === value.activeId)
        ? String(value.activeId)
        : first.id,
      tabs,
    };
  } catch {
    return null;
  }
}
export function saveWorkspace(
  state: WorkspaceViews,
  tab: WorkspaceView,
): WorkspaceViews {
  const next = {
    ...tab,
    name: workspaceName(tab.name),
    projects: [...new Set(tab.projects)],
  };
  return {
    ...state,
    activeId: tab.id,
    tabs: state.tabs.some((item) => item.id === tab.id)
      ? state.tabs.map((item) => (item.id === tab.id ? next : item))
      : [...state.tabs, next],
  };
}
export function selectWorkspace(
  state: WorkspaceViews,
  id: string,
): WorkspaceViews {
  if (!state.tabs.some((tab) => tab.id === id))
    throw new Error("선택한 뷰를 찾을 수 없습니다.");
  return { ...state, activeId: id };
}
export function deleteWorkspace(
  state: WorkspaceViews,
  id: string,
): WorkspaceViews {
  if (state.tabs.length === 1)
    throw new Error("뷰는 하나 이상 유지해야 합니다.");
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) throw new Error("삭제할 뷰를 찾을 수 없습니다.");
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  const next = tabs[Math.min(index, tabs.length - 1)];
  if (!next) throw new Error("뷰는 하나 이상 유지해야 합니다.");
  return {
    ...state,
    tabs,
    activeId: state.activeId === id ? next.id : state.activeId,
  };
}
