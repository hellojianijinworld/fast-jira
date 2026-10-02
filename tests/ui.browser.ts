import "../src/client/styles.css";
import type { AdfDocument, AdfNode } from "../src/domain/adf.ts";
import type { Issue } from "../src/domain/issue.ts";
import { adfEditor } from "../src/ui/adf-editor.ts";
import { renderADF } from "../src/ui/adf-render.ts";
import { actionButton, element } from "../src/ui/dom.ts";
import { createFilterPanel } from "../src/ui/filter-panel.ts";
import { issueCard } from "../src/ui/issue-card.ts";
import { mentionPicker } from "../src/ui/mention-picker.ts";
import {
  personPill,
  refreshRelativeTimes,
  relativeTime,
} from "../src/ui/meta.ts";
import { showModal } from "../src/ui/modal.ts";
import { createNotice } from "../src/ui/notice.ts";
import { enhanceSelect } from "../src/ui/select-menu.ts";

const results = document.querySelector("#results");
const fixture = document.querySelector("#fixture");
if (!results || !fixture) throw new Error("검사 화면이 없습니다.");
function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
async function check(name: string, inspect: () => void | Promise<void>) {
  try {
    await inspect();
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
  }
}
const issue: Issue = {
  key: "TEST-711",
  summary:
    "긴 제목에서도 상태와 담당자 태그가 카드 밖으로 삐져나오지 않고 오른쪽에 정렬되어야 합니다",
  project: "TEST",
  parent: "",
  parentSummary: "",
  status: "개발 진행 중",
  statusId: "2",
  statusCategory: "indeterminate",
  issueType: "태스크",
  issueTypeId: "1",
  hierarchyLevel: 0,
  issueTypeIcon: "",
  priority: "보통",
  priorityId: "medium",
  defaultPriorityId: "medium",
  priorityIcon: "",
  assignee: "검사 사용자",
  assigneeId: "fixture-user",
  assigneeAvatar: "",
  updated: "",
  dueDate: "2026-10-05",
  commentCount: 3,
  hasChildren: false,
};
const order = ["백로그", "개발 진행 중", "개발 완료", "Done"];
const now = new Date(2026, 9, 1, 12);

await check("카드는 댓글을 앞에 배치하고 기본 우선순위·미지정을 숨긴다", () => {
  let selected = "";
  const container = element("div", "issue-list-container");
  container.style.width = "min(100%, 700px)";
  const card = issueCard(issue, {
    statusOrder: order,
    selectedKey: issue.key,
    context: "상위",
    onSelect: (key) => {
      selected = key;
    },
    now,
  });
  const badges = [...card.querySelectorAll(".list-meta > *")];
  assert(
    badges[0]?.classList.contains("comment-pill") ?? false,
    "댓글이 첫 배지가 아님",
  );
  assert(
    badges.at(-1)?.classList.contains("status-pill") ?? false,
    "상태가 마지막 배지가 아님",
  );
  const due = badges.findIndex((badge) => badge.tagName === "TIME");
  const person = badges.findIndex((badge) =>
    badge.classList.contains("person-pill"),
  );
  assert(due >= 0 && person > due, "마감일·담당자 배지 순서 오류");
  container.append(
    card,
    issueCard(
      {
        ...issue,
        key: "TEST-712",
        summary: "짧은 제목",
        assignee: "",
        dueDate: "",
        commentCount: 0,
      },
      { statusOrder: order, onSelect: () => {} },
    ),
  );
  fixture.append(container);
  assert(
    card.querySelector(".list-meta")?.firstElementChild?.className ===
      "comment-pill",
    "댓글 배지 순서",
  );
  assert(
    !card.querySelector(".priority-pill") &&
      !card.querySelector(".context-label"),
    "기본 우선순위·상위 레이블 제외",
  );
  assert(
    card.querySelector(".list-item")?.getAttribute("aria-current") === "true",
    "선택 표시",
  );
  const plainClick = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  card.dispatchEvent(plainClick);
  assert(
    plainClick.defaultPrevented && selected === issue.key,
    "일반 클릭은 인라인 상세",
  );
  const modifier = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
  });
  let modifierAllowed = false;
  card.addEventListener("click", (event) => {
    if (event.ctrlKey) {
      modifierAllowed = !event.defaultPrevented;
      event.preventDefault();
    }
  });
  card.dispatchEvent(modifier);
  assert(modifierAllowed, "수정키 클릭의 브라우저 기본 동작");
  assert(
    !container.lastElementChild?.querySelector(
      ".person-pill, .date-pill, .comment-pill",
    ),
    "미지정과 없는 날짜·댓글 숨김",
  );
});

