import "../src/client/styles.css";
import { createViewController } from "../src/client/view-controller.ts";
import { createViewDraft } from "../src/client/view-editor-controller.ts";
import type { TreeCatalog } from "../src/domain/catalog.ts";
import { branchDefaults, type Filters } from "../src/domain/filters.ts";
import { initialViews } from "../src/domain/views.ts";
import { element } from "../src/ui/dom.ts";
import { createFilterPanel } from "../src/ui/filter-panel.ts";
import { createPeopleFilter } from "../src/ui/people-filter.ts";

const host = document.querySelector("#fixture");
const results = document.querySelector("#results");
if (!host || !results) throw new Error("검사 화면이 없습니다.");
const wait = () => new Promise((resolve) => setTimeout(resolve, 20));
const assert: (value: unknown, message: string) => asserts value = (
  value,
  message,
) => {
  if (!value) throw new Error(message);
};
function button(name: string, root: ParentNode = document): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) =>
      item.getAttribute("aria-label") === name ||
      (!item.hasAttribute("aria-label") && item.textContent?.trim() === name),
  );
  assert(found, `${name} 버튼 없음`);
  return found;
}
function input(name: string, root: ParentNode = document): HTMLInputElement {
  const found = [...root.querySelectorAll<HTMLInputElement>("input")].find(
    (item) => item.getAttribute("aria-label") === name,
  );
  assert(found, `${name} 입력 없음`);
  return found;
}
const statuses = [
  { id: "1", name: "시작", category: "new", projects: ["TEST"] },
  { id: "2", name: "확인", category: "indeterminate", projects: ["TEST"] },
  { id: "3", name: "완료", category: "done", projects: ["TEST"] },
];
const target = { kind: "branch" as const, key: "TEST-1" };
let filters: Filters = {
  projects: ["TEST"],
  scope: "all",
  sort: "recent",
  statuses: null,
  assignees: null,
  excludeDone: false,
  q: "",
};
let catalog: TreeCatalog = {
  projects: [{ key: "TEST", name: "검사 프로젝트", avatar: "" }],
  priorities: [],
  statuses,
  types: [],
};
let metadataCalls = 0;
let userCalls = 0;
const views = createViewController(initialViews(filters), {
  save: () => {},
  changed: () => {},
  statuses: () => statuses,
});
const panel = createFilterPanel(
  {
    statuses: async () => {
      metadataCalls++;
      return statuses;
    },
    users: async () => {
      userCalls++;
      return [{ id: "account-me", name: "검사 계정", avatar: "" }];
    },
    types: async () => [],
  },
  { accountId: "account-me", displayName: "검사 계정" },
  {
    filters: () => filters,
    catalog: () => catalog,
    views,
    onApply: (next, nextCatalog, commit) => {
      commit?.();
      filters = next;
      catalog = nextCatalog;
    },
  },
);
const anchor = element("button", "", "뷰 검사 열기");
host.append(anchor);
anchor.addEventListener("click", () => panel.open(anchor, "TEST-1"));
let failures = 0;
async function check(name: string, action: () => Promise<void>) {
  try {
    await action();
    results?.append(element("li", "", `통과 · ${name}`));
  } catch (reason) {
    failures++;
    results?.append(
      element(
        "li",
        "error",
        `실패 · ${name}: ${reason instanceof Error ? reason.message : String(reason)}`,
      ),
    );
    panel.close();
  }
}
async function edit(key = "TEST-1") {
  panel.open(anchor, key);
  await wait();
  const select = panel.element.querySelector<HTMLSelectElement>(
    ".view-picker select",
  );
  assert(select, "뷰 선택기 없음");
  if (select.value !== "inline") {
    select.value = "inline";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  } else
    panel.element
      .querySelector<HTMLButtonElement>(
        '.view-settings > button[aria-expanded="false"]',
      )
      ?.click();
  for (
    let step = 0;
    step < 50 && !panel.element.querySelector('[aria-label="단계: 완료"]');
    step++
  )
    await wait();
  assert(
    panel.element.querySelector('[aria-label="단계: 완료"]'),
    "동적 조건 편집기 없음",
  );
}
await check(
  "부모는 필드별 상속 대신 하나의 뷰 선택을 제공하고 선택지 조회를 미룬다",
  async () => {
    panel.open(anchor, target.key);
    await wait();
    assert(
      panel.element.querySelector('[aria-label="사용할 뷰"]'),
      "뷰 선택기 없음",
    );
    assert(
      !panel.element.querySelector('[aria-label="담당자 글로벌 필터 적용"]'),
      "필드별 상속 UI가 남음",
    );
    assert(metadataCalls === 0, "뷰 선택만으로 metadata 재조회");
    panel.close();
  },
);
await check(
  "전체·하위 필터를 다시 열면 현재 적용 범위를 표시한다",
  async () => {
    const before = metadataCalls + userCalls;
    for (const key of ["", target.key, ""]) {
      panel.open(anchor, key);
      await wait();
      assert(
        panel.element.querySelector("h2")?.textContent === "필터 및 뷰",
        "필터 제목이 적용 대상에 따라 달라짐",
      );
      assert(
        panel.element.querySelector(".view-panel-scope")?.textContent ===
          (key ? `${key}의 하위 목록에 적용` : "전체 목록에 적용"),
        "이전에 연 필터의 적용 범위가 남음",
      );
      panel.close();
    }
    assert(
      metadataCalls + userCalls === before,
      "범위 표시 때문에 추가 조회 발생",
    );
  },
);
await check(
  "직접 설정은 다시 열어도 조건을 바로 편집하고 취소하면 보존한다",
  async () => {
    const key = "TEST-INLINE";
    const branch = { kind: "branch" as const, key };
    views.apply(branch, { ...filters, statuses: ["1", "2"] });
    for (const openKey of ["", key]) {
      panel.open(anchor, openKey);
      await wait();
      assert(
        panel.element.querySelector(".view-editor"),
        "직접 설정인데 조건 편집을 다시 눌러야 함",
      );
      assert(userCalls === 0, "직접 설정을 열 때 전체 사용자를 불러옴");
      const original = JSON.stringify(
        views.resolve(openKey ? branch : { kind: "global" }),
      );
      input("단계: 시작", panel.element).click();
      button("취소", panel.element).click();
      assert(
        JSON.stringify(views.resolve(openKey ? branch : { kind: "global" })) ===
          original,
        "편집 취소가 적용된 조건을 바꿈",
      );
    }
  },
);
await check(
  "뷰 선택 항목의 아이콘·이름·설명은 같은 왼쪽 기준으로 정렬한다",
  async () => {
    panel.open(anchor, target.key);
    button("사용할 뷰", panel.element).click();
    const choices = panel.element.querySelector<HTMLElement>(
      ".select-options:popover-open",
    );
    assert(choices, "선택 메뉴 없음");
    for (const option of choices.querySelectorAll<HTMLElement>(
      ".select-option",
    )) {
      const copy = option.querySelector<HTMLElement>(".select-option-copy");
      assert(copy, "선택 설명 없음");
      assert(
        getComputedStyle(option).justifyContent === "flex-start",
        "선택 항목이 중앙 정렬됨",
      );
      assert(
        copy.getBoundingClientRect().left -
          option.getBoundingClientRect().left <
          16,
        "이름·설명이 항목 왼쪽에서 떨어짐",
      );
    }
    button("사용할 뷰", panel.element).click();
    panel.close();
  },
);
await check(
  "뷰 선택 이름과 안내는 전체 상속과 하위 목록 설정의 범위를 설명한다",
  async () => {
    panel.open(anchor, target.key);
    const select = panel.element.querySelector<HTMLSelectElement>(
      '[aria-label="사용할 뷰"]',
    );
    assert(select, "뷰 선택기 없음");
    assert(
      select.querySelector('option[value="default"]')?.textContent ===
        "전체 뷰 따라가기",
      "상속 옵션의 적용 범위가 불명확함",
    );
    assert(
      select.querySelector('option[value="inline"]')?.textContent ===
        "이 하위 목록만 설정",
      "하위 설정의 적용 범위가 불명확함",
    );
    const help = panel.element.querySelector(".view-selection-help");
    assert(help, "선택 안내 없음");
    assert(
      help?.textContent?.includes("상단"),
      "전체 뷰를 어디서 설정하는지 안내 없음",
    );
    select.value = "inline";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await wait();
    assert(
      help.textContent?.includes(target.key),
      "해당 하위 목록 안내가 선택 후 갱신되지 않음",
    );
    assert(views.binding(target).kind === "default", "선택 초안이 즉시 적용됨");
    select.value = "default";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    assert(help.textContent?.includes("상단"), "상속 안내가 복원되지 않음");
    panel.close();
  },
);

