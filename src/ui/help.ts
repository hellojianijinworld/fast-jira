import { shortcutLabel } from "../domain/commands.ts";
import { feedbackUrl, PRODUCT_URL } from "../domain/product.ts";
import {
  actionButton,
  buttonLink,
  element,
  externalLink,
  uiIcon,
} from "./dom.ts";

const features = [
  {
    icon: "layers",
    title: "뷰로 모아보기",
    description: "프로젝트·필터·정렬을 뷰마다 따로 저장해요.",
  },
  {
    icon: "search",
    title: "이슈 검색",
    description: "제목이나 이슈 번호로 필요한 작업을 찾아요.",
  },
  {
    icon: "chevron-right",
    title: "상하위 작업 살펴보기",
    description: "하위 작업을 펼치고 경로를 따라 이동해요.",
  },
  {
    icon: "check",
    title: "여러 이슈 함께 변경",
    description: "상태·작업참여자·마감일 등을 한 번에 바꿔요.",
  },
  {
    icon: "plus",
    title: "이슈 만들기",
    description: "프로젝트에서 새 작업이나 하위 이슈를 만들어요.",
  },
  {
    icon: "star",
    title: "즐겨찾기",
    description: "자주 보는 작업을 오른쪽 맨 위에 모아둬요.",
  },
  {
    icon: "history",
    title: "변경 기록",
    description: "누가 무엇을 바꿨는지 이슈별로 확인해요.",
  },
  {
    icon: "sparkles",
    title: "AI 대화",
    description: "작업을 물어보고 변경 내용을 확인한 뒤 적용해요.",
  },
];

export function helpContent(
  options: { start?: () => void; faq?: (id?: string) => void } = {},
): HTMLElement {
  const content = element("div", "help-content");
  content.append(
    element(
      "p",
      "help-intro",
      "작업을 한곳에 모으고, 필요한 일부터 빠르게 정리해요.",
    ),
  );
  const grid = element("div", "help-overview");
  const section = element("section", "help-section");
  section.append(element("h3", "", "이렇게 쓸 수 있어요"));
  const featureList = element("div", "help-features");
  for (const feature of features) {
    const item = element("div", "help-feature");
    const copy = element("span");
    const icon = uiIcon(feature.icon);
    icon.classList.add("help-feature-icon");
    copy.append(
      element("strong", "", feature.title),
      element("span", "help-feature-description", feature.description),
    );
    item.append(icon, copy);
    featureList.append(item);
  }
  section.append(featureList);
  const privacy = element("section", "help-section help-privacy");
  privacy.append(element("h3", "", "내 정보는 어디에 있나요?"));
  for (const [title, description] of [
    ["이 컴퓨터", "Jira 연결 정보와 토큰을 저장해요."],
    ["이 브라우저", "뷰·화면 설정과 대화를 저장해요."],
    ["선택한 AI 서비스", "보낸 대화와 필요한 작업 정보가 전달돼요."],
  ]) {
    const fact = element("p");
    fact.append(
      element("strong", "", title),
      element("span", "help-fact-description", description),
    );
    privacy.append(fact);
  }
  const approval = element("p", "help-approval");
  const approvalIcon = uiIcon("check");
  approvalIcon.classList.add("help-approval-icon");
  approval.append(
    approvalIcon,
    document.createTextNode("AI 변경은 내용을 확인한 뒤 적용해요."),
  );
  privacy.append(approval);
  grid.append(section, privacy);
  content.append(grid);
  if (options.faq) {
    const row = element("div", "help-faq-entry");
    const text = element("div");
    text.append(
      element("strong", "", "궁금한 점이 있나요?"),
      element("p", "muted", "사용 방법이 궁금하면 FAQ에서 질문을 찾아보세요."),
    );
    const search = actionButton("FAQ 검색", "search", { purpose: "utility" });
    search.addEventListener("click", () => options.faq?.());
    row.append(text, search);
    content.append(row);
  }
  const shortcuts = element("section", "help-section");
  shortcuts.append(element("h3", "", "단축키"));
  const keys = element("dl", "faq-shortcuts");
  for (const [label, command] of [
    ["이슈 검색", "search"],
    ["AI 대화", "ai"],
    ["명령 팔레트", "palette"],
  ] as const)
    keys.append(
      element("dt", "", label),
      element("dd", "", shortcutLabel(navigator.platform, command)),
    );
  shortcuts.append(keys);
  content.append(shortcuts);
  const links = element("footer", "help-links");
  if (options.start) {
    const start = actionButton("시작 안내 다시 보기", "circle-help", {
      purpose: "utility",
    });
    start.addEventListener("click", options.start);
    links.append(start);
  }
  const github = buttonLink(PRODUCT_URL, "GitHub", "github");
  links.append(github, externalLink(feedbackUrl("bug"), "버그 제보"));
  content.append(links);
  return content;
}
