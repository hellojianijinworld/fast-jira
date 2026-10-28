import "../src/client/styles.css";
import type { AssistantApproval } from "../src/domain/assistant-approval.ts";
import { createAssistantApprovalPanel } from "../src/ui/assistant-approvals.ts";
import { element } from "../src/ui/dom.ts";

const results = document.querySelector("#results"),
  host = document.querySelector("#fixture");
if (!results || !host) throw new Error("fixture");
let pending: AssistantApproval[] = [
  {
    id: "one",
    title: "Slack 메시지 보내기",
    description: "내용을 확인한 후 이번 요청만 승인하세요.",
    details: "채널: test\n내용: 검증 메시지 (실제 전송 안 함)",
    fields: [
      {
        key: "target",
        label: "대상",
        type: "text",
        required: true,
        options: ["A", "B"],
      },
    ],
  },
];
const decisions: { approved: boolean; values: unknown }[] = [];
let waiting = false;
const panel = createAssistantApprovalPanel(
  {
    assistantApprovals: async () => pending,
    approveAssistant: async (_run, _id, approved, values) => {
      decisions.push({ approved, values });
      pending = [];
      return {};
    },
  },
  (value) => {
    waiting = value;
  },
);
host.append(panel.element);
const abort = new AbortController();
panel.start("0123456789abcdef0123456789abcdef", abort.signal);
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
function assert(value: unknown, message: string) {
  if (!value) throw new Error(message);
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
  "실행 전 대상·내용과 승인/거절을 표시하고 자동 승인하지 않는다",
  async () => {
    await tick();
    assert(waiting, "대기 상태");
    assert(decisions.length === 0, "자동 실행 금지");
    assert(panel.element.textContent?.includes("채널: test"), "대상 표시");
    assert(panel.element.querySelectorAll("button").length === 2, "선택 버튼");
  },
);
await check(
  "명시적 승인 클릭은 선택한 값만 전달하고 확인 카드를 제거한다",
  async () => {
    const select = panel.element.querySelector("select");
    assert(select, "select");
    if (select) select.value = "B";
    panel.element.querySelector("form")?.requestSubmit();
    await tick();
    assert(decisions.length === 1, "한 번 승인");
    assert(
      JSON.stringify(decisions[0]) ===
        JSON.stringify({ approved: true, values: { target: "B" } }),
      "정확한 값",
    );
    assert(!waiting && !panel.element.querySelector("form"), "승인 후 정리");
  },
);
await check("거절과 취소는 승인을 만들지 않고 UI를 정리한다", async () => {
  pending = [
    {
      id: "two",
      title: "Notion 문서 변경",
      description: "변경 내용 확인",
      details: "문서 A",
      fields: [],
    },
  ];
  panel.start("a".repeat(32), abort.signal);
  await tick();
  const deny = [...panel.element.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("거절"),
  );
  deny?.click();
  await tick();
  assert(decisions[1]?.approved === false, "거절");
  pending = [
    {
      id: "three",
      title: "파일 변경",
      description: "변경",
      details: "file.txt",
      fields: [],
    },
  ];
  panel.start("b".repeat(32), abort.signal);
  await tick();
  abort.abort();
  assert(!panel.element.childElementCount, "취소 정리");
  assert(decisions.length === 2, "취소 자동 승인 금지");
});
panel.destroy();
document.title = failures ? `실패 ${failures}개` : "검사 통과";