await check(
  "저장한 뷰는 내 뷰 배지를 표시하고 직접 설정만 조건을 편집한다",
  async () => {
    const custom = views.create({ ...filters, statuses: [] }, "내 검사 뷰");
    try {
      panel.open(anchor, target.key);
      const select = panel.element.querySelector<HTMLSelectElement>(
        ".view-picker select",
      );
      const edit = panel.element.querySelector<HTMLButtonElement>(
        ".view-settings > button",
      );
      assert(select && edit, "뷰 편집 요소 없음");
      assert(edit.hidden, "전체 뷰를 따르는 상태에서 조건 편집 노출");
      button("사용할 뷰", panel.element).click();
      const savedOption = [
        ...panel.element.querySelectorAll<HTMLElement>(".select-option"),
      ].find((option) => option.textContent?.includes("내 검사 뷰"));
      assert(
        savedOption?.querySelector(".view-custom-badge")?.textContent ===
          "내가 만든 뷰",
        "저장한 뷰의 사용자 생성 표시 없음",
      );
      button("사용할 뷰", panel.element).click();
      const before = metadataCalls;
      select.value = `saved:${custom}`;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await wait();
      assert(
        edit.hidden && metadataCalls === before,
        "저장한 뷰 선택이 편집기를 조회하거나 노출함",
      );
      select.value = "inline";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await wait();
      assert(
        !edit.hidden && panel.element.querySelector(".view-editor"),
        "직접 설정 편집기가 열리지 않음",
      );
      select.value = "default";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      assert(
        edit.hidden && !panel.element.querySelector(".view-editor"),
        "상속 전환 후 편집기가 남음",
      );
    } finally {
      panel.close();
      views.delete(custom);
    }
  },
);

