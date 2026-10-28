import { shortcutLabel } from "../domain/commands.ts";
import { element } from "./dom.ts";

export function helpContent(): DocumentFragment {
  const content = document.createDocumentFragment();
  const sections: [string, string[]][] = [
    [
      "단축키",
      [
        `${shortcutLabel(navigator.platform)}: 이슈 검색`,
        `${shortcutLabel(navigator.platform, "ai")}: AI 대화`,
        `${shortcutLabel(navigator.platform, "palette")}: 명령 팔레트`,
      ],
    ],
    [
      "어떤 서비스인가요?",
      [
        "Jira 작업을 빠르게 확인하고 수정하는 로컬 앱이에요.",
        "부모와 하위 작업을 한눈에 보고, 필요한 이슈만 골라 볼 수 있어요.",
      ],
    ],
    [
      "이렇게 시작해 보세요",
      [
        "상단 폴더 아이콘에서 볼 프로젝트를 골라 주세요. 로그인한 계정이 ‘나’로 자동 설정돼요.",
        "현재 탭의 필터에서 사람 조건과 단계를 고르고 적용해 주세요. 완료 제외·나 또는 미지정 버튼으로 빠르게 고를 수 있어요.",
        "돋보기로 제목을 검색해 보세요. 검색은 Jira에서 조회하고, 초기화하면 원래 목록으로 돌아와요.",
        "이슈를 누르면 상세가 열려요. 화살표로 하위 작업을 펼치고, 옆의 필터 아이콘으로 하위 필터와 정렬을 바꿀 수 있어요.",
      ],
    ],
    [
      "어떤 기능을 쓸 수 있나요?",
      [
        "상태·담당자·우선순위·마감일을 바로 수정할 수 있어요. 제목·본문·댓글도 저장하면 Jira와 목록에 반영돼요.",
        "본문이나 댓글에 @이름을 입력하면 멘션할 사람을 찾을 수 있어요. 방향키와 Enter로 선택하고 Escape로 닫아 주세요.",
        "댓글에는 답글을 달거나, 내가 쓴 댓글을 편집할 수 있어요. 좋아요와 이모지 반응은 지원하지 않아요.",
        "선택 모드에서 여러 이슈를 체크하고 부모·상태·담당자·마감일을 일괄 변경해 보세요. 결과에서 성공한 항목을 되돌릴 수 있어요.",
        "이미지·표·링크와 변경 기록을 볼 수 있어요. 최근 변경은 약 1분마다 확인해 반영해요.",
        "필터·접힘 상태·화면 설정과 최근 본 이슈 5개는 이 브라우저에 기억해요. 설정에서 테마와 목록·완료 항목 표시 방식을 선택할 수 있어요.",
      ],
    ],
  ];
  for (const [title, tips] of sections) {
    const section = element("section", "help-section"),
      list = element("ul", "help-tips");
    for (const tip of tips) list.append(element("li", "", tip));
    section.append(element("h3", "", title), list);
    content.append(section);
  }
  return content;
}