await check(
  "좁은 카드 폭과 간단히 보기에서도 배지가 오른쪽에 남고 넘치지 않는다",
  () => {
    const container = fixture.querySelector<HTMLElement>(
      ".issue-list-container",
    );
    const card = container?.querySelector<HTMLElement>(".list-item");
    const meta = card?.querySelector<HTMLElement>(".list-meta");
    assert(Boolean(container && card && meta), "공유 카드");
    if (!container || !card || !meta) return;
    const long = issueCard(
      {
        ...issue,
        key: "TEST-713",
        status: "아주 긴 사용자 지정 단계 이름 ".repeat(5),
        assignee: "아주 긴 담당자 이름 ".repeat(5),
      },
      { statusOrder: order, onSelect: () => {} },
    );
    container.append(long);
    for (const width of [320, 700]) {
      container.style.width = `${width}px`;
      for (const compact of [false, true]) {
        document.documentElement.dataset.compact = String(compact);
        const rect = card.getBoundingClientRect();
        const tags = meta.getBoundingClientRect();
        assert(
          tags.right <= rect.right && tags.bottom <= rect.bottom,
          "배지가 카드 내부 오른쪽에 위치",
        );
        assert(
          card.scrollWidth <= card.clientWidth + 1,
          "카드 가로 오버플로 없음",
        );
        assert(
          long.scrollWidth <= long.clientWidth + 1,
          "사용자 지정 긴 배지 가로 오버플로 없음",
        );
      }
    }
    long.remove();
    delete document.documentElement.dataset.compact;
    container.style.width = "min(100%, 700px)";
  },
);

await check(
  "아바타 셀렉트는 키보드·값 변경·비활성 옵션·정리 동작을 지원한다",
  async () => {
    const select = element("select");
    select.id = "fixture-assignee";
    select.setAttribute("aria-label", "담당자");
    select.append(
      new Option("미지정", ""),
      new Option("검사 사용자", "me"),
      new Option("선택 불가", "disabled"),
    );
    const disabled = select.options[2];
    if (disabled) disabled.disabled = true;
    fixture.append(select);
    let changes = 0;
    select.addEventListener("change", () => changes++);
    const menu = enhanceSelect(select, {
      renderOption: (option) =>
        personPill({ name: option.textContent ?? "", avatar: "" }),
    });
    menu.trigger.click();
    await wait();
    assert(
      menu.panel.matches(":popover-open") &&
        menu.trigger.getAttribute("aria-expanded") === "true",
      "팝오버 열림",
    );
    assert(
      menu.panel.querySelectorAll(".person-pill").length === 3,
      "풍부한 옵션",
    );
    menu.panel.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    assert(
      document.activeElement instanceof HTMLButtonElement &&
        document.activeElement.textContent?.includes("검사 사용자") === true,
      "방향키가 비활성 옵션을 건너뜀",
    );
    if (document.activeElement instanceof HTMLButtonElement)
      document.activeElement.click();
    assert(
      select.value === "me" &&
        changes === 1 &&
        !menu.panel.matches(":popover-open"),
      "한 번만 변경 전달",
    );
    select.disabled = true;
    await wait();
    assert(menu.trigger.disabled, "원본 select 비활성 동기화");
    menu.destroy();
    assert(
      !select.hidden && select.isConnected && !menu.trigger.isConnected,
      "observer·리스너·wrapper 정리",
    );
  },
);

