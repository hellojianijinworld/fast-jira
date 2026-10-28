import type { ViewBinding, ViewTarget } from "./views.ts";

export const FOLLOW_GLOBAL_VIEW = "현재 탭 필터 따라가기";

export interface ViewInfo {
  kind: ViewBinding["kind"];
  label: string;
  icon: string;
  active: boolean;
  temporary: boolean;
}

/** 선택 메뉴와 현재 적용 상태가 같은 이름으로 적용 범위를 설명한다. */
export function viewPresentation(
  target: ViewTarget,
  binding: ViewBinding,
  savedName?: string,
) {
  if (binding.kind === "default")
    return {
      label: FOLLOW_GLOBAL_VIEW,
      icon: "list-filter",
      help: "현재 탭의 필터를 따라가요. 탭의 조건을 바꾸면 함께 바뀝니다.",
    };
  if (binding.kind === "saved")
    return {
      label: savedName ?? "저장한 뷰",
      icon: "user",
      help:
        target.kind === "branch"
          ? "이 하위 목록에 저장된 조건을 사용해요. 필터에서 바로 편집할 수 있어요."
          : "현재 탭에 저장된 조건을 사용해요. 필터에서 바로 편집할 수 있어요.",
    };
  return target.kind === "branch"
    ? {
        label: "이 하위 목록만 설정",
        icon: "list-filter-plus",
        help: `${target.key} 아래 이슈의 필터와 정렬을 따로 정해요. 다른 목록은 바뀌지 않습니다.`,
      }
    : {
        label: "필터 직접 설정",
        icon: "list-filter",
        help: "현재 탭에서 사용할 필터와 정렬을 정해요.",
      };
}
