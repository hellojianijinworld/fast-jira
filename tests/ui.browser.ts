import { parseActivityFeed } from "../src/client/activity-parser.ts";
import { createApi } from "../src/client/api.ts";
import { createListController } from "../src/client/list-controller.ts";
import { createViewController } from "../src/client/view-controller.ts";
import { initialViews } from "../src/domain/views.ts";
import { emptyIssue } from "../src/domain/wire.ts";
import { connectionForm } from "../src/ui/connection.ts";
import { detailChildren } from "../src/ui/detail-children.ts";
import { issueBreadcrumbs } from "../src/ui/issue-breadcrumbs.ts";
import { parentSelect } from "../src/ui/parent-select.ts";
import { createTreeContext } from "../src/ui/tree-context.ts";
import { createTreeView } from "../src/ui/tree-view.ts";
import {
  captureViewportAnchor,
  restoreViewportAnchor,
} from "../src/ui/viewport-anchor.ts";
import { activityXML } from "./activity-fixture.ts";
import "../src/client/styles.css";
import { readPreferences } from "../src/client/preferences.ts";
import type { AdfDocument, AdfNode } from "../src/domain/adf.ts";
import type { Comment, HistoryPage } from "../src/domain/content.ts";
import type { Issue } from "../src/domain/issue.ts";
import { adfEditor } from "../src/ui/adf-editor.ts";
import { renderADF } from "../src/ui/adf-render.ts";
import { copyText, issueKeyCopy } from "../src/ui/clipboard.ts";
import { actionButton, element } from "../src/ui/dom.ts";
import { filterChecklist } from "../src/ui/filter-checklist.ts";
import { createFilterPanel } from "../src/ui/filter-panel.ts";
import { issueCard } from "../src/ui/issue-card.ts";
import { issueComments } from "../src/ui/issue-comments.ts";
import { issueHistory } from "../src/ui/issue-history.ts";
import { mentionPicker } from "../src/ui/mention-picker.ts";
import {
  personPill,
  refreshRelativeTimes,
  relativeTime,
} from "../src/ui/meta.ts";
import { showModal } from "../src/ui/modal.ts";
import { createNotice } from "../src/ui/notice.ts";
import { enhanceSelect } from "../src/ui/select-menu.ts";
import { settingsContent } from "../src/ui/settings.ts";
import type { ComponentSize } from "../src/ui/theme.ts";
import { startTooltips, TOOLTIP_DELAY_MS } from "../src/ui/tooltip.ts";

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
await check(
  "화면 표시 선택 카드는 각 설명·독립 선택·즉시 적용을 제공한다",
  () => {
    const initial = readPreferences({ getItem: () => null, setItem: () => {} });
    let saved = initial;
    const content = settingsContent(initial, "검사 계정", (next) => {
      saved = next;
    });
    fixture.append(content.element);
    try {
      const groups = content.element.querySelectorAll(".setting-group");
      assert(groups.length === 4, "화면 표시 그룹 수 불일치");
      const radios = [
        ...content.element.querySelectorAll<HTMLInputElement>(
          'input[type="radio"]',
        ),
      ];
      assert(radios.length === 8, "선택 카드 누락");
      assert(
        content.element.querySelectorAll("input:checked").length === 4,
        "그룹별 선택 누락",
      );
      for (const input of radios) {
        const help = document.getElementById(
          input.getAttribute("aria-describedby") ?? "",
        );
        assert(
          help !== null && (help.textContent?.length ?? 0) > 10,
          "선택지 설명 연결 누락",
        );
      }
      const select = (label: string) => {
        const radio = radios.find(
          (item) => item.getAttribute("aria-label") === label,
        );
        assert(radio !== undefined, "설정 선택지 누락");
        radio.click();
      };
      select("테마 · 다크");
      select("제목 표시 · 한 줄로");
      select("완료된 하위 작업 · 목록");
      select("완료된 상위 작업 · 목록");
      assert(
        saved.theme === "dark" &&
          saved.compactView &&
          !saved.compactDone &&
          !saved.compactDoneParents,
        "선택 즉시 적용 또는 다른 그룹 보존 실패",
      );
      assert(
        content.element.querySelectorAll("input:checked").length === 4,
        "그룹 간 라디오 선택 충돌",
      );
      assert(
        !content.element.textContent?.includes("개발자"),
        "개발자 설정이 남음",
      );
    } finally {
      content.element.remove();
    }
  },
);

await check(
  "HTTP 모바일에서도 설정 탭과 선택 필드를 고유 ID로 연결한다",
  () => {
    const descriptor = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    });
    const host = element("div");
    fixture.append(host);
    try {
      const preferences = readPreferences({
        getItem: () => null,
        setItem: () => {},
      });
      const first = settingsContent(preferences, "검사 계정", () => {});
      const second = settingsContent(preferences, "다른 설정", () => {});
      host.append(first.element, second.element);
      const tabs = [
        ...host.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
      ];
      assert(
        new Set(tabs.map((tab) => tab.id)).size === 6,
        "설정 ID가 중복된다",
      );
      for (const tab of tabs) {
        const panel = document.getElementById(
          tab.getAttribute("aria-controls") ?? "",
        );
        assert(
          panel?.getAttribute("aria-labelledby") === tab.id,
          "탭과 패널 연결이 끊긴다",
        );
      }
      for (let index = 0; index < 2; index++) {
        const select = element("select");
        select.setAttribute("aria-label", `검사 선택 ${index}`);
        select.append(new Option("진행 중", "working"));
        host.append(select);
        enhanceSelect(select);
      }
      const triggers = [
        ...host.querySelectorAll<HTMLButtonElement>(".select-trigger"),
      ];
      assert(
        triggers.length === 2 && triggers[0]?.id !== triggers[1]?.id,
        "선택 ID가 중복된다",
      );
      assert(
        triggers.every((trigger) => trigger.textContent?.includes("진행 중")),
        "선택 값을 표시하지 못한다",
      );
    } finally {
      host.remove();
      if (descriptor) Object.defineProperty(crypto, "randomUUID", descriptor);
      else Reflect.deleteProperty(crypto, "randomUUID");
    }
  },
);

await check(
  "상세·최근 이슈 패널은 라이트·다크 모두 페이지 배경과 통일된다",
  () => {
    const root = document.documentElement;
    const theme = root.dataset.theme;
    const pane = element("aside", "detail-pane");
    const dashboard = element("section", "dashboard");
    const head = element("header", "detail-head");
    const modal = element("dialog", "detail-modal");
    pane.append(dashboard, head);
    fixture.append(pane, modal);
    try {
      for (const mode of ["light", "dark"]) {
        root.dataset.theme = mode;
        const page = getComputedStyle(root).backgroundColor;
        assert(
          getComputedStyle(pane).backgroundColor ===
            (innerWidth <= 600 ? "rgba(0, 0, 0, 0)" : page),
          "오른쪽 패널 배경이 페이지와 다르다",
        );
        assert(
          getComputedStyle(head).backgroundColor === page,
          "상세 고정 헤더만 다른 배경이다",
        );
        assert(
          getComputedStyle(modal).backgroundColor === page,
          "좁은 화면의 상세 배경이 다르다",
        );
        assert(
          getComputedStyle(dashboard).backgroundColor === "rgba(0, 0, 0, 0)",
          "최근 이슈에 별도 배경이 남는다",
        );
      }
    } finally {
      pane.remove();
      modal.remove();
      if (theme === undefined) delete root.dataset.theme;
      else root.dataset.theme = theme;
    }
  },
);