await check(
  "닫힌 화면의 늦은 선택지 응답이 팝오버를 다시 열지 않는다",
  async () => {
    const select = element("select");
    select.append(new Option("값", "value"));
    fixture.append(select);
    let resolve: (() => void) | undefined;
    const pending = new Promise<undefined>((done) => {
      resolve = () => done(undefined);
    });
    const menu = enhanceSelect(select, { beforeOpen: () => pending });
    menu.trigger.click();
    assert(menu.trigger.getAttribute("aria-busy") === "true", "트리거 내 로딩");
    menu.close();
    resolve?.();
    await wait();
    assert(
      !menu.panel.matches(":popover-open") &&
        !menu.trigger.hasAttribute("aria-busy"),
      "늦은 응답 무시",
    );
    menu.destroy();
    select.remove();
  },
);

await check(
  "검색 메뉴 헤더는 옵션과 겹치지 않고 검색 실패를 안내한다",
  async () => {
    const select = element("select");
    select.setAttribute("aria-label", "검색 검사");
    select.append(new Option("검사 사용자", "me"));
    fixture.append(select);
    const menu = enhanceSelect(select, {
      renderOption: (option) =>
        personPill({ name: option.textContent ?? "", avatar: "" }),
      onSearch: async () => {
        throw new Error("모의 검색 실패");
      },
    });
    menu.trigger.click();
    await wait();
    const form = menu.panel.querySelector("form");
    assert(Boolean(form), "검색 폼");
    const option = menu.panel.querySelector(".select-option");
    assert(
      (form?.getBoundingClientRect().bottom ?? 0) <=
        (option?.getBoundingClientRect().top ?? 0),
      "검색 헤더와 옵션 얼라인",
    );
    form?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await wait();
    assert(
      menu.panel.querySelector('[role="alert"]')?.textContent ===
        "모의 검색 실패",
      "검색 오류 안내",
    );
    menu.panel.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    assert(
      !menu.panel.matches(":popover-open") &&
        document.activeElement === menu.trigger,
      "Escape와 포커스 복원",
    );
    menu.destroy();
    select.remove();
  },
);

await check(
  "ADF는 표·코드·스마트 링크를 표시하고 위험 링크를 실행하지 않는다",
  () => {
    const body: AdfNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "<script>실행하지 않음</script>",
              marks: [
                { type: "strong" },
                { type: "link", attrs: { href: "javascript:alert(1)" } },
              ],
            },
          ],
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  attrs: { colspan: 2 },
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "표 셀" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "codeBlock",
          content: [{ type: "text", text: "const value = 1;" }],
        },
        {
          type: "blockCard",
          attrs: { url: "https://www.figma.com/design/fixture" },
        },
        {
          type: "media",
          attrs: { alt: "hidden-filename.png", width: 800, height: 400 },
        },
      ],
    };
    const container = element("div", "adf");
    container.append(
      renderADF(
        body,
        {
          key: issue.key,
          url: "https://example.atlassian.net/browse/TEST-711",
        },
        false,
      ),
    );
    fixture.append(container);
    assert(
      !container.querySelector("script") &&
        !container.querySelector('a[href^="javascript:"]'),
      "본문은 텍스트·허용 링크만",
    );
    assert(
      container.querySelector("td")?.colSpan === 2 &&
        container.querySelector("pre")?.textContent === "const value = 1;",
      "표·코드",
    );
    assert(
      container.querySelector(".smart-link")?.textContent ===
        "figma.com에서 열기 ↗",
      "스마트 링크 fallback",
    );
    assert(
      !container.textContent?.includes("hidden-filename.png"),
      "이미지 파일명 숨김",
    );
  },
);

await check("댓글·기록·보고 시각은 같은 상대 시각 갱신을 사용한다", () => {
  const time = relativeTime("2026-10-01T11:59:00+09:00", "", "보고", now);
  fixture.append(time);
  refreshRelativeTimes(fixture, new Date(now.getTime() + 60000));
  assert(time.textContent === "2분 전", "공유 상대 시각");
});

