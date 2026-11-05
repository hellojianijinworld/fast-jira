import "../src/client/styles.css";
import {
  type MentionTarget,
  mentionLabel,
  mentionPrompt,
} from "../src/domain/mention.ts";
import { adfEditor } from "../src/ui/adf-editor.ts";
import { renderADF } from "../src/ui/adf-render.ts";
import { chatMessage } from "../src/ui/chat-message.ts";
import { element } from "../src/ui/dom.ts";
import {
  adfMentionEditor,
  textareaMentions,
} from "../src/ui/mention-editors.ts";
import { mentionPicker } from "../src/ui/mention-picker.ts";
import { mentionToken } from "../src/ui/mention-token.ts";

const fixture = document.querySelector("#fixture"),
  results = document.querySelector("#results");
if (!fixture || !results) throw new Error("fixture 누락");
const targets: [MentionTarget, MentionTarget] = [
  {
    kind: "issue",
    id: "123",
    key: "DEMO-833",
    label: "공통 작성란 개선",
    url: "https://example.atlassian.net/browse/DEMO-833",
  },
  { kind: "user", id: "account-1", label: "김하나" },
];
const load = async (q: string) =>
  targets.filter((t) =>
    `${t.key ?? ""} ${t.label}`.toLowerCase().includes(q.toLowerCase()),
  );
