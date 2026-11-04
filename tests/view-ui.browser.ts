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
const filters: Filters = {
  projects: ["TEST"],
  scope: "all",
  sort: "recent",
  statuses: null,
  assignees: null,
  excludeDone: false,
  q: "",
};
const catalog: TreeCatalog = {
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
  const follow = panel.element.querySelector<HTMLInputElement>(
    '[aria-label="현재 탭 필터 따라가기"]',
  );
  if (key && follow?.checked) follow.click();
  await wait();
  assert(
    panel.element.querySelector('[aria-label="단계: 완료"]'),
    "조건 편집기 없음",
  );
}
await check("하위 필터는 프로젝트·뷰 관리를 중복하지 않는다", async () => {
  await edit();
  assert(
    panel.element.getAttribute("aria-label") === "하위 목록 필터",
    "필터 제목",
  );
  assert(
    panel.element.querySelector(".view-panel-scope")?.textContent ===
      "TEST-1의 하위 목록에 적용",
    "탭 범위 안내",
  );
  assert(panel.element.querySelector(".view-editor"), "조건 편집기");
  assert(
    !panel.element.querySelector(
      '[aria-label="사용할 뷰"], [aria-label="뷰 이름"], .view-picker',
    ),
    "중복 뷰 UI 잔존",
  );
  assert(
    !panel.element.textContent?.includes("뷰 관리") &&
      !panel.element.textContent?.includes("내 뷰로 저장"),
    "관리·등록 액션 잔존",
  );
  assert(
    !panel.element.querySelector('[aria-label^="프로젝트:"]'),
    "프로젝트 편집 중복",
  );
  assert(userCalls === 0, "멤버를 미리 조회함");
  panel.close();
});
await check("필터는 즉시 저장되고 닫거나 다시 열어도 유지한다", async () => {
  views.select(target, { kind: "default" });
  await edit();
  input("단계: 완료", panel.element).click();
  assert(
    views.resolve(target, false).statuses?.join() === "1,2",
    "즉시 저장 누락",
  );
  button("닫기", panel.element).click();
  await edit();
  assert(!input("단계: 완료", panel.element).checked, "닫은 뒤 조건 초기화");
  input("다른 사람도 보기", panel.element).click();
  button("닫기", panel.element).click();
  panel.open(anchor, target.key);
  assert(
    input("다른 사람도 보기", panel.element).checked,
    "닫기가 임시 조건을 되돌림",
  );
  assert(
    ![...panel.element.querySelectorAll("button")].some(
      (b) => b.textContent === "적용" || b.textContent === "취소",
    ),
    "중복 저장 버튼 잔존",
  );
  panel.close();
  views.select(target, { kind: "default" });
});
await check(
  "하위 필터 적용은 다른 하위 목록과 탭 조건을 유지한다",
  async () => {
    const other = { kind: "branch", key: "TEST-2" } as const;
    views.apply(other, { ...filters, statuses: ["1"] });
    await edit();
    input("단계: 완료", panel.element).click();
    assert(views.resolve(target).statuses?.join() === "1,2", "하위 필터 저장");
    assert(
      views.resolve(other).statuses?.join() === "1",
      "다른 하위 조건 유실",
    );
    assert(views.resolve({ kind: "global" }).statuses === null, "탭 필터 변경");
    assert(filters.projects.join() === "TEST", "프로젝트 범위 변경");
  },
);
await check(
  "하위 목록은 탭 필터를 상속하거나 개별 조건만 설정한다",
  async () => {
    views.select(target, { kind: "default" });
    panel.open(anchor, target.key);
    await wait();
    assert(
      input("현재 탭 필터 따라가기", panel.element).checked,
      "상속 선택 누락",
    );
    assert(
      !panel.element.querySelector(".view-editor"),
      "상속 상태에서 편집기 조회",
    );
    assert(
      panel.element.querySelector("h2")?.textContent === "하위 목록 필터",
      "적용 범위 제목",
    );
    input("현재 탭 필터 따라가기", panel.element).click();
    await wait();
    input("단계: 완료", panel.element).click();
    assert(views.binding(target).kind !== "default", "개별 필터 저장");
    assert(
      views.resolve({ kind: "global" }).statuses === null,
      "탭 필터가 바뀜",
    );
    panel.open(anchor, target.key);
    input("현재 탭 필터 따라가기", panel.element).click();
    assert(views.binding(target).kind === "default", "상속 복원 실패");
  },
);
await check("기존 저장 뷰도 즉시 편집하고 닫은 뒤 유지한다", async () => {
  views.register(target, { ...filters, statuses: ["2"] }, "이전 저장 조건");
  const before = JSON.stringify(views.state);
  await edit();
  assert(
    !input("단계: 시작", panel.element).checked &&
      input("단계: 확인", panel.element).checked,
    "이전 조건 복원",
  );
  input("단계: 시작", panel.element).click();
  const after = JSON.stringify(views.state);
  assert(after !== before, "기존 뷰 편집이 반영되지 않음");
  button("닫기", panel.element).click();
  assert(JSON.stringify(views.state) === after, "닫기가 저장 조건을 바꿈");
});
await check("선택지는 재사용하고 불필요한 저장 푸터는 없다", async () => {
  const before = metadataCalls + userCalls;
  for (let n = 0; n < 3; n++) {
    await edit();
    panel.close();
  }
  assert(metadataCalls + userCalls === before, "반복 열기로 추가 조회");
  assert(!panel.element.querySelector(".filter-footer"), "저장 푸터 잔존");
});
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
  "작업관계자 미지정 포함을 켜고 끈 뒤 저장된 뷰에서 복원한다",
  async () => {
    const draft = createViewDraft({
      ...filters,
      scope: "related",
      assignees: null,
    });
    const people = createPeopleFilter(
      draft,
      [],
      { accountId: "account-me", displayName: "검사 계정" },
      () => {},
    );
    host.append(people.element);
    try {
      const check = input(
        "아무 작업관계자도 없는 항목도 같이 볼게요",
        people.element,
      );
      assert(
        !check.checked && !check.closest("label")?.hidden,
        "기본 체크 상태 오류",
      );
      check.click();
      assert(draft.value.includeUnassigned === true, "미지정 포함 저장 누락");
      const restored = createViewDraft(draft.value);
      const again = createPeopleFilter(
        restored,
        [],
        { accountId: "account-me", displayName: "검사 계정" },
        () => {},
      );
      host.append(again.element);
      assert(
        input("아무 작업관계자도 없는 항목도 같이 볼게요", again.element)
          .checked,
        "저장값 복원 누락",
      );
      again.destroy();
      check.click();
      assert(!draft.value.includeUnassigned, "미지정 포함 해제 누락");
    } finally {
      people.destroy();
    }
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
          .querySelector(".people-filter > .view-help")
          ?.textContent?.includes("담당자가 비어"),
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
await check(
  "선택지 실패는 적용을 막고 다시 불러오면 편집할 수 있다",
  async () => {
    views.apply(target, filters);
    let attempts = 0;
    const retryPanel = createFilterPanel(
      {
        statuses: async () => {
          if (++attempts === 1) throw new Error("선택지 조회 실패");
          return statuses;
        },
        users: async () => [],
        types: async () => [],
      },
      { accountId: "account-me", displayName: "검사 계정" },
      {
        filters: () => filters,
        catalog: () => ({ ...catalog, statuses: [] }),
        views,
      },
    );
    try {
      retryPanel.open(anchor, target.key);
      await wait();
      assert(
        !retryPanel.element.querySelector(".view-editor"),
        "조회 실패 후 적용 허용",
      );
      assert(
        retryPanel.element.querySelector('[role="alert"]')?.textContent ===
          "선택지 조회 실패",
        "오류 안내 누락",
      );
      button("다시 불러오기", retryPanel.element).click();
      await wait();
      assert(
        retryPanel.element.querySelector(".view-editor"),
        "재시도 후 편집 실패",
      );
      assert(attempts === 2, "재시도 조회 누락");
    } finally {
      retryPanel.destroy();
    }
  },
);
await check(
  "닫은 필터의 늦은 응답은 편집기를 다시 만들거나 카탈로그를 바꾸지 않는다",
  async () => {
    let resolve: ((value: typeof statuses) => void) | undefined;
    let updated = false;
    const latePanel = createFilterPanel(
      {
        statuses: () =>
          new Promise((done) => {
            resolve = done;
          }),
        users: async () => [],
        types: async () => [],
      },
      { accountId: "account-me", displayName: "검사 계정" },
      {
        filters: () => filters,
        catalog: () => ({ ...catalog, statuses: [] }),
        views,
        onCatalog: () => {
          updated = true;
        },
      },
    );
    try {
      latePanel.open(anchor, target.key);
      latePanel.close();
      resolve?.(statuses);
      await wait();
      assert(
        !updated && !latePanel.element.querySelector(".view-editor"),
        "닫은 필터에 응답 반영",
      );
    } finally {
      latePanel.destroy();
    }
  },
);
document.body.dataset.testFailures = String(failures);
document.title = failures ? `뷰 검사 ${failures}개 실패` : "뷰 검사 통과";
