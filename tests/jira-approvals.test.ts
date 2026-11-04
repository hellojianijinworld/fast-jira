import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyIssue } from "../src/domain/wire.ts";
import { callApprovedJiraTool } from "../src/server/jira-approvals.ts";
import type { ToolService } from "../src/server/mcp-server.ts";

async function execute(...args: Parameters<typeof callApprovedJiraTool>) {
  return (await callApprovedJiraTool(...args)) as {
    results: { status: string }[];
    feedback: string;
    changedKeys: string[];
  };
}
function fixture() {
  const writes: { name: string; args: unknown }[] = [];
  const tools: ToolService = {
    definitions: [
      "jira_apply_changes",
      "jira_create_issue",
      "jira_description",
      "jira_edit_issue",
      "jira_update_issues",
      "jira_comment",
    ].map((name) => ({
      name,
      description: "",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    })),
    call: async (name, args) => {
      writes.push({ name, args });
      return { key: "AA-99" };
    },
  };
  return { tools, writes };
}
test("작업마다 순서대로 묻고 진행한 작업만 고정된 원본으로 실행한다", async () => {
  const f = fixture();
  let asked = 0;
  const fields = { summary: "새 작업" };
  const input = {
    actions: [
      {
        tool: "jira_create_issue",
        arguments: { project: "AA", type: "2", fields },
      },
      {
        tool: "jira_edit_issue",
        arguments: { key: "AA-1", field: "summary", value: "새 제목" },
      },
      {
        tool: "jira_description",
        arguments: {
          key: "AA-1",
          document: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "새 본문" }],
              },
            ],
          },
        },
      },
    ],
  };
  const result = await execute(
    f.tools,
    "jira_apply_changes",
    input,
    async (request) => {
      asked++;
      assert.ok(request.title.endsWith("까요?"));
      assert.equal(request.fields.length, 1);
      fields.summary = "변경된 원본";
      return { approved: asked !== 2, values: {} };
    },
  );
  assert.equal(asked, 3);
  assert.deepEqual(
    f.writes.map((item) => item.name),
    ["jira_create_issue", "jira_description"],
  );
  const first = f.writes[0];
  assert(first);
  assert.equal(
    (first.args as { fields: { summary: string } }).fields.summary,
    "새 작업",
  );
  assert.deepEqual(
    result.results.map((item) => item.status),
    ["applied", "notApproved", "applied"],
  );
});
test("기타 의견은 실행 승인이 아니며 남은 작업도 실행하지 않고 모델에 돌려준다", async () => {
  const f = fixture();
  let asked = 0;
  const result = await execute(
    f.tools,
    "jira_apply_changes",
    {
      actions: [
        {
          tool: "jira_create_issue",
          arguments: {
            project: "AA",
            type: "2",
            fields: { summary: "새 작업" },
          },
        },
        {
          tool: "jira_edit_issue",
          arguments: { key: "AA-1", field: "summary", value: "제목" },
        },
      ],
    },
    async () => {
      asked++;
      return {
        approved: false,
        values: { feedback: "생성이 아니라 기존 이슈를 수정해주세요" },
      };
    },
  );
  assert.equal(asked, 1);
  assert.equal(f.writes.length, 0);
  assert.equal(result.feedback, "생성이 아니라 기존 이슈를 수정해주세요");
  assert.deepEqual(
    result.results.map((item) => item.status),
    ["notApproved", "notApproved"],
  );
});
test("일괄 작업은 이슈별로 쪼개지 않고 한 번 묻고 부분 실패를 구분한다", async () => {
  const f = fixture();
  let asked = 0;
  f.tools.call = async (name, args) => {
    f.writes.push({ name, args });
    return {
      issues: [{ key: "AA-1" }],
      failures: [{ key: "AA-2", error: "권한 없음" }],
    };
  };
  const result = await execute(
    f.tools,
    "jira_update_issues",
    { keys: ["AA-1", "AA-2"], field: "status", value: "Done" },
    async () => {
      asked++;
      return { approved: true, values: {} };
    },
  );
  assert.equal(asked, 1);
  assert.equal(f.writes.length, 1);
  assert.equal(result.results[0]?.status, "partiallyApplied");
  assert.deepEqual(result.changedKeys, ["AA-1"]);
});
test("잘못된 도구·재귀 묶음·초과 요청은 확인 전에 차단한다", async () => {
  const f = fixture();
  let asked = false;
  const ask = async () => {
    asked = true;
    return { approved: true, values: {} };
  };
  for (const actions of [
    [],
    [{ tool: "jira_apply_changes", arguments: {} }],
    [{ tool: "unknown", arguments: {} }],
    Array.from({ length: 51 }, () => ({
      tool: "jira_edit_issue",
      arguments: {},
    })),
  ])
    await assert.rejects(
      execute(f.tools, "jira_apply_changes", { actions }, ask),
    );
  assert.equal(asked, false);
  assert.equal(f.writes.length, 0);
});

