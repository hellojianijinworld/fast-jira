import type { Issue } from "../domain/issue.ts";
import { issueKeyCopy } from "./clipboard.ts";
import { element, uiIcon } from "./dom.ts";
import {
  dueTime,
  issueTypeIcon,
  personPill,
  priorityPill,
  statusPill,
} from "./meta.ts";

export interface CardOptions {
  selectedKey?: string;
  context?: string;
  statusOrder: readonly string[];
  onSelect: (key: string) => void;
  now?: Date;
  site?: string;
  copied?: (message: string) => void;
  metaAction?: HTMLButtonElement;
}
/** 목록·최근 본 이슈·상세 하위 목록은 동일한 카드와 배지 순서를 사용한다. */
export function issueCard(issue: Issue, options: CardOptions): HTMLElement {
  const root = element("div", "issue-card");
  const link = element("div", "list-item");
  const title = element("a", "list-title", issue.summary);
  title.href = `?issue=${encodeURIComponent(issue.key)}`;
  if (options.context) link.classList.add("context");
  if (issue.key === options.selectedKey)
    link.setAttribute("aria-current", "true");
  const identity = element("span", "issue-identity");
  if (issue.issueType) identity.append(issueTypeIcon(issue));
  identity.append(
    issueKeyCopy(
      issue.key,
      options.site ? `https://${options.site}/browse/${issue.key}` : null,
      options.copied,
    ),
  );
  const meta = element("span", "list-meta");
  if (options.metaAction) meta.append(options.metaAction);
  if (issue.commentCount > 0) {
    const comments = element("span", "comment-pill");
    comments.setAttribute("aria-label", `댓글 ${issue.commentCount}개`);
    comments.title = `댓글 ${issue.commentCount}개`;
    comments.append(
      uiIcon("message-circle"),
      element("span", "", String(issue.commentCount)),
    );
    meta.append(comments);
  }
  if (options.context && options.context !== "상위") {
    const label = element("span", "context-label", options.context);
    label.title = "검색 결과와 연결된 이슈";
    meta.append(label);
  }
  // 기본 우선순위는 프로젝트·유형 메타정보로 판단한다. 조회에 실패하면 배지를 숨기지 않는다.
  if (
    issue.priority &&
    (!issue.defaultPriorityId || issue.priorityId !== issue.defaultPriorityId)
  )
    meta.append(priorityPill(issue));
  if (issue.dueDate) meta.append(dueTime(issue.dueDate, options.now));
  if (issue.assignee)
    meta.append(
      personPill({ name: issue.assignee, avatar: issue.assigneeAvatar }),
    );
  if (issue.status) meta.append(statusPill(issue.status, options.statusOrder));
  link.append(identity, title, meta);
  root.append(link);
  root.addEventListener("click", (event) => {
    if (
      event.button ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    options.onSelect(issue.key);
  });
  return root;
}
