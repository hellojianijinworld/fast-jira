import "../src/client/styles.css";
import { createApi } from "../src/client/api.ts";
import { createListController } from "../src/client/list-controller.ts";
import { emptyIssue } from "../src/domain/wire.ts";
import { createBulkSelection } from "../src/ui/bulk-selection.ts";
import { element } from "../src/ui/dom.ts";
import { createTreeView } from "../src/ui/tree-view.ts";

const host = document.querySelector<HTMLElement>("#fixture");
const results = document.querySelector<HTMLElement>("#results");
if (!host || !results) throw new Error("검사 화면 누락");
const listHost = element("div"),
  side = element("aside"),
  toggle = element("button", "", "선택 모드");
host.append(toggle, listHost, side);
const parent = {
  ...emptyIssue("TEST-833", "하위 작업이 있는 부모"),
  hasChildren: true,
};
const children = [847, 848, 849].map((number) => ({
  ...emptyIssue(`TEST-${number}`, `하위 ${number}`),
  parent: parent.key,
}));
const hidden = {
  ...emptyIssue("TEST-850", "필터로 숨긴 하위"),
  parent: parent.key,
  assigneeId: "other",
};
const list = createListController(
  {
    issues: async () => ({
      issues: [parent, ...children, hidden],
      ancestors: [],
      nextPageToken: null,
    }),
    children: async () => ({ issues: [], nextPageToken: null }),
  },
  {
    projects: ["TEST"],
    scope: "assigned",
    assignees: ["unassigned"],
    statuses: null,
    sort: "recent",
    excludeDone: false,
    q: "",
  },
  "me",
);
await list.load();
list.childPage(parent.key).loaded = true;
const notices: string[] = [];
const bulk = createBulkSelection({
  host,
  mount: side,
  toggle,
  site: "fixture.atlassian.net",
  api: createApi(),
  order: () => [],
  render: () => tree.render(),
  changed: async () => {},
  notice: (message) => notices.push(message),
});
const tree = createTreeView(listHost, list, {
  catalog: () => ({ projects: [], types: [], statuses: [], priorities: [] }),
  site: "fixture.atlassian.net",
  copied: () => {},
  selectedKey: () => "",
  onSelect: () => {},
  onBranch: () => {},
  onTreeChange: () => {},
  decorate: bulk.decorate,
  selectionGroup: bulk.groupControl,
});
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function check(key: string) {
  const input = host?.querySelector<HTMLInputElement>(
    `[data-select-key="${key}"]`,
  );
  assert(input, `선택 항목 없음: ${key}`);
  return input;
}
try {
  tree.render();
  assert(
    !host.querySelector("[data-select-group]"),
    "일반 모드에 전체 선택 노출",
  );
  toggle.click();
  let group = host.querySelector<HTMLInputElement>("[data-select-group]");
  assert(
    group && !group.checked && !group.indeterminate,
    "선택 없음 상태 누락",
  );
  assert(
    !host.querySelector('[data-select-key="TEST-850"]'),
    "필터 제외 하위가 표시됨",
  );
  assert(
    Math.abs(
      group.getBoundingClientRect().left -
        check("TEST-847").getBoundingClientRect().left,
    ) <= 1,
    "전체 선택 체크박스가 하위 선택 열과 어긋남",
  );
  check("TEST-847").click();
  assert(
    group.indeterminate &&
      !group.checked &&
      group.getAttribute("aria-checked") === "mixed",
    "일부 선택 상태 누락",
  );
  group.click();
  assert(
    group.checked && !group.indeterminate && Number(bulk.keys.length) === 3,
    "일부 선택에서 전체 선택 실패",
  );
  assert(
    !check(parent.key).checked && !bulk.keys.includes(hidden.key),
    "부모나 숨긴 항목이 함께 선택됨",
  );
  check(parent.key).click();
  group.click();
  assert(
    !group.checked &&
      !group.indeterminate &&
      Number(bulk.keys.length) === 1 &&
      bulk.keys[0] === parent.key,
    "전체 해제 시 부모 선택이 바뀜",
  );
  group.click();
  tree.render();
  group = host.querySelector<HTMLInputElement>("[data-select-group]");
  assert(group?.checked, "다시 렌더링할 때 전체 선택 상태 유실");
  check("TEST-848").click();
  tree.render();
  group = host.querySelector<HTMLInputElement>("[data-select-group]");
  assert(group?.indeterminate, "다시 렌더링할 때 일부 선택 상태 유실");
  bulk.reset();
  for (let index = 1; index <= 49; index++) {
    const card = bulk.decorate(emptyIssue(`EXTRA-${index}`), element("div"));
    host.append(card);
    check(`EXTRA-${index}`).click();
  }
  group.click();
  assert(
    Number(bulk.keys.length) === 49 && notices.length === 1 && !group.checked,
    "50개 초과 시 일부만 선택하거나 제한 누락",
  );
  results.append(
    element(
      "li",
      "",
      "통과 · 하위 전체 선택의 세 상태·부모 분리·필터 제외·50개 제한·렌더링 복원",
    ),
  );
  results.dataset.failures = "0";
} catch (error) {
  results.append(
    element(
      "li",
      "error",
      `실패 · ${error instanceof Error ? error.message : String(error)}`,
    ),
  );
  results.dataset.failures = "1";
} finally {
  results.dataset.complete = "true";
}