test("짧은 필드 변경은 실제 대상과 전후 값을 질문 한 문장으로 보여준다", async () => {
  const f = fixture();
  await execute(
    f.tools,
    "jira_edit_issue",
    {
      key: "AA-833",
      field: "status",
      value: "개발 진행 중",
      expected: "개발 대기중",
    },
    async (question) => {
      assert.equal(
        question.title,
        "AA-833의 상태를 ‘개발 대기중’에서 ‘개발 진행 중’으로 바꿀까요?",
      );
      assert.equal(question.description, "");
      assert.match(question.details, /미확인/);
      return { approved: false, values: {} };
    },
  );
  assert.equal(f.writes.length, 0);
});
test("긴 변경값은 생략하지 않고 질문 아래에 원문을 유지한다", async () => {
  const f = fixture();
  const value = "긴 제목 ".repeat(40);
  await execute(
    f.tools,
    "jira_edit_issue",
    { key: "AA-1", field: "summary", value },
    async (question) => {
      assert.equal(question.title, "AA-1의 제목을 바꿀까요?");
      assert.ok(question.details.includes(value));
      return { approved: false, values: {} };
    },
  );
});

test("댓글 편집 질문은 생성으로 안내하지 않고 원문을 보존한다", async () => {
  const f = fixture();
  await execute(
    f.tools,
    "jira_comment",
    { key: "AA-1", action: "edit", id: "comment-1", text: "수정할 댓글" },
    async (question) => {
      assert.equal(question.title, "AA-1의 댓글을 수정할까요?");
      assert.ok(question.details.includes("수정할 댓글"));
      return { approved: false, values: {} };
    },
  );
  assert.equal(f.writes.length, 0);
});