const issue: Issue = {
  id: "",
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

const cardExamples = [
  ["CLIPO-820", "세특·간편세특 생성 결과 가운데점(·) → 쉼표(,) 룰베이스 치환"],
  ["CLIPO-641", "AI 기록 작성시 특수문자 변환 처리"],
  [
    "CLIPO-821",
    "세특·간편세특 프롬프트에 기재요령 기본 금지어 반영 ('과제'→'활동', 상호명·플랫폼명 → 일반 표현)",
  ],
] as const;
function exampleCards(size: ComponentSize = "auto") {
  const host = element("section", "issue-list-container");
  for (const [key, summary] of cardExamples)
    host.append(
      issueCard(
        {
          ...issue,
          key,
          summary,
          commentCount: 0,
          dueDate: "",
          assignee: "Jacob Kim",
          status: "개발 진행 중",
        },
        {
          size,
          statusOrder: order,
          site: "example.atlassian.net",
          onSelect: () => {},
        },
      ),
    );
  return host;
}
await check(
  "내용이 들어가는 카드는 한 줄, 긴 제목은 오른쪽 배지만 내려가며 높이가 달라진다",
  () => {
    const compact = document.documentElement.dataset.compact;
    document.documentElement.dataset.compact = "false";
    const host = exampleCards("md");
    host.style.width = "760px";
    fixture.append(host);
    try {
      const rows = [...host.querySelectorAll<HTMLElement>(".list-item")];
      rows.forEach((row, index) => {
        const titleElement = row.querySelector<HTMLElement>(".list-title");
        const metaElement = row.querySelector<HTMLElement>(".list-meta");
        assert(titleElement !== null && metaElement !== null, "카드 구성 누락");
        const title = titleElement.getBoundingClientRect();
        const meta = metaElement.getBoundingClientRect();
        assert(
          index < 2
            ? meta.top < title.bottom && meta.bottom > title.top
            : meta.top >= title.bottom,
          "제목 길이에 맞는 줄 배치가 아님",
        );
        assert(row.scrollWidth <= row.clientWidth + 1, "카드 가로 넘침");
      });
      const first = rows[0],
        last = rows[2];
      assert(first !== undefined && last !== undefined, "비교 카드 누락");
      assert(
        first.getBoundingClientRect().height <
          last.getBoundingClientRect().height,
        "카드 높이가 불필요하게 같음",
      );
    } finally {
      host.remove();
      if (compact === undefined)
        delete document.documentElement.dataset.compact;
      else document.documentElement.dataset.compact = compact;
    }
  },
);

await check(
  "제목 마지막 줄에 공간이 있으면 배지가 같은 줄 오른쪽에 붙는다",
  () => {
    const compact = document.documentElement.dataset.compact;
    document.documentElement.dataset.compact = "false";
    const host = exampleCards("md");
    host.style.width = "420px";
    fixture.append(host);
    try {
      const row = host.querySelector(".list-item");
      const title = row?.querySelector(".list-title");
      const meta = row?.querySelector(".list-meta");
      assert(Boolean(row && title && meta), "카드 내용 누락");
      const range = document.createRange();
      range.selectNodeContents(title as Node);
      const lines = [...range.getClientRects()];
      const last = lines.at(-1);
      const badges = meta?.getBoundingClientRect();
      assert(lines.length > 1, "여러 줄 제목이 아니다");
      assert(
        Boolean(
          last &&
            badges &&
            badges.top < last.bottom &&
            badges.bottom > last.top,
        ),
        "배지가 마지막 줄의 빈 공간을 사용하지 않는다",
      );
      assert(
        Boolean(last && badges && last.right < badges.left),
        "제목과 배지가 겹친다",
      );
    } finally {
      host.remove();
      if (compact === undefined)
        delete document.documentElement.dataset.compact;
      else document.documentElement.dataset.compact = compact;
    }
  },
);

await check(
  "긴 제목은 번호 옆에서 시작하고 다음 줄은 카드 왼쪽부터 이어진다",
  () => {
    const compact = document.documentElement.dataset.compact;
    document.documentElement.dataset.compact = "false";
    const host = element("div", "issue-list-container");
    host.style.width = "480px";
    const card = issueCard(issue, {
      size: "md",
      statusOrder: order,
      onSelect: () => {},
    });
    host.append(card);
    fixture.append(host);
    try {
      const title = card.querySelector(".list-title");
      const identity = card.querySelector(".issue-identity");
      const main = card.querySelector(".list-main");
      assert(
        title !== null && identity !== null && main !== null,
        "카드 내용 누락",
      );
      const range = document.createRange();
      range.selectNodeContents(title);
      const lines = [...range.getClientRects()];
      const first = lines[0],
        second = lines[1];
      assert(
        first !== undefined && second !== undefined,
        "긴 제목이 여러 줄로 표시되지 않는다",
      );
      assert(
        first.left >= identity.getBoundingClientRect().right,
        "첫 줄 제목이 번호 옆에서 시작하지 않는다",
      );
      assert(
        Math.abs(second.left - main.getBoundingClientRect().left) < 1,
        "두 번째 줄이 번호 옆의 별도 칸에 갇혀 있다",
      );
      const identityBounds = identity.getBoundingClientRect();
      assert(
        Math.abs(
          identityBounds.top +
            identityBounds.height / 2 -
            (first.top + first.height / 2),
        ) <
          (second.top - first.top) / 2,
        "유형·번호 영역이 첫 줄 대신 제목 전체 높이 가운데로 내려간다",
      );
      assert(
        second.top - first.bottom >= 9,
        "여러 줄 제목의 줄 간격이 너무 좁다",
      );
    } finally {
      host.remove();
      if (compact === undefined)
        delete document.documentElement.dataset.compact;
      else document.documentElement.dataset.compact = compact;
    }
  },
);

await check(
  "작은 카드의 긴 제목은 키 아래 전체 폭을 사용하고 배지는 오른쪽에 남는다",
  () => {
    const compact = document.documentElement.dataset.compact;
    document.documentElement.dataset.compact = "false";
    const host = element("div", "issue-list-container");
    host.style.width = "180px";
    const card = issueCard(issue, { statusOrder: order, onSelect: () => {} });
    host.append(card);
    fixture.append(host);
    try {
      const row = card.querySelector<HTMLElement>(".list-item");
      const title = card.querySelector<HTMLElement>(".list-title");
      const identity = card.querySelector<HTMLElement>(".issue-identity");
      const meta = card.querySelector<HTMLElement>(".list-meta");
      assert(
        row !== null && title !== null && identity !== null && meta !== null,
        "카드 구성 누락",
      );

      const range = document.createRange();
      range.selectNodeContents(title);
      const lines = [...range.getClientRects()];
      const main = card.querySelector(".list-main");
      assert(
        Boolean(lines[1] && main) &&
          Math.abs(
            (lines[1]?.left ?? 0) - (main?.getBoundingClientRect().left ?? 0),
          ) < 1,
        "작은 카드의 다음 줄에 번호 칸이 남는다",
      );
      assert(
        Boolean(lines[0] && lines[1]) &&
          (lines[0]?.left ?? 0) >= identity.getBoundingClientRect().right,
        "작은 카드도 번호 옆부터 제목을 이어 쓴다",
      );
      assert(
        Math.abs(
          meta.getBoundingClientRect().right -
            (row.getBoundingClientRect().right -
              parseFloat(getComputedStyle(row).paddingRight) -
              1),
        ) < 1,
        "배지 우측 정렬이 깨진다",
      );
      assert(row.scrollWidth <= row.clientWidth + 1, "카드가 가로로 넘친다");
    } finally {
      host.remove();
      if (compact === undefined)
        delete document.documentElement.dataset.compact;
      else document.documentElement.dataset.compact = compact;
    }
  },
);

await check(
  "높이가 줄어든 설정 모달에서도 닫기와 시작 버튼은 화면에 남는다",
  () => {
    const modal = element("dialog", "settings-modal");
    modal.style.maxHeight = "280px";
    const connection = connectionForm(
      {
        connection: async () => ({
          site: "example.atlassian.net",
          email: "fixture@example.com",
          tokenConfigured: true,
        }),
        saveConnection: async () => ({
          site: "example.atlassian.net",
          email: "fixture@example.com",
        }),
      },
      () => {},
    );
    const content = settingsContent(
      readPreferences({ getItem: () => null, setItem: () => {} }),
      "검사 계정",
      () => {},
      () => {},
      connection,
    );
    fixture.append(modal);
    try {
      showModal(modal, {
        title: "처음 설정",
        content: content.element,
        actions: content.actions,
      });
      const bounds = modal.getBoundingClientRect();
      const close = modal.querySelector<HTMLElement>('[aria-label="닫기"]');
      const action = modal.querySelector<HTMLElement>(".modal-footer button");
      assert(close !== null && action !== null, "모달 액션 누락");
      assert(
        close.getBoundingClientRect().top >= bounds.top,
        "닫기가 모달 밖으로 밀린다",
      );
      assert(
        action.getBoundingClientRect().bottom <= bounds.bottom,
        "시작 버튼이 화면 아래로 밀린다",
      );
      const panels = modal.querySelector<HTMLElement>(".settings-panels");
      assert(
        panels !== null &&
          panels.clientHeight > 0 &&
          panels.scrollHeight > panels.clientHeight,
        "본문 스크롤 영역을 만들지 못한다",
      );
    } finally {
      modal.close();
      modal.remove();
    }
  },
);

await check(
  "HTTP의 클립보드 API가 없어도 복사하고 기존 입력 포커스를 복원한다",
  async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const original = document.execCommand;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    const input = element("input");
    fixture.append(input);
    input.focus();
    let copied = "",
      message = "";
    document.execCommand = (command) => {
      const selected = document.activeElement;
      if (command !== "copy" || !(selected instanceof HTMLTextAreaElement))
        return false;
      copied = selected.value;
      return true;
    };
    try {
      await copyText("https://example.atlassian.net/browse/TEST-1", (value) => {
        message = value;
      });
      assert(
        copied === "https://example.atlassian.net/browse/TEST-1",
        "복사할 텍스트가 전달되지 않는다",
      );
      assert(message === "링크를 복사했어요.", "복사 성공을 안내하지 않는다");
      assert(document.activeElement === input, "입력 포커스를 복원하지 않는다");
      assert(
        !document.querySelector("textarea.clipboard-copy"),
        "임시 복사 입력이 남는다",
      );
    } finally {
      document.execCommand = original;
      input.remove();
      if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  },
);

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
    badge.classList.contains("participant-avatars"),
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
        "figma.com/design/fixture",
      "스마트 링크 경로 fallback",
    );
    assert(
      !container.textContent?.includes("hidden-filename.png"),
      "이미지 파일명 숨김",
    );
  },
);

await check(
  "스마트 링크는 제목·경로·노드 위치를 구분하고 좁은 폭에서도 안전하게 표시한다",
  () => {
    const container = element("section", "adf smart-link-fixture");
    container.style.width = "240px";
    container.style.maxWidth = "100%";
    const issue = {
      key: "TEST-1",
      url: "https://example.atlassian.net/browse/TEST-1",
    };
    const href =
      "https://www.figma.com/design/fixture/%ED%95%99%EC%83%9D?node-id=1-2#detail";
    container.append(
      renderADF(
        { type: "blockCard", attrs: { url: href, title: "학생 채점 화면" } },
        issue,
      ),
      renderADF(
        {
          type: "embedCard",
          attrs: {
            url: "https://www.figma.com/design/fixture/%ED%95%99%EC%83%9D?node-id=3-4",
          },
        },
        issue,
      ),
      renderADF(
        {
          type: "inlineCard",
          attrs: { url: "https://www.figma.com/design/other?node-id=5-6" },
        },
        issue,
      ),
      renderADF(
        {
          type: "blockCard",
          attrs: { url: "javascript:alert(1)", title: "실행 금지" },
        },
        issue,
      ),
      renderADF(
        {
          type: "blockCard",
          attrs: {
            url: "https://example.com/bad%ZZ",
            title: "<script>실행하지 않음</script>",
          },
        },
        issue,
      ),
    );
    fixture.append(container);
    const links = [...container.querySelectorAll<HTMLAnchorElement>("a")];
    assert(
      links.length === 4,
      "위험한 링크를 활성화했거나 잘못된 % 표기 때문에 링크를 잃음",
    );
    assert(
      links[0]?.textContent?.includes("학생 채점 화면") === true,
      "문서에 포함된 제목을 표시하지 않음",
    );
    assert(
      links[0]?.textContent?.includes("학생?node-id=1-2#detail") === true,
      "제목 아래 링크 위치 정보 누락",
    );
    assert(
      links[1]?.textContent?.includes("학생?node-id=3-4") === true,
      "같은 파일의 다른 노드를 구분할 수 없음",
    );
    assert(
      links[2]?.textContent?.includes("/design/other") === true,
      "인라인 링크 경로 누락",
    );
    assert(links[0]?.href === href, "표시를 바꾸면서 실제 목적지를 변경함");
    for (const link of links) {
      assert(
        link.target === "_blank" && link.rel === "noopener noreferrer",
        "외부 링크 보호 누락",
      );
      assert(
        link.getBoundingClientRect().right <=
          container.getBoundingClientRect().right + 1,
        "긴 링크가 좁은 본문을 넘침",
      );
    }
    assert(
      !container.querySelector("iframe, img, script"),
      "외부 미리보기를 추가하거나 제목을 HTML로 삽입함",
    );
  },
);