await check(
  "그 자리에서 초안을 편집하고 이름을 붙여 등록·적용한다",
  async () => {
    await edit();
    input("단계: 완료", panel.element).click();
    assert(
      views.binding(target).kind === "default",
      "초안이 목록 조건에 즉시 적용됨",
    );
    button("내 뷰로 저장", panel.element).click();
    const name = panel.element.querySelector<HTMLInputElement>(
      '[aria-label="뷰 이름"]',
    );
    assert(name, "인라인 이름 입력 없음");
    name.value = "QA 확인";
    button("저장하고 적용", panel.element).click();
    await wait();
    assert(
      views.state.saved.length === 1 && views.binding(target).kind === "saved",
      "공용 등록과 연결 실패",
    );
    assert(
      views.resolve(target).statuses?.join(",") === "1,2",
      "편집 조건이 등록되지 않음",
    );
  },
);
await check(
  "새 인라인이 같은 등록 조건이면 안내하고 적용 시 기존 ID를 참조한다",
  async () => {
    await edit("TEST-2");
    input("단계: 완료", panel.element).click();
    assert(
      panel.element.textContent?.includes("QA 확인") &&
        panel.element.querySelector(".view-match"),
      "동일 뷰 안내 없음",
    );
    button("적용", panel.element).click();
    await wait();
    assert(
      views.binding({ kind: "branch", key: "TEST-2" }).kind === "saved",
      "같은 조건이 inline으로 남음",
    );
    assert(views.state.saved.length === 1, "동일 뷰가 중복 등록됨");
  },
);
await check(
  "공용 조건을 위치에서 편집하고 취소해도 두 묶음의 조건은 유지된다",
  async () => {
    await edit();
    input("단계: 시작", panel.element).click();
    button("취소", panel.element).click();
    assert(
      views.resolve(target).statuses?.join(",") === "1,2",
      "취소가 원래 조건을 변경",
    );
    assert(
      views.resolve({ kind: "branch", key: "TEST-2" }).statuses?.join(",") ===
        "1,2",
      "다른 묶음까지 변경",
    );
  },
);
await check(
  "관리 화면도 같은 편집기를 사용하고 공용 수정만 두 연결에 전파한다",
  async () => {
    panel.open(anchor, target.key);
    await wait();
    button("뷰 관리", panel.element).click();
    await wait();
    const manager = document.querySelector<HTMLDialogElement>(".view-manager");
    assert(manager?.open, "관리 모달 없음");
    button("QA 확인 편집", manager).click();
    for (
      let step = 0;
      step < 50 && !manager.querySelector('[aria-label="단계: 확인"]');
      step++
    )
      await wait();
    assert(manager.textContent?.includes("2곳"), "공용 수정 영향 안내 없음");
    input("단계: 확인", manager).click();
    button("저장", manager).click();
    await wait();
    assert(
      views.resolve(target).statuses?.join(",") === "1",
      "공용 수정 미적용",
    );
    assert(
      views.resolve({ kind: "branch", key: "TEST-2" }).statuses?.join(",") ===
        "1",
      "두 번째 연결 미적용",
    );
    button("QA 확인 삭제", manager).click();
    await wait();
    button("삭제", manager).click();
    await wait();
    assert(views.state.saved.length === 0, "뷰 삭제 실패");
    assert(
      views.binding(target).kind === "inline" &&
        views.resolve(target).statuses?.join(",") === "1",
      "삭제 후 적용 조건 유실",
    );
    button("닫기", manager).click();
    await wait();
    const restoredPicker = panel.element.querySelector<HTMLSelectElement>(
      ".view-picker select",
    );
    assert(
      restoredPicker?.value === "inline",
      "관리에서 삭제한 뷰의 이전 참조가 팝오버에 남음",
    );
    button("적용", panel.element).click();
    assert(
      views.resolve(target).statuses?.join(",") === "1",
      "관리에서 돌아와 적용할 때 조건이 유실됨",
    );
    panel.close();
  },
);
await check(
  "다시 편집해도 선택지 요청을 중복하지 않고 푸터가 팝오버 안에 있다",
  async () => {
    const before = metadataCalls,
      beforeUsers = userCalls;
    await edit();
    assert(
      metadataCalls === before && userCalls === beforeUsers,
      "같은 프로젝트 metadata 중복 요청",
    );
    const footer = panel.element.querySelector<HTMLElement>(".filter-footer");
    assert(
      footer &&
        footer.getBoundingClientRect().right <=
          panel.element.getBoundingClientRect().right + 1,
      "푸터가 영역 밖으로 나감",
    );
    assert(footer, "푸터 없음");
    const save = button("내 뷰로 저장", panel.element);
    assert(footer.contains(save), "저장 버튼이 스크롤 본문에 남음");
    assert(
      Math.abs(
        save.getBoundingClientRect().left -
          footer.getBoundingClientRect().left -
          Number.parseFloat(getComputedStyle(footer).paddingLeft),
      ) < 1,
      "저장 버튼이 푸터 왼쪽에 정렬되지 않음",
    );
    const top = footer.getBoundingClientRect().top;
    const body = panel.element.querySelector<HTMLElement>(".view-panel-body");
    assert(body, "스크롤 본문 없음");
    body.scrollTop = body.scrollHeight;
    await wait();
    assert(
      footer.getBoundingClientRect().top === top,
      "본문 스크롤이 푸터를 밀어냄",
    );
    for (const action of footer.querySelectorAll("button")) {
      const rect = action.getBoundingClientRect();
      assert(
        rect.left >= footer.getBoundingClientRect().left &&
          rect.right <= footer.getBoundingClientRect().right,
        "푸터 버튼이 가로 경계를 넘음",
      );
    }
    panel.close();
  },
);
await check(
  "관리 모달은 큰 창에서 넓게 쓰고 작은 창의 가로 경계를 넘지 않는다",
  async () => {
    panel.open(anchor, target.key);
    button("뷰 관리", panel.element).click();
    await wait();
    const manager = document.querySelector<HTMLDialogElement>(".view-manager");
    assert(manager?.open, "관리 모달 없음");
    const rect = manager.getBoundingClientRect();
    assert(
      rect.width >= Math.min(800, innerWidth - 24),
      "기존 설정 모달의 좁은 폭을 물려받음",
    );
    assert(rect.left >= 0 && rect.right <= innerWidth, "관리 모달 가로 넘침");
    button("닫기", manager).click();
    await wait();
    panel.close();
  },
);
await check(
  "사람 선택은 기준과 대상만 표시하고 직접 선택할 때 멤버를 펼친다",
  async () => {
    await edit();
    assert(
      !panel.element.querySelector(".people-filter-choices input"),
      "기본 상태에서 전체 멤버 노출",
    );
    const mode = panel.element.querySelector<HTMLSelectElement>(
      '[aria-label="표시할 사람"]',
    );
    const basis = panel.element.querySelector<HTMLSelectElement>(
      '[aria-label="사람 조건 기준"]',
    );
    assert(mode && basis, "기준·대상 선택기 누락");
    const beforeUsers = userCalls;
    mode.value = "custom";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
    await wait();
    assert(
      userCalls === beforeUsers + 1,
      "사용자 목록이 직접 선택 전에 이미 조회됨",
    );
    assert(
      panel.element.querySelector(".people-filter-choices input"),
      "직접 선택 목록 누락",
    );
    const section = panel.element.querySelector<HTMLElement>(
      ".people-filter-choices .filter-section",
    );
    assert(section, "멤버 영역 누락");
    button("선택 해제", section).click();
    basis.value = "assigned";
    basis.dispatchEvent(new Event("change", { bubbles: true }));
    mode.value = "me";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
    assert(
      !panel.element.querySelector(".people-filter-choices input"),
      "내 작업 전환 후 멤버 목록 잔존",
    );
    button("적용", panel.element).click();
    const definition = views.resolve(target, false);
    assert(
      definition.assignees === null &&
        branchDefaults({ ...filters, ...definition }).people === "assigned",
      "내 담당 조건이 실제 조회에 반영되지 않음",
    );
    views.apply(target, { ...filters, statuses: ["1", "2"] });
  },
);
await check(
  "미지정 작업 대상은 사용자 조회 없이 적용·복원하고 기준 전환을 유지한다",
  async () => {
    const original = views.binding(target);
    const beforeUsers = userCalls;
    try {
      await edit();
      const mode = panel.element.querySelector<HTMLSelectElement>(
        '[aria-label="표시할 사람"]',
      );
      const basis = panel.element.querySelector<HTMLSelectElement>(
        '[aria-label="사람 조건 기준"]',
      );
      assert(mode && basis, "사람 조건 없음");
      assert(
        mode.querySelector('option[value="unassigned"]')?.textContent ===
          "미지정 작업만",
        "미지정 대상 선택지 없음",
      );
      mode.value = "unassigned";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
      basis.value = "related";
      basis.dispatchEvent(new Event("change", { bubbles: true }));
      await wait();
      assert(
        userCalls === beforeUsers &&
          !panel.element.querySelector(".people-filter-choices input"),
        "미지정 대상이 멤버 목록을 조회하거나 노출함",
      );
      assert(
        panel.element
          .querySelector(".people-filter > .view-help")
          ?.textContent?.includes("모두"),
        "관계자 모두 미지정 기준 안내 없음",
      );
      button("적용", panel.element).click();
      assert(
        views.resolve(target, false).scope === "related" &&
          views.resolve(target, false).assignees?.join(",") === "unassigned",
        "미지정 조건 저장 실패",
      );
      await edit();
      const restoredMode = panel.element.querySelector<HTMLSelectElement>(
        '[aria-label="표시할 사람"]',
      );
      const restoredBasis = panel.element.querySelector<HTMLSelectElement>(
        '[aria-label="사람 조건 기준"]',
      );
      assert(
        restoredMode?.value === "unassigned" && restoredBasis,
        "미지정 대상 복원 실패",
      );
      restoredBasis.value = "assigned";
      restoredBasis.dispatchEvent(new Event("change", { bubbles: true }));
      assert(
        restoredMode.value === "unassigned",
        "기준 전환이 미지정을 다른 대상으로 바꿈",
      );
      assert(
        panel.element
          .querySelector(".view-current-summary")
          ?.textContent?.includes("담당자 미지정"),
        "미지정 조건 요약 없음",
      );
      restoredBasis.value = "related";
      restoredBasis.dispatchEvent(new Event("change", { bubbles: true }));
      restoredMode.value = "custom";
      restoredMode.dispatchEvent(new Event("change", { bubbles: true }));
      await wait();
      assert(
        panel.element.querySelectorAll(".people-filter-choices input:checked")
          .length === 0,
        "직접 선택에 보이지 않는 미지정 계정이 남음",
      );
    } finally {
      panel.close();
      views.select(target, original);
    }
  },
);

