import "../src/client/styles.css";
import { createApi } from "../src/client/api.ts";
import { createAccountStore } from "../src/client/preferences.ts";
import type { IssueDetails } from "../src/domain/details.ts";
import type { ParticipantChange } from "../src/domain/participants.ts";
import { issueParticipantFields } from "../src/domain/participants.ts";
import { emptyIssue } from "../src/domain/wire.ts";
import { element } from "../src/ui/dom.ts";
import { issueCard } from "../src/ui/issue-card.ts";
import { issueDetail } from "../src/ui/issue-detail.ts";
import { participantsField } from "../src/ui/participants.ts";

const host = document.querySelector("#fixture"),
  results = document.querySelector("#results");
if (!host || !results) throw new Error("검사 화면 없음");
const member = (id: string, name: string) => ({ id, name, avatar: "" });
const alice = member("member-alice", "Alice"),
  bob = member("member-bob", "Bob"),
  charlie = member("member-charlie", "Charlie");
let issue: IssueDetails = {
  ...emptyIssue("TEST-1", "작업참여자는 역할 구분 없이 간단하게 표시"),
  status: "진행 중",
  statusId: "3",
  priority: "보통",
  priorityId: "2",
  assignee: alice.name,
  assigneeId: alice.id,
  reporter: "보고자",
  reporterAvatar: "",
  created: "2026-10-26T00:00:00Z",
  url: "https://example.atlassian.net/browse/TEST-1",
  description: null,
  attachments: [],
  participantFields: [
    { id: "customfield_101", name: "개발", multiple: false, users: [alice] },
    {
      id: "customfield_202",
      name: "협업",
      multiple: true,
      users: [alice, bob],
    },
    { id: "customfield_303", name: "기획", multiple: false, users: [] },
  ],
};
let historyRequests = 0;
const oldDescription = `공통 시작\n${"긴 변경 전 설명 ".repeat(70)}\n공통 끝`;
const newDescription = `공통 시작\n${"긴 변경 후 설명 ".repeat(70)}\n공통 끝`;
let writes = 0,
  holds = 0,
  saved = 0,
  shouldFail = false;
let delayDefault = false;
let completeDefault: ((response: Response) => void) | undefined;
let delaySearch = false,
  delaySave = false;
