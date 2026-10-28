import "../src/client/styles.css";
import type { AssistantApproval } from "../src/domain/assistant-approval.ts";
import { createAssistantApprovalPanel } from "../src/ui/assistant-approvals.ts";
import { element } from "../src/ui/dom.ts";

const host = document.querySelector("#fixture"),
  results = document.querySelector("#results");
if (!host || !results) throw Error("fixture");
const question = (id: string): AssistantApproval => ({
  id,
  title: "이 작업을 진행할까요?",
  description: `요청 ${id}의 내용을 변경하려고 합니다.`,
  details: "대상과 변경할 내용을 확인하세요.",
  fields: [
    { key: "feedback", label: "기타 의견", type: "text", required: false },
  ],
});
let pending = [question("one"), question("two")],
  waiting = false;
const answers: { id: string; approved: boolean; values: unknown }[] = [];
const panel = createAssistantApprovalPanel(
  {
    assistantApprovals: async () => pending,
    approveAssistant: async (_run, id, approved, values) => {
      answers.push({ id, approved, values });
      pending = pending.filter((item) => item.id !== id);
      return {};
    },
  },
  (value) => {
    waiting = value;
  },
);
host.append(panel.element);
const abort = new AbortController();
panel.start("a".repeat(32), abort.signal);
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
function assert(value: unknown, message: string) {
  if (!value) throw Error(message);
}
function choose(value: string) {
  const input = panel.element.querySelector<HTMLInputElement>(
    `input[value=${value}]`,
  );
  assert(input, "선택지");
  if (input) {
    input.checked = true;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
function submit() {
  panel.element.querySelector("form")?.requestSubmit();
}
let failures = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results?.append(element("li", "", `통과: ${name}`));
  } catch (error) {
    failures++;
    results?.append(element("li", "error", `${name}: ${String(error)}`));
  }
}
await check(
  "질문은 하나씩 표시하고 선택 전에는 답변을 전송하지 않는다",
  async () => {
    await tick();
    assert(panel.element.querySelectorAll("form").length === 1, "하나의 질문");
    assert(
      panel.element
        .querySelector("button[type=submit]")
        ?.hasAttribute("disabled"),
      "선택 전 비활성",
    );
    assert(answers.length === 0 && waiting, "자동 승인 금지");
    assert(
      panel.element.querySelectorAll("input[type=radio]").length === 3,
      "객관식 선택지",
    );
  },
);
await check("진행을 고르면 실행 승인하고 다음 질문을 표시한다", async () => {
  choose("allow");
  submit();
  await tick();
  assert(answers[0]?.approved === true, "진행");
  assert(panel.element.textContent?.includes("요청 two"), "다음 질문");
});
await check("다른 의견은 실행 승인 없이 모델에 전달한다", async () => {
  choose("other");
  const note = panel.element.querySelector("textarea");
  assert(note && !note.closest("label")?.hidden, "의견 입력");
  if (note) {
    note.value = "이 내용은 다시 제안해주세요";
    note.dispatchEvent(new Event("input", { bubbles: true }));
  }
  submit();
  await tick();
  assert(answers[1]?.approved === false, "의견은 승인 아님");
  assert(
    JSON.stringify(answers[1]?.values) ===
      JSON.stringify({ feedback: "이 내용은 다시 제안해주세요" }),
    "의견 전달",
  );
  assert(!waiting, "질문 완료");
});
await check("건너뛰기와 요청 취소는 실행하지 않는다", async () => {
  pending = [question("three")];
  panel.start("b".repeat(32), abort.signal);
  await tick();
  choose("deny");
  submit();
  await tick();
  assert(answers[2]?.approved === false, "건너뛰기");
  pending = [question("four")];
  panel.start("c".repeat(32), abort.signal);
  await tick();
  abort.abort();
  assert(!panel.element.childElementCount, "취소 정리");
  assert(answers.length === 3, "취소 자동 승인 금지");
});
panel.destroy();
document.title = failures ? `실패 ${failures}개` : "검사 통과";
