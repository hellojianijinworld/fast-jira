import packageInfo from "../../package.json" with { type: "json" };

export const APP_VERSION = packageInfo.version;
export const PRODUCT_REPOSITORY = "hellojianijinworld/fast-jira";
export const PRODUCT_URL = `https://github.com/${PRODUCT_REPOSITORY}`;
export const feedbackKinds = [
  {
    id: "bug",
    label: "버그 제보",
    description: "예상과 다르게 동작했어요.",
    icon: "circle-help",
  },
  {
    id: "feature",
    label: "개선·기능 제안",
    description: "이렇게 바뀌면 더 편할 것 같아요.",
    icon: "plus",
  },
  {
    id: "question",
    label: "설치·사용 문의",
    description: "설치나 사용 중 도움이 필요해요.",
    icon: "message-circle",
  },
] as const;
export type FeedbackKind = (typeof feedbackKinds)[number]["id"];

/** 공개 문의에는 제품 버전만 넣고 계정·Jira·대화 정보는 첨부하지 않는다. */
export function feedbackUrl(kind: FeedbackKind): string {
  const url = new URL(`${PRODUCT_URL}/issues/new`);
  url.searchParams.set("template", `${kind}.yml`);
  url.searchParams.set("version", APP_VERSION);
  return url.href;
}