await check(
  "기록 무효화 전 응답은 최신 기록을 덮지 않고 갱신 실패 후 첫 페이지를 재시도한다",
  async () => {
    const cursors: (number | null)[] = [];
    let finishOld: (page: HistoryPage) => void = () => {};
    let fail = false;
    const page = (id: string): HistoryPage => ({
      before: null,
      entries: [
        {
          id,
          author: "모의 작성자",
          avatar: "",
          created: "2026-10-01T08:00:00Z",
          changes: [{ field: "summary", from: "이전", to: id }],
        },
      ],
    });
    const history = issueHistory(
      {
        history: async (_key, before) => {
          cursors.push(before ?? null);
          if (cursors.length === 1)
            return new Promise<HistoryPage>((resolve) => {
              finishOld = resolve;
            });
          if (fail) throw new Error("모의 기록 조회 실패");
          return page("최신 기록");
        },
      },
      "TEST-991",
    );
    fixture.append(history.trigger, history.panel);
    const close = history.panel.querySelector<HTMLButtonElement>(
      '[aria-label="변경 기록 닫기"]',
    );
    assert(Boolean(close), "기록 닫기 버튼 없음");
    try {
      history.trigger.click();
      await wait();
      history.invalidate();
      close?.click();
      history.trigger.click();
      await wait();
      assert(
        history.panel.textContent?.includes("최신 기록") === true &&
          cursors.length === 2,
        "무효화 뒤 최신 첫 페이지를 읽지 않음",
      );
      finishOld(page("과거 기록"));
      await wait();
      assert(
        history.panel.textContent?.includes("최신 기록") === true &&
          !history.panel.textContent?.includes("과거 기록"),
        "수정 전 늦은 응답이 최신 결과를 덮음",
      );
      close?.click();
      history.invalidate();
      fail = true;
      history.trigger.click();
      await wait();
      assert(
        history.panel.textContent?.includes("모의 기록 조회 실패") === true &&
          history.panel.textContent.includes("최신 기록"),
        "조회 실패가 기존 기록이나 오류 안내를 지움",
      );
      fail = false;
      [...history.panel.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "이전 기록")
        ?.click();
      await wait();
      assert(
        Number(cursors.length) === 4 &&
          cursors.at(-1) === null &&
          history.panel.querySelectorAll(".history-entry").length === 1,
        "재시도 커서가 잘못됐거나 기존 기록과 중복됨",
      );
      close?.click();
      history.trigger.click();
      await wait();
      assert(Number(cursors.length) === 4, "변경 없이 재열 때 다시 조회함");
    } finally {
      history.destroy();
      history.trigger.remove();
    }
  },
);

await check("댓글·기록·보고 시각은 같은 상대 시각 갱신을 사용한다", () => {
  const time = relativeTime("2026-10-01T11:59:00+09:00", "", "보고", now);
  fixture.append(time);
  refreshRelativeTimes(fixture, new Date(now.getTime() + 60000));
  assert(time.textContent === "2분 전", "공유 상대 시각");
});

await check(
  "자동 알림은 되돌리기 시간을 유지하고 최신 한 건만 이어서 표시한다",
  async () => {
    const host = element("div");
    fixture.append(host);
    const notice = createNotice(host);
    try {
      notice.show("상태 변경됨", () => {});
      await wait(2500);
      notice.showBackground("이전 자동 알림");
      notice.showBackground("최신 자동 알림");
      assert(
        host.textContent?.includes("되돌리기") === true,
        "자동 알림이 되돌리기를 덮음",
      );
      await wait(2650);
      assert(
        host.textContent?.includes("최신 자동 알림") === true && !host.hidden,
        "5초 뒤 최신 보류 알림 표시",
      );
      assert(
        !host.textContent?.includes("이전 자동 알림"),
        "오래된 보류 알림 제거",
      );
      await wait(3100);
      assert(Boolean(host.hidden), "보류된 일반 알림은 3초 뒤 종료");
    } finally {
      notice.destroy();
      host.remove();
    }
  },
);

await check(
  "직접 조작과 되돌리기·종료는 오래된 자동 알림을 남기지 않는다",
  async () => {
    const host = element("div");
    fixture.append(host);
    const notice = createNotice(host);
    try {
      notice.show("변경됨", () => {});
      notice.showBackground("오래된 자동 알림");
      notice.show("링크 복사됨");
      notice.close();
      assert(host.hidden === true, "다음 직접 조작이 보류 알림 폐기");
      let undo = 0;
      notice.show("변경됨", () => {
        undo++;
      });
      notice.showBackground("되돌리기 전 자동 알림");
      host.querySelector<HTMLButtonElement>(".secondary")?.click();
      await wait();
      assert(
        undo === 1 && host.hidden === true,
        "되돌리기는 보류 알림 없이 실행",
      );
      notice.show("변경됨", () => {});
      notice.showBackground("닫은 뒤 자동 알림");
      host
        .querySelector<HTMLButtonElement>('[aria-label="알림 닫기"]')
        ?.click();
      assert(
        host.textContent?.includes("닫은 뒤 자동 알림") === true,
        "직접 닫으면 보류 알림 표시",
      );
      notice.show("변경됨", () => {});
      notice.showBackground("종료 후 표시 금지");
      notice.destroy();
      assert(
        host.hidden === true && host.childElementCount === 0,
        "종료 시 보류 알림 폐기",
      );
    } finally {
      notice.destroy();
      host.remove();
    }
  },
);

await check(
  "댓글 더보기 응답은 작성 중인 답글·편집 폼과 초점을 보존하고 종료 후 반영한다",
  async () => {
    for (const mode of ["답글", "편집"] as const) {
      const draft = `유지할 ${mode} 초안`;
      const child: Comment = {
        id: "2",
        parentId: "1",
        authorId: "me",
        author: "나",
        avatar: "",
        created: "2026-10-01T00:00:00Z",
        updated: "2026-10-01T00:00:00Z",
        body: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "기존 댓글" }],
            },
          ],
        },
      };
      const parent: Comment = {
        ...child,
        id: "1",
        parentId: "",
        authorId: "other",
        author: "동료",
      };
      let reads = 0,
        saves = 0,
        held = 0,
        failSave = true;
      let complete = (_response: Response) => {};
      const pending = new Promise<Response>((resolve) => {
        complete = resolve;
      });
      const api = createApi(async (path, init) => {
        if (init?.method === "POST") {
          assert(String(path) === "/api/comment-edit", "예상 밖 댓글 쓰기");
          saves++;
          if (failSave)
            return Response.json({ error: "모의 저장 실패" }, { status: 400 });
          assert(
            String(init.body).includes(draft),
            "편집 초안을 전송하지 않음",
          );
          return Response.json({
            ...child,
            body: {
              type: "doc",
              version: 1,
              content: [
                { type: "paragraph", content: [{ type: "text", text: draft }] },
              ],
            },
          });
        }
        assert(String(path).startsWith("/api/comments?"), "예상 밖 조회");
        reads++;
        return reads === 1
          ? Response.json({ total: 3, startAt: 0, comments: [child] })
          : pending;
      });
      const view = issueComments(
        api,
        {
          ...issue,
          reporter: "",
          reporterAvatar: "",
          created: "",
          url: "https://fixture.atlassian.net/browse/TEST-711",
          description: null,
          attachments: [],
        },
        false,
        () => {},
        "me",
        async () => {},
        () => {
          held++;
          return () => {
            held--;
          };
        },
      );
      fixture.append(view.element);
      try {
        await wait();
        const more = view.element.lastElementChild;
        assert(more instanceof HTMLButtonElement, "더보기 버튼 누락");
        more.click();
        view.element
          .querySelector<HTMLButtonElement>(
            mode === "답글"
              ? '[aria-label="답글 작성"]'
              : '[aria-label="내 댓글 편집"]',
          )
          ?.click();
        const form =
          view.element.querySelector<HTMLFormElement>(".document-form");
        const input = form?.querySelector<HTMLElement>(
          '[contenteditable="true"]',
        );
        assert(
          form !== null && input !== null && input !== undefined,
          "작성 폼 누락",
        );
        input.textContent = draft;
        input.focus();
        complete(Response.json({ total: 3, startAt: 1, comments: [parent] }));
        await wait();
        assert(
          form.isConnected && input.isConnected,
          `${mode}: 더보기 응답이 작성 폼을 제거함`,
        );
        assert(
          input.textContent === draft && document.activeElement === input,
          `${mode}: 초안 또는 초점 유실`,
        );
        assert(more.disabled && held === 1, "작성 중 더보기를 다시 활성화함");
        assert(
          !view.element.querySelector("#comment-1"),
          "작성 중 댓글 행 교체",
        );
        if (mode === "답글") {
          form
            .querySelector<HTMLButtonElement>(
              '.document-actions button[type="button"]',
            )
            ?.click();
        } else {
          form.requestSubmit();
          await wait();
          assert(
            form.isConnected && input.textContent === draft,
            "저장 실패 후 초안 유실",
          );
          failSave = false;
          form.requestSubmit();
          await wait();
          assert(
            view.element.querySelector("#comment-2 .comment-body")
              ?.textContent === draft,
            "재시도한 편집 결과 누락",
          );
        }
        assert(
          view.element.querySelector(
            "#comment-1 .comment-replies #comment-2",
          ) !== null,
          "종료 후 받아둔 부모·답글 목록 반영 누락",
        );
        assert(
          !more.disabled && Number(held) === 0 && reads === 2,
          "작성 종료 후 상태 또는 조회 횟수 오류",
        );
        assert(saves === (mode === "답글" ? 0 : 2), "예상 밖 저장 호출");
      } finally {
        complete(Response.json({ total: 3, startAt: 1, comments: [parent] }));
        view.destroy();
        view.element.remove();
      }
    }
  },
);

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
  "티켓 번호는 아이콘 없이 공통 툴팁을 표시하고 복사 표시가 배치를 바꾸지 않는다",
  async () => {
    const stop = startTooltips();
    const host = element("div");
    const copy = issueKeyCopy(
      "CLIPO-820",
      "https://example.atlassian.net/browse/CLIPO-820",
    );
    host.append(copy, element("span", "", "바로 다음 제목"));
    fixture.append(host);
    try {
      assert(copy.querySelector(".ui-icon") === null, "복사 아이콘이 남음");
      assert(
        copy.firstChild !== null && !copy.title,
        "번호 또는 툴팁 구성 누락",
      );
      const range = document.createRange();
      range.selectNode(copy.firstChild);
      const before = copy.getBoundingClientRect();
      assert(
        Math.abs(before.width - range.getBoundingClientRect().width) < 1,
        "복사 표시 공간이 예약됨",
      );
      await wait(50);
      copy.focus({ preventScroll: true });
      await wait(TOOLTIP_DELAY_MS + 30);
      const tip = document.querySelector(".ui-tooltip:popover-open");
      assert(tip?.textContent === "링크 복사", "공통 복사 툴팁 누락");
      const after = copy.getBoundingClientRect();
      assert(
        after.width === before.width && after.height === before.height,
        "툴팁 표시로 배치 변경",
      );
    } finally {
      stop();
      host.remove();
    }
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
await check("공통 완료 카드는 아이콘 분기 없이 기존 배지를 유지한다", () => {
  const done = issueCard(
    { ...issue, status: "완료", statusCategory: "done" },
    { statusOrder: [], onSelect: () => {} },
  );
  fixture.append(done);
  try {
    assert(
      !done.querySelector(".completed-check"),
      "이전 완료 아이콘 분기가 남음",
    );
    const meta = done.querySelector(".list-meta");
    assert(
      Boolean(meta && getComputedStyle(meta).display !== "none"),
      "최근·최상위 카드의 배지가 숨겨짐",
    );
  } finally {
    done.remove();
  }
});
await check(
  "현재 탭 필터는 프로젝트·뷰 관리 없이 조건을 바로 편집한다",
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
          projects: ["AA"],
          scope: "all",
          excludeDone: false,
          sort: "recent",
          statuses: null,
          assignees: null,
          q: "",
        }),
        catalog: () => ({
          projects: [{ key: "AA", name: "A", avatar: "" }],
          statuses: [],
          types: [],
          priorities: [],
        }),
        onApply: () => {},
        views: createViewController(
          initialViews({
            scope: "all",
            excludeDone: false,
            sort: "recent",
            statuses: null,
            assignees: null,
          }),
          { save: () => {}, changed: () => {}, statuses: () => [] },
        ),
      },
    );
    const anchor = element("button", "", "필터 검사");
    fixture.append(anchor);
    try {
      panel.open(anchor);
      assert(
        !panel.element.querySelector('[aria-label="프로젝트: A"]'),
        "프로젝트가 뷰 편집기에 남음",
      );
      assert(
        panel.element.getAttribute("aria-label") === "필터",
        "필터 명칭 미반영",
      );
      await wait();
      assert(Number(requests) === 1, "직접 설정의 메타정보 조회 누락");
      assert(
        Boolean(panel.element.querySelector(".view-editor")),
        "직접 설정 편집기 없음",
      );
    } finally {
      panel.destroy();
      anchor.remove();
    }
  },
);
await check("단계는 동적 개수에 맞춰 컬럼을 위에서 아래로 채운다", () => {
  const host = element("div");
  host.style.width = "600px";
  const stages = Array.from({ length: 9 }, (_, i) => ({
    id: String(i),
    name: `단계 ${i + 1}`,
  }));
  host.append(
    filterChecklist(
      "단계",
      stages,
      null,
      (choice) => element("span", "status-pill", choice.name),
      [],
      () => {},
    ),
  );
  fixture.append(host);
  try {
    const checks = host.querySelector<HTMLElement>(".status-checks");
    if (!checks) throw new Error("단계 목록 누락");
    const style = getComputedStyle(checks);
    assert(
      style.display === "flex" &&
        style.flexDirection === "column" &&
        style.flexWrap === "wrap",
      "단계가 컬럼 랩 레이아웃이 아님",
    );
    const rows = [...host.querySelectorAll<HTMLElement>(".status-check")].map(
      (node) => node.getBoundingClientRect(),
    );
    const first = rows[0],
      bottom = rows[4],
      second = rows[5];
    if (!first || !bottom || !second) throw new Error("단계 행 누락");
    if (innerWidth > 600) {
      assert(
        first.left === bottom.left && bottom.top > first.top,
        "첫 컬럼을 아래로 채우지 않음",
      );
      assert(
        second.left > first.left && second.top === first.top,
        "다음 컬럼이 위에서 시작하지 않음",
      );
    }
    assert(checks.scrollWidth <= checks.clientWidth, "단계가 가로로 넘침");
  } finally {
    host.remove();
  }
});

