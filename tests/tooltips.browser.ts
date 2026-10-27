import "../src/client/styles.css";
import { element, iconButton } from "../src/ui/dom.ts";
import { startTooltips, TOOLTIP_DELAY_MS } from "../src/ui/tooltip.ts";

const host = document.querySelector("#fixture"),
  results = document.querySelector("#results");
if (!host || !results) throw new Error("검사 화면 없음");
const stop = startTooltips();
const button = iconButton("설정", "settings");
const other = iconButton("다른 설정", "settings");
button.setAttribute("aria-describedby", "existing-help");
host.setAttribute("title", "상위 도움말");
host.append(button, other);
const wait = (ms = TOOLTIP_DELAY_MS + 30) =>
  new Promise((resolve) => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
let failures = 0;
async function check(name: string, run: () => Promise<void>) {
  try {
    await run();
    results?.append(element("li", "", `통과 · ${name}`));
  } catch (reason) {
    failures++;
    results?.append(
      element("li", "error", `실패 · ${name}: ${String(reason)}`),
    );
  }
}
await check(
  "키보드 포커스도 공통 지연 후 표시하고 기존 접근성 설명을 유지한다",
  async () => {
    button.focus();
    assert(
      !button.hasAttribute("title") && !host?.hasAttribute("title"),
      "기본 툴팁이 중복됨",
    );
    assert(
      !document.querySelector(".ui-tooltip:popover-open"),
      "지연 전에 표시됨",
    );
    await wait();
    assert(
      document.querySelector(".ui-tooltip:popover-open")?.textContent ===
        "설정",
      "툴팁 없음",
    );
    assert(
      button.getAttribute("aria-describedby")?.includes("existing-help"),
      "기존 접근성 설명 손실",
    );
    button.blur();
    assert(button.title === "설정", "title 복원 실패");
    assert(
      button.getAttribute("aria-describedby") === "existing-help",
      "툴팁 접근성 연결이 남음",
    );
  },
);
await check(
  "빨리 벗어난 대상은 표시하지 않고 다음 대상만 표시한다",
  async () => {
    button.dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }),
    );
    button.dispatchEvent(
      new PointerEvent("pointerout", { bubbles: true, relatedTarget: other }),
    );
    other.dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }),
    );
    await wait();
    assert(
      document.querySelector(".ui-tooltip:popover-open")?.textContent ===
        "다른 설정",
      "이전 툴팁이 남음",
    );
    other.click();
    assert(!document.querySelector(".ui-tooltip:popover-open"), "클릭 후 남음");
  },
);
await check(
  "모달 안의 긴 툴팁도 화면 안에 표시하고 스크롤하면 닫는다",
  async () => {
    const dialog = element("dialog");
    const inside = iconButton("아주 긴 도움말 ".repeat(25), "settings");
    dialog.append(inside);
    host.append(dialog);
    dialog.showModal();
    await wait();
    const tip = document.querySelector<HTMLElement>(".ui-tooltip:popover-open");
    assert(tip, "모달 툴팁 없음");
    const rect = tip.getBoundingClientRect();
    assert(
      rect.left >= 0 && rect.right <= innerWidth,
      "툴팁이 화면 밖으로 벗어남",
    );
    dialog.dispatchEvent(new Event("scroll"));
    assert(!tip.matches(":popover-open"), "스크롤 후 남음");
    dialog.close();
    dialog.remove();
  },
);
await check("해제 후 타이머·이벤트·접근성 연결을 남기지 않는다", async () => {
  button.focus();
  stop();
  await wait();
  assert(!document.querySelector(".ui-tooltip"), "툴팁 노드가 남음");
  assert(button.title === "설정", "해제 후 title 복원 실패");
});
document.documentElement.dataset.result = failures ? "failed" : "passed";