test("서버에서 조회한 제목·현재 상태와 AI 제안 이유·근거를 승인 전에 보여준다", async () => {
  const f = fixture();
  Object.assign(f.tools, {
    approvalIssues: async () => [
      {
        ...emptyIssue("AA-848"),
        summary: "역량 추출·근거·기록을 1회 호출로 통합",
        status: "백로그",
      },
    ],
  });
  await execute(
    f.tools,
    "jira_edit_issue",
    {
      key: "AA-848",
      field: "status",
      value: "개발 진행 중",
      reason: "관련 구현을 확인했어요",
      evidence: "커밋 abc123에서 테스트 코드를 확인. 테스트 실행은 미확인.",
    },
    async (request) => {
      assert.match(request.title, /역량 추출/);
      assert.match(request.title, /AA-848/);
      assert.match(request.title, /백로그/);
      assert.match(request.details, /변경 이유/);
      assert.match(request.details, /관련 구현/);
      assert.match(request.details, /AI가 제시한 근거/);
      assert.match(request.details, /테스트 실행은 미확인/);
      return { approved: false, values: {} };
    },
  );
  assert.equal(f.writes.length, 0);
});
test("이슈 조회 실패·누락·빈 제목은 불완전한 승인 질문으로 대체하지 않는다", async () => {
  for (const data of [
    [],
    [{ ...emptyIssue("AA-1"), summary: "", status: "백로그" }],
  ]) {
    const f = fixture();
    Object.assign(f.tools, { approvalIssues: async () => data });
    await assert.rejects(
      execute(
        f.tools,
        "jira_edit_issue",
        { key: "AA-1", field: "status", value: "진행" },
        async () => {
          assert.fail("승인을 물으면 안 됨");
        },
      ),
      /확인/,
    );
    assert.equal(f.writes.length, 0);
  }
});
test("승인 대기 중 상태가 바뀌면 이전 승인으로 덮어쓰지 않는다", async () => {
  const f = fixture();
  let state = "백로그";
  Object.assign(f.tools, {
    approvalIssues: async () => [
      { ...emptyIssue("AA-1"), summary: "서버의 작업 제목", status: state },
    ],
  });
  const result = await execute(
    f.tools,
    "jira_edit_issue",
    { key: "AA-1", field: "status", value: "진행" },
    async () => {
      state = "완료";
      return { approved: true, values: {} };
    },
  );
  assert.equal(f.writes.length, 0);
  assert.equal(result.results[0]?.status, "failed");
});
test("일괄 승인도 모든 대상의 제목·현재 상태를 묶음 조회하고 미제공 근거를 표시한다", async () => {
  const f = fixture();
  const calls: string[][] = [];
  Object.assign(f.tools, {
    approvalIssues: async (keys: string[]) => {
      calls.push([...keys]);
      return keys.map((key) => ({
        ...emptyIssue(key),
        summary: `작업 ${key}`,
        status: "대기",
      }));
    },
  });
  await execute(
    f.tools,
    "jira_update_issues",
    {
      keys: ["AA-1", "AA-2"],
      field: "status",
      value: "진행",
      expected: "잘못된 AI 상태",
    },
    async (request) => {
      assert(!request.title.includes("잘못된 AI 상태"));
      assert.match(request.details, /작업 AA-1/);
      assert.match(request.details, /작업 AA-2/);
      assert.match(request.details, /대기/);
      assert.match(request.details, /미확인/);
      return { approved: false, values: {} };
    },
  );
  assert.deepEqual(calls, [["AA-1", "AA-2"]]);
});

test("같은 이슈의 앞선 승인 작업으로 바뀐 제목은 다음 질문에 반영하고 외부 변경과 혼동하지 않는다", async () => {
  const f = fixture();
  const issue = { ...emptyIssue("AA-1"), summary: "이전 제목", status: "대기" };
  Object.assign(f.tools, { approvalIssues: async () => [issue] });
  f.tools.call = async (name, args) => {
    f.writes.push({ name, args });
    issue.summary = "새 제목";
    return { key: "AA-1" };
  };
  let asked = 0;
  const result = await execute(
    f.tools,
    "jira_apply_changes",
    {
      actions: [
        {
          tool: "jira_edit_issue",
          arguments: { key: "AA-1", field: "summary", value: "새 제목" },
        },
        {
          tool: "jira_edit_issue",
          arguments: { key: "AA-1", field: "status", value: "진행" },
        },
      ],
    },
    async (request) => {
      asked++;
      assert.match(request.title, asked === 1 ? /이전 제목/ : /새 제목/);
      return { approved: true, values: {} };
    },
  );
  assert.deepEqual(
    result.results.map((x) => x.status),
    ["applied", "applied"],
  );
});

test("Jira 조회 오류는 승인과 쓰기 전에 반환한다", async () => {
  const f = fixture();
  Object.assign(f.tools, {
    approvalIssues: async () => {
      throw new Error("Jira 조회 실패");
    },
  });
  await assert.rejects(
    execute(
      f.tools,
      "jira_edit_issue",
      { key: "AA-1", field: "status", value: "진행" },
      async () => {
        assert.fail("조회 실패 시 승인 금지");
      },
    ),
    /조회 실패/,
  );
  assert.equal(f.writes.length, 0);
});
