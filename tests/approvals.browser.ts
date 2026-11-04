import "../src/client/styles.css";
import type { VoiceCallbacks } from "../src/client/codex-voice.ts";
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
  waiting = false,
  rejectNext = false;
let speech: VoiceCallbacks | undefined;
let recording = false;
const answers: { id: string; approved: boolean; values: unknown }[] = [];
const panel = createAssistantApprovalPanel(
  {
    assistantApprovals: async () => pending,
    approveAssistant: async (_run, id, approved, values) => {
      if (rejectNext) {
        rejectNext = false;
        throw new Error("모의 전송 실패");
      }
      answers.push({ id, approved, values });
      pending = pending.filter((item) => item.id !== id);
      return {};
    },
  },
  (value) => {
    waiting = value;
  },
  undefined,
  {
    voice: (callbacks) => {
      speech = callbacks;
      const stop = () => {
        recording = false;
        callbacks.state(false, "");
      };
      return {
        start() {
          recording = !recording;
          callbacks.state(recording, "");
        },
        stop,
        destroy: stop,
      };
    },
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
      panel.element.querySelector(".assistant-approval-details")
        ?.textContent === question("one").details &&
        !panel.element.querySelector("details"),
      "변경 내용이 접혀 있거나 누락됨",
    );
    assert(
      panel.element.querySelectorAll("input[type=radio]").length === 2,
      "객관식 선택지",
    );
  },
);
await check("진행을 고르면 실행 승인하고 다음 질문을 표시한다", async () => {
  assert(
    panel.element.querySelector<HTMLTextAreaElement>("textarea")
      ?.placeholder === "다른 의견을 입력하세요",
    "의견 입력을 바로 제공하지 않음",
  );
  choose("allow");
  await tick();
  assert(answers[0]?.approved === true, "진행");
  assert(panel.element.textContent?.includes("요청 two"), "다음 질문");
});
await check("다른 의견은 실행 승인 없이 모델에 전달한다", async () => {
  assert(answers.length === 1, "의견 입력 전에 자동 전송됨");
  const note = panel.element.querySelector("textarea");
  assert(note && note.offsetHeight > 0, "의견 입력");
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
  await tick();
  assert(answers[2]?.approved === false, "건너뛰기");
  pending = [question("four")];
  panel.start("c".repeat(32), abort.signal);
  await tick();
  abort.abort();
  assert(!panel.element.childElementCount, "취소 정리");
  assert(answers.length === 3, "취소 자동 승인 금지");
});
await check(
  "즉시 전송 실패는 다시 보내기를 표시하고 자동 재승인하지 않는다",
  async () => {
    pending = [question("retry")];
    const signal = new AbortController();
    panel.start("d".repeat(32), signal.signal);
    await tick();
    rejectNext = true;
    choose("allow");
    await tick();
    assert(answers.length === 3, "실패한 승인을 자동 재전송함");
    assert(
      !panel.element.querySelector<HTMLElement>(".assistant-approval-actions")
        ?.hidden,
      "실패 후 재전송 경로가 없음",
    );
    submit();
    await tick();
    assert(
      answers.length === 4 && answers[3]?.id === "retry",
      "명시적 재전송 실패",
    );
    signal.abort();
  },
);
await check(
  "추가 필수 입력이 있는 확인은 내용을 입력한 후 전송한다",
  async () => {
    pending = [
      {
        ...question("required"),
        fields: [
          { key: "target", label: "대상", type: "text", required: true },
        ],
      },
    ];
    const signal = new AbortController();
    panel.start("e".repeat(32), signal.signal);
    await tick();
    choose("allow");
    await tick();
    assert(answers.length === 4, "필수 값 없이 승인됨");
    const target = panel.element.querySelector<HTMLInputElement>(
      '[aria-label="대상"]',
    );
    if (!target) throw Error("대상 입력 누락");
    target.value = "검사 대상";
    target.dispatchEvent(new Event("input", { bubbles: true }));
    assert(answers.length === 4, "입력 도중 전송됨");
    submit();
    await tick();
    assert(answers.length === 5, "필수 입력 확인 전송 실패");
    signal.abort();
  },
);
await check(
  "선택형 질문은 선택지를 바로 전송하고 값이 원래 필드에 연결된다",
  async () => {
    pending = [
      {
        ...question("options"),
        title: "어느 상위에 만들까요?",
        description: "",
        details: "",
        fields: [
          {
            key: "parent",
            label: "어느 상위에 만들까요?",
            type: "text",
            required: true,
            options: ["상위 A", "상위 B"],
          },
        ],
      },
    ];
    const signal = new AbortController();
    panel.start("f".repeat(32), signal.signal);
    await tick();
    assert(
      !panel.element.querySelector("select"),
      "선택형 질문에 셀렉트가 남음",
    );
    choose("option-1");
    await tick();
    assert(
      JSON.stringify(answers.at(-1)?.values) ===
        JSON.stringify({ parent: "상위 B" }),
      "선택값의 실제 필드 연결 실패",
    );
    signal.abort();
  },
);
await check(
  "음성은 의견란에만 입력하고 중지·명시 전송 전에는 승인하지 않는다",
  async () => {
    pending = [question("voice")];
    const signal = new AbortController();
    panel.start("1".repeat(32), signal.signal);
    await tick();
    const before = answers.length;
    const mic = panel.element.querySelector<HTMLButtonElement>(
      '[aria-label="의견 음성 입력"]',
    );
    assert(mic && !mic.hidden, "의견 마이크 누락");
    mic?.click();
    speech?.transcript("이 작업은 내일 진행해 주세요");
    await tick();
    assert(
      recording && answers.length === before,
      "음성이 답변을 자동 전송했다",
    );
    assert(
      panel.element.querySelector("textarea")?.value ===
        "이 작업은 내일 진행해 주세요",
      "의견 전사 누락",
    );
    assert(
      panel.element.querySelector<HTMLButtonElement>('[type="submit"]')
        ?.disabled,
      "녹음 중 전송 가능",
    );
    mic?.click();
    submit();
    await tick();
    assert(
      answers.at(-1)?.approved === false &&
        JSON.stringify(answers.at(-1)?.values).includes("내일 진행"),
      "음성 의견을 승인으로 처리함",
    );
    signal.abort();
  },
);
await check(
  "자유 답변 질문은 중복 입력 없이 답변을 전달하고 취소하면 마이크를 정리한다",
  async () => {
    pending = [
      {
        ...question("text"),
        title: "어떤 제목으로 만들까요?",
        description: "",
        details: "",
        fields: [
          {
            key: "summary",
            label: "어떤 제목으로 만들까요?",
            type: "text",
            required: true,
          },
        ],
      },
    ];
    const signal = new AbortController();
    panel.start("2".repeat(32), signal.signal);
    await tick();
    assert(
      panel.element.querySelectorAll("textarea").length === 1 &&
        !panel.element.querySelector('input[type="radio"]'),
      "자유 질문의 중복 폼",
    );
    const note = panel.element.querySelector("textarea");
    if (note) {
      note.value = "새 제목";
      note.dispatchEvent(new Event("input", { bubbles: true }));
    }
    submit();
    await tick();
    assert(
      answers.at(-1)?.approved === true &&
        JSON.stringify(answers.at(-1)?.values) ===
          JSON.stringify({ summary: "새 제목" }),
      "자유 답변 전달 실패",
    );
    pending = [question("cancel-voice")];
    panel.start("3".repeat(32), signal.signal);
    await tick();
    panel.element
      .querySelector<HTMLButtonElement>('[aria-label="의견 음성 입력"]')
      ?.click();
    assert(recording, "녹음 시작 실패");
    const late = speech;
    signal.abort();
    assert(!recording, "취소 후 마이크 유지");
    late?.transcript("늦은 전사");
    assert(!panel.element.childElementCount, "취소 후 음성으로 폼 복원됨");
  },
);
panel.destroy();
document.title = failures ? `실패 ${failures}개` : "검사 통과";

if (new URLSearchParams(location.search).has("preview")) {
  pending = [
    {
      ...question("preview"),
      title:
        "CLIPO-833의 상태를 ‘개발 대기중’에서 ‘개발 진행 중’으로 바꿀까요?",
      description: "",
      details: "",
    },
  ];
  host.append(panel.element);
  panel.start("4".repeat(32), new AbortController().signal);
}