await check(
  "완료 상위 타일은 하위 행과 탐색 버튼을 생략하고 옵션 해제 시 기존 트리를 복원한다",
  () => {
    const host = element("div", "issue-list-container");
    host.style.width = "600px";
    fixture.append(host);
    const list = createListController(
      createApi(),
      {
        projects: ["TEST"],
        scope: "all",
        excludeDone: false,
        statuses: null,
        assignees: null,
        sort: "recent",
        q: "",
      },
      "my-account",
    );
    const parent = {
      ...issue,
      key: "TEST-100",
      project: "TEST",
      parent: "",
      hasChildren: true,
      hierarchyLevel: 1,
      status: "완료",
      statusCategory: "done",
    };
    const children = [1, 2, 3].map((n) => ({
      ...issue,
      key: `TEST-${n}`,
      project: "TEST",
      parent: parent.key,
      status: "완료",
      statusCategory: "done",
      hasChildren: false,
      issueTypeId: "subtask",
      hierarchyLevel: n === 3 ? null : -1,
    }));
    children.push(
      ...[0, 1].map((level) => ({
        ...issue,
        key: `TEST-${level + 10}`,
        project: "TEST",
        parent: parent.key,
        statusCategory: "done",
        hierarchyLevel: level,
        hasChildren: false,
      })),
    );
    list.items.set(parent.key, parent);
    list.childPage(parent.key).loaded = true;
    for (const child of children) list.items.set(child.key, child);
    list.matched.add(parent.key);
    for (const child of children) list.matched.add(child.key);
    let compact = true;
    let compactParents = true;
    let selected = "";
    const view = createTreeView(host, list, {
      catalog: () => ({
        projects: [],
        priorities: [],
        statuses: [],
        types: [
          {
            id: "subtask",
            name: "하위 버그",
            project: "TEST",
            hierarchyLevel: -1,
          },
        ],
      }),
      site: "example.atlassian.net",
      copied: () => {},
      selectedKey: () => selected,
      compactDone: () => compact,
      compactDoneParents: () => compactParents,
      onSelect: (key) => {
        selected = key;
      },
      onBranch: () => {},
      onTreeChange: () => {},
    });
    try {
      view.render();
      const parentGrid = host.querySelector<HTMLElement>(".completed-grid");
      assert(
        parentGrid?.children.length === 1 &&
          host.querySelectorAll(".list-item").length === 1,
        "완료 상위 타일 아래 하위 행이 남음",
      );
      assert(
        !parentGrid?.querySelector(".tree-actions,.tree-toggle,.row-action"),
        "완료 상위 타일에 탐색 버튼이 남음",
      );
      parentGrid?.querySelector<HTMLAnchorElement>(".list-title")?.click();
      assert(selected === parent.key, "완료 상위 클릭이 상세를 선택하지 않음");
      const before = list.tree.states.get(parent.key);
      compactParents = false;
      view.render();
      assert(
        list.tree.states.get(parent.key) === before,
        "간단히 보기 변경이 접힘 상태를 바꿈",
      );
      const grid = host.querySelector<HTMLElement>(".completed-grid");
      assert(
        Boolean(grid) && grid?.children.length === 3,
        "완료 하위 그리드 누락",
      );
      assert(
        !grid?.querySelector(".tree-actions, .tree-toggle, .row-action"),
        "완료 타일에 하위 필터·접기 버튼이 남음",
      );
      for (const key of ["TEST-10", "TEST-11"])
        assert(
          Boolean(host.querySelector(`a[href="?issue=${key}"]`)) &&
            !grid?.querySelector(`a[href="?issue=${key}"]`),
          "스토리·에픽이 완료 그리드에 포함됨",
        );
      assert(
        Boolean(grid && getComputedStyle(grid).display === "grid"),
        "그리드 스타일 누락",
      );
      const tiles = grid?.querySelectorAll<HTMLElement>(".list-item");
      assert(
        Boolean(
          tiles?.[0] &&
            tiles[1] &&
            Math.abs(
              tiles[0].getBoundingClientRect().top -
                tiles[1].getBoundingClientRect().top,
            ) < 2,
        ),
        "같은 행에 타일이 배치되지 않음",
      );
      for (const tile of tiles ?? []) {
        const label = tile.querySelector<HTMLElement>(".list-title"),
          identity = tile.querySelector<HTMLElement>(".issue-identity");
        assert(label !== null && identity !== null, "완료 카드 내용 누락");
        assert(
          getComputedStyle(tile.querySelector(".list-main") as Element)
            .webkitLineClamp === "2",
          "번호와 제목 전체가 최대 두 줄로 제한되지 않는다",
        );
        const firstLine = label.getClientRects()[0];
        assert(firstLine !== undefined, "완료 카드 제목 줄 누락");
        assert(
          firstLine.left >= identity.getBoundingClientRect().right &&
            firstLine.top < identity.getBoundingClientRect().bottom,
          "제목이 번호 바로 뒤에서 시작하지 않는다",
        );
      }
      const title = grid?.querySelector<HTMLAnchorElement>(".list-title");
      title?.click();
      assert(selected === "TEST-1", "타일 상세 클릭 누락");
      assert(
        !host.querySelector(".completed-check"),
        "이전 아이콘 분기가 남음",
      );
      compact = false;
      view.render();
      assert(
        !host.querySelector(".completed-grid"),
        "옵션 해제 시 그리드가 남음",
      );
      assert(
        host.querySelectorAll(".list-item").length === 6,
        "옵션 해제 시 카드가 사라짐",
      );
    } finally {
      view.destroy();
      host.remove();
    }
  },
);

