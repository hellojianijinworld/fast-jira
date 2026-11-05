import assert from "node:assert/strict";
import { test } from "node:test";
import type { Api } from "../src/client/api.ts";
import { createChatQueue } from "../src/client/chat-queue.ts";
import { createMentionSource } from "../src/client/mention-source.ts";
import {
  mentionLabel,
  mentionPrompt,
  moveMentions,
  type TextMention,
} from "../src/domain/mention.ts";
import { validSort } from "../src/domain/sort.ts";
import { emptyIssue } from "../src/domain/wire.ts";

const reference: TextMention = {
  start: 0,
  end: 4,
  target: { kind: "user", id: "account-1", label: "김하나" },
};
test("멘션 앞 편집은 위치를 이동하고 멘션 자체를 고치면 참조를 해제한다", () => {
  const moved = moveMentions("@김하나 작업", "오늘 @김하나 작업", [reference]);
  assert.equal(moved[0]?.start, 3);
  assert.match(mentionPrompt("오늘 @김하나 작업", moved), /account-1/);
  assert.deepEqual(moveMentions("@김하나 작업", "@김둘 작업", [reference]), []);
  assert.equal(mentionPrompt("@김하나 작업"), "@김하나 작업");
  assert.equal(mentionPrompt("@다른이 작업", [reference]), "@다른이 작업");
});
test("대기열은 선택한 참조의 스냅샷을 보존하고 같은 이름도 계정 ID로 구분한다", () => {
  const queue = createChatQueue();
  const refs: [TextMention] = [structuredClone(reference)];
  queue.add("chat", "@김하나 작업", refs);
  refs[0].target.id = "changed";
  const next = queue.take("chat");
  assert.ok(next);
  assert.match(mentionPrompt(next.text, next.mentions), /account-1/);
  assert.doesNotMatch(mentionPrompt(next.text, next.mentions), /changed/);
});
test("같은 프로젝트 사용자 조회를 공유하고 이슈·사람 중 한쪽 실패는 다른 결과를 보존한다", async () => {
  let calls = 0;
  const source = createMentionSource(
    {
      users: async () => {
        calls++;
        return [{ id: "u", name: "사용자", avatar: "" }];
      },
      issues: async () => {
        throw new Error("조회 실패");
      },
    },
    {
      site: "example.atlassian.net",
      projects: () => ["AA"],
      local: () => [{ ...emptyIssue("AA-1"), id: "123", summary: "작업" }],
    },
  );
  const results = await Promise.all([source(""), source("사용")]);
  assert.equal(calls, 1);
  assert.equal(results[0]?.[0]?.id, "123");
  assert.equal(results[1]?.[0]?.kind, "user");
});

test("이슈 멘션은 짧은 제목을 함께 표시하고 긴 제목·줄바꿈·이모지를 안전하게 축약한다", () => {
  const issue = {
    kind: "issue" as const,
    id: "123",
    key: "AA-1",
    label: "짧은 제목",
  };
  assert.equal(mentionLabel(issue), "@AA-1 · 짧은 제목");
  assert.equal(
    mentionLabel({ ...issue, label: "  제목\n미리보기  " }),
    "@AA-1 · 제목 미리보기",
  );
  assert.equal(
    mentionLabel({ ...issue, label: "🦓".repeat(20) }),
    `@AA-1 · ${"🦓".repeat(18)}…`,
  );
  const label = mentionLabel(issue);
  assert.match(
    mentionPrompt(label, [{ start: 0, end: label.length, target: issue }]),
    /"id":"123"/,
  );
});

test("멘션은 뷰 밖 로컬 후보를 먼저 표시하고 전역 조회 결과를 중복 없이 합친다", async () => {
  const local = {
    ...emptyIssue("BB-866", "이메일 변경"),
    id: "866",
    project: "BB",
  };
  let release:
    | ((value: Awaited<ReturnType<Api["issues"]>>) => void)
    | undefined;
  const snapshots: string[][] = [];
  const source = createMentionSource(
    {
      users: async () => [],
      issues: async (filters) => {
        assert.deepEqual(filters.projects, []);
        assert.equal(filters.scope, "all");
        assert.equal(filters.excludeDone, false);
        assert(
          validSort(filters.sort),
          "멘션이 서버에서 지원하지 않는 정렬값을 보냄",
        );
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    },
    {
      site: "example.atlassian.net",
      projects: () => ["AA"],
      local: () => [local],
    },
  );
  const pending = source("866", (items) =>
    snapshots.push(items.map((item) => item.key ?? "")),
  );
  assert.deepEqual(snapshots[0], ["BB-866"]);
  release?.({
    issues: [local, { ...local, key: "CC-866", id: "other" }],
    nextPageToken: null,
    ancestors: [],
  });
  assert.deepEqual(
    (await pending)
      .filter((item) => item.kind === "issue")
      .map((item) => item.key),
    ["BB-866", "CC-866"],
  );
});
