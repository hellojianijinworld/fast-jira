import { emptyIssue } from "../src/domain/wire.ts";
import { actionButton, element, iconButton } from "../src/ui/dom.ts";
import { issueCard } from "../src/ui/issue-card.ts";
import { enhanceSelect } from "../src/ui/select-menu.ts";
import "../src/client/styles.css";

const fixture = document.querySelector("#fixture");
const results = document.querySelector<HTMLOListElement>("#results");
if (!fixture || !results) throw new Error("테마 검사 화면 누락");
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
let failures = 0;
function check(name: string, run: () => void) {
  try {
    run();
    results?.append(element("li", "", `통과 · ${name}`));
  } catch (reason) {
    failures++;
    results?.append(
      element("li", "error", `실패 · ${name}: ${String(reason)}`),
    );
  }
}
const row = {
  ...emptyIssue("TEST-1"),
  summary:
    "긴 제목과 담당자·상태 배지를 가진 이슈도 같은 카드 규칙으로 줄바꿈합니다",
  status: "진행 중",
  assignee: "검사자",
  commentCount: 3,
};
const controls = new Map<
  string,
  {
    button: HTMLButtonElement;
    icon: HTMLButtonElement;
    menu: ReturnType<typeof enhanceSelect>;
    card: HTMLElement;
  }
