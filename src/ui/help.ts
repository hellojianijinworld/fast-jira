import { shortcutLabel } from "../domain/commands.ts";
import { element, externalLink, uiIcon } from "./dom.ts";

export function helpContent(): HTMLElement {
  const content = element("div", "help-content");
  const intro = element(
    "p",
    "help-intro",
    "Jira 작업을 한곳에서 살펴보고 빠르게 정리해요.",
  );
  const features = element("section", "help-section");
  features.append(element("h3", "", "이렇게 쓸 수 있어요"));
  const featureList = element("div", "help-features");
  for (const [icon, title, description] of [
    ["list-filter", "작업 살펴보기", "뷰와 필터로 필요한 이슈를 모아봐요."],
    ["check", "한 번에 변경하기", "여러 이슈를 선택해 함께 수정해요."],
    ["sparkles", "AI와 함께 정리하기", "질문하거나 작업 변경을 요청해요."],
  ] as const) {
    const item = element("div", "help-feature"),
      copy = element("div");
    const symbol = uiIcon(icon);
    symbol.classList.add("help-feature-icon");
    item.append(symbol, copy);
    copy.append(element("strong", "", title), element("p", "", description));
    featureList.append(item);
  }
  features.append(featureList);
  const privacy = element("section", "help-section help-privacy");
  privacy.append(element("h3", "", "내 정보는 이렇게 사용해요"));
  const tips = element("ul", "help-tips");
  for (const tip of [
    "Jira 연결 정보와 토큰은 이 컴퓨터에 저장해요.",
    "AI 대화 내용과 필요한 작업 정보는 선택한 AI 서비스에 전달돼요.",
    "AI가 Jira를 변경하기 전에는 내용을 확인받아요.",
    "대화와 화면 설정은 이 브라우저에 저장돼요. 브라우저 데이터를 지우면 함께 삭제될 수 있어요.",
  ])
    tips.append(element("li", "", tip));
  privacy.append(tips);
  const shortcuts = element("section", "help-section");
  shortcuts.append(element("h3", "", "단축키"));
  const list = element("dl", "help-shortcuts");
  for (const [name, keys] of [
    ["이슈 검색", shortcutLabel(navigator.platform)],
    ["AI 대화", shortcutLabel(navigator.platform, "ai")],
    ["명령 팔레트", shortcutLabel(navigator.platform, "palette")],
  ])
    list.append(element("dt", "", name), element("dd", "", keys));
  shortcuts.append(list);
  const links = element("footer", "help-links");
  const github = externalLink(
    "https://github.com/hellojianijinworld/fast-jira",
    "",
    "button-link outline",
  );
  github.append(uiIcon("external-link"), document.createTextNode("GitHub"));
  links.append(github);
  content.append(intro, features, privacy, shortcuts, links);
  return content;
}
