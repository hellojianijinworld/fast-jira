import "../src/client/styles.css";
import "../src/ui/command-palette.css";
import "../src/ui/create-issue.css";
import { actionButton, element, iconButton } from "../src/ui/dom.ts";

const host = required(document.querySelector<HTMLElement>("#fixture"));
const results = required(document.querySelector<HTMLOListElement>("#results"));
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("상태 검사 요소 누락");
  return value;
}
// Same declarations and cascade as production; classes let the matrix show transient
// pseudo states side by side, without changing selection or sending requests.
const simulated = element("style");
function rules(list: CSSRuleList): string {
  return [...list]
    .map((rule) => {
      if (rule instanceof CSSStyleRule)
        return rule.cssText
          .replaceAll(":hover", ".qa-hover")
          .replaceAll(":active", ".qa-down")
          .replaceAll(":focus-visible", ".qa-focus");
      if (rule instanceof CSSMediaRule)
        return `@media ${rule.conditionText}{${rules(rule.cssRules)}}`;
      if (rule instanceof CSSImportRule && rule.styleSheet)
        return rules(rule.styleSheet.cssRules);
      return "";
    })
    .join("\n");
}
simulated.textContent = [...document.styleSheets]
  .map((sheet) => rules(sheet.cssRules))
  .join("\n");
