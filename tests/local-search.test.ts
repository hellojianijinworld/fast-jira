import assert from "node:assert/strict";
import { test } from "node:test";
import { localSearch } from "../src/domain/local-search.ts";
import { emptyIssue } from "../src/domain/wire.ts";

const issue = (key: string, summary: string, updated = "") => ({
  ...emptyIssue(key, summary),
  project: key.split("-")[0] ?? "",
  updated,
});
test("일치도가 즐겨찾기보다 먼저이며 프로젝트 밖 결과와 중복을 제외한다", () => {
  const exact = issue("AA-1", "세특 평가");
  const all = issue("AA-2", "신규 세특 평가 오류");
  const partial = issue("AA-3", "세특 설정");
  const other = issue("BB-1", "세특 평가");
  const result = localSearch(
    [partial, all, exact, other, exact],
    " 세특 평가 ",
    ["AA"],
    (item) => item.key === partial.key,
    [partial],
  );
  assert.deepEqual(
    result.map((item) => item.key),
    ["AA-1", "AA-2", "AA-3"],
  );
  assert.deepEqual(
    localSearch([exact], "없는 단어", ["AA"], () => false, []),
    [],
  );
  assert.deepEqual(
    localSearch([exact], " ", ["AA"], () => false, []),
    [],
  );
});
test("같은 일치도에서는 즐겨찾기·최근 방문 순서·최근 수정순으로 정렬한다", () => {
  const items = [
    issue("AA-1", "공통 제목", "2026-01-01"),
    issue("AA-2", "공통 제목", "2026-01-02"),
    issue("AA-3", "공통 제목"),
    issue("AA-4", "공통 제목"),
    issue("AA-5", "공통 제목"),
  ];
  assert.deepEqual(
    localSearch(
      items,
      "공통",
      ["AA"],
      (item) => item.key === "AA-3",
      items.slice(3).reverse(),
    ).map((item) => item.key),
    ["AA-3", "AA-5", "AA-4", "AA-2", "AA-1"],
  );
});
test("이슈 번호는 대소문자와 무관하게 완전 일치를 먼저, 후보는 8개까지 보여준다", () => {
  const items = Array.from({ length: 12 }, (_, index) =>
    issue(`AA-${index + 1}`, "AA-8 작업"),
  );
  const result = localSearch(
    items,
    "aa-8",
    ["AA"],
    (item) => item.key === "AA-1",
    [],
  );
  assert.equal(result[0]?.key, "AA-8");
  assert.equal(result.length, 8);
});
