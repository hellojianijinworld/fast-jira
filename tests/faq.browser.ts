import "../src/client/styles.css";
import { createFaqDialog } from "../src/ui/faq.ts";

const host = document.querySelector<HTMLElement>("#fixture");
const results = document.querySelector("#results");
if (!host || !results) throw Error("fixture 누락");
const faq = createFaqDialog(host);
let failures = 0;
function assert(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
function check(name: string, work: () => void) {
  const row = document.createElement("li");
  try {
    work();
    row.textContent = `통과: ${name}`;
  } catch (error) {
    failures++;
    row.textContent = `실패: ${name}: ${error}`;
  }
  results?.append(row);
}
faq.open();
const dialog = host.querySelector<HTMLDialogElement>(".faq-dialog");
let search = host.querySelector<HTMLInputElement>("input");
if (!dialog || !search) throw Error("FAQ 누락");
function item(id: string) {
  const value = dialog?.querySelector<HTMLDetailsElement>(
    `[data-faq-id="${id}"]`,
  );
  if (!value) throw Error(`${id} 질문 누락`);
  return value;
}
check("여러 답변을 펼쳐도 검색·주제·질문 목록을 유지한다", () => {
  item("view").querySelector("summary")?.click();
  item("view-menu").querySelector("summary")?.click();
  assert(
    item("view").open && item("view-menu").open,
    "하나를 열 때 다른 답변이 닫힘",
  );
  assert(dialog.querySelector("input") === search, "화면 전환으로 검색창 교체");
  assert(
    item("view").querySelectorAll(".faq-answer ul li").length >= 2,
    "실제 불릿 목록 없음",
  );
  assert(!dialog.querySelector(".faq-back"), "뒤로 가기 화면 유지");
});
check("본문 검색과 검색 해제 후 개폐 상태 유지", () => {
  if (!search) throw Error("검색 입력 누락");
  search.value = "메모리";
  search.dispatchEvent(new Event("input"));
  assert(item("ai-history"), "구조화된 본문 검색 실패");
  if (!search) throw Error("검색 입력 누락");
  search.value = "";
  search.dispatchEvent(new Event("input"));
  assert(item("view").open && item("view-menu").open, "검색 후 펼친 답변 유실");
});
check("명령에서 연 질문도 목록 안에서 펼치고 포커스한다", () => {
  faq.open("ai-followup");
  search = dialog.querySelector<HTMLInputElement>("input");
  if (!search) throw Error("새 검색 입력 누락");
  assert(item("ai-followup").open, "지정한 질문을 펼치지 않음");
  assert(item("view"), "다른 질문 목록이 사라짐");
  assert(
    document.activeElement === item("ai-followup").querySelector("summary"),
    "해당 질문 포커스 누락",
  );
});
check("주제 변경과 검색을 함께 사용할 수 있다", () => {
  [...dialog.querySelectorAll<HTMLButtonElement>(".faq-topic")]
    .find((b) => b.textContent?.includes("AI 대화"))
    ?.click();
  assert(dialog.querySelectorAll(".faq-group").length === 1, "다른 주제 표시");
  if (!search) throw Error("검색 입력 누락");
  search.value = "추론";
  search.dispatchEvent(new Event("input"));
  assert(item("ai-model"), "선택 주제 검색 실패");
});
check("일치하지 않는 검색에도 입력창과 빈 결과 안내 유지", () => {
  if (!search) throw Error("검색 입력 누락");
  search.value = "없는질문abc123";
  search.dispatchEvent(new Event("input"));
  assert(!dialog.querySelector(".faq-item"), "빈 결과에 질문 표시");
  assert(
    dialog.textContent?.includes("일치하는 질문이 없어요"),
    "빈 결과 안내 없음",
  );
  assert(dialog.querySelector("input") === search, "검색 포커스 대상 교체");
});
check("큰 모달과 내부 스크롤·가로 넘침 방지", () => {
  faq.open();
  const rect = dialog.getBoundingClientRect();
  if (innerWidth >= 1280) assert(rect.width > 1000, "큰 모달 미적용");
  assert(
    rect.width <= innerWidth && rect.height <= innerHeight,
    "화면 밖으로 넘침",
  );
  const list = dialog.querySelector<HTMLElement>(".faq-results");
  assert(
    list && list.scrollHeight > list.clientHeight,
    "긴 질문 목록 스크롤 누락",
  );
  assert(dialog.scrollWidth <= dialog.clientWidth, "가로 넘침");
  assert(
    Math.abs(rect.right - list.getBoundingClientRect().right) <= 2,
    "FAQ 스크롤바가 모달 오른쪽 여백 안에 갇힘",
  );
  assert(
    Math.abs(rect.bottom - list.getBoundingClientRect().bottom) <= 2,
    "FAQ 스크롤바가 모달 아래쪽 여백 안에 갇힘",
  );
});
faq.close();
check("닫은 뒤 다시 열 수 있고 정리 시 모달을 제거한다", () => {
  assert(!dialog.open, "닫기 실패");
  faq.open("shortcuts");
  assert(
    dialog.querySelectorAll(".faq-shortcuts dd").length === 4,
    "OS별 단축키 누락",
  );
  faq.destroy();
  assert(!host.querySelector(".faq-dialog"), "모달 정리 누락");
});
document.body.dataset.result = failures ? "failed" : "passed";
