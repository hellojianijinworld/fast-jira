import {
  type AdfDocument,
  commentDocument,
  decodeAdfDocument,
  textDocument,
} from "../domain/adf.ts";
import type {
  Comment,
  CommentPage,
  HistoryEntry,
  HistoryPage,
} from "../domain/content.ts";
import { parseIssueKey, record, requiredString } from "../domain/validation.ts";
import {
  ensureJiraResponse,
  type JiraClient,
  JiraError,
} from "./jira-client.ts";
import {
  arrayValue,
  avatarValue,
  decodeUsers,
  numberValue,
  optionalRecord,
  stringValue,
} from "./jira-decode.ts";
import type { createJiraMetadata } from "./jira-metadata.ts";

function writingDocument(read: () => AdfDocument): AdfDocument {
  try {
    return read();
  } catch (error) {
    throw new JiraError(
      error instanceof Error ? error.message : "작성 내용이 올바르지 않습니다.",
      400,
    );
  }
}
function countValue(value: unknown): number {
  const count = numberValue(value);
  if (!Number.isSafeInteger(count) || count < 0)
    throw new Error("페이지 위치가 올바르지 않습니다.");
  return count;
}
function commentId(id: string): string {
  if (!/^\d{1,30}$/.test(id))
    throw new JiraError("댓글 ID가 올바르지 않습니다.", 400);
  return id;
}
export function decodeComment(value: unknown): Comment {
  const comment = record(value),
    author = optionalRecord(comment.author);
  const parent = comment.parentId;
  if (
    parent != null &&
    typeof parent !== "string" &&
    (typeof parent !== "number" || !Number.isSafeInteger(parent))
  )
    throw new Error("부모 댓글 ID 형식이 올바르지 않습니다.");
  return {
    id: commentId(requiredString(comment.id, "댓글 ID")),
    parentId: parent == null ? "" : commentId(String(parent)),
    authorId: stringValue(author.accountId),
    author: stringValue(author.displayName),
    avatar: avatarValue(author.avatarUrls),
    created: requiredString(comment.created, "댓글 작성 시각"),
    updated: stringValue(comment.updated),
    body: decodeAdfDocument(comment.body),
  };
}
function decodeHistory(value: unknown): HistoryEntry {
  const entry = record(value),
    author = optionalRecord(entry.author);
  return {
    id: requiredString(entry.id, "변경 기록 ID"),
    author: stringValue(author.displayName, "알 수 없음"),
    avatar: avatarValue(author.avatarUrls),
    created: requiredString(entry.created, "변경 시각"),
    changes: arrayValue(entry.items).map((value) => {
      const change = record(value);
      return {
        field: requiredString(change.field, "변경 필드"),
        from: stringValue(change.fromString),
        to: stringValue(change.toString),
      };
    }),
  };
}
export function createJiraContent(
  client: JiraClient,
  metadata: ReturnType<typeof createJiraMetadata>,
) {
  const pathFor = (key: string) =>
    `/rest/api/3/issue/${parseIssueKey(key, "")}`;
  async function comments(key: string, startAt = 0): Promise<CommentPage> {
    if (!Number.isSafeInteger(startAt) || startAt < 0)
      throw new JiraError("댓글 시작 위치가 올바르지 않습니다.", 400);
    const params = new URLSearchParams({
      maxResults: "20",
      startAt: String(startAt),
      orderBy: "-created",
    });
    return client.json(`${pathFor(key)}/comment?${params}`, (value) => {
      const page = record(value);
      return {
        total: countValue(page.total),
        startAt: countValue(page.startAt),
        comments: arrayValue(page.comments).map(decodeComment),
      };
    });
  }
  async function history(
    key: string,
    before: number | null = null,
  ): Promise<HistoryPage> {
    if (before !== null && (!Number.isSafeInteger(before) || before < 0))
      throw new JiraError("기록 위치가 올바르지 않습니다.", 400);
    const path = `${pathFor(key)}/changelog`;
    // Jira는 오래된 기록부터 준다. 전체를 읽지 않고 마지막 20개 위치만 계산한다.
    const count =
      before ??
      (await client.json(`${path}?maxResults=1`, (value) =>
        countValue(record(value).total),
      ));
    const startAt = Math.max(0, count - 20);
    const params = new URLSearchParams({
      startAt: String(startAt),
      maxResults: String(Math.min(20, count)),
    });
    const entries = count
      ? await client.json(`${path}?${params}`, (value) =>
          arrayValue(record(value).values).map(decodeHistory),
        )
      : [];
    return { before: startAt || null, entries: entries.reverse() };
  }
  async function mentionUsers(key: string, query = "") {
    key = parseIssueKey(key, "");
    if (query.length > 100)
      throw new JiraError("검색어는 100자 이내로 입력하세요.", 400);
    const params = new URLSearchParams({
      issueKey: key,
      maxResults: query ? "50" : "1000",
    });
    if (query) params.set("query", query);
    return (
      await client.json(
        `/rest/api/3/user/${query ? "viewissue" : "assignable"}/search?${params}`,
        decodeUsers,
      )
    ).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }
  async function writeComment(
    path: string,
    method: "POST" | "PUT",
    body: AdfDocument,
    parentId?: string,
  ): Promise<Comment> {
    const response = await ensureJiraResponse(
      await client.request(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          ...(parentId === undefined ? {} : { parentId }),
        }),
      }),
    );
    const value: unknown = await response.json();
    return decodeComment(value);
  }
  async function addComment(
    key: string,
    input: { text?: string; document?: AdfDocument; parentId?: string },
  ) {
    if (input.parentId !== undefined) commentId(input.parentId);
    const body =
      input.document === undefined
        ? writingDocument(() => textDocument(input.text ?? ""))
        : writingDocument(() => commentDocument(input.document));
    // 원본 댓글 링크를 본문에 덧붙이지 않는다. Jira의 부모 연결을 보내 스레드로 저장한다.
    return writeComment(
      `${pathFor(key)}/comment`,
      "POST",
      body,
      input.parentId,
    );
  }
  async function editComment(key: string, id: string, document: AdfDocument) {
    const body = writingDocument(() => commentDocument(document));
    const path = `${pathFor(key)}/comment/${commentId(id)}`;
    const [existing, self] = await Promise.all([
      client.json(path, decodeComment),
      metadata.currentUser(),
    ]);
    if (existing.authorId !== self.accountId)
      throw new JiraError("내가 작성한 댓글만 편집할 수 있어요.", 403);
    return writeComment(path, "PUT", body);
  }
  async function updateDescription(key: string, document: AdfDocument) {
    const body = writingDocument(() => decodeAdfDocument(document));
    await ensureJiraResponse(
      await client.request(pathFor(key), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { description: body } }),
      }),
    );
    return { description: body };
  }
  return {
    comments,
    history,
    mentionUsers,
    addComment,
    editComment,
    updateDescription,
  };
}
