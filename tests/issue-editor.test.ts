import assert from "node:assert/strict";
import { test } from "node:test";
import { createApi } from "../src/client/api.ts";
import { createIssueEditor } from "../src/client/issue-editor.ts";
import type { IssueDetails } from "../src/domain/details.ts";
import { emptyIssue } from "../src/domain/wire.ts";

const initial: IssueDetails = {
  ...emptyIssue("TEST-1", "원래 제목"),
  status: "대기",
  statusId: "1",
  assigneeId: "my-account",
  assignee: "나",
  priorityId: "2",
  priority: "보통",
  reporter: "작성자",
  reporterAvatar: "",
  created: "2026-10-01T00:00:00Z",
  url: "https://example.atlassian.net/browse/TEST-1",
  description: {
    type: "doc",
    version: 1,
    content: [
      { type: "paragraph", content: [{ type: "text", text: "보존할 본문" }] },
    ],
  },
  attachments: [
    {
      id: "1",
      name: "image.png",
      mimeType: "image/png",
      size: 10,
      url: "https://example.atlassian.net/image",
    },
  ],
};

test("필드 저장은 본문·첨부를 보존하며 알림의 되돌리기가 이전 값을 복원한다", async () => {
  const writes: unknown[] = [],
    changed: IssueDetails[] = [];
  let undo: (() => Promise<void>) | undefined;
  const api = createApi(async (_path, init) => {
    assert.equal(init?.method, "POST");
    assert.equal(typeof init.body, "string");
    const body: unknown = JSON.parse(String(init.body));
    writes.push(body);
    const value = writes.length === 1 ? "새 제목" : "원래 제목";
    return Response.json({
      ...initial,
      summary: value,
      description: null,
      attachments: [],
    });
  });
  const editor = createIssueEditor(api, initial, {
    state: () => {},
    changed: (issue) => {
      changed.push(issue);
    },
    notice: (_text, action) => {
      undo = action;
    },
  });
  assert.equal(await editor.change("summary", "새 제목"), true);
  assert.equal(editor.issue.summary, "새 제목");
  assert.equal(
    editor.issue.description?.content[0]?.content?.[0]?.text,
    "보존할 본문",
  );
  assert.equal(editor.issue.attachments.length, 1);
  assert.equal(changed[0]?.summary, "새 제목");
  assert.deepEqual(writes[0], {
    key: "TEST-1",
    field: "summary",
    value: "새 제목",
  });
  assert(undo);
  await undo();
  assert.equal(editor.issue.summary, "원래 제목");
  assert.deepEqual(writes[1], {
    key: "TEST-1",
    field: "summary",
    value: "원래 제목",
  });
});
test("저장 중 같은 값·중복 액션은 요청하지 않고 실패 시 값과 busy 상태를 복구한다", async () => {
  let resolve: (value: Response) => void = () => {};
  const waiting = new Promise<Response>((done) => {
    resolve = done;
  });
  let requests = 0,
    notices = 0;
  const api = createApi(async () => {
    requests++;
    return waiting;
  });
  const editor = createIssueEditor(api, initial, {
    state: () => {},
    changed: () => {},
    notice: () => {
      notices++;
    },
  });
  assert.equal(await editor.change("summary", "원래 제목"), true);
  assert.equal(requests, 0);
  const change = editor.change("status", "진행 중");
  assert.equal(editor.busy, "status");
  assert.equal(await editor.change("summary", "겹친 변경"), false);
  assert.equal(requests, 1);
  resolve(Response.json({ error: "권한 없음" }, { status: 403 }));
  assert.equal(await change, false);
  assert.equal(editor.busy, null);
  assert.equal(editor.issue.status, "대기");
  assert.equal(notices, 1);
});
test("저장 뒤 화면 갱신 실패는 저장 실패로 되돌리지 않으며 되돌리기도 유지한다", async () => {
  const notices: { text: string; undo: (() => Promise<void>) | undefined }[] =
    [];
  const editor = createIssueEditor(
    createApi(async () =>
      Response.json({
        ...initial,
        summary: "저장된 제목",
        description: null,
        attachments: [],
      }),
    ),
    initial,
    {
      state: () => {},
      changed: () => {
        throw new Error("목록 조회 실패");
      },
      notice: (text, undo) => {
        notices.push({ text, undo });
      },
    },
  );
  assert.equal(await editor.change("summary", "저장된 제목"), true);
  assert.equal(editor.issue.summary, "저장된 제목");
  assert(notices.at(-1)?.undo);
  assert(notices.at(-1)?.text.includes("변경은 완료"));
});
test("나중에 같은 필드를 바꿨다면 이전 알림의 되돌리기는 덮어쓰지 않는다", async () => {
  const undos: (() => Promise<void>)[] = [];
  let calls = 0;
  const editor = createIssueEditor(
    createApi(async () => {
      calls++;
      return Response.json({
        ...initial,
        summary: calls === 1 ? "첫 변경" : "나중 변경",
        description: null,
        attachments: [],
      });
    }),
    initial,
    {
      state: () => {},
      changed: () => {},
      notice: (_text, undo) => {
        if (undo) undos.push(undo);
      },
    },
  );
  await editor.change("summary", "첫 변경");
  await editor.change("summary", "나중 변경");
  const undo = undos[0];
  assert(undo);
  await assert.rejects(undo(), /이후 변경/);
  assert.equal(calls, 2);
});

test("댓글·본문 저장 뒤 늦은 필드 응답이 새 내용을 덮어쓰지 않는다", async () => {
  let respond: ((response: Response) => void) | undefined;
  const api = createApi(
    async () =>
      new Promise<Response>((resolve) => {
        respond = resolve;
      }),
  );
  const editor = createIssueEditor(api, initial, {
    state() {},
    changed() {},
    notice() {},
  });
  const saving = editor.change("summary", "변경 제목");
  const description = {
    type: "doc",
    version: 1,
    content: [
      { type: "paragraph", content: [{ type: "text", text: "새 본문" }] },
    ],
  } as const;
  editor.mergeContent({
    commentCount: 5,
    description: {
      ...description,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "새 본문" }] },
      ],
    },
  });
  if (!respond) throw new Error("요청 시작 누락");
  respond(
    Response.json({
      ...initial,
      summary: "변경 제목",
      description: null,
      attachments: [],
    }),
  );
  await saving;
  assert.equal(editor.issue.commentCount, 5);
  assert.equal(
    editor.issue.description?.content[0]?.content?.[0]?.text,
    "새 본문",
  );
});