await check(
  "관리에서 새 뷰와 복제 등록은 현재 적용 조건을 바꾸지 않는다",
  async () => {
    const before = views.resolve(target, false);
    panel.open(anchor, target.key);
    button("뷰 관리", panel.element).click();
    const manager = document.querySelector<HTMLDialogElement>(".view-manager");
    assert(manager?.open, "관리 모달 없음");
    button("새 뷰", manager).click();
    await wait();
    input("뷰 이름", manager).value = "새 등록";
    button("등록", manager).click();
    await wait();
    button("새 등록 복제하여 편집", manager).click();
    await wait();
    input("단계: 완료", manager).click();
    button("등록", manager).click();
    await wait();
    assert(views.state.saved.length === 2, "복제가 원래 뷰를 덮어씀");
    assert(
      JSON.stringify(views.resolve(target, false)) === JSON.stringify(before),
      "관리 등록이 부모 조건을 변경함",
    );
    const clone = views.state.saved.find(
      (view) => view.name === "새 등록 복사",
    );
    assert(clone, "복제 뷰 없음");
    views.select(
      { kind: "branch", key: "TEST-2" },
      { kind: "saved", viewId: clone.id },
    );
    button("닫기", manager).click();
    await wait();
    button("뷰 관리", panel.element).click();
    assert(manager.textContent?.includes("TEST-2"), "뷰 사용 위치 누락");
    assert(manager.scrollWidth <= manager.clientWidth, "관리 목록 가로 넘침");
    button("닫기", manager).click();
    panel.close();
  },
);
await check(
  "긴 뷰 이름은 선택 메뉴와 관리 목록의 가로 경계를 넘지 않는다",
  async () => {
    const name = "LongViewName".repeat(6);
    views.create({ ...filters, assignees: [] }, name);
    panel.open(anchor, target.key);
    button("사용할 뷰", panel.element).click();
    const choices = document.querySelector<HTMLElement>(
      ".view-picker .select-options:popover-open",
    );
    assert(choices, "뷰 선택 메뉴 없음");
    assert(
      choices.scrollWidth <= choices.clientWidth,
      "긴 이름이 선택 메뉴 밖으로 나감",
    );
    button("사용할 뷰", panel.element).click();
    button("뷰 관리", panel.element).click();
    const manager = document.querySelector<HTMLDialogElement>(".view-manager");
    assert(manager?.open, "관리 목록 없음");
    assert(
      manager.scrollWidth <= manager.clientWidth,
      "긴 이름이 관리 목록 밖으로 나감",
    );
    button("닫기", manager).click();
    panel.close();
  },
);
await check(
  "대규모 멤버의 전체 선택은 계정 배열 없이 전체 조건으로 저장한다",
  async () => {
    const draft = createViewDraft({
      ...filters,
      scope: "assigned",
      assignees: [],
    });
    const users = Array.from({ length: 1000 }, (_, n) => ({
      id: `account-${n}`,
      name: `사용자 ${n}`,
      avatar: "",
    }));
    const people = createPeopleFilter(
      draft,
      users,
      { accountId: "account-me", displayName: "나" },
      () => {},
    );
    host.append(people.element);
    try {
      button("전체 선택", people.element).click();
      assert(
        draft.value.scope === "all" && draft.value.assignees === null,
        "전체 선택이 200명 상한을 넘는 배열이 됨",
      );
      assert(
        !people.element.querySelector(".people-filter-choices input"),
        "전체 작업 전환 뒤 멤버 목록 잔존",
      );
      const mode = people.element.querySelector<HTMLSelectElement>(
        '[aria-label="표시할 사람"]',
      );
      assert(mode?.value === "all", "대상 선택기와 조건 불일치");
    } finally {
      people.destroy();
    }
  },
);
document.body.dataset.testFailures = String(failures);
document.title = failures ? `뷰 검사 ${failures}개 실패` : "뷰 검사 통과";
