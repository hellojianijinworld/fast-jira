import { shortcutLabel } from "../domain/commands.ts";
import { element } from "./dom.ts";

export function helpContent(): DocumentFragment {
  const content = document.createDocumentFragment();
  const sections: [string, string[]][] = [
    [
      "Fast Jira 소개",
      [
        "Jira 이슈를 한곳에서 살펴보고, 하위 작업과 변경 내용을 빠르게 확인할 수 있어요.",
        "뷰마다 프로젝트와 필터를 설정하고, 여러 이슈를 한 번에 변경할 수 있어요.",
        "AI 대화로 작업을 살펴보거나 변경을 요청할 수 있어요. 변경 요청은 내용을 확인한 뒤 승인해 주세요.",
      ],
    ],
    [
      "내 정보와 연결",
      [
        "Jira 연결 정보와 API 토큰은 이 컴퓨터에 저장해요. 토큰을 AI 대화에 입력할 필요는 없어요.",
        "이슈를 조회하거나 변경할 때 Jira와 통신해요. AI 대화에 입력한 내용과 필요한 맥락은 선택한 AI 서비스에 전달돼요.",
        "대화와 화면 설정은 이 브라우저에 저장돼요. 브라우저 데이터를 지우면 함께 삭제될 수 있어요.",
        "앱은 이 컴퓨터에서 실행돼요. 다른 사람이 이 컴퓨터나 계정에 접근할 수 있다면 저장된 정보도 보호해 주세요.",
      ],
    ],
    [
      "단축키",
      [
        `${shortcutLabel(navigator.platform)}: 이슈 검색`,
        `${shortcutLabel(navigator.platform, "ai")}: AI 대화`,
        `${shortcutLabel(navigator.platform, "palette")}: 명령 팔레트`,
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
