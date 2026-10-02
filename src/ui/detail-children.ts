import type { Api } from "../client/api.ts";
import type { LookupResult } from "../domain/details.ts";
import { element } from "./dom.ts";
import { type CardOptions, issueCard } from "./issue-card.ts";

/** 상세의 직접 하위 목록은 펼칠 때만 읽는다. 왼쪽 트리의 필터·커서와 섞지 않는다. */
export function detailChildren(
  result: LookupResult,
  api: Api,
  cards: CardOptions,
) {
  if (
    !result.children.length &&
    !(result.deferredChildren && result.parent.hasChildren)
  )
    return null;
  const root = element("details", "detail-children issue-list-container"),
    summary = element("summary"),
    list = element("div");
  root.append(summary, list);
  let alive = true,
    loaded = !result.deferredChildren,
    loading = false;
  function render(issues: LookupResult["children"]) {
    summary.textContent = `하위 이슈 ${issues.length}개`;
    list.replaceChildren(...issues.map((issue) => issueCard(issue, cards)));
  }
  if (loaded) render(result.children);
  else summary.textContent = "하위 이슈 보기";
  root.addEventListener("toggle", async () => {
    if (!root.open || loaded || loading) return;
    loading = true;
    summary.textContent = "하위 이슈 불러오는 중…";
    try {
      const issues = await api.directChildren(result.parent.key);
      if (!alive) return;
      render(issues);
      loaded = true;
    } catch {
      if (!alive) return;
      summary.textContent = "하위 이슈 다시 불러오기";
      root.open = false;
    } finally {
      loading = false;
    }
  });
  return {
    element: root,
    destroy() {
      alive = false;
    },
  };
}
