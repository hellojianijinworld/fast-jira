import { APP_VERSION, feedbackKinds, feedbackUrl } from "../domain/product.ts";
import { element, externalLink, uiIcon } from "./dom.ts";

export function feedbackContent(): HTMLElement {
  const root = element("section", "feedback-content");
  root.append(
    element(
      "p",
      "",
      "사용 중 불편했던 점이나 아이디어를 알려주세요. GitHub에서 내용을 확인한 뒤 보내요.",
    ),
  );
  const options = element("div", "feedback-options");
  for (const kind of feedbackKinds) {
    const link = externalLink(feedbackUrl(kind.id), "", "feedback-option");
    const copy = element("span");
    copy.append(
      element("strong", "", kind.label),
      element("small", "", kind.description),
    );
    link.append(uiIcon(kind.icon), copy, uiIcon("external-link"));
    options.append(link);
  }
  root.append(
    options,
    element(
      "small",
      "setting-help",
      `Fast Jira ${APP_VERSION} · 제품 버전만 문의 양식에 넣어요. 토큰, 회사의 이슈 내용이나 대화·원본 로그는 올리지 마세요.`,
    ),
  );
  return root;
}
