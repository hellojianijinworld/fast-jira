import "../src/client/styles.css";
import { createListController } from "../src/client/list-controller.ts";
import { emptyIssue } from "../src/domain/wire.ts";
import { createTreeView } from "../src/ui/tree-view.ts";

const host = document.querySelector<HTMLElement>("#fixture");
const results = document.querySelector("#results");
if (!host || !results) throw Error("검사 화면 누락");
const parent = {
  ...emptyIssue("TEST-1", "상위 작업"),
  project: "TEST",
  hasChildren: true,
};
const child = {
  ...emptyIssue("TEST-2", "하위 작업"),
  project: "TEST",
  parent: parent.key,
};
const next = { ...emptyIssue("TEST-3", "다음 작업"), project: "TEST" };
const list = createListController(
  {
    issues: async () => ({
      issues: [parent, next],
      ancestors: [],
      nextPageToken: null,
    }),
    children: async () => ({ issues: [child], nextPageToken: null }),
  },
  {
    sort: "recent",
    q: "",
    statuses: null,
    assignees: null,
    projects: ["TEST"],
    scope: "all",
    excludeDone: false,
  },
  "me",
);
list.updateMany([parent, next], new Set([parent.key, next.key]));
list.toggle(parent.key, false);
const page = list.childPage(parent.key);
page.issues.set(child.key, child);
page.loaded = true;
page.restored = { count: 1, complete: true };
const tree = createTreeView(host, list, {
  catalog: () => ({ projects: [], statuses: [], priorities: [], types: [] }),
  site: "fixture.atlassian.net",
  copied: () => {},
  selectedKey: () => "",
  onSelect: () => {},
  onBranch: () => {},
  onTreeChange: () => {},
});
const top = () => {
  const node = host.querySelector<HTMLAnchorElement>('a[href="?issue=TEST-3"]');
  if (!node) throw Error("다음 카드 누락");
  return node.getBoundingClientRect().top;
};
tree.render();
const before = top();
page.restored = undefined;
tree.render();
const after = top();
results.textContent =
  Math.abs(before - after) < 0.5
    ? "통과: 같은 캐시의 재검증 전후 다음 카드 위치 유지"
    : `실패: 재검증만으로 ${before - after}px 이동`;
const first = document.createElement("li");
first.textContent = results.textContent;
results.replaceChildren(first);
page.issues.clear();
page.restored = { count: 0, complete: true };
tree.render();
const emptyBefore = top();
page.restored = undefined;
tree.render();
const emptyAfter = top();
const empty = document.createElement("li");
empty.textContent =
  Math.abs(emptyBefore - emptyAfter) < 0.5
    ? "통과: 빈 캐시의 재검증도 카드 간격 유지"
    : `실패: 빈 재검증으로 ${emptyBefore - emptyAfter}px 이동`;
results.append(empty);