await check(
  "부모 셀렉트는 후보 검색·커서 더 보기·연결 해제와 선택 초기화를 지원한다",
  async () => {
    const host = element("div");
    fixture.append(host);
    const api = createApi(async (input) => {
      const url = new URL(String(input), location.origin);
      assert(url.pathname === "/api/parent-options", "실제 API 호출이 발생함");
      const q = url.searchParams.get("q");
      const more = url.searchParams.get("pageToken");
      return Response.json({
        issues: q
          ? []
          : [
              {
                ...issue,
                key: more ? "TEST-201" : "TEST-200",
                summary: more ? "다음 부모" : "첫 부모",
              },
            ],
        nextPageToken: q || more ? null : "next",
      });
    });
    const picker = await parentSelect(host, api, ["TEST-1"]);
    let changes = 0;
    picker.select.addEventListener("change", () => {
      changes++;
    });
    try {
      assert(
        String(picker.select.value) === "__choose__",
        "부모가 자동으로 선택됨",
      );
      picker.menu.trigger.click();
      const choice = [
        ...picker.menu.panel.querySelectorAll<HTMLButtonElement>(
          "[role=option]",
        ),
      ].find((node) => node.textContent?.includes("첫 부모"));
      choice?.click();
      assert(
        String(picker.select.value) === "TEST-200" && changes === 1,
        "후보 선택이 연결되지 않음",
      );
      picker.menu.trigger.click();
      const more = [
        ...picker.menu.panel.querySelectorAll<HTMLButtonElement>("button"),
      ].find((node) => node.textContent === "후보 더 보기");
      assert(Boolean(more && !more.hidden), "후보 더 보기 버튼 누락");
      more?.click();
      for (
        let attempt = 0;
        attempt < 20 &&
        ![...picker.select.options].some(
          (option) => option.value === "TEST-201",
        );
        attempt++
      )
        await wait(10);
      assert(
        [...picker.select.options].some(
          (option) => option.value === "TEST-201",
        ),
        "다음 후보 누락",
      );
      const input =
        picker.menu.panel.querySelector<HTMLInputElement>("input[type=search]");
      assert(Boolean(input), "이슈 검색 필드 누락");
      if (input) {
        input.value = "없는 후보";
        input.form?.requestSubmit();
      }
      for (
        let attempt = 0;
        attempt < 20 && String(picker.select.value) !== "__choose__";
        attempt++
      )
        await wait(10);
      assert(
        String(picker.select.value) === "__choose__" && Number(changes) === 2,
        "새 검색 후 이전 선택이 남음",
      );
      const clear = [
        ...picker.menu.panel.querySelectorAll<HTMLButtonElement>(
          "[role=option]",
        ),
      ].find((node) => node.textContent === "부모 연결 해제");
      clear?.click();
      assert(String(picker.select.value) === "", "연결 해제 선택 누락");
    } finally {
      picker.menu.destroy();
      host.remove();
    }
  },
);
await check(
  "상위 경로는 목록을 재사용하고 없는 경로만 보강하며 클릭으로 상세를 연다",
  async () => {
    const child = { ...issue, key: "TEST-3", parent: "TEST-2" };
    const parent = {
      ...issue,
      key: "TEST-2",
      parent: "TEST-1",
      summary: "부모",
    };
    const ancestor = { ...issue, key: "TEST-1", parent: "", summary: "에픽" };
    let calls = 0;
    let selected = "";
    const api = {
      ancestors: async () => {
        calls++;
        return [parent, ancestor];
      },
    };
    const full = issueBreadcrumbs(
      child,
      new Map([
        [parent.key, parent],
        [ancestor.key, ancestor],
      ]),
      api,
      (key) => {
        selected = key;
      },
    );
    fixture.append(full.element);
    assert(calls === 0, "알려진 상위를 다시 조회함");
    assert(
      [...full.element.querySelectorAll("a")]
        .map((link) => link.querySelector(".breadcrumb-label")?.textContent)
        .join() === "TEST-1 · 에픽,TEST-2 · 부모",
      "상위 경로 순서 누락",
    );
    assert(
      full.element.querySelectorAll("a .issue-type-icon").length === 2,
      "상위 경로 유형 아이콘 누락",
    );
    full.element.querySelector<HTMLAnchorElement>("a")?.click();
    assert(selected === "TEST-1", "상위 이동 누락");
    full.destroy();
    full.element.remove();
    const partial = issueBreadcrumbs(child, new Map(), api, () => {});
    fixture.append(partial.element);
    await wait();
    assert(
      Number(calls) === 1 && partial.element.querySelectorAll("a").length === 2,
      "누락 경로 보강 실패",
    );
    partial.destroy();
    partial.element.remove();
  },
);

await check(
  "연결 입력은 항상 보이며 저장된 값을 채우고 실패한 토큰을 비운다",
  async () => {
    let submitted = "";
    const form = connectionForm(
      {
        connection: async () => ({
          site: "example.atlassian.net",
          email: "fixture@example.com",
          tokenConfigured: true,
        }),
        saveConnection: async (credentials) => {
          submitted = JSON.stringify(credentials);
          throw new Error("모의 인증 실패");
        },
      },
      () => {},
    );
    fixture.append(form);
    await wait();
    const site = form.querySelector<HTMLInputElement>(
      'input[aria-label="Jira 사이트"]',
    );
    const email = form.querySelector<HTMLInputElement>("input[type=email]");
    const token = form.querySelector<HTMLInputElement>("input[type=password]");
    if (!site || !email || !token) throw new Error("연결 필드 누락");
    assert(
      !site.readOnly && !email.readOnly && !site.closest("label")?.hidden,
      "기존 연결 입력이 숨겨짐",
    );
    assert(token.value === "••••••••", "저장된 토큰 마스킹 누락");
    form.requestSubmit();
    await wait();
    assert(submitted === "", "마스킹 값이 인증 요청으로 전송됨");
    assert(
      form.querySelector<HTMLAnchorElement>(".connection-field-label a")
        ?.href ===
        "https://id.atlassian.com/manage-profile/security/api-tokens",
      "토큰 발급 링크 위치 누락",
    );
    token.value = "fixture-token";
    form.requestSubmit();
    await wait();
    assert(
      submitted.includes('"site":"example.atlassian.net"') &&
        submitted.includes('"email":"fixture@example.com"'),
      "토큰 교체에 기존 연결 정보 누락",
    );
    assert(
      token.value === "" &&
        Boolean(form.textContent?.includes("모의 인증 실패")),
      "실패한 토큰 또는 오류 안내 처리 누락",
    );
    assert(
      !site.readOnly && !email.readOnly && !site.closest("label")?.hidden,
      "연결 정보 편집 전환 누락",
    );
    assert(
      site.placeholder.includes(".atlassian.net") &&
        !site.hasAttribute("aria-describedby"),
      "사이트 형식 안내 누락",
    );
    form.remove();
    const initial = connectionForm(
      {
        connection: async () => ({ site: "", email: "" }),
        saveConnection: async () => ({ site: "", email: "" }),
      },
      () => {},
    );
    fixture.append(initial);
    await wait();
    assert(
      !initial.querySelector<HTMLInputElement>("input[type=email]")?.readOnly &&
        !initial
          .querySelector<HTMLInputElement>("input[type=email]")
          ?.closest("label")?.hidden,
      "최초 연결 입력이 숨겨짐",
    );
    initial.remove();
  },
);

await check(
  "늦은 연결 설정 응답은 인증 확인 중 비운 토큰을 다시 채우지 않는다",
  async () => {
    let settings!: (value: {
      site: string;
      email: string;
      tokenConfigured: boolean;
    }) => void;
    let saved!: (value: { site: string; email: string }) => void;
    const form = connectionForm(
      {
        connection: () =>
          new Promise((resolve) => {
            settings = resolve;
          }),
        saveConnection: () =>
          new Promise((resolve) => {
            saved = resolve;
          }),
      },
      () => {},
    );
    fixture.append(form);
    try {
      const site = form.querySelector<HTMLInputElement>(
        '[aria-label="Jira 사이트"]',
      );
      const email = form.querySelector<HTMLInputElement>(
        '[aria-label="Atlassian 이메일"]',
      );
      const token = form.querySelector<HTMLInputElement>(
        "input[type=password]",
      );
      assert(
        site !== null && email !== null && token !== null,
        "인증 필드 누락",
      );
      site.value = "example.atlassian.net";
      email.value = "fixture@example.com";
      token.value = "fixture-token";
      token.focus();
      form.requestSubmit();
      settings({
        site: "example.atlassian.net",
        email: "fixture@example.com",
        tokenConfigured: true,
      });
      await wait();
      assert(
        token.value === "",
        "늦은 설정 응답이 전송 후 비운 토큰 입력을 다시 채움",
      );
    } finally {
      saved({ site: "example.atlassian.net", email: "fixture@example.com" });
      form.remove();
      await wait();
    }
  },
);

await check(
  "첫 연결은 모든 필드를 함께 표시하고 입력·확인 결과에 따라 진행도를 갱신한다",
  async () => {
    let releaseSettings!: (value: { site: string; email: string }) => void;
    let failSave!: (reason: Error) => void;
    let calls = 0;
    let connected = false;
    const form = connectionForm(
      {
        connection: () =>
          new Promise((resolve) => {
            releaseSettings = resolve;
          }),
        saveConnection: async (credentials) => {
          calls++;
          assert(
            credentials.site === "example.atlassian.net" &&
              credentials.email === "fixture@example.com",
            "기본 정보 유실",
          );
          assert(credentials.token === "fixture-token", "토큰 전달 누락");
          if (calls === 1)
            return new Promise((_resolve, reject) => {
              failSave = reject;
            });
          return { site: credentials.site, email: credentials.email };
        },
      },
      () => {
        connected = true;
      },
      { guided: true },
    );
    fixture.append(form);
    try {
      const site = form.querySelector<HTMLInputElement>(
        '[aria-label="Jira 사이트"]',
      );
      const email = form.querySelector<HTMLInputElement>(
        '[aria-label="Atlassian 이메일"]',
      );
      const token = form.querySelector<HTMLInputElement>(
        "input[type=password]",
      );
      const issueToken = form.querySelector<HTMLAnchorElement>(
        ".connection-token-link",
      );
      const steps = [
        ...form.querySelectorAll<HTMLElement>(".connection-progress li"),
      ];
      assert(
        site !== null &&
          email !== null &&
          token !== null &&
          issueToken !== null,
        "연결 폼 구성 누락",
      );
      assert(
        [site, email, token].every(
          (field) => field.getBoundingClientRect().height > 0,
        ),
        "일부 입력 필드를 별도 단계로 숨김",
      );
      assert(
        steps.length === 3 && steps[0]?.getAttribute("aria-current") === "step",
        "최초 진행도 표시 누락",
      );
      assert(
        form.querySelector('[aria-label="이전 단계"]') === null,
        "불필요한 단계 이동 버튼이 남음",
      );
      form.requestSubmit();
      assert(calls === 0, "비어 있는 입력으로 인증 요청");
      site.value = "example.atlassian.net";
      email.value = "invalid";
      email.dispatchEvent(new Event("input", { bubbles: true }));
      assert(
        steps[0]?.dataset.state !== "complete",
        "잘못된 이메일을 입력 완료로 표시",
      );
      email.value = "fixture@example.com";
      email.dispatchEvent(new Event("input", { bubbles: true }));
      releaseSettings({
        site: "late.atlassian.net",
        email: "late@example.com",
      });
      await wait();
      assert(
        site.value === "example.atlassian.net" &&
          steps[0]?.dataset.state === "complete",
        "늦은 설정 응답이 사용자 입력이나 진행도를 덮음",
      );
      issueToken.addEventListener("click", (event) => event.preventDefault());
      issueToken.click();
      token.blur();
      window.dispatchEvent(new Event("focus"));
      assert(
        document.activeElement === token &&
          email.value === "fixture@example.com",
        "발급 페이지 복귀 시 포커스 또는 입력 유실",
      );
      token.value = "fixture-token";
      token.dispatchEvent(new Event("input", { bubbles: true }));
      assert(
        steps[1]?.dataset.state === "complete" &&
          steps[2]?.getAttribute("aria-current") === "step",
        "토큰 입력 후 확인 단계 표시 누락",
      );
      form.requestSubmit();
      assert(
        token.value === "" &&
          token.matches(":disabled") &&
          steps[1]?.dataset.state === "complete",
        "확인 중 토큰 제거·입력 잠금·진행도 유지 누락",
      );
      form.requestSubmit();
      assert(Number(calls) === 1, "연결 중 중복 요청");
      failSave(new Error("모의 인증 실패"));
      await wait();
      assert(
        !token.matches(":disabled") &&
          !connected &&
          token.value === "" &&
          steps[2]?.dataset.state === "error",
        "실패 복구 또는 진행도 오류 표시 누락",
      );
      token.value = "fixture-token";
      token.dispatchEvent(new Event("input", { bubbles: true }));
      form.requestSubmit();
      await wait();
      assert(
        connected &&
          token.value === "" &&
          steps.every((step) => step.dataset.state === "complete"),
        "성공 후 완료 표시·토큰 제거·화면 전환 누락",
      );
    } finally {
      form.remove();
    }
  },
);