document.head.append(simulated);
const layout = element("style");
layout.textContent = `main{padding:20px}#fixture{display:grid;gap:12px}.qa-row{display:grid;grid-template-columns:160px repeat(7,minmax(105px,1fr));gap:8px;align-items:center}.qa-row>div{min-width:0}.qa-row small{display:block;color:var(--muted);margin-bottom:4px}.qa-row .list-item{margin:0}.qa-row .setting-option{padding:8px}.qa-row .chat-conversation-open{padding:6px}.qa-row .workspace-tab{max-width:100%;width:100%}#fixture{overflow:auto}.qa-row{min-width:1050px}`;
document.head.append(layout);
type Spec = {
  name: string;
  make(): HTMLElement;
  select?(node: HTMLElement): void;
  target?(node: HTMLElement): HTMLElement;
};
function button(cls: string) {
  return element("button", cls, "항목");
}
function container(cls: string, child: HTMLElement) {
  const root = element("div", cls);
  root.append(child);
  return root;
}
const specs: Spec[] = [
  {
    name: "텍스트 링크",
    make: () => {
      const a = element("a", "", "링크");
      a.href = "#";
      return a;
    },
  },
  {
    name: "접기·펼치기",
    make: () => {
      const d = element("details");
      d.append(element("summary", "", "내용 보기"));
      return d;
    },
    target: (n) => n.firstElementChild as HTMLElement,
  },
  {
    name: "스플리터",
    make: () => {
      const n = element("div", "splitter");
      n.tabIndex = 0;
      n.style.height = "32px";
      return n;
    },
  },
  {
    name: "멘션 후보",
    make: () => container("inline-mention", button("select-option")),
    target: (n) => n.firstElementChild as HTMLElement,
    select: (n) => {
      n.firstElementChild?.setAttribute("aria-selected", "true");
      n.firstElementChild?.classList.add("keyboard-selected");
    },
  },

  ...(["primary", "secondary", "outline", "ghost"] as const).map((variant) => ({
    name: `버튼 ${variant}`,
    make: () => actionButton("저장", "check", variant),
  })),
  ...["", "secondary", "outline"].map((cls) => ({
    name: `일반 버튼 ${cls || "primary"}`,
    make: () => button(cls),
  })),
  { name: "아이콘 버튼", make: () => iconButton("도구", "search") },
  {
    name: "뷰 탭",
    make: () => button("workspace-tab"),
    select: (n) => n.setAttribute("aria-selected", "true"),
  },
  {
    name: "설정 탭",
    make: () => button("settings-tab"),
    select: (n) => n.setAttribute("aria-selected", "true"),
  },
  {
    name: "뷰 전환",
    make: () => button("workspace-switch-option"),
    select: (n) => n.setAttribute("aria-checked", "true"),
  },
  {
    name: "선택 옵션",
    make: () => button("select-option"),
    select: (n) => n.setAttribute("aria-selected", "true"),
  },
  {
    name: "셀렉트 트리거",
    make: () => button("select-trigger"),
    select: (n) => n.setAttribute("aria-expanded", "true"),
  },
  {
    name: "이슈 카드",
    make: () => {
      const n = element("a", "list-item", "제목");
      n.href = "#";
      return n;
    },
    select: (n) => n.setAttribute("aria-current", "true"),
  },
  {
    name: "완료 카드",
    make: () =>
      container("completed-grid", element("a", "list-item", "완료 제목")),
    target: (n) => n.firstElementChild as HTMLElement,
    select: (n) => n.firstElementChild?.setAttribute("aria-current", "true"),
  },
  {
    name: "설정 라디오",
    make: () => {
      const n = element("label", "setting-option");
      const r = element("input");
      r.type = "radio";
      n.append(r, element("span", "", "화이트"));
      return n;
    },
    select: (n) => {
      required(n.querySelector("input")).checked = true;
    },
  },
  {
    name: "프로젝트 체크",
    make: () => {
      const n = element("label", "status-check");
      const r = element("input");
      r.type = "checkbox";
      n.append(r, element("span", "", "프로젝트"));
      return container("project-checks", n);
    },
    target: (n) => n.firstElementChild as HTMLElement,
    select: (n) => {
      required(n.querySelector("input")).checked = true;
    },
  },
  {
    name: "도구 활성",
    make: () => container("nav-tools", iconButton("선택", "check")),
    target: (n) => n.firstElementChild as HTMLElement,
    select: (n) => n.firstElementChild?.classList.add("active"),
  },
  {
    name: "하위 필터",
    make: () => iconButton("필터", "list-filter"),
    select: (n) => n.classList.add("active"),
    target: (n) => {
      n.classList.add("detail-child-filter");
      return n;
    },
  },
  {
    name: "카드 뷰 조건",
    make: () => iconButton("뷰", "list-filter"),
    select: (n) => n.classList.add("active"),
    target: (n) => {
      n.classList.add("row-action");
      return n;
    },
  },
  {
    name: "FAQ 주제",
    make: () => button("faq-topic"),
    select: (n) => n.setAttribute("aria-pressed", "true"),
  },
  {
    name: "대화 기록",
    make: () =>
      container("chat-conversation", button("chat-conversation-open")),
    target: (n) => n,
    select: (n) => n.firstElementChild?.setAttribute("aria-current", "true"),
  },
  {
    name: "앱 메뉴",
    make: () => container("app-menu-panel", button("")),
    target: (n) => n.firstElementChild as HTMLElement,
  },
  {
    name: "뷰 메뉴",
    make: () => container("workspace-tab-menu", button("")),
    target: (n) => n.firstElementChild as HTMLElement,
  },
  {
    name: "명령 팔레트",
    make: () => container("command-menu", button("")),
    target: (n) => n.firstElementChild as HTMLElement,
  },
  { name: "FAQ 결과", make: () => button("faq-result") },
  {
    name: "최근 활동",
    make: () => {
      const a = element("a", "activity-row", "최근 변경");
      a.href = "#";
      return a;
    },
  },
  {
    name: "의견 유형",
    make: () => {
      const a = element("a", "feedback-option", "버그 제보");
      a.href = "#";
      return a;
    },
  },
  {
    name: "텍스트 입력",
    make: () => {
      const n = element("input");
      n.value = "입력 내용";
      return n;
    },
  },
  {
    name: "날짜 입력",
    make: () => {
      const n = element("input");
      n.type = "date";
      return n;
    },
  },
  {
    name: "긴 글 입력",
    make: () => {
      const n = element("textarea");
      n.value = "작성 내용";
      return n;
    },
  },
  {
    name: "즐겨찾기",
    make: () => {
      const n = iconButton("즐겨찾기", "star");
      n.classList.add("favorite-button");
      return n;
    },
    select: (n) => n.setAttribute("aria-pressed", "true"),
  },
  {
    name: "트리 펼치기",
    make: () => {
      const n = iconButton("펼치기", "chevron-right");
      n.classList.add("tree-toggle");
      n.style.position = "static";
      n.style.transform = "none";
      return n;
    },
    select: (n) => n.setAttribute("aria-expanded", "true"),
  },
];
function signature(node: HTMLElement) {
  const s = getComputedStyle(
    node,
    node.matches(".splitter") ? "::before" : null,
  );
  return [
    s.backgroundColor,
    s.borderColor,
    s.color,
    s.boxShadow,
    s.outlineStyle,
    s.outlineWidth,
    s.fontWeight,
  ].join("|");
}
let failures = 0;
for (const theme of ["light", "dark"]) {
  document.documentElement.dataset.theme = theme;
  for (const spec of specs) {
    const row = element("section", "qa-row");
    row.append(element("strong", "", spec.name));
    host.append(row);
    const samples = new Map<
      string,
      { root: HTMLElement; target: HTMLElement }
    >();
    for (const state of [
      "기본",
      "호버",
      "선택",
      "선택+호버",
      "누름",
      "포커스",
      "비활성",
    ]) {
      const box = element("div");
      box.append(element("small", "", state));
      const root = spec.make();
      const target = spec.target?.(root) ?? root;
      if (state.startsWith("선택")) spec.select?.(root);
      if (state.includes("호버")) target.classList.add("qa-hover");
      if (state === "누름") target.classList.add("qa-hover", "qa-down");
      if (state === "포커스") {
        const focus =
          root.querySelector<HTMLElement>("input,button,a[href],textarea") ??
          target;
        focus.classList.add("qa-focus");
      }
      if (state === "비활성") {
        const disabled =
          root.querySelector<HTMLInputElement>("input") ?? target;
        disabled.setAttribute("disabled", "");
      }
      box.append(root);
      row.append(box);
      samples.set(state, { root, target });
    }
    const get = (state: string) => required(samples.get(state));
    const check = (name: string, pass: boolean) => {
      results.append(
        element(
          "li",
          pass ? "" : "error",
          `${pass ? "통과" : "실패"} · ${theme} ${spec.name} ${name}`,
        ),
      );
      if (!pass) failures++;
    };
    if (spec.name !== "즐겨찾기")
      check(
        "기본과 호버 구분",
        signature(get("기본").target) !== signature(get("호버").target),
      );
    if (spec.select && !["즐겨찾기", "트리 펼치기"].includes(spec.name)) {
      check(
        "선택과 호버 구분",
        signature(get("선택").target) !== signature(get("호버").target),
      );
      check(
        "선택 호버 유지",
        getComputedStyle(get("선택+호버").target).backgroundColor !==
          getComputedStyle(get("호버").target).backgroundColor,
      );
    }
    if (
      ![
        "대화 기록",
        "즐겨찾기",
        "텍스트 입력",
        "날짜 입력",
        "긴 글 입력",
      ].includes(spec.name)
    ) {
      check(
        "누름 피드백",
        signature(get("누름").target) !== signature(get("호버").target),
      );
    }
    const focused = get("포커스");
    const focusTarget =
      focused.root.querySelector<HTMLElement>(".qa-focus") ?? focused.target;
    check(
      "키보드 포커스 링",
      getComputedStyle(focusTarget).outlineStyle === "solid" &&
        Number.parseFloat(getComputedStyle(focusTarget).outlineWidth) >= 2,
    );
    const disabled = get("비활성");
    const d =
      disabled.root.querySelector<HTMLInputElement>("input") ?? disabled.target;
    if (d.matches("button,input,textarea")) {
      const before = signature(disabled.target);
      disabled.target.classList.add("qa-hover");
      check("비활성 호버 차단", before === signature(disabled.target));
    }
  }
  host.replaceChildren();
}
document.documentElement.dataset.theme =
  new URLSearchParams(location.search).get("theme") === "dark"
    ? "dark"
    : "light";
// Keep the last theme's matrix available for visual review.
for (const spec of specs) {
  const row = element("section", "qa-row");
  row.append(element("strong", "", spec.name));
  for (const state of [
    "기본",
    "호버",
    "선택",
    "선택+호버",
    "누름",
    "포커스",
    "비활성",
  ]) {
    const box = element("div");
    box.append(element("small", "", state));
    const root = spec.make();
    const target = spec.target?.(root) ?? root;
    if (state.startsWith("선택")) spec.select?.(root);
    if (state.includes("호버")) target.classList.add("qa-hover");
    if (state === "누름") target.classList.add("qa-hover", "qa-down");
    if (state === "포커스")
      (
        root.querySelector("input,button,a[href],textarea") ?? target
      ).classList.add("qa-focus");
    if (state === "비활성")
      (root.querySelector("input") ?? target).setAttribute("disabled", "");
    box.append(root);
    row.append(box);
  }
  host.append(row);
}
results.dataset.complete = "true";
results.dataset.failures = String(failures);
document.body.dataset.result = failures ? "failed" : "passed";

if (new URLSearchParams(location.search).has("preview")) results.hidden = true;