const input = element("textarea");
input.setAttribute("aria-label", "AI 대화 모의 작성란");
const mentions = textareaMentions(input, load);
const rich = adfEditor(
  null,
  { key: "DEMO-1", url: "https://example.atlassian.net" },
  false,
);
rich.element.setAttribute("aria-label", "댓글·본문 모의 작성란");
const picker = mentionPicker(adfMentionEditor(rich), load);
fixture.append(
  element("h2", "", "AI 대화"),
  mentions.element,
  element("h2", "", "댓글·본문"),
  rich.element,
  picker.element,
);
const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
let failures = 0;
async function check(name: string, run: () => void | Promise<void>) {
  try {
    await run();
    results?.append(element("li", "", `통과: ${name}`));
  } catch (e) {
    failures++;
    results?.append(element("li", "error", `${name}: ${e}`));
  }
}
await check(
  "텍스트 멘션은 ID를 전송하고 편집·대기열 복원에서도 유지한다",
  () => {
    input.value = "  @김";
    input.setSelectionRange(4, 4);
    const context = mentions.mentionQuery();
    if (!context) throw new Error("멘션 범위 누락");
    mentions.insertMention(targets[1], context.range);
    const text = input.value.trim(),
      refs = mentions.references(text);
    assert(
      mentionPrompt(text, refs).includes("account-1"),
      "공백 제거 후 ID 누락",
    );
    mentions.restore(text, refs);
    assert(mentions.references()[0]?.target.id === "account-1", "복원 ID 누락");
    input.value = "@김둘";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    assert(!mentions.references().length, "편집한 멘션 유지됨");
  },
);
await check(
  "Enter는 멘션만 선택하고 작성란의 전송 동작을 실행하지 않는다",
  async () => {
    input.value = "@DEMO";
    input.focus();
    input.setSelectionRange(5, 5);
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 350));
    let sent = false;
    const send = () => {
      sent = true;
    };
    input.addEventListener("keydown", send);
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    input.removeEventListener("keydown", send);
    assert(input.value === `${mentionLabel(targets[0])} `, "이슈 선택 실패");
    assert(!sent, "선택하면서 전송됨");
    assert(mentions.references()[0]?.target.id === "123", "이슈 ID 누락");
  },
);
await check("리치 작성란은 사람을 ADF 멘션으로, 이슈를 링크로 저장한다", () => {
  rich.element.focus();
  const p = rich.element.querySelector("p");
  if (!p) throw new Error("문단 누락");
  p.textContent = "@이슈";
  let range = document.createRange();
  range.selectNodeContents(p);
  rich.insertIssueMention(targets[0], range);
  p.append(document.createTextNode("@사람"));
  range = document.createRange();
  if (!p.lastChild) throw new Error("텍스트 누락");
  range.selectNodeContents(p.lastChild);
  rich.insertMention({ id: "account-1", name: "김하나" }, range);
  const rendered = element("div");
  rendered.append(
    renderADF(rich.document(), {
      key: "DEMO-1",
      url: "https://example.atlassian.net/browse/DEMO-1",
    }),
  );
  assert(
    rendered.querySelector("a.mention-issue"),
    "저장 후 이슈 멘션 배지 누락",
  );
  assert(rendered.querySelector("span.mention"), "저장 후 사람 멘션 배지 누락");
  const saved = JSON.stringify(rich.document());
  assert(saved.includes('"type":"mention"'), "ADF 사람 멘션 누락");
  assert(saved.includes("account-1"), "계정 누락");
  assert(saved.includes("/browse/DEMO-833"), "이슈 링크 누락");
});
await check(
  "후보가 줄어도 작성란 위쪽 정렬을 유지하고 유형 배지를 표시한다",
  async () => {
    const style = fixture.getAttribute("style");
    fixture.setAttribute(
      "style",
      "position:fixed;left:24px;right:24px;bottom:24px",
    );
    async function query(value: string) {
      input.value = value;
      input.focus();
      input.setSelectionRange(value.length, value.length);
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 350));
      const panel = document.getElementById(
        input.getAttribute("aria-controls") ?? "",
      );
      if (!panel?.matches(":popover-open")) throw new Error("멘션 후보 누락");
      return panel;
    }
    try {
      const many = await query("@");
      const initial = many.getBoundingClientRect();
      assert(
        many.querySelectorAll(".mention-kind").length === 2,
        "유형 배지 누락",
      );
      const single = (await query("@DEMO")).getBoundingClientRect();
      assert(
        Math.abs(initial.bottom - single.bottom) < 1,
        "후보 수에 따라 앵커 위치 이동",
      );
      assert(
        single.bottom < input.getBoundingClientRect().top,
        "메뉴가 작성란 아래로 이동",
      );
    } finally {
      if (style) fixture.setAttribute("style", style);
      else fixture.removeAttribute("style");
    }
  },
);
await check(
  "완성한 멘션은 유형별 마크업을 가지며 초안 복원에도 유지한다",
  () => {
    const issueLabel = mentionLabel(targets[0]);
    const text = `${issueLabel} 작업을 @김하나에게 부탁해요`;
    mentions.restore(text, [
      { start: 0, end: issueLabel.length, target: targets[0] },
      {
        start: issueLabel.length + 5,
        end: issueLabel.length + 9,
        target: targets[1],
      },
    ]);
    const tokens = mentions.element.querySelectorAll("mark.mention-token");
    assert(tokens.length === 2, "완성 멘션 배지 누락");
    assert(tokens[0]?.getAttribute("data-kind") === "issue", "이슈 타입 누락");
    assert(tokens[1]?.getAttribute("data-kind") === "user", "사람 타입 누락");
    const mirror =
      mentions.element.querySelector<HTMLElement>(".mention-mirror");
    assert(
      mirror?.getAttribute("aria-hidden") === "true",
      "보조 마크업을 중복 낭독",
    );
    assert(input.value === text, "표시를 위해 원문이 변경됨");
    assert(
      Math.abs(
        mentions.element.getBoundingClientRect().height -
          input.getBoundingClientRect().height,
      ) < 1,
      "빈 멘션 안내가 작성란 높이를 차지함",
    );
  },
);
await check(
  "긴 작성란을 스크롤해도 멘션 표시와 입력 글자가 같은 위치를 유지한다",
  async () => {
    const previousStyle = input.getAttribute("style");
    const prefix = "긴 작성 내용을 여러 줄로 확인해요.\n".repeat(30);
    const label = mentionLabel(targets[0]);
    mentions.restore(`${prefix}${label}`, [
      {
        start: prefix.length,
        end: prefix.length + label.length,
        target: targets[0],
      },
    ]);
    input.style.height = "64px";
    await new Promise(requestAnimationFrame);
    input.scrollTop = input.scrollHeight;
    input.dispatchEvent(new Event("scroll"));
    const mirror =
      mentions.element.querySelector<HTMLElement>(".mention-mirror");
    assert(input.scrollTop > 0, "스크롤 검사 영역 누락");
    assert(
      mirror?.scrollTop === input.scrollTop,
      "멘션 배경이 입력 스크롤을 따라가지 않음",
    );
    if (previousStyle) input.setAttribute("style", previousStyle);
    else input.removeAttribute("style");
  },
);
await check(
  "멘션은 로컬 후보를 먼저 표시한 채 전체 검색 중 상태를 보여주고 원격 후보를 합친다",
  async () => {
    const field = element("textarea");
    let finish: ((items: MentionTarget[]) => void) | undefined;
    const progressive = textareaMentions(field, async (_query, publish) => {
      publish?.([targets[0]]);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    fixture.append(progressive.element);
    try {
      field.focus();
      field.value = "@833";
      field.setSelectionRange(4, 4);
      field.dispatchEvent(new InputEvent("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      const panel =
        progressive.element.querySelector<HTMLElement>(".inline-mention");
      assert(
        panel?.matches(":popover-open"),
        "원격 조회 중 로컬 후보 팝오버가 열리지 않음",
      );
      assert(panel?.textContent?.includes("DEMO-833"), "로컬 후보 누락");
      assert(
        panel?.textContent?.includes("현재 뷰 밖"),
        "전체 검색 중 안내 누락",
      );
      finish?.(targets);
      await new Promise(requestAnimationFrame);
      assert(panel?.textContent?.includes("김하나"), "원격 후보 누락");
      assert(
        panel?.querySelector<HTMLElement>(".mention-search-status")?.hidden,
        "완료 후 검색 중 안내 잔존",
      );
    } finally {
      progressive.destroy();
      field.remove();
    }
  },
);
await check(
  "전송된 이슈 멘션은 상세를 열고 사람 멘션은 링크로 만들지 않는다",
  () => {
    const label = mentionLabel(targets[0]);
    let selected = "";
    const row = chatMessage(
      "user",
      `${label} 확인`,
      "",
      {
        site: "example.atlassian.net",
        select: (key) => {
          selected = key;
        },
      },
      "",
      [{ start: 0, end: label.length, target: targets[0] }],
    );
    const link = row.querySelector<HTMLAnchorElement>("a.chat-mention");
    assert(link, "전송된 이슈 멘션 링크 누락");
    link?.click();
    assert(selected === "DEMO-833", "멘션 클릭 시 상세 이동 누락");
    assert(
      link?.getAttribute("href") === "?issue=DEMO-833",
      "내부 이슈 링크 누락",
    );
    const user = chatMessage("user", "@김하나", "", undefined, "", [
      { start: 0, end: 4, target: targets[1] },
    ]);
    assert(!user.querySelector("a"), "사람 멘션을 링크로 만들었음");
  },
);
await check(
  "작성란 멘션은 실제 클릭 영역이며 이동해도 원문과 참조를 보존한다",
  async () => {
    const field = element("textarea");
    let selected = "";
    const editor = textareaMentions(field, load, {
      select: (key) => {
        selected = key;
      },
    });
    fixture.append(editor.element);
    try {
      const label = mentionLabel(targets[0]);
      editor.restore(`${label} 확인`, [
        { start: 0, end: label.length, target: targets[0] },
      ]);
      field.style.height = "80px";
      await new Promise(requestAnimationFrame);
      editor.element.scrollIntoView();
      const link = editor.element.querySelector<HTMLAnchorElement>(
        "a.mention-token-content",
      );
      assert(link, "작성란 멘션 링크 누락");
      const rect = link?.getClientRects()[0];
      if (!rect) throw new Error("멘션 클릭 영역 누락");
      assert(
        document
          .elementFromPoint(rect.x + 3, rect.y + rect.height / 2)
          ?.closest("a") === link,
        "textarea가 멘션 클릭을 가림",
      );
      link?.click();
      assert(selected === "DEMO-833", "작성란 상세 이동 누락");
      assert(
        field.value === `${label} 확인` &&
          editor.references()[0]?.target.id === "123",
        "이동 시 작성 내용 유실",
      );
      const passive = mentionToken(targets[0], label, {
        clickable: false,
        select: () => {
          throw new Error("비활성 멘션 실행");
        },
      });
      assert(passive.tagName === "SPAN", "클릭 옵션을 무시함");
    } finally {
      editor.destroy();
      field.remove();
    }
  },
);
await check("본문 멘션도 내부 상세를 열고 ADF 저장 링크는 보존한다", () => {
  let selected = "";
  const document = rich.document();
  const rendered = renderADF(document, {
    key: "DEMO-1",
    url: "https://example.atlassian.net/browse/DEMO-1",
    select: (key) => {
      selected = key;
    },
  });
  const root = element("div");
  root.append(rendered);
  root.querySelector<HTMLAnchorElement>("a.mention-issue")?.click();
  assert(selected === "DEMO-833", "본문 멘션 내부 이동 누락");
  assert(
    JSON.stringify(rich.document()).includes("/browse/DEMO-833"),
    "원본 ADF 링크 변경",
  );
});
document.body.dataset.failures = String(failures);
document.body.dataset.complete = "true";
if (new URLSearchParams(location.search).has("preview")) {
  mentions.restore("");
  rich.element.focus();
  input.focus();
}