let completeSearch: ((response: Response) => void) | undefined;
let completeSave: (() => void) | undefined;
let sent: ParticipantChange[] = [];
const notices: string[] = [];
const api = createApi(async (input, init) => {
  const url = new URL(String(input), location.origin);
  if (url.pathname === "/api/participant-options")
    return Response.json(
      issueParticipantFields(issue).map((field) => ({
        ...field,
        required: false,
      })),
    );
  if (url.pathname === "/api/participant-users") {
    if (delayDefault && !url.searchParams.get("q"))
      return new Promise<Response>((resolve) => {
        completeDefault = resolve;
      });
    if (delaySearch && url.searchParams.get("q"))
      return new Promise<Response>((resolve) => {
        completeSearch = resolve;
      });
    return Response.json([charlie]);
  }
  if (url.pathname === "/api/participants") {
    writes++;
    sent = JSON.parse(String(init?.body)).changes;
    if (shouldFail)
      return Response.json({ error: "권한 없음" }, { status: 403 });
    issue = {
      ...issue,
      ...(sent.some((change) => change.id === "assignee")
        ? {
            assigneeId:
              sent.find((change) => change.id === "assignee")?.userIds[0] ?? "",
            assignee: sent.find((change) => change.id === "assignee")?.userIds
              .length
              ? charlie.name
              : "",
          }
        : {}),
      participantFields:
        issue.participantFields?.map((field) => {
          const change = sent.find((change) => change.id === field.id);
          return change
            ? {
                ...field,
                users: [alice, bob, charlie].filter((user) =>
                  change.userIds.includes(user.id),
                ),
              }
            : field;
        }) ?? [],
    };
    if (delaySave)
      await new Promise<void>((resolve) => {
        completeSave = resolve;
      });
    return Response.json(issue);
  }
  if (url.pathname === "/api/comments")
    return Response.json({ comments: [], total: 0, nextStartAt: null });
  if (url.pathname === "/api/ancestors") return Response.json([]);
  if (url.pathname === "/api/history") {
    historyRequests++;
    return Response.json({
      before: null,
      entries: Array.from({ length: 30 }, (_, index) => ({
        id: String(index),
        author: "동료",
        avatar: "",
        created: issue.created,
        changes: [
          index === 0
            ? { field: "description", from: oldDescription, to: newDescription }
            : { field: "status", from: "대기", to: "진행 중" },
        ],
      })),
    });
  }
  throw new Error(`예상하지 않은 요청: ${url.pathname}`);
});
const peopleData = new Map<string, string>();
const peopleStorage = {
  getItem: (key: string) => peopleData.get(key) ?? null,
  setItem: (key: string, value: string) => {
    peopleData.set(key, value);
  },
};
const peopleStore = createAccountStore(
  peopleStorage,
  "example.atlassian.net",
  alice.id,
);
const view = participantsField(api, issue, {
  me: alice,
  recents: peopleStore.people,
  hold() {
    holds++;
    return () => {
      holds--;
    };
  },
  busy() {},
  async saved() {
    saved++;
  },
  notice(text) {
    notices.push(text);
  },
});
host.append(view.element);
const wait = () => new Promise((resolve) => setTimeout(resolve, 20));
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function summaryNames() {
  return [...(host?.querySelectorAll(".participant-summary .avatar") ?? [])]
    .map((node) => node.getAttribute("title"))
    .join(",");
}
async function closeDialog() {
  const dialog = host?.querySelector<HTMLDialogElement>("dialog");
  assert(dialog, "편집 창 없음");
  const closed = new Promise((resolve) =>
    dialog.addEventListener("close", resolve, { once: true }),
  );
  dialog.close();
  await closed;
}
function button(label: string) {
  const found = host?.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  assert(found, `버튼 없음: ${label}`);
  return found;
}
let failures = 0;
async function check(name: string, inspect: () => Promise<void> | void) {
  try {
    await inspect();
    results?.append(element("li", "", `통과 · ${name}`));
  } catch (error) {
    failures++;
    results?.append(element("li", "error", `실패 · ${name}: ${String(error)}`));
  }
}
await check(
  "저장된 참여자는 중복을 제거하고 실제 필드명을 노출하지 않는다",
  () => {
    const summary = host.querySelector(".participant-summary");
    assert(summary, "요약 없음");
    assert(summaryNames() === "Alice,Bob", "이름이 중복되거나 역할이 노출됨");
  },
);
await check(
  "편집할 때만 필드가 나타나고 취소는 요청 없이 입력을 버린다",
  async () => {
    button("작업참여자 변경").click();
    await wait();
    assert(
      holds === 1 && host.querySelector("dialog[open]"),
      "편집 중 새로고침을 막지 않음",
    );
    assert(
      host.querySelector("dialog")?.textContent?.includes("기획"),
      "빈 필드 누락",
    );
    const remove = button("개발 Alice 해제");
    assert(
      remove.parentElement?.classList.contains("person-pill"),
      "해제 X가 배지 밖에 있음",
    );
    const rows = [
      ...host.querySelectorAll<HTMLElement>(".participant-edit-row"),
    ];
    assert(
      rows.every((row) =>
        [...row.querySelectorAll("button")].some(
          (button) => button.textContent === "나에게 할당",
        ),
      ),
      "일부 필드에 나에게 할당 없음",
    );
    const multiple = rows.find((row) => row.textContent?.includes("협업"));
    assert(multiple, "다중 필드 없음");
    const bobRemove = button("협업 Bob 해제");
    [...multiple.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "나에게 할당")
      ?.click();
    assert(
      button("협업 Bob 해제") && bobRemove.isConnected === false,
      "나에게 할당이 다른 참여자를 제거함",
    );
    remove.click();
    await closeDialog();
    assert(
      writes === 0 && Number(holds) === 0,
      "취소가 저장되거나 새로고침 잠금이 남음",
    );
  },
);
await check(
  "이미 지정한 사람은 해당 필드 후보에서 빠지고 해제하면 다시 나타난다",
  async () => {
    button("작업참여자 변경").click();
    await wait();
    button("협업 지정").click();
    await wait();
    const row = button("협업 지정").closest(".participant-edit-row");
    const select = row?.querySelector("select");
    assert(select, "참여자 셀렉트 없음");
    assert(
      ![...select.options].some(
        (option) => option.value === alice.id || option.value === bob.id,
      ),
      "지정된 사람이 후보에 남음",
    );
    assert(
      [...select.options].some((option) => option.value === charlie.id),
      "미지정 후보 누락",
    );
    button("협업 Alice 해제").click();
    button("협업 지정").click();
    await wait();
    assert(
      [...select.options].some((option) => option.value === alice.id),
      "해제한 사람이 후보에 돌아오지 않음",
    );
    assert(
      ![...select.options].some((option) => option.value === bob.id),
      "다른 지정자가 후보에 나타남",
    );
    await closeDialog();
  },
);
await check(
  "검색 Enter는 저장하지 않고 선택 후 변경한 실제 필드만 저장한다",
  async () => {
    button("작업참여자 변경").click();
    await wait();
    button("개발 지정").click();
    await wait();
    const search = host.querySelector<HTMLFormElement>(
      ".select-options:popover-open .select-search",
    );
    assert(search, "사용자 검색 없음");
    const input = search.querySelector<HTMLInputElement>("input");
    assert(input, "검색 입력 없음");
    input.value = "Charlie";
    search.requestSubmit();
    await wait();
    assert(writes === 0, "검색 Enter가 참여자를 저장함");
    const option = host.querySelector<HTMLButtonElement>(
      ".select-options:popover-open .select-option",
    );
    assert(option, "검색 후보 없음");
    option.click();
    const dialog = host.querySelector<HTMLDialogElement>("dialog");
    assert(dialog, "편집 창 없음");
    const closed = new Promise((resolve) =>
      dialog.addEventListener("close", resolve, { once: true }),
    );
    host.querySelector<HTMLFormElement>(".participant-form")?.requestSubmit();
    await closed;
    assert(Number(writes) === 1 && saved === 1, "저장 실패");
    assert(
      JSON.stringify(sent) ===
        JSON.stringify([
          { id: "customfield_101", userIds: ["member-charlie"] },
        ]),
      "다른 역할까지 변경함",
    );
    assert(
      summaryNames() === "Alice,Charlie,Bob",
      "저장 후 합쳐진 표시가 아님",
    );
    assert(
      notices.some((text) => text.includes("변경됨")) && Number(holds) === 0,
      "저장 안내 또는 잠금 해제 없음",
    );
  },
);
await check(
  "검색 없이 최근 선택을 먼저 보여주고 검색창 대신 후보에 포커스를 둔다",
  async () => {
    delayDefault = true;
    button("작업참여자 변경").click();
    await wait();
    button("협업 지정").click();
    await wait();
    const menu = host.querySelector<HTMLElement>(
      ".select-options:popover-open",
    );
    let first = menu?.querySelector<HTMLButtonElement>(".select-option");
    assert(
      first?.querySelector(".person-name")?.textContent === "Charlie",
      "추가 후보 응답 전에 최근 선택을 표시하지 못함",
    );
    assert(completeDefault, "지연 후보 조회 없음");
    completeDefault(Response.json([charlie, alice]));
    await wait();
    first = menu?.querySelector<HTMLButtonElement>(".select-option");
    assert(
      first && document.activeElement === first,
      "후보 보강 후 키보드 포커스가 사라짐",
    );
    delayDefault = false;
    const remembered = createAccountStore(
      peopleStorage,
      "example.atlassian.net",
      alice.id,
    ).people.recent();
    assert(
      remembered[0]?.id === charlie.id,
      "최근 선택이 모달 밖에 저장되지 않음",
    );
    first.click();
    assert(button("협업 Charlie 해제"), "검색 없이 후보를 지정하지 못함");
    await closeDialog();
  },
);
await check(
  "저장 실패는 편집값과 기존 참여자를 유지하고 오류를 알린다",
  async () => {
    shouldFail = true;
    button("작업참여자 변경").click();
    await wait();
    button("개발 Charlie 해제").click();
    host.querySelector<HTMLFormElement>(".participant-form")?.requestSubmit();
    await wait();
    assert(host.querySelector("dialog[open]"), "실패했는데 편집 창이 닫힘");
    assert(
      host.querySelector(".participant-form > .error")?.textContent ===
        "권한 없음",
      "오류 없음",
    );
    assert(summaryNames() === "Alice,Charlie,Bob", "실패값이 요약에 반영됨");
    await closeDialog();
    shouldFail = false;
  },
);
await check(
  "저장 중 도착한 검색 응답이 선택 컨트롤을 다시 활성화하지 않는다",
  async () => {
    delaySearch = delaySave = true;
    button("작업참여자 변경").click();
    await wait();
    button("개발 Charlie 해제").click();
    button("협업 지정").click();
    await wait();
    const search = host.querySelector<HTMLFormElement>(
      ".select-options:popover-open .select-search",
    );
    assert(search, "검색 없음");
    const input = search.querySelector<HTMLInputElement>("input");
    assert(input, "검색 입력 없음");
    input.value = "Charlie";
    search.requestSubmit();
    await wait();
    button("협업 지정").click();
    const dialog = host.querySelector<HTMLDialogElement>("dialog");
    assert(dialog, "편집창 없음");
    const closed = new Promise((resolve) =>
      dialog.addEventListener("close", resolve, { once: true }),
    );
    host.querySelector<HTMLFormElement>(".participant-form")?.requestSubmit();
    await wait();
    assert(completeSearch && completeSave, "지연 요청 없음");
    completeSearch(Response.json([charlie]));
    await wait();
    const disabled = button("협업 지정").disabled;
    completeSave();
    await closed;
    delaySearch = delaySave = false;
    assert(disabled, "늦은 검색 응답이 저장 중 선택을 활성화함");
  },
);
view.destroy();
host.replaceChildren();
// 실제 상세 컴포넌트로 데스크톱·좁은 화면의 표시를 확인한다. 모든 통신은 위 모의 API로만 처리한다.
const detail = issueDetail(
  {
    parent: {
      ...issue,
      parent: "TEST-10",
      parentSummary: "같은 줄에 표시할 상위 경로",
      issueType: "작업",
    },
    children: [],
    deferredChildren: false,
    dateEditing: true,
    imageEnabled: false,
  },
  ["진행 중"],
  () => {},
  (text) => notices.push(text),
  api,
  { accountId: alice.id, displayName: alice.name },
  () => {},
  () => {},
  () => {},
  new Map([
    [
      "TEST-10",
      {
        ...emptyIssue("TEST-10", "같은 줄에 표시할 상위 경로"),
        issueType: "에픽",
      },
    ],
  ]),
);
host.append(detail.element);
await check(
  "상세와 카드는 같은 크기·테두리의 겹친 아바타를 쓰고 내 계정을 맨 앞에 둔다",
  () => {
    const card = issueCard(issue, {
      currentUserId: alice.id,
      statusOrder: [],
      onSelect() {},
    });
    host.append(card);
    const stack = card.querySelector(".participant-avatars");
    assert(stack, "카드 참여자 누락");
    const avatars = [...stack.querySelectorAll<HTMLElement>(".avatar")];
    assert(avatars[0]?.title === "Alice", "본인 우선 순서 누락");
    assert(avatars.length === 2, "담당자 중복 표시");
    const [self, other] = avatars.map((avatar) => ({
      width: avatar.getBoundingClientRect().width,
      height: avatar.getBoundingClientRect().height,
      border: getComputedStyle(avatar).border,
    }));
    assert(
      JSON.stringify(self) === JSON.stringify(other),
      "본인 아바타 크기·테두리가 다름",
    );
    assert(
      (avatars[1]?.getBoundingClientRect().left ?? Infinity) <
        (avatars[0]?.getBoundingClientRect().right ?? 0),
      "아바타가 겹치지 않음",
    );
    const summary = detail.element.querySelector(".participant-summary");
    assert(
      summary?.querySelector("use")?.getAttribute("href")?.endsWith("#users"),
      "Users 아이콘 누락",
    );
    assert(
      !summary?.querySelector(".person-name"),
      "읽기 표시에 이름 배지가 남음",
    );
  },
);
await check(
  "상위 경로와 현재 이슈는 같은 헤더 줄에 있고 별도 담당자·보고자 필드는 없다",
  () => {
    const head = detail.element.querySelector(".detail-head");
    const parent = head?.querySelector(".detail-breadcrumbs a");
    const current = head?.querySelector(".breadcrumb-current");
    assert(parent && current, "경로가 별도 행에 있음");
    const a = parent.getBoundingClientRect(),
      b = current.getBoundingClientRect();
    assert(
      Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 4,
      "경로가 한 줄이 아님",
    );
    assert(
      !detail.element.querySelector('.detail-fields [aria-label="담당자"]'),
      "담당자 필드가 따로 남음",
    );
    assert(
      !detail.element.querySelector(".reporter-value"),
      "보고자가 상세에 남음",
    );
  },
);
await check(
  "변경 기록은 본문만 스크롤하고 보고자는 패널 하단에 계속 보인다",
  async () => {
    const trigger = detail.element.querySelector<HTMLButtonElement>(
      '[aria-label="변경 기록"]',
    );
    assert(trigger, "기록 버튼 없음");
    trigger.click();
    await wait();
    const panel = detail.element.querySelector<HTMLElement>(".history-panel");
    const scroll = panel?.querySelector<HTMLElement>(".history-scroll");
    const footer = panel?.querySelector<HTMLElement>(".history-footer");
    assert(panel && scroll && footer, "고정 보고자 영역 없음");
    assert(footer.textContent?.includes("보고자"), "보고자 정보 누락");
    assert(
      scroll.scrollHeight > scroll.clientHeight,
      "긴 기록의 스크롤 재현 실패",
    );
    const before = footer.getBoundingClientRect();
    scroll.scrollTop = scroll.scrollHeight;
    await wait();
    const after = footer.getBoundingClientRect(),
      bounds = panel.getBoundingClientRect();
    assert(
      Math.abs(before.bottom - after.bottom) < 1 &&
        after.bottom <= bounds.bottom &&
        after.top >= bounds.top,
      "보고자 푸터가 스크롤로 사라짐",
    );
    panel
      .querySelector<HTMLButtonElement>('[aria-label="변경 기록 닫기"]')
      ?.click();
  },
);
await check(
  "긴 기록은 요약하고 클릭하면 원문·변경 범위를 추가 조회 없이 비교한다",
  async () => {
    const trigger = detail.element.querySelector<HTMLButtonElement>(
      '[aria-label="변경 기록"]',
    );
    assert(trigger, "기록 버튼 없음");
    trigger.click();
    await wait();
    const panel = detail.element.querySelector<HTMLElement>(".history-panel");
    const scroll = panel?.querySelector<HTMLElement>(".history-scroll");
    const preview = panel?.querySelector<HTMLButtonElement>(
      '[aria-label="설명 변경 비교"]',
    );
    assert(panel && scroll && preview, "설명 비교 버튼 없음");
    assert(
      preview.getBoundingClientRect().height < 48,
      "긴 원문이 요약 높이를 늘림",
    );
    const requests = historyRequests;
    preview.focus();
    const previousScroll = scroll.scrollTop;
    preview.click();
    await wait();
    const diff = panel.querySelector<HTMLElement>(".history-diff");
    assert(diff && !diff.hidden, "상세 비교 화면 없음");
    const texts = [...diff.querySelectorAll("pre")];
    assert(
      texts[0]?.textContent === oldDescription &&
        texts[1]?.textContent === newDescription,
      "원문이 유실됨",
    );
    assert(
      diff.querySelector("del") && diff.querySelector("ins"),
      "삭제·추가 강조 없음",
    );
    assert(
      diff.scrollWidth <= scroll.clientWidth + 1,
      "상세 비교가 좁은 화면을 넘침",
    );
    const footer = panel.querySelector<HTMLElement>(".history-footer");
    assert(
      footer &&
        footer.getBoundingClientRect().top <
          panel.getBoundingClientRect().bottom,
      "비교 중 보고자 누락",
    );
    diff.querySelector<HTMLButtonElement>("button")?.click();
    assert(
      diff.hidden &&
        document.activeElement === preview &&
        Math.abs(scroll.scrollTop - previousScroll) < 1,
      "돌아올 때 포커스·스크롤이 사라짐",
    );
    assert(historyRequests === requests, "상세 비교에 불필요한 조회 발생");
    assert(
      parseFloat(getComputedStyle(footer).marginTop) > 0,
      "보고자 구분선 위 여백 없음",
    );
    const lastEntry = panel.querySelector(".history-entry:last-child");
    assert(
      lastEntry && getComputedStyle(lastEntry).borderBottomWidth === "0px",
      "마지막 기록 아래 중복 선이 남음",
    );
    panel
      .querySelector<HTMLButtonElement>('[aria-label="변경 기록 닫기"]')
      ?.click();
  },
);
document.body.dataset.result = failures ? "failed" : "passed";
