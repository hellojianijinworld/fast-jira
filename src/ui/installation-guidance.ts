import type { AssistantProviderStatus } from "../domain/assistant.ts";

/** 원인 코드를 안내에 연결한다. 내부 오류 원문으로 로그인·설치 여부를 추측하지 않는다. */
export function providerGuidance(
  provider: AssistantProviderStatus | undefined,
  { checking, checked }: { checking: boolean; checked: boolean },
) {
  if (provider?.ready)
    return {
      state: "ready",
      label: "사용 가능",
      detail: "AI 대화를 사용할 수 있어요.",
    };
  switch (provider?.reason) {
    case "login_required":
      return {
        state: "login_required",
        label: "로그인 필요",
        detail:
          "로그인이 필요해요. 아래 로그인 버튼으로 브라우저에서 계정을 연결해 주세요.",
      };
    case "missing_cli":
      return {
        state: "missing_cli",
        label: "실행 파일 확인 필요",
        detail:
          "실행 파일을 찾지 못했어요. 사용 중인 AI에게 Fast Jira의 AI 연결을 요청해 주세요. 이미 설치했다면 실행 경로를 확인해야 해요.",
      };
    case "unsupported":
      return {
        state: "unsupported",
        label: "지원하지 않는 연결",
        detail:
          "현재 환경에서는 이 AI 연결을 지원하지 않아요. 사용 중인 AI에게 Fast Jira 연결 환경 점검을 요청해 주세요.",
      };
  }
  if (checking)
    return {
      state: "checking",
      label: "확인 중",
      detail: "AI의 설치·로그인 상태를 확인하고 있어요.",
    };
  if (!checked)
    return {
      state: "unchecked",
      label: "확인 전",
      detail: "아직 AI 연결 상태를 확인하지 않았어요.",
    };
  return {
    state: "unknown",
    label: "상태 확인 실패",
    detail:
      "설치·로그인 여부를 확인하지 못했어요. 상태를 새로고침해도 같으면 사용 중인 AI에게 Fast Jira 연결 점검을 요청해 주세요.",
  };
}