await check("일반 알림은 3초, 되돌리기 알림은 5초 뒤 닫힌다", async () => {
  const host = element("div");
  fixture.append(host);
  const notice = createNotice(host);
  notice.show("일반 안내");
  await wait(3150);
  assert(host.hidden === true, "3초 알림 종료");
  let undo = 0;
  notice.show("변경됨", () => {
    undo++;
  });
  await wait(3100);
  assert(!host.hidden, "되돌리기는 3초에 닫지 않음");
  await wait(2050);
  assert(host.hidden === true, "5초 되돌리기 종료");
  notice.show("변경됨", () => {
    undo++;
  });
  host.querySelector<HTMLButtonElement>(".secondary")?.click();
  await wait();
  assert(undo === 1 && host.hidden, "되돌리기 한 번 실행");
  notice.destroy();
  host.remove();
});

await check(
  "편집기 왕복은 표·코드·서식·이미지와 미지원 확장 노드를 보존한다",
  () => {
    const source: AdfDocument = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "제목" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "서식",
              marks: [
                { type: "strong" },
                { type: "textColor", attrs: { color: "#123456" } },
                {
                  type: "link",
                  attrs: { href: "https://example.com", title: "원문" },
                },
              ],
            },
            { type: "mention", attrs: { id: "user", text: "@작성자" } },
          ],
        },
        {
          type: "table",
          attrs: { layout: "wide" },
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  attrs: { colspan: 2, background: "#ffffff" },
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "표 내용" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "codeBlock",
          attrs: { language: "javascript" },
          content: [{ type: "text", text: "const x = 1;" }],
        },
        {
          type: "mediaSingle",
          attrs: { layout: "center" },
          content: [
            {
              type: "media",
              attrs: { id: "file", type: "file", collection: "jira" },
            },
          ],
        },
        {
          type: "extension",
          attrs: {
            extensionKey: "unknown",
            parameters: { nested: [1, "내용"] },
          },
        },
      ],
    };
    const editor = adfEditor(
      source,
      { key: "TEST-1", url: "https://example.com/browse/TEST-1" },
      false,
    );
    fixture.append(editor.element);
    assert(
      JSON.stringify(editor.document()) === JSON.stringify(source),
      "ADF 원본 손실",
    );
    assert(
      editor.element.querySelectorAll('[contenteditable="false"]').length === 3,
      "멘션·이미지·확장 노드 수정 불가 유지",
    );
    editor.element.remove();
  },
);
await check("키보드 멘션 범위는 이메일을 제외하고 계정 ID를 저장한다", () => {
  const editor = adfEditor(
    null,
    { key: "TEST-1", url: "https://example.com" },
    false,
  );
  fixture.append(editor.element);
  const paragraph = editor.element.querySelector("p");
  assert(Boolean(paragraph), "빈 문단 누락");
  function place(value: string) {
    if (!paragraph) throw new Error("문단 누락");
    paragraph.textContent = value;
    editor.element.focus();
    const node = paragraph.firstChild;
    if (!node) throw new Error("텍스트 누락");
    const range = document.createRange();
    range.setStart(node, value.length);
    range.collapse(true);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    editor.rememberSelection();
  }
  place("메일 person@example.com");
  assert(editor.mentionQuery() === null, "이메일 오인식");
  place("앞 @Jul");
  const query = editor.mentionQuery();
  assert(query?.query === "Jul", "키보드 멘션 검색어");
  if (!query) throw new Error("멘션 범위 누락");
  editor.insertMention({ id: "julie-id", name: "Julie" }, query.range);
  const content = editor.document().content[0]?.content ?? [];
  assert(
    content[0]?.text === "앞 " &&
      content[1]?.type === "mention" &&
      content[1].attrs?.id === "julie-id",
    "작성 위치·계정 ID 손실",
  );
  assert(!editor.element.textContent?.includes("@Jul "), "검색 문자열 잔존");
  const restored = adfEditor(
    editor.document(),
    { key: "TEST-1", url: "https://example.com" },
    false,
  );
  assert(
    JSON.stringify(restored.document()) === JSON.stringify(editor.document()),
    "멘션 재편집 손실",
  );
  editor.element.remove();
});
await check("브라우저가 넣은 최상위 텍스트도 문단으로 저장한다", () => {
  const editor = adfEditor(
    null,
    { key: "TEST-1", url: "https://example.com" },
    false,
  );
  editor.element.textContent = "일반 입력";
  assert(
    editor.document().content[0]?.type === "paragraph",
    "최상위 텍스트 문단 누락",
  );
  assert(
    editor.document().content[0]?.content?.[0]?.text === "일반 입력",
    "입력 손실",
  );
});
await check(
  "키보드 멘션은 한글 조합 뒤에 검색하고 방향키·Enter·Escape로 조작한다",
  async () => {
    const editor = adfEditor(
      null,
      { key: "TEST-1", url: "https://example.com" },
      false,
    );
    const queries: string[] = [];
    const picker = mentionPicker(editor, async (query) => {
      queries.push(query);
      return [
        { id: "one", name: "사람 하나", avatar: "" },
        { id: "two", name: "사람 둘", avatar: "" },
      ];
    });
    fixture.append(editor.element, picker.element);
    const paragraph = editor.element.querySelector("p");
    if (!paragraph) throw new Error("문단 누락");
    function type(value: string) {
      if (!paragraph) return;
      paragraph.textContent = value;
      editor.element.focus();
      const text = paragraph.firstChild;
      if (!text) throw new Error("텍스트 누락");
      const range = document.createRange();
      range.setStart(text, value.length);
      range.collapse(true);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      editor.element.dispatchEvent(new Event("input"));
    }
    editor.element.dispatchEvent(new CompositionEvent("compositionstart"));
    type("앞 @사");
    await wait(300);
    assert(!queries.length, "한글 조합 중 검색");
    editor.element.dispatchEvent(new CompositionEvent("compositionend"));
    await wait(300);
    assert(
      queries[0] === "사" &&
        editor.element.getAttribute("aria-expanded") === "true",
      "조합 완료 후보 누락",
    );
    editor.element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    editor.element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    assert(
      editor.document().content[0]?.content?.[1]?.attrs?.id === "two",
      "방향키 선택 멘션 누락",
    );
    type("다시 @사");
    await wait(300);
    editor.element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    assert(
      editor.element.getAttribute("aria-expanded") === "false" &&
        editor.element.textContent === "다시 @사",
      "Escape 입력 보존",
    );
    picker.destroy();
    editor.element.remove();
  },
);
await check(
  "카드 복사는 상세 이동 없이 사이트 링크를 복사하고 실패를 안내한다",
  async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    let text = "",
      selected = "",
      message = "",
      fail = false;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          if (fail) throw new Error("denied");
          text = value;
        },
      },
    });
    const card = issueCard(issue, {
      statusOrder: order,
      site: "example.atlassian.net",
      onSelect: (key) => {
        selected = key;
      },
      copied: (value) => {
        message = value;
      },
    });
    fixture.append(card);
    try {
      const copy = card.querySelector<HTMLButtonElement>(".card-copy");
      assert(
        copy?.textContent === issue.key && !copy.closest("a"),
        "이슈키 자체가 독립된 복사 버튼이어야 함",
      );
      copy.click();
      await wait();
      assert(
        text === `https://example.atlassian.net/browse/${issue.key}` &&
          selected === "",
        "복사 링크 또는 이동 분리 오류",
      );
      assert(message === "링크를 복사했어요.", "복사 성공 안내 누락");
      fail = true;
      copy.click();
      await wait();
      assert(message.includes("복사하지 못"), "복사 실패 안내 누락");
      copy.focus();
      assert(
        getComputedStyle(copy).opacity === "1",
        "키보드 포커스에서 복사 버튼 숨김",
      );
    } finally {
      card.remove();
      if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  },
);
await check(
  "공통 모달은 선택적인 오른쪽 푸터를 지원하고 도움말에는 푸터를 만들지 않는다",
  () => {
    const modal = element("dialog", "settings-modal"),
      save = actionButton("저장", "check"),
      cancel = actionButton("취소", "x");
    fixture.append(modal);
    try {
      showModal(modal, {
        title: "설정",
        content: element("p", "", "설정 본문"),
        actions: [cancel, save],
      });
      const footer = modal.querySelector<HTMLElement>(".modal-footer");
      assert(
        footer !== null &&
          Math.abs(
            save.getBoundingClientRect().right -
              footer.getBoundingClientRect().right,
          ) < 1,
        "모달 푸터 우측 정렬 누락",
      );
      showModal(modal, {
        title: "도움말",
        content: element("p", "", "이용 가이드"),
      });
      assert(!modal.querySelector(".modal-footer"), "도움말에 빈 푸터 생성");
    } finally {
      modal.close();
      modal.remove();
    }
  },
);
await check("완료 범주만 한 줄로 줄이며 옵션을 끄면 배지를 복원한다", () => {
  const previous = document.documentElement.dataset.compactDone;
  const done = issueCard(
    { ...issue, status: "사용자 완료 단계", statusCategory: "done" },
    { statusOrder: [], onSelect: () => {} },
  );
  const active = issueCard(
    { ...issue, status: "개발 완료", statusCategory: "indeterminate" },
    { statusOrder: [], onSelect: () => {} },
  );
  fixture.append(done, active);
  try {
    document.documentElement.dataset.compactDone = "true";
    const meta = done.querySelector<HTMLElement>(".list-meta");
    const title = done.querySelector<HTMLElement>(".list-title");
    const check = done.querySelector(".completed-check");
    const activeMeta = active.querySelector(".list-meta");
    assert(Boolean(meta && title && check && activeMeta), "카드 요소 누락");
    if (!meta || !title || !check || !activeMeta) return;
    assert(getComputedStyle(meta).display === "none", "완료 메타 숨김 누락");
    assert(
      getComputedStyle(title).whiteSpace === "nowrap" &&
        getComputedStyle(title).textOverflow === "ellipsis",
      "한 줄 말줄임 누락",
    );
    assert(getComputedStyle(check).display !== "none", "완료 체크 누락");
    assert(
      !active.querySelector(".completed-check") &&
        getComputedStyle(activeMeta).display !== "none",
      "상태 이름으로 완료를 추측함",
    );
    document.documentElement.dataset.compactDone = "false";
    assert(
      getComputedStyle(meta).display !== "none" &&
        getComputedStyle(check).display === "none",
      "원래 배지 복원 누락",
    );
  } finally {
    done.remove();
    active.remove();
    if (previous === undefined)
      delete document.documentElement.dataset.compactDone;
    else document.documentElement.dataset.compactDone = previous;
  }
});
await check(
  "프로젝트 연속 선택은 한 번 조회하고 닫힌 필터는 조회를 취소한다",
  async () => {
    let requests = 0;
    const panel = createFilterPanel(
      {
        statuses: async () => {
          requests++;
          return [];
        },
        users: async () => [],
        types: async () => [],
      },
      { accountId: "me", displayName: "나" },
      {
        filters: () => ({
          projects: ["AA", "BB"],
          scope: "all",
          excludeDone: false,
          sort: "recent",
          statuses: null,
          assignees: null,
          q: "",
        }),
        catalog: () => ({
          projects: [
            { key: "AA", name: "A", avatar: "" },
            { key: "BB", name: "B", avatar: "" },
          ],
          statuses: [],
          types: [],
          priorities: [],
        }),
        onApply: () => {},
        onBranch: () => {},
      },
    );
    const anchor = element("button", "", "필터 검사");
    fixture.append(anchor);
    try {
      panel.open(anchor);
      await wait();
      const toggle = (name: string) => {
        const input = panel.element.querySelector<HTMLInputElement>(
          `[aria-label="프로젝트: ${name}"]`,
        );
        assert(Boolean(input), "프로젝트 선택 누락");
        input?.click();
      };
      toggle("A");
      toggle("B");
      toggle("A");
      assert(requests === 1, "연속 체크마다 요청 발생");
      await wait(250);
      assert(Number(requests) === 2, "마지막 선택 조회 누락 또는 중복");
      toggle("B");
      panel.element.hidePopover();
      await wait(250);
      assert(Number(requests) === 2, "닫힌 팝오버가 불필요하게 조회함");
    } finally {
      panel.destroy();
      anchor.remove();
    }
  },
);
document.body.dataset.result = failures ? "failed" : "passed";
results.append(
  element(
    "li",
    failures ? "error" : "",
    failures
      ? `${failures}개 실패`
      : "전체 브라우저 검사 통과 · 실제 Jira 변경 없음",
  ),
);
