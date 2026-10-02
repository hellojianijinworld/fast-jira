import type { Api } from "../client/api.ts";
import {
  type AdfDocument,
  type AdfNode,
  commentDocument,
} from "../domain/adf.ts";
import { type CommentThread, commentThreads } from "../domain/comment-tree.ts";
import type { Comment } from "../domain/content.ts";
import type { IssueDetails } from "../domain/details.ts";
import { renderADF } from "./adf-render.ts";
import { copyText } from "./clipboard.ts";
import { documentForm } from "./document-form.ts";
import { actionButton, element, iconButton, safeHref } from "./dom.ts";
import { avatar, relativeTime } from "./meta.ts";

/** 댓글은 페이지 단위로 읽는다. 목록 카드마다 추가 요청하지 않는다. */
export function issueComments(
  api: Api,
  issue: IssueDetails,
  imageEnabled: boolean,
  notice: (message: string) => void,
  accountId: string,
  onCount: (count: number) => Promise<void>,
  hold: () => () => void,
) {
  const root = element("section", "comments");
  const head = element("div", "comments-head"),
    title = element("h3", "", `댓글 ${issue.commentCount}개`);
  const support = element(
    "small",
    "comment-support-note",
    "좋아요·이모지 반응은 아직 지원하지 않아요.",
  );
  support.hidden = !issue.commentCount;
  head.append(title, support);
  const add = actionButton("댓글 추가", "message-circle");
  const writingHost = element("div");
  const entries = element("div"),
    message = element("p", "empty"),
    more = actionButton("댓글 더 보기", "chevron-right");
  root.append(head, add, writingHost, entries, message, more);
  const comments = new Map<string, Comment>();
  let startAt = 0,
    loading = false,
    alive = true,
    total = issue.commentCount;
  let writing: ReturnType<typeof documentForm> | null = null;
  let release: (() => void) | null = null;
  function renderEntries() {
    entries.replaceChildren(
      ...commentThreads([...comments.values()]).map((thread) => row(thread)),
    );
  }
  function closeWriting() {
    writing?.destroy();
    writing = null;
    add.disabled = false;
    more.disabled = loading;
    if (alive) renderEntries();
    release?.();
    release = null;
  }
  const hasReplyText = (nodes: readonly AdfNode[]): boolean =>
    nodes.some(
      (node) =>
        (node.type === "text" && Boolean(node.text?.trim())) ||
        hasReplyText(node.content ?? []),
    );
  function compose(
    comment?: Comment,
    reply = false,
    host: HTMLElement = writingHost,
  ) {
    if (writing) return;
    const initial: AdfDocument | null = reply
      ? {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: comment?.authorId
                ? [
                    {
                      type: "mention",
                      attrs: {
                        id: comment.authorId,
                        text: `@${comment.author}`,
                      },
                    },
                    { type: "text", text: " " },
                  ]
                : [],
            },
          ],
        }
      : (comment?.body ?? null);
    const parentId = reply ? comment?.parentId || comment?.id : undefined;
    release = hold();
    writing = documentForm({
      initial,
      issue,
      imageEnabled,
      api,
      label: reply ? "답글 내용" : comment ? "댓글 편집" : "새 댓글",
      submitLabel: reply ? "답글 등록" : comment ? "저장" : "댓글 저장",
      close: closeWriting,
      validate(document) {
        const validated = commentDocument(document);
        if (reply && !hasReplyText(validated.content))
          throw new Error("답글을 입력하세요.");
        return validated;
      },
      async save(document) {
        const saved =
          comment && !reply
            ? await api.editComment(issue.key, comment.id, document)
            : await api.addComment(issue.key, document, parentId);
        comments.set(saved.id, saved);
        if (!comment || reply) total++;
        if (alive) {
          title.textContent = `댓글 ${total}개`;
          support.hidden = !total;
          renderEntries();
        }
        notice(
          reply && saved.parentId !== parentId
            ? "댓글은 등록됐지만 답글 연결을 확인하지 못했어요. Jira에서 확인해 주세요."
            : `${reply ? "답글 등록됨" : comment ? "댓글 변경됨" : "댓글 추가됨"} · ${issue.key}`,
        );
        // 저장 성공 후 목록 갱신 실패를 댓글 저장 실패로 되돌리지 않는다.
        void onCount(total).catch(() =>
          notice("댓글은 저장됐지만 목록을 갱신하지 못했어요."),
        );
      },
    });
    const currentBody = host.querySelector<HTMLElement>(
      ":scope > .comment-body",
    );
    if (currentBody) currentBody.hidden = true;
    add.disabled = more.disabled = true;
    host.append(writing.element);
    writing.focus();
  }
  add.addEventListener("click", () => compose());
  function commentLink(id: string) {
    const href = safeHref(issue.url);
    if (!href) return "";
    const url = new URL(href);
    url.searchParams.set("focusedCommentId", id);
    url.hash = `comment-${id}`;
    return url.href;
  }
  function row(thread: CommentThread, nested = false): HTMLElement {
    const comment = thread.comment,
      entry = element("article", nested ? "comment comment-reply" : "comment");
    entry.id = `comment-${comment.id}`;
    const author = element("div", "comment-head");
    author.append(
      avatar({ name: comment.author, avatar: comment.avatar }),
      element("strong", "", comment.author),
      relativeTime(comment.created),
    );
    const body = element("div", "adf comment-body");
    body.append(renderADF(comment.body, issue, imageEnabled));
    const toolbar = element("div", "comment-toolbar"),
      copy = iconButton("댓글 링크 복사", "link");
    copy.disabled = !commentLink(comment.id);
    copy.addEventListener("click", async () => {
      await copyText(
        commentLink(comment.id),
        notice,
        "댓글 링크를 복사했어요.",
        "댓글 링크를 복사하지 못했어요.",
      );
    });
    const reply = iconButton("답글 작성", "reply");
    reply.addEventListener("click", () => compose(comment, true, entry));
    toolbar.append(reply, copy);
    if (accountId && comment.authorId === accountId) {
      const edit = iconButton("내 댓글 편집", "square-pen");
      edit.addEventListener("click", () => compose(comment, false, entry));
      toolbar.append(edit);
    }
    entry.append(author, body, toolbar);
    if (!nested && comment.parentId) {
      const parent = element("a", "comment-parent-link", "원댓글 보기");
      const href = commentLink(comment.parentId);
      if (href) {
        parent.href = href;
        parent.target = "_blank";
        parent.rel = "noopener noreferrer";
        entry.append(parent);
      }
    }
    if (thread.replies.length) {
      const replies = element("div", "comment-replies");
      replies.append(...thread.replies.map((reply) => row(reply, true)));
      entry.append(replies);
    }
    return entry;
  }
  async function load() {
    if (loading || !alive || writing) return;
    loading = true;
    more.disabled = true;
    message.textContent = "댓글을 불러오는 중…";
    try {
      const page = await api.comments(issue.key, startAt);
      if (!alive) return;
      for (const comment of page.comments) comments.set(comment.id, comment);
      total = page.total;
      title.textContent = `댓글 ${total}개`;
      support.hidden = !page.total;
      startAt = page.startAt + page.comments.length;
      renderEntries();
      // 빈 페이지라면 종료한다. 잘못된 total 때문에 같은 위치를 계속 조회하지 않는다.
      more.hidden = !page.comments.length || startAt >= page.total;
      message.textContent = "";
    } catch (reason) {
      if (!alive) return;
      message.textContent =
        reason instanceof Error ? reason.message : "댓글을 불러오지 못했어요.";
      more.hidden = false;
    } finally {
      loading = false;
      more.disabled = false;
    }
  }
  more.hidden = !issue.commentCount;
  more.addEventListener("click", () => {
    void load();
  });
  if (issue.commentCount) void load();
  return {
    element: root,
    destroy() {
      alive = false;
      writing?.destroy();
    },
  };
}
