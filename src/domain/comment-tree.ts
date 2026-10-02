import type { Comment } from "./content.ts";

export interface CommentThread {
  comment: Comment;
  replies: CommentThread[];
}
/** 페이지를 넘나드는 부모 관계의 판단을 화면 렌더링과 분리한다. */
export function commentThreads(comments: readonly Comment[]): CommentThread[] {
  const nodes = new Map<string, CommentThread>();
  for (const comment of comments)
    nodes.set(comment.id, { comment, replies: [] });
  const roots: CommentThread[] = [];
  for (const node of nodes.values()) {
    const parent = nodes.get(node.comment.parentId);
    const seen = new Set([node.comment.id]);
    let ancestor = parent;
    // ponytail: 읽은 댓글의 조상만 순회한다(O(n²)). 큰 스레드는 메모된 부모 판정으로 바꾼다.
    while (ancestor && !seen.has(ancestor.comment.id)) {
      seen.add(ancestor.comment.id);
      ancestor = nodes.get(ancestor.comment.parentId);
    }
    // 부모가 없거나 순환하면 독립 댓글로 둔다. 이후 페이지에서 부모가 오면 다시 묶는다.
    if (parent && !ancestor) parent.replies.push(node);
    else roots.push(node);
  }
  const time = (node: CommentThread) => Date.parse(node.comment.created) || 0;
  roots.sort((a, b) => time(b) - time(a));
  for (const node of nodes.values())
    node.replies.sort((a, b) => time(a) - time(b));
  return roots;
}