await check(
  "부모 경로는 상단 틈 없이 고정되며 목록 높이·카드·스크롤을 바꾸지 않는다",
  async () => {
    const pane = element("section", "browse"),
      content = element("div", "browse-content"),
      host = element("div");
    pane.style.cssText =
      "height:280px;width:min(620px,calc(100vw - 48px));overflow:auto;";
    content.append(host);
    pane.append(content);
    fixture.append(pane);
    const list = createListController(
      {
        issues: async () => ({
          issues: [],
          ancestors: [],
          nextPageToken: null,
        }),
        children: async () => {
          throw new Error("경로 표시가 추가 조회를 하면 안 된다");
        },
      },
      {
        projects: ["TEST"],
        scope: "all",
        excludeDone: false,
        statuses: null,
        assignees: null,
        sort: "recent",
        q: "",
      },
      "me",
    );
    const rows: Issue[] = [
      {
        ...issue,
        key: "TEST-100",
        project: "TEST",
        parent: "",
        summary: "큰 계획",
        hasChildren: true,
        hierarchyLevel: 1,
        issueType: "에픽",
      },
      {
        ...issue,
        key: "TEST-101",
        project: "TEST",
        parent: "TEST-100",
        summary: "길게 적은 중간 부모 제목도 읽는 영역을 넘지 않아요",
        hasChildren: true,
        hierarchyLevel: 0,
        issueType: "작업",
      },
      ...Array.from({ length: 24 }, (_, index) => ({
        ...issue,
        key: `TEST-${200 + index}`,
        project: "TEST",
        parent: "TEST-101",
        summary: `하위 작업 ${index}`,
        hasChildren: false,
        hierarchyLevel: -1,
      })),
    ];
    for (const row of rows) {
      list.items.set(row.key, row);
      list.matched.add(row.key);
    }
    list.childPage("TEST-100").loaded = true;
    list.childPage("TEST-101").loaded = true;
    let selected = "";
    const tree = createTreeView(host, list, {
      catalog: () => ({
        projects: [],
        priorities: [],
        statuses: [],
        types: [],
      }),
      site: "fixture.atlassian.net",
      copied: () => {},
      selectedKey: () => "",
      compactDone: () => false,
      compactDoneParents: () => false,
      onSelect: () => {},
      onBranch: () => {},
      onTreeChange: () => {},
    });
    const context = createTreeContext(pane, host, {
      scroller: () => pane,
      items: list.visibleItems,
      projects: () => [
        {
          key: "TEST",
          name: "검사 프로젝트",
          avatar: "https://example.com/project.png",
        },
      ],
      select: (key) => {
        selected = key;
      },
    });
    try {
      tree.render();
      context.refresh();
      await wait(60);
      const nav = pane.querySelector<HTMLElement>(".tree-context");
      assert(Boolean(nav?.hidden), "상단에서 경로를 중복 표시한다");
      const height = pane.scrollHeight,
        first = host.querySelector('a[href="?issue=TEST-200"]');
      pane.scrollTop = 250;
      pane.dispatchEvent(new Event("scroll"));
      await wait(60);
      assert(
        Boolean(nav && !nav.hidden && nav.querySelectorAll("a").length === 2),
        "현재 부모 둘을 경로로 모으지 않는다",
      );
      assert(
        nav?.querySelector(".tree-context-project")?.textContent ===
          "검사 프로젝트",
        "프로젝트 이름이 경로에 없다",
      );
      assert(
        Boolean(
          nav &&
            Math.abs(
              nav.getBoundingClientRect().top -
                pane.getBoundingClientRect().top,
            ) < 1,
        ),
        "고정 경로 위에 틈이 있다",
      );
      assert(
        Boolean(nav && nav.scrollWidth <= nav.clientWidth),
        "부모 경로가 가로로 넘친다",
      );
      assert(
        pane.scrollHeight === height && pane.scrollTop === 250,
        "경로 표시가 스크롤 범위를 바꾼다",
      );
      assert(
        first === host.querySelector('a[href="?issue=TEST-200"]'),
        "스크롤 때문에 카드를 교체했다",
      );
      nav?.querySelector<HTMLAnchorElement>(".tree-context-current")?.click();
      assert(
        selected === "TEST-101",
        "부모 경로 클릭이 이슈를 선택하지 않는다",
      );
      pane.style.width = "300px";
      await wait(60);
      assert(
        Boolean(
          nav &&
            pane.scrollWidth === pane.clientWidth &&
            [...nav.querySelectorAll<HTMLElement>(".tree-context-key")].every(
              (key) => key.scrollWidth <= key.clientWidth,
            ),
        ),
        "좁은 경로가 넘치거나 이슈 번호가 잘린다",
      );
      const narrowHeight = pane.scrollHeight;
      pane.scrollTop = 0;
      pane.dispatchEvent(new Event("scroll"));
      await wait(60);
      assert(
        Boolean(nav?.hidden) && pane.scrollHeight === narrowHeight,
        "상단 복귀 시 경로가 남거나 높이가 바뀐다",
      );
    } finally {
      context.destroy();
      tree.destroy();
      pane.remove();
    }
  },
);

await check(
  "읽던 카드가 없어지면 다음 카드 위치를 유지하고 상단에서는 고정하지 않는다",
  () => {
    const pane = element("div"),
      host = element("div");
    pane.style.cssText =
      "height:180px;width:320px;overflow:auto;overflow-anchor:none";
    pane.append(host);
    fixture.append(pane);
    const cards = Array.from({ length: 20 }, (_, index) => {
      const card = issueCard(
        {
          ...issue,
          key: `TEST-${index + 1}`,
          summary: `위치 검사 ${index + 1}`,
        },
        { statusOrder: [], onSelect: () => {} },
      );
      card.style.height = "70px";
      host.append(card);
      return card;
    });
    pane.scrollTop = 350;
    const first = cards.findIndex(
      (card) =>
        (card.querySelector(".list-item")?.getBoundingClientRect().bottom ??
          0) > pane.getBoundingClientRect().top,
    );
    const next = cards[first + 1]?.querySelector("a.list-title");
    const before = next?.getBoundingClientRect().top ?? 0;
    const anchors = captureViewportAnchor(host, pane);
    cards[first]?.remove();
    assert(
      restoreViewportAnchor(host, pane, anchors),
      "이웃 카드로 복원하지 못함",
    );
    assert(
      Math.abs((next?.getBoundingClientRect().top ?? 0) - before) <= 2,
      "이웃 카드 위치가 움직임",
    );
    pane.scrollTop = 0;
    assert(
      captureViewportAnchor(host, pane).length === 0,
      "상단에서도 기존 카드에 고정함",
    );
    pane.remove();
  },
);

await check(
  "긴 캐시 하위의 중간으로 복원해도 부모와 끝 버튼 대신 보이는 분기를 검증한다",
  async () => {
    const pane = element("div"),
      host = element("div");
    pane.style.cssText = "height:240px;width:500px;overflow:auto";
    pane.append(host);
    fixture.append(pane);
    pane.scrollIntoView();
    const parent = {
      ...issue,
      key: "TEST-1000",
      project: "TEST",
      parent: "",
      hasChildren: true,
      hierarchyLevel: 1,
    };
    const children = Array.from({ length: 100 }, (_, index) => ({
      ...issue,
      key: `TEST-${2000 + index}`,
      project: "TEST",
      parent: parent.key,
      hasChildren: false,
      hierarchyLevel: -1,
    }));
    let requests = 0;
    const list = createListController(
      {
        issues: async () => ({
          issues: [parent],
          ancestors: [],
          nextPageToken: null,
        }),
        children: async () => {
          requests++;
          return { issues: children, nextPageToken: null };
        },
      },
      {
        projects: ["TEST"],
        scope: "all",
        excludeDone: false,
        sort: "recent",
        statuses: null,
        assignees: null,
        q: "",
      },
      "me",
    );
    list.items.set(parent.key, parent);
    list.direct.add(parent.key);
    list.matched.add(parent.key);
    const page = list.childPage(parent.key);
    page.loaded = true;
    page.restored = { count: 100, complete: true };
    for (const child of children) page.issues.set(child.key, child);
    const tree = createTreeView(host, list, {
      catalog: () => ({
        projects: [],
        statuses: [],
        priorities: [],
        types: [],
      }),
      site: "fixture.atlassian.net",
      copied: () => {},
      selectedKey: () => "",
      compactDone: () => false,
      compactDoneParents: () => false,
      onSelect: () => {},
      onBranch: () => {},
      onTreeChange: () => {},
    });
    try {
      tree.render();
      pane.scrollTop = 1800;
      await wait(100);
      assert(
        requests === 1,
        "화면 중간의 복원된 분기가 검증되지 않거나 중복 조회됐다",
      );
    } finally {
      tree.destroy();
      pane.remove();
    }
  },
);

