import type { ViewBinding, ViewTarget } from "./views.ts";

export const FOLLOW_GLOBAL_VIEW = "전체 뷰 따라가기";

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
      help: "상단 ‘필터 및 뷰’의 조건을 따라가요. 전체 조건을 바꾸면 함께 바뀝니다.",
    };
  if (binding.kind === "saved")
    return {
      label: savedName ?? "저장한 뷰",
      icon: "user",
      help:
        target.kind === "branch"
          ? "저장한 조건을 사용해요. 이 목록만 바꾸려면 ‘이 하위 목록만 설정’을 선택하세요."
          : "저장한 조건을 사용해요. 수정은 ‘뷰 관리’에서 하거나 ‘필터 직접 설정’을 선택하세요.",
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
        help: "전체 목록에서 사용할 필터와 정렬을 직접 정해요.",
      };
}
