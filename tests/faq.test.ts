import assert from "node:assert/strict";
import { test } from "node:test";
import { matchingCommands } from "../src/domain/commands.ts";
import { faqEntries, faqTopics, matchingFaq } from "../src/domain/faq.ts";

test("FAQ는 질문·역할 별칭과 본문을 함께 검색한다", () => {
  assert(matchingFaq("작업참여자").some((entry) => entry.id === "people"));
  assert(matchingFaq("프론트 디자이너").some((entry) => entry.id === "people"));
  assert(matchingFaq("토큰 저장").some((entry) => entry.id === "privacy"));
  assert.equal(matchingFaq("   ").length, faqEntries.length);
  assert.equal(matchingFaq("없는질문123").length, 0);
});
test("FAQ는 AI 연결 없이 명령에서 열 수 있고 질문 ID가 고유하다", () => {
  assert.deepEqual(
    matchingCommands("faq", false).map((entry) => entry.id),
    ["faq"],
  );
  assert.equal(
    new Set(faqEntries.map((entry) => entry.id)).size,
    faqEntries.length,
  );
});

test("주제에는 여러 질문을 두고 검색은 선택한 주제 범위를 지킨다", () => {
  assert(faqTopics.some((topic) => topic.questions.length > 1));
  assert.equal(
    new Set(faqTopics.map((topic) => topic.id)).size,
    faqTopics.length,
  );
  for (const topic of faqTopics) {
    assert(topic.title && topic.questions.length);
    assert.deepEqual(
      matchingFaq("", topic.id).map((entry) => entry.id),
      topic.questions.map((entry) => entry.id),
    );
    assert(
      matchingFaq("저장", topic.id).every(
        (entry) => entry.topicId === topic.id,
      ),
    );
  }
  assert.equal(matchingFaq("", "missing-topic").length, 0);
});

test("추가된 기능의 답변 본문도 구조화된 목록에서 검색한다", () => {
  for (const [query, id] of [
    ["대기열 메모리", "ai-history"],
    ["인라인 본문", "history"],
    ["우선순위 정렬", "search-sort"],
    ["다른 컴퓨터", "favorite"],
  ])
    assert(matchingFaq(query ?? "").some((entry) => entry.id === id));
  for (const entry of faqEntries) {
    assert(entry.question && entry.answer.length > 0);
    for (const section of entry.answer) {
      assert(section.title && section.items.length > 0);
      assert(
        section.items.every((item) => typeof item === "string" && item.trim()),
      );
    }
  }
});