await check(
  "펼침 중 부모를 접으면 다음 페이지를 중단하고 다시 펼칠 때 캐시를 유지한다",
  async () => {
    const pane = element("div"),
      host = element("div");
    pane.style.cssText = "height:240px;width:500px;overflow:auto";
    pane.append(host);
    fixture.append(pane);
    pane.scrollIntoView();
    const parent = {
      ...issue,
      key: "TEST-1000",
      project: "TEST",
      parent: "",
      hasChildren: true,
      hierarchyLevel: 1,
    };
    const children = Array.from({ length: 35 }, (_, index) => ({
      ...issue,
      key: `TEST-${2000 + index}`,
      project: "TEST",
      parent: parent.key,
      hasChildren: false,
      hierarchyLevel: -1,
    }));
    let release = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0,
      draw = () => {};
    const list = createListController(
      {
        issues: async () => ({
          issues: [parent],
          ancestors: [],
          nextPageToken: null,
        }),
        children: async (_key, _filters, _settings, token) => {
          requests++;
          await waiting;
          return {
            issues: token ? children.slice(25) : children.slice(0, 25),
            nextPageToken: token ? null : "next",
          };
        },
      },
      {
        projects: ["TEST"],
        scope: "all",
        excludeDone: false,
        sort: "recent",
        statuses: null,
        assignees: null,
        q: "",
      },
      "me",
      () => draw(),
    );
    list.items.set(parent.key, parent);
    list.direct.add(parent.key);
    list.matched.add(parent.key);
    const page = list.childPage(parent.key);
    page.loaded = true;
    page.restored = { count: 35, complete: true };
    for (const child of children) page.issues.set(child.key, child);
    const tree = createTreeView(host, list, {
      catalog: () => ({
        projects: [],
        statuses: [],
        priorities: [],
        types: [],
      }),
      site: "fixture.atlassian.net",
      copied: () => {},
      selectedKey: () => "",
      compactDone: () => false,
      compactDoneParents: () => false,
      onSelect: () => {},
      onBranch: () => {},
      onTreeChange: () => {},
    });
    draw = tree.render;
    try {
      draw();
      await wait(100);
      assert(requests === 1, "첫 검증이 시작되지 않았다");
      host
        .querySelector<HTMLButtonElement>('[data-issue-key="TEST-1000"]')
        ?.click();
      release();
      await wait(100);
      assert(
        Number(requests) === 1 && !host.querySelector(".tree-children"),
        "부모를 접어도 숨겨진 다음 페이지를 조회한다",
      );
      assert(
        page.issues.size === 35 && Boolean(page.restored),
        "접었다고 이전 캐시를 버린다",
      );
      host
        .querySelector<HTMLButtonElement>('[data-issue-key="TEST-1000"]')
        ?.click();
      assert(
        host.querySelectorAll(".list-item").length === 36,
        "다시 펼칠 때 캐시가 사라진다",
      );
      await wait(100);
      assert(
        Number(requests) === 3 && !page.restored,
        "재펼침 검증이 중복되거나 완료되지 않는다",
      );
    } finally {
      release();
      list.destroy();
      tree.destroy();
      pane.remove();
    }
  },
);

await check(
  "일반 다음 페이지를 상세에서도 보고 있으면 트리를 접어도 반영한다",
  async () => {
    const parent = { ...emptyIssue("TEST-2000"), hasChildren: true };
    let treeOpen = true,
      release = () => {},
      draw = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const list = createListController(
      {
        issues: async () => ({
          issues: [parent],
          ancestors: [],
          nextPageToken: null,
        }),
        children: async () => {
          await waiting;
          return {
            issues: [{ ...emptyIssue("TEST-2001"), parent: parent.key }],
            nextPageToken: null,
          };
        },
      },
      {
        projects: ["TEST"],
        scope: "all",
        excludeDone: false,
        sort: "recent",
        statuses: null,
        assignees: null,
        q: "",
      },
      "me",
      () => draw(),
    );
    const page = list.childPage(parent.key);
    page.loaded = true;
    page.nextPageToken = "next";
    const detail = detailChildren(
      {
        parent: {
          ...parent,
          reporter: "",
          reporterAvatar: "",
          created: "",
          description: null,
          attachments: [],
          url: "",
        },
        children: [],
        deferredChildren: true,
        dateEditing: false,
        imageEnabled: false,
      },
      createApi(),
      { statusOrder: [], onSelect: () => {} },
      {
        list,
        catalog: () => ({
          projects: [],
          statuses: [],
          priorities: [],
          types: [],
        }),
        onFilter: () => {},
      },
    );
    assert(Boolean(detail), "상세 하위 영역이 없다");
    if (!detail) return;
    fixture?.append(detail.element);
    const root = detail.element.querySelector("details");
    assert(Boolean(root), "아코디언이 없다");
    if (!root) return;
    root.open = true;
    draw = detail.refresh;
    try {
      const pending = list.queueChildren(parent.key, () => treeOpen);
      treeOpen = false;
      release();
      await pending;
      assert(
        page.issues.has("TEST-2001"),
        "열린 상세가 소비자로 등록되지 않아 응답이 버려졌다",
      );
    } finally {
      release();
      detail.destroy();
      list.destroy();
      detail.element.remove();
    }
  },
);

await check(
  "활동 XML은 생성·댓글 대상을 읽고 HTML을 실행하지 않으며 잘못된 응답을 거부한다",
  () => {
    const base = {
      id: "one",
      key: "TEST-1",
      author: "나",
      avatar: "",
      text: "나 이슈 생성",
      created: "2026-10-18T00:00:00Z",
    };
    const source = activityXML([
      base,
      {
        ...base,
        id: "two",
        key: "TEST-2",
        comment: true,
        text: '<a href="javascript:alert(1)">나 댓글 작성</a><img src="/should-not-load" onerror="alert(1)">',
        html: true,
        created: "2026-10-18T00:01:00Z",
      },
      { ...base, id: "outside", key: "OTHER-1" },
      base,
    ]);
    const parsed = parseActivityFeed(source, ["TEST"]);
    assert(
      parsed.length === 2 &&
        parsed[0]?.key === "TEST-2" &&
        parsed[0].text === "나 댓글 작성",
      "활동 파싱·중복·범위 처리 실패",
    );
    assert(
      !fixture.querySelector('img[src="/should-not-load"]'),
      "피드 HTML이 문서에 삽입됨",
    );
    for (const bad of [
      "<html>login</html>",
      "<feed",
      '<!DOCTYPE feed><feed xmlns="http://www.w3.org/2005/Atom"/>',
      activityXML([{ ...base, created: "invalid" }]),
    ]) {
      let failed = false;
      try {
        parseActivityFeed(bad, ["TEST"]);
      } catch {
        failed = true;
      }
      assert(failed, "잘못된 XML을 빈 성공으로 취급함");
    }
  },
);

await check(
  "공통 카드 별표는 높이를 늘리지 않고 완료 타일에서도 표시되며 상세 이동을 막는다",
  () => {
    let selected = 0,
      removed = false;
    const shortIssue = { ...issue, summary: "짧은 제목" };
    const saved = issueCard(shortIssue, {
      statusOrder: order,
      onSelect: () => {
        selected++;
      },
      favorites: {
        has: () => true,
        change: (_, value) => {
          removed = !value;
        },
      },
    });
    const plain = issueCard(shortIssue, {
      statusOrder: order,
      onSelect: () => {},
    });
    const host = element("section", "issue-list-container");
    host.style.width = "600px";
    host.append(saved, plain);
    fixture.append(host);
    try {
      assert(
        saved.getBoundingClientRect().height ===
          plain.getBoundingClientRect().height,
        "별표가 카드 높이를 늘린다",
      );
      host.classList.add("completed-grid");
      const star = saved.querySelector<HTMLButtonElement>(".favorite-button");
      assert(
        Boolean(star?.getBoundingClientRect().height),
        "완료 타일의 별표가 숨겨진다",
      );
      star?.click();
      assert(
        removed && selected === 0,
        "별표 해제가 상세를 열거나 상태를 전달하지 않는다",
      );
    } finally {
      host.remove();
    }
  },
);