>();
for (const size of ["auto", "sm", "md"] as const) {
  const group = element("section");
  group.style.cssText = "max-width:600px;margin-bottom:16px";
  group.append(element("h2", "", size));
  const button = actionButton("저장", "check", { size, variant: "primary" });
  const icon = iconButton("닫기", "x", { size });
  const select = element("select");
  select.setAttribute("aria-label", `${size} 선택`);
  select.append(
    new Option("첫 번째 선택", "first"),
    new Option("두 번째 선택", "second"),
  );
  group.append(button, icon, select);
  const menu = enhanceSelect(select, { size });
  const card = issueCard(row, { size, statusOrder: [], onSelect: () => {} });
  group.append(card);
  fixture.append(group);
  controls.set(size, { button, icon, menu, card });
}
check("기본 간격은 화면 폭과 무관하게 고정된다", () => {
  const root = getComputedStyle(document.documentElement);
  assert(
    root.getPropertyValue("--space-4").trim() === "16px",
    "기본 간격이 화면 밀도에 따라 바뀜",
  );
});
check("버튼·셀렉트·아이콘 버튼은 같은 명시적 크기를 사용한다", () => {
  for (const [size, height, font] of [
    ["sm", 32, 12],
    ["md", 34, 13],
  ] as const) {
    const group = controls.get(size);
    assert(group, "크기별 컴포넌트 누락");
    for (const control of [group.button, group.icon, group.menu.trigger]) {
      assert(
        Math.abs(control.getBoundingClientRect().height - height) < 1,
        `${size} 높이 불일치`,
      );
      assert(
        parseFloat(getComputedStyle(control).fontSize) === font,
        `${size} 글자 크기 불일치`,
      );
    }
    group.menu.show(group.menu.trigger.getBoundingClientRect(), false);
    const option = group.menu.panel.querySelector("button");
    assert(
      option && option.getBoundingClientRect().height >= height,
      "선택지 높이가 트리거보다 작음",
    );
    assert(
      parseFloat(getComputedStyle(option).fontSize) === font,
      "팝오버가 선택기의 크기를 잃음",
    );
    group.menu.close();
  }
});
check("auto만 화면 밀도를 따르고 명시적 카드 크기는 유지된다", () => {
  const small = controls.get("sm")?.card.querySelector(".list-item");
  const medium = controls.get("md")?.card.querySelector(".list-item");
  const auto = controls.get("auto");
  assert(small && medium && auto, "카드 누락");
  assert(
    parseFloat(getComputedStyle(small).fontSize) === 12,
    "sm 카드 글자 크기",
  );
  assert(
    parseFloat(getComputedStyle(medium).fontSize) === 14,
    "md 카드가 화면 폭에 따라 바뀜",
  );
  assert(
    parseFloat(getComputedStyle(auto.button).fontSize) ===
      (innerWidth <= 900 ? 12 : 13),
    "auto 버튼 밀도",
  );
  const autoCard = auto.card.querySelector(".list-item");
  assert(
    autoCard &&
      parseFloat(getComputedStyle(autoCard).fontSize) ===
        (innerWidth <= 900 ? 12 : 14),
    "auto 카드 밀도",
  );
  assert(
    small.textContent === medium.textContent &&
      medium.textContent === autoCard.textContent,
    "크기에 따라 카드 정보가 달라짐",
  );
  for (const card of [small, medium, autoCard]) {
    assert(card.scrollWidth <= card.clientWidth + 1, "긴 제목이 카드를 넘음");
  }
});
check("라이트·다크에서 공통 버튼 변형과 카드 표면이 테마를 따른다", () => {
  const root = document.documentElement;
  const original = root.dataset.theme;
  const primary = actionButton("저장", "check", { variant: "primary" });
  const secondary = actionButton("취소", "x", { variant: "secondary" });
  const ghost = iconButton("닫기", "x");
  fixture.append(primary, secondary, ghost);
  try {
    for (const theme of ["light", "dark"]) {
      root.dataset.theme = theme;
      const tokens = getComputedStyle(root);
      assert(
        getComputedStyle(primary).backgroundColor !==
          getComputedStyle(secondary).backgroundColor,
        "주요/보조 버튼 구분 실패",
      );
      assert(
        getComputedStyle(ghost).backgroundColor === "rgba(0, 0, 0, 0)",
        "아이콘 버튼 배경 불일치",
      );
      const card = controls.get("auto")?.card.querySelector(".list-item");
      assert(card, "카드 누락");
      const surface = element("div");
      surface.style.backgroundColor = "var(--surface)";
      fixture.append(surface);
      assert(
        getComputedStyle(card).backgroundColor ===
          getComputedStyle(surface).backgroundColor,
        "카드 표면이 테마와 다름",
      );
      surface.remove();
      assert(
        tokens.getPropertyValue("--space-4").trim() === "16px",
        "색상 모드가 기본 간격을 바꿈",
      );
    }
  } finally {
    if (original === undefined) delete root.dataset.theme;
    else root.dataset.theme = original;
    primary.remove();
    secondary.remove();
    ghost.remove();
  }
});
check("크기 상속과 비활성·로딩 상태는 표시 규칙을 유지한다", () => {
  const scope = element("div");
  scope.dataset.size = "sm";
  const inherited = actionButton("저장", "check");
  const fixed = actionButton("고정 크기", "check", { size: "md" });
  const outline = actionButton("기록", "history", { variant: "outline" });
  scope.append(inherited, fixed, outline);
  fixture.append(scope);
  try {
    assert(
      inherited.getBoundingClientRect().height === 32,
      "auto가 부모 크기를 상속하지 않음",
    );
    assert(
      fixed.getBoundingClientRect().height === 34,
      "명시적 md가 부모 크기에 덮임",
    );
    inherited.disabled = true;
    assert(
      parseFloat(getComputedStyle(inherited).opacity) < 1,
      "비활성 상태 구분 누락",
    );
    fixed.setAttribute("aria-busy", "true");
    assert(getComputedStyle(fixed).cursor === "wait", "로딩 상태 구분 누락");
    assert(
      getComputedStyle(outline).borderStyle === "solid",
      "테두리 변형 누락",
    );
    assert(
      getComputedStyle(outline).backgroundColor === "rgba(0, 0, 0, 0)",
      "테두리 변형 배경 오류",
    );
  } finally {
    scope.remove();
  }
});
results.dataset.failures = String(failures);
results.dataset.complete = "true";
