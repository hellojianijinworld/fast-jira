import { createApi } from "../src/client/api.ts";
import { emptyIssue } from "../src/domain/wire.ts";
import { documentForm } from "../src/ui/document-form.ts";
import {
  actionButton,
  buttonGroup,
  buttonLink,
  element,
  iconButton,
  textButton,
} from "../src/ui/dom.ts";
import { issueCard } from "../src/ui/issue-card.ts";
import { createMenu, menuItemButton } from "../src/ui/menu.ts";
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
  const secondary = actionButton("취소", "x", { variant: "subtle" });
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

check("버튼 그룹은 의미를 보존하고 크기·간격·줄바꿈을 공유한다", () => {
  const group = element("div");
  group.setAttribute("role", "tablist");
  buttonGroup(group, { size: "sm", compact: true });
  group.style.width = "150px";
  const buttons = [
    actionButton("저장하기", "check"),
    actionButton("취소하기", "x"),
    iconButton("닫기", "x"),
  ];
  group.append(...buttons);
  fixture.append(group);
  try {
    assert(group.getAttribute("role") === "tablist", "기존 역할을 덮어씀");
    for (const button of buttons)
      assert(
        button.getBoundingClientRect().height === 32,
        "그룹 크기를 상속하지 않음",
      );
    assert(
      buttons[2] &&
        buttons[0] &&
        buttons[2].getBoundingClientRect().top >
          buttons[0].getBoundingClientRect().top,
      "좁은 그룹의 줄바꿈 누락",
    );
    const gap = Number.parseFloat(getComputedStyle(group).columnGap);
    assert(gap >= 4 && gap <= 6, "아이콘 그룹 사이 간격 없음");
    buttonGroup(group, { size: "sm", compact: true, wrap: false });
    assert(
      buttons[2] &&
        buttons[0] &&
        buttons[2].getBoundingClientRect().top ===
          buttons[0].getBoundingClientRect().top,
      "줄바꿈 제한 무시",
    );
  } finally {
    group.remove();
  }
});
check("정렬 버튼 패딩은 다른 보조 버튼의 크기를 덮지 않는다", () => {
  const primary = actionButton("저장", "check", {
    size: "md",
    variant: "primary",
  });
  const secondary = actionButton("취소", "x", { size: "md" });
  fixture.append(primary, secondary);
  try {
    assert(
      getComputedStyle(primary).paddingInlineStart ===
        getComputedStyle(secondary).paddingInlineStart,
      "정렬 전용 패딩이 공통 버튼을 덮음",
    );
  } finally {
    primary.remove();
    secondary.remove();
  }
});

check(
  "공통 메뉴는 숨김·비활성 항목을 건너뛰고 체크 항목과 포커스 복원을 지원한다",
  () => {
    const trigger = iconButton("검사 메뉴", "menu");
    const menu = createMenu({ label: "공통 메뉴 검사", width: 220 });
    const first = actionButton("첫 동작", "search"),
      hidden = actionButton("숨김", "x"),
      disabled = actionButton("비활성", "x"),
      toggle = actionButton("이름 표시", "check");
    for (const item of [first, hidden, disabled])
      item.setAttribute("role", "menuitem");
    hidden.hidden = true;
    disabled.disabled = true;
    toggle.setAttribute("role", "menuitemcheckbox");
    toggle.setAttribute("aria-checked", "true");
    menu.element.append(first, hidden, disabled, toggle);
    fixture.append(trigger, menu.element);
    try {
      menu.open(trigger, { x: innerWidth - 1, y: innerHeight - 1 });
      assert(document.activeElement === first, "첫 항목 포커스 누락");
      first.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
      assert(
        document.activeElement === toggle,
        "숨김·비활성 항목 건너뛰기 실패",
      );
      const rect = menu.element.getBoundingClientRect();
      assert(
        rect.right <= innerWidth && rect.bottom <= innerHeight,
        "화면 밖으로 메뉴가 나감",
      );
      toggle.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      assert(
        !menu.element.matches(":popover-open") &&
          document.activeElement === trigger,
        "Escape 닫기·포커스 복원 실패",
      );
      menu.open(trigger, { last: true });
      assert(document.activeElement === toggle, "마지막 항목 진입 실패");
      toggle.click();
      assert(!menu.element.matches(":popover-open"), "선택 후 닫기 실패");
      menu.open(trigger);
      window.dispatchEvent(new Event("resize"));
      assert(
        !menu.element.matches(":popover-open"),
        "화면 크기 변경 후 메뉴 유지",
      );
    } finally {
      menu.destroy();
      trigger.remove();
    }
  },
);