let groupPreview: HTMLElement | undefined;
await check(
  "유형과 무관한 루트 분류·완료 통합과 카드 안의 펼침을 유지한다",
  () => {
    const host = element("div", "issue-list-container");
    fixture.append(host);
    const list = createListController(
      createApi(),
      {
        projects: ["TEST"],
        scope: "all",
        excludeDone: false,
        statuses: null,
        assignees: null,
        sort: "recent",
        q: "",
      },
      "me",
    );
    const parent = {
      ...emptyIssue("TEST-1000"),
      hierarchyLevel: 1,
      summary: "상위 태스크",
      hasChildren: true,
    };
    const child = {
      ...emptyIssue("TEST-1001"),
      parent: parent.key,
      hierarchyLevel: -1,
      statusCategory: "done",
      summary: "완료된 하위 작업",
    };
    const orphan = {
      ...emptyIssue("TEST-1002"),
      hierarchyLevel: 0,
      summary: "상위 연결 없는 작업 예시",
    };
    const done = {
      ...emptyIssue("TEST-1003"),
      hierarchyLevel: 1,
      statusCategory: "done",
      summary: "완료된 상위 작업",
    };
    const doneTask = {
      ...emptyIssue("TEST-1004"),
      hierarchyLevel: 0,
      statusCategory: "done",
      summary:
        "완료된 일반 작업의 긴 제목을 두 줄에 표시해도 다른 카드와 높이가 같아야 합니다",
    };
    const missingParent = {
      ...emptyIssue("TEST-1005"),
      parent: "TEST-9999",
      hierarchyLevel: 0,
      statusCategory: "done",
      summary: "현재 목록에 부모가 없는 작업",
    };
    for (const item of [parent, child, orphan, done, doneTask, missingParent]) {
      list.items.set(item.key, item);
      list.matched.add(item.key);
    }
    list.childPage(parent.key).loaded = true;
    const view = createTreeView(host, list, {
      site: "example",
      compactDoneParents: () => true,
      copied: () => {},
      selectedKey: () => "",
      catalog: () => ({
        projects: [],
        priorities: [],
        statuses: [],
        types: [1, 0, -1].map((level) => ({
          id: String(level),
          name: String(level),
          project: "TEST",
          hierarchyLevel: level,
        })),
      }),
      onSelect: () => {},
      onBranch: () => {},
      onTreeChange: () => {},
    });
    try {
      view.render();
      const unparented = host.querySelector<HTMLElement>(
        '[data-tree-key="unparented:TEST"]',
      );
      const rootDone = host.querySelector<HTMLElement>(
        '[data-tree-key="completed:TEST:tree"]',
      );
      assert(
        Boolean(unparented?.querySelector(`[data-tree-key="${parent.key}"]`)) &&
          Boolean(unparented?.querySelector(`[data-tree-key="${orphan.key}"]`)),
        "상위 연결 없는 에픽과 일반 작업이 유형으로 분리됐다",
      );
      assert(
        !unparented?.querySelector(`[data-tree-key="${missingParent.key}"]`),
        "부모가 목록에 없는 항목을 상위 연결 없음으로 오인했다",
      );
      assert(
        rootDone?.querySelectorAll(".list-item").length === 2 &&
          !unparented?.querySelector(
            '[data-tree-key="completed:TEST:standalone"]',
          ),
        "루트 완료가 유형별로 분리되거나 누락됐다",
      );
      assert(
        Boolean(unparented?.querySelector(`[data-tree-key="${child.key}"]`)) &&
          !rootDone?.querySelector(`[data-tree-key="${child.key}"]`),
        "실제 하위 완료가 프로젝트 완료로 이동했다",
      );
      const toggle = host.querySelector<HTMLButtonElement>(
        `[data-issue-key="${parent.key}"]`,
      );
      assert(
        Boolean(toggle?.parentElement?.classList.contains("tree-row")) &&
          !host.querySelector(".tree-folder,.tree-actions") &&
          Boolean(toggle?.querySelector(".ui-icon")) &&
          toggle?.textContent === "" &&
          toggle.parentElement?.firstElementChild === toggle &&
          getComputedStyle(toggle).position === "absolute" &&
          toggle.getBoundingClientRect().right <=
            (toggle.parentElement
              ?.querySelector(".list-item")
              ?.getBoundingClientRect().left ?? 0),
        "펼침 화살표가 카드 왼쪽 바깥에 절대 배치되지 않았다",
      );
      const children = toggle
        ?.closest(".tree-row")
        ?.parentElement?.querySelector(".tree-children");
      assert(
        Boolean(
          children && getComputedStyle(children).borderTopWidth === "0px",
        ),
        "펼친 하위 목록에 구분선이 남아 있다",
      );
      const parentIdentity = toggle
        ?.closest(".tree-row")
        ?.querySelector(".issue-identity");
      assert(
        Boolean(
          parentIdentity &&
            getComputedStyle(parentIdentity).paddingInlineStart === "0px",
        ),
        "펼침 버튼의 빈 공간이 왼쪽에 남아 있다",
      );
      const groupArrows = [
        ...host.querySelectorAll<SVGSVGElement>(
          '[data-group-key="unparented:TEST"] .ui-icon, [data-group-key="completed:TEST:tree"] .ui-icon',
        ),
      ].map((arrow) => arrow.getBoundingClientRect());
      assert(
        groupArrows.length === 2 &&
          Math.abs((groupArrows[0]?.x ?? 0) - (groupArrows[1]?.x ?? 0)) < 1,
        "루트 그룹의 들여쓰기 레벨이 다르다",
      );
      for (const label of ["상위 연결 없는 작업", "완료 2개"]) {
        const toggle = [
          ...host.querySelectorAll<HTMLButtonElement>(".tree-section-toggle"),
        ].find((button) => button.textContent === label);
        assert(Boolean(toggle), "묶음 접기 버튼 누락");
        toggle?.click();
        view.render();
        const closed = [
          ...host.querySelectorAll<HTMLButtonElement>(".tree-section-toggle"),
        ].find((button) => button.textContent === label);
        assert(
          closed?.getAttribute("aria-expanded") === "false" &&
            Boolean(
              closed
                .closest(".tree-section")
                ?.lastElementChild?.hasAttribute("hidden"),
            ),
          "묶음 접힘 상태가 유지되지 않는다",
        );
        const content = closed?.closest(".tree-section")?.lastElementChild;
        assert(
          Boolean(content && getComputedStyle(content).display === "none"),
          "접힌 묶음이 실제 화면에 남아 있다",
        );
        closed?.click();
      }
      assert(
        list.tree.states.size === 0,
        "그룹 접기가 이슈 펼침 상태를 바꿨다",
      );
      toggle?.click();
      view.render();
      const closedParent = host.querySelector<HTMLButtonElement>(
        `[data-issue-key="${parent.key}"]`,
      );
      assert(
        closedParent?.getAttribute("aria-expanded") === "false" &&
          !closedParent
            .closest(".tree-row")
            ?.parentElement?.querySelector(".tree-children"),
        "접어도 하위 목록이 남는다",
      );
      closedParent?.click();
      view.render();
      const openedParent = host.querySelector<HTMLButtonElement>(
        `[data-issue-key="${parent.key}"]`,
      );
      assert(
        openedParent?.getAttribute("aria-expanded") === "true" &&
          Boolean(
            openedParent
              .closest(".tree-row")
              ?.parentElement?.querySelector(".tree-children"),
          ),
        "다시 열어도 하위 목록이 복원되지 않는다",
      );
      const theme = document.documentElement.dataset.theme;
      try {
        host.style.width = "320px";
        for (const mode of ["light", "dark"]) {
          document.documentElement.dataset.theme = mode;
          for (const card of host.querySelectorAll<HTMLElement>(".issue-card"))
            assert(card.scrollWidth <= card.clientWidth, "좁은 카드가 넘친다");
          for (const grid of host.querySelectorAll<HTMLElement>(
            ".completed-grid",
          )) {
            const heights = [
              ...grid.querySelectorAll<HTMLElement>(".list-item"),
            ].map((tile) => tile.getBoundingClientRect().height);
            assert(
              Math.max(...heights) - Math.min(...heights) < 1,
              "완료 카드가 제목 길이와 행에 따라 높이가 달라진다",
            );
          }
        }
      } finally {
        host.style.removeProperty("width");
        if (theme === undefined) delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = theme;
      }
      list.items.delete(child.key);
      view.render();
      assert(
        !host.querySelector(".tree-children .empty"),
        "필터로 비어 있는 하위 목록이 안내 행을 차지한다",
      );
      groupPreview = host.cloneNode(true) as HTMLElement;
      groupPreview.id = "group-layout-preview";
      groupPreview.style.width = "min(100%, 760px)";
    } finally {
      view.destroy();
      host.remove();
    }
  },
);

await check(
  "부모가 없는 일반·완료 목록도 현재 프로젝트 경로를 표시한다",
  async () => {
    const pane = element("section", "browse"),
      content = element("div", "browse-content"),
      host = element("div");
    pane.style.cssText = "height:280px;width:400px;overflow:auto";
    content.append(host);
    pane.append(content);
    fixture.append(pane);
    const list = createListController(
      createApi(),
      {
        projects: ["AA", "BB"],
        scope: "all",
        excludeDone: false,
        statuses: null,
        assignees: null,
        sort: "recent",
        q: "",
      },
      "me",
    );
    const projects = [
      { key: "AA", name: "첫 프로젝트", avatar: "" },
      { key: "BB", name: "다른 프로젝트", avatar: "" },
    ];
    for (const project of projects)
      for (let i = 1; i <= 24; i++) {
        const row = {
          ...emptyIssue(`${project.key}-${i}`, `작업 ${i}`),
          hierarchyLevel: 0,
          statusCategory: i > 14 ? "done" : "indeterminate",
        };
        list.items.set(row.key, row);
        list.matched.add(row.key);
      }
    const tree = createTreeView(host, list, {
      site: "example",
      copied: () => {},
      selectedKey: () => "",
      compactDoneParents: () => true,
      catalog: () => ({
        projects,
        priorities: [],
        statuses: [],
        types: projects.flatMap((project) =>
          [1, 0].map((level) => ({
            id: String(level),
            name: String(level),
            project: project.key,
            hierarchyLevel: level,
          })),
        ),
      }),
      onSelect: () => {},
      onBranch: () => {},
      onTreeChange: () => {},
    });
    const context = createTreeContext(pane, host, {
      scroller: () => pane,
      items: list.visibleItems,
      projects: () => projects,
      select: () => {},
    });
    try {
      tree.render();
      context.refresh();
      await wait(60);
      const nav = pane.querySelector<HTMLElement>(".tree-context");
      assert(
        Boolean(nav?.hidden),
        "프로젝트 제목을 아직 보고 있는데 중복 경로가 나온다",
      );
      for (const [selector, label, expectedGroups] of [
        [
          '[data-tree-key="AA"] .unparented-heading',
          "첫 프로젝트",
          ["상위 연결 없는 작업"],
        ],
        ['[data-tree-key="completed:AA:tree"]', "첫 프로젝트", ["완료"]],
        [
          '[data-tree-key="BB"] .list-item',
          "다른 프로젝트",
          ["상위 연결 없는 작업"],
        ],
      ] as const) {
        const target = host.querySelector<HTMLElement>(selector ?? "");
        assert(target !== null, "스크롤 검사 대상 누락");
        pane.scrollTop +=
          target.getBoundingClientRect().top -
          pane.getBoundingClientRect().top +
          10;
        pane.dispatchEvent(new Event("scroll"));
        await wait(60);
        assert(
          Boolean(
            nav &&
              !nav.hidden &&
              nav.querySelector(".tree-context-project")?.textContent === label,
          ),
          "현재 프로젝트 경로가 없거나 이전 프로젝트가 남는다",
        );
        assert(
          nav?.querySelectorAll("a").length === 0,
          "없는 상위 이슈 경로가 남는다",
        );
        const groupLabels = [
          ...(nav?.querySelectorAll(".tree-context-group") ?? []),
        ].map((node) => node.textContent);
        assert(
          JSON.stringify(groupLabels) === JSON.stringify(expectedGroups),
          "현재 묶음 경로가 누락되거나 순서가 다르다",
        );
        const project = nav?.querySelector(".tree-context-project"),
          group = nav?.querySelector(".tree-context-group");
        assert(Boolean(project && group), "프로젝트·그룹 경로 누락");
        assert(
          Math.abs(
            (project?.getBoundingClientRect().top ?? 0) -
              (group?.getBoundingClientRect().top ?? 0),
          ) < 2,
          "공간이 충분한 프로젝트·그룹 경로가 강제로 줄 바꿈된다",
        );
      }
    } finally {
      context.destroy();
      tree.destroy();
      pane.remove();
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

const cardPreview = exampleCards();
cardPreview.id = "card-layout-preview";
const previewWidth = new URLSearchParams(location.search).get("width");
cardPreview.style.width =
  previewWidth === "320" || previewWidth === "420" || previewWidth === "480"
    ? `${previewWidth}px`
    : "min(100%, 760px)";
fixture.append(cardPreview);
const previewLink = element("a", "", "카드 배치 미리보기");
previewLink.href = "#card-layout-preview";
results.append(previewLink);

if (groupPreview) {
  if (new URLSearchParams(location.search).get("width") === "320") {
    groupPreview.style.width = "320px";
    const title = groupPreview.querySelector(".tree-parent .list-title");
    if (title)
      title.textContent =
        "긴 제목을 여러 줄로 읽는 경우에도 번호 옆부터 자연스럽게 이어지며 배지가 남은 줄 오른쪽에 정렬되어야 합니다";
  }
  fixture.append(groupPreview);
  const link = element("a", "", "그룹 배치 미리보기");
  link.href = "#group-layout-preview";
  results.append(link);
}

if (new URLSearchParams(location.search).get("theme") === "dark")
  document.documentElement.dataset.theme = "dark";