check(
  "메뉴 너비는 기본적으로 내용에 맞고 명시적 너비와 긴 내용도 처리한다",
  () => {
    const trigger = iconButton("너비 검사", "menu");
    const auto = createMenu({ label: "내용 너비 검사" }),
      fixed = createMenu({ label: "고정 너비 검사", width: 260 });
    const item = actionButton("설정", "settings"),
      fixedItem = actionButton("설정", "settings");
    item.setAttribute("role", "menuitem");
    fixedItem.setAttribute("role", "menuitem");
    auto.element.append(item);
    fixed.element.append(fixedItem);
    fixture.append(trigger, auto.element, fixed.element);
    try {
      auto.open(trigger);
      const shortWidth = auto.element.getBoundingClientRect().width;
      assert(shortWidth < 160, "짧은 메뉴의 불필요한 고정 폭");
      assert(
        auto.element.style.width === "",
        "자동 너비를 픽셀 인라인 스타일로 덮음",
      );
      const label = item.querySelector("span");
      assert(label, "메뉴 레이블 누락");
      label.textContent = "모든 뷰 이름 표시";
      const longerWidth = auto.element.getBoundingClientRect().width;
      assert(
        longerWidth > shortWidth && longerWidth < 220,
        "내용 변경 후 너비가 갱신되지 않음",
      );
      auto.close(false);
      label.textContent = "VeryLongMenuItem".repeat(100);
      auto.open(trigger, { x: innerWidth - 1, y: 0 });
      assert(
        auto.element.getBoundingClientRect().right <= innerWidth &&
          auto.element.clientWidth >= auto.element.scrollWidth,
        "긴 메뉴가 화면을 벗어나거나 가로 스크롤 생성",
      );
      auto.close(false);
      fixed.open(trigger);
      assert(
        Math.abs(
          fixed.element.getBoundingClientRect().width -
            Math.min(260, innerWidth - 24),
        ) < 1,
        "명시적 메뉴 너비 무시",
      );
    } finally {
      auto.destroy();
      fixed.destroy();
      trigger.remove();
    }
  },
);

check("본문·댓글 작성의 저장과 취소는 공통 실행·보조 역할로 구분한다", () => {
  const form = documentForm({
    initial: null,
    issue: {
      key: "TEST-1",
      url: "https://example.atlassian.net/browse/TEST-1",
    },
    imageEnabled: false,
    api: createApi(),
    label: "본문 검사",
    submitLabel: "저장",
    save: async () => {},
    close: () => {},
  });
  fixture.append(form.element);
  try {
    const save = form.element.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    const cancel = [
      ...form.element.querySelectorAll<HTMLButtonElement>("button"),
    ].find((b) => b.textContent === "취소");
    assert(save?.dataset.variant === "primary", "최종 저장이 primary가 아님");
    assert(cancel?.dataset.variant === "ghost", "취소가 ghost가 아님");
    assert(
      getComputedStyle(save).backgroundColor !==
        getComputedStyle(cancel).backgroundColor,
      "저장·취소의 시각적 위계가 같음",
    );
    assert(
      save.getBoundingClientRect().height ===
        cancel.getBoundingClientRect().height,
      "같은 작업 그룹의 버튼 높이가 다름",
    );
  } finally {
    form.destroy();
  }
});
check(
  "역할 버튼·링크·메뉴와 뷰·도구 선택은 라이트·다크에서 같은 규칙을 사용한다",
  () => {
    const scope = element("section");
    const confirm = actionButton("저장", "check", { purpose: "confirm" });
    const entry = actionButton("생성", "plus", { purpose: "entry" });
    const utility = actionButton("연결 확인", "search", { purpose: "utility" });
    const link = buttonLink(
      "https://example.com",
      "외부 안내",
      "external-link",
    );
    const menu = menuItemButton("뷰 복제", "copy");
    const danger = actionButton("뷰 삭제", "trash-2", { purpose: "danger" });
    const tab = textButton("뷰", { purpose: "quiet", selectable: true });
    const tool = iconButton("AI 대화", "sparkles", { selectable: true });
    tab.setAttribute("aria-selected", "true");
    tool.setAttribute("aria-pressed", "true");
    scope.append(confirm, entry, utility, link, menu, danger, tab, tool);
    fixture.append(scope);
    const original = document.documentElement.dataset.theme;
    try {
      for (const theme of ["light", "dark"]) {
        document.documentElement.dataset.theme = theme;
        const style = (node: Element) => getComputedStyle(node);
        assert(
          style(confirm).backgroundColor !== style(entry).backgroundColor,
          "확정과 진입 역할이 구분되지 않음",
        );
        assert(
          style(utility).backgroundColor === style(link).backgroundColor &&
            style(utility).borderColor === style(link).borderColor &&
            style(utility).color === style(link).color,
          "같은 보조 동작의 버튼·링크가 다름",
        );
        assert(
          menu.getAttribute("role") === "menuitem" &&
            menu.dataset.variant === "ghost",
          "메뉴를 강한 액션 버튼으로 생성함",
        );
        assert(
          style(danger).color !== style(menu).color,
          "위험 동작 구분 누락",
        );
        assert(
          style(tab).backgroundColor === style(tool).backgroundColor &&
            style(tab).borderColor === style(tool).borderColor &&
            style(tab).color === style(tool).color,
          "뷰·도구의 선택 표현이 다름",
        );
        const plain = element("button", "", "일반 조작");
        scope.append(plain);
        assert(
          style(plain).backgroundColor !== style(confirm).backgroundColor,
          "variant 미지정 버튼이 주요 동작처럼 보임",
        );
        plain.remove();
      }
    } finally {
      if (original === undefined) delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = original;
      scope.remove();
    }
  },
);
results.dataset.failures = String(failures);
results.dataset.complete = "true";
