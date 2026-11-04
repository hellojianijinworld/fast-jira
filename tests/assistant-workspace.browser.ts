import { createApi } from "../src/client/api.ts";
import { createApp } from "../src/client/app.ts";
import { emptyIssue } from "../src/domain/wire.ts";
import { element } from "../src/ui/dom.ts";
import { activityXML } from "./activity-fixture.ts";
import "../src/client/styles.css";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("검사 영역 누락");
const preview = new URLSearchParams(location.search).has("preview");
const values = new Map<string, string>([
  [
    "fastJira:filters:fixture.atlassian.net:me",
    JSON.stringify({ configured: true, projects: ["TEST"], scope: "all" }),
  ],
]);
const issue = {
  ...emptyIssue("TEST-833", "생성 파이프라인 개편 및 내용 보존·분량·표기 개선"),
  project: "TEST",
  status: "개발 진행 중",
  statusCategory: "indeterminate",
};
let activityCalls = 0,
  listCalls = 0;
let runs = 0,
  release: (() => void) | undefined;
const api = createApi(async (input, init) => {
  const url = new URL(String(input), location.origin);
  if (
    init?.method &&
    init.method !== "GET" &&
    url.pathname !== "/api/assistant/run"
  )
    throw new Error("실제 쓰기 금지");
  switch (url.pathname) {
    case "/api/identity":
    case "/api/projects":
      return Response.json({
        site: "fixture.atlassian.net",
        me: { accountId: "me", displayName: "검사 사용자" },
        projects: [{ key: "TEST", name: "제품 개발", avatar: "" }],
        priorities: [],
      });
    case "/api/issues":
      listCalls++;
      return Response.json({
        issues: [issue],
        ancestors: [],
        nextPageToken: null,
      });
    case "/api/statuses":
      return Response.json([
        {
          id: "2",
          name: "개발 진행 중",
          category: "indeterminate",
          projects: ["TEST"],
        },
      ]);
    case "/api/issue-types":
    case "/api/assignees":
    case "/api/ancestors":
    case "/api/comments":
      return Response.json([]);
    case "/api/activity":
      activityCalls++;
      return Response.json({
        feed: activityXML(
          runs
            ? [
                {
                  id: "saved-activity",
                  key: issue.key,
                  author: "검사 사용자",
                  avatar: "",
                  text: "AI 변경이 저장됐어요",
                  created: new Date().toISOString(),
                },
              ]
            : [],
        ),
      });
    case "/api/matches":
      return Response.json({ keys: [issue.key], ancestors: [] });
    case "/api/changes":
      return Response.json({ issues: [], ancestors: [] });
    case "/api/assistant/status":
      return Response.json({
        ready: true,
        models: [{ id: "test", name: "검사 모델", isDefault: true }],
        providers: [{ id: "codex", ready: true, error: "" }],
        error: "",
        voice: { ready: false },
      });
    case "/api/assistant/approvals":
      return Response.json([]);
    case "/api/assistant/run":
      runs++;
      if (runs > 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return Response.json({
        conversationId: "test",
        issues: runs === 1 ? [issue] : [],
        answer: new URLSearchParams(location.search).has("markdown")
          ? "최근 작업을 정리했어요.\n\n| 이슈 | 현재 상태 | 확인한 내용 |\n| --- | --- | --- |\n| [TEST-833 · 생성 파이프라인 개선](https://fixture.atlassian.net/browse/TEST-833) | **개발 진행 중** | 세부 작업을 확인하고 있어요. |\n| TEST-820 · 가운뎃점 치환 | PR 대기중 | 관련 PR이 병합됐어요. 완료 기준을 확인해 주세요. |\n\n1. 완료 기준 확인\n2. QA 결과 확인\n\n> 상태를 바꾸기 전에 내용을 확인해 주세요."
          : "현재 작업은 [TEST-833](https://fixture.atlassian.net/browse/TEST-833)에서 확인할 수 있어요.",
        proposals: [],
      });
    case "/api/issue":
      return Response.json({
        parent: {
          ...issue,
          description: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "필요한 내용을 확인하면서 AI 대화를 이어갈 수 있어요. 목록과 상세는 기존 컴포넌트를 그대로 사용해요.",
                  },
                ],
              },
            ],
          },
          reporter: "검사 사용자",
          reporterAvatar: "",
          created: "2026-11-04T00:00:00Z",
          attachments: [],
          url: "https://fixture.atlassian.net/browse/TEST-833",
        },
        children: [],
        dateEditing: true,
        imageEnabled: false,
        deferredChildren: true,
      });
    case "/api/issue-children":
      return Response.json({ issues: [], ancestors: [], nextPageToken: null });
    default:
      throw new Error(`모의 응답 누락: ${url.pathname}`);
  }
});
history.replaceState(null, "", location.pathname + location.search);
let app = await createApp(root, api, {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => {
    values.set(key, value);
  },
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function button(label: string, scope: ParentNode = document) {
  const node = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) =>
      node.getAttribute("aria-label") === label ||
      node.textContent?.trim() === label,
  );
  assert(node, `버튼 누락: ${label}`);
  return node;
}
function input() {
  const node = root?.querySelector<HTMLTextAreaElement>(
    '[aria-label="AI 메시지"]',
  );
  assert(node, "입력창 누락");
  return node;
}
let failures = 0;
async function check(name: string, run: () => Promise<void>) {
  try {
    await run();
    document
      .querySelector("#results")
      ?.append(element("li", "", `통과: ${name}`));
  } catch (error) {
    failures++;
    document
      .querySelector("#results")
      ?.append(element("li", "error", `${name}: ${String(error)}`));
  }
}
button("AI 대화").click();
await tick();
input().value = "내 작업을 확인해 줘";
root.querySelector<HTMLFormElement>(".command-form")?.requestSubmit();
await tick();
if (!preview) {
  await check(
    "AI 변경 완료는 목록 전체 재조회 없이 최근 활동도 바로 확인한다",
    async () => {
      for (let n = 0; n < 20 && activityCalls < 2; n++) await tick();
      assert(activityCalls === 2, "AI 변경 후 최근 활동을 조회하지 않음");
      assert(
        root
          .querySelector(".activity-feed")
          ?.textContent?.includes("AI 변경이 저장됐어요"),
        "변경된 활동 표시 누락",
      );
      assert(listCalls === 1, "활동 갱신이 목록 전체를 재조회함");
    },
  );

  await check(
    "AI는 비모달 왼쪽 패널이고 링크를 눌러도 대화와 입력을 유지한다",
    async () => {
      const chat = root.querySelector<HTMLDialogElement>(".ai-modal");
      assert(chat?.open && !chat.matches(":modal"), "AI가 모달로 열림");
      input().value = "이어서 물어볼 내용";
      root.querySelector<HTMLAnchorElement>(".command-answer a")?.click();
      await tick();
      assert(
        chat.open && input().value === "이어서 물어볼 내용",
        "상세를 열면서 대화·초안 유실",
      );
      assert(
        root
          .querySelector(".detail-content .detail-title")
          ?.textContent?.includes("생성 파이프라인"),
        "상세 열기 누락",
      );
      assert(!root.querySelector("dialog:modal"), "겹친 모달 발생");
      assert(root.querySelector(".browse a.list-title"), "목록 유실");
    },
  );
  await check(
    "폭이 부족하면 목록·상세를 전환하고 대화 요청은 계속 유지한다",
    async () => {
      root.style.width = "1000px";
      await tick();
      const shell = root.querySelector<HTMLElement>(".assistant-workspace");
      for (let n = 0; n < 20 && shell?.dataset.compact !== "true"; n++)
        await tick();
      assert(shell?.dataset.compact === "true", "작은 작업 영역이 분할됨");
      button("목록", shell).click();
      await tick();
      assert(
        root.querySelector(".browse")?.getClientRects().length,
        "목록 전환 실패",
      );
      button("상세", shell).click();
      await tick();
      assert(
        root.querySelector(".detail-pane")?.getClientRects().length,
        "상세 전환 실패",
      );
      input().value = "진행 중인 요청";
      root.querySelector<HTMLFormElement>(".command-form")?.requestSubmit();
      await tick();
      root.style.width = "390px";
      for (let n = 0; n < 20 && shell?.dataset.mobile !== "true"; n++)
        await tick();
      button("대화", shell).click();
      await tick();
      input().value = "보존할 입력";
      button("목록", shell).click();
      await tick();
      button("상세", shell).click();
      await tick();
      assert(
        !root.querySelector("dialog:modal"),
        "작은 화면에서 상세 모달 겹침",
      );
      button("대화", shell).click();
      await tick();
      assert(
        input().value === "보존할 입력" &&
          runs === 2 &&
          root.querySelector('[aria-label="답변 중단"]')?.getClientRects()
            .length,
        "화면 전환이 요청을 취소하거나 입력을 지움",
      );
      release?.();
      await tick();
      button("상세", shell).click();
      button("이슈 상세 닫기").click();
      await tick();
      assert(
        shell.dataset.pane === "chat",
        "모바일 상세를 닫으면 이전 대화로 돌아오지 않음",
      );
      root.style.removeProperty("width");
    },
  );
  await check(
    "대화 기록은 패널 안에서 열리고 검색 모달은 패널을 닫지 않는다",
    async () => {
      await tick();
      await tick();
      const history = root.querySelector<HTMLElement>(".chat-sidebar");
      if (history?.hasAttribute("popover")) {
        button("대화 목록").click();
        await tick();
        assert(history.matches(":popover-open"), "대화 기록 열기 누락");
        button("대화 목록").click();
      } else assert(history?.getClientRects().length, "고정 대화 목록 누락");
      button("검색").click();
      await tick();
      assert(
        root.querySelector(".ai-modal[open]") &&
          root.querySelector(".search-modal:modal"),
        "검색이 대화 패널을 닫음",
      );
      button("검색 닫기").click();
      await tick();
      button("AI 대화 닫기").click();
      await tick();
      assert(
        root.querySelector<HTMLElement>(".assistant-workspace")?.dataset
          .chatOpen === "false",
        "대화 닫기 누락",
      );
      button("AI 대화").click();
      await tick();
      assert(input().value === "보존할 입력", "다시 열면서 초안 유실");
    },
  );
  await check(
    "넓은 AI 패널은 같은 대화 목록을 고정 폭으로 표시하고 좁히면 팝오버로 전환한다",
    async () => {
      const handle = root.querySelector<HTMLElement>(
        '[aria-label="AI 대화와 작업 영역 너비"]',
      );
      const sidebar = root.querySelector<HTMLElement>(".chat-sidebar");
      assert(handle && sidebar, "대화 목록 누락");
      const draft = input().value;
      const count = sidebar.querySelectorAll(".chat-conversation").length;
      handle.dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", bubbles: true }),
      );
      for (
        let n = 0;
        n < 20 && !sidebar.classList.contains("chat-history-inline");
        n++
      )
        await tick();
      assert(
        sidebar.classList.contains("chat-history-inline") &&
          !sidebar.hasAttribute("popover"),
        "넓은 패널에서 목록이 팝오버로 남음",
      );
      assert(
        Math.abs(
          sidebar.getBoundingClientRect().width -
            14 *
              parseFloat(getComputedStyle(document.documentElement).fontSize),
        ) < 2,
        "목록이 고정 폭이 아님",
      );
      assert(
        !button("대화 목록").getClientRects().length &&
          sidebar.getClientRects().length,
        "목록 버튼과 고정 목록이 중복됨",
      );
      handle.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
      );
      for (let n = 0; n < 20 && !sidebar.hasAttribute("popover"); n++)
        await tick();
      button("대화 목록").click();
      await tick();
      assert(
        sidebar.matches(":popover-open") &&
          sidebar.querySelectorAll(".chat-conversation").length === count &&
          input().value === draft,
        "전환하면서 목록 또는 초안이 유실됨",
      );
      button("대화 목록").click();
      handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await tick();
    },
  );
  await check(
    "AI 스플리터는 너비를 조절·저장하고 모바일 전환 후에도 복원한다",
    async () => {
      const handle = root.querySelector<HTMLElement>(
        '[role="separator"][aria-label="AI 대화와 작업 영역 너비"]',
      );
      const chat = root.querySelector<HTMLElement>(".assistant-workspace-chat");
      assert(handle && chat, "AI 스플리터 누락");
      const original = chat.getBoundingClientRect().width;
      handle.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      );
      await tick();
      assert(
        chat.getBoundingClientRect().width > original,
        "AI 너비가 늘지 않음",
      );
      handle.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "End",
          bubbles: true,
          cancelable: true,
        }),
      );
      await tick();
      const settings = JSON.parse(values.get("fastJira:settings") ?? "null");
      assert(
        settings?.layout?.assistantRatio > 0.5 &&
          handle.getAttribute("aria-valuenow") ===
            handle.getAttribute("aria-valuemax"),
        "AI 너비 저장·최대 제한 실패",
      );
      const ratio = settings.layout.assistantRatio;
      root.style.width = "390px";
      for (let n = 0; n < 20 && handle.getClientRects().length; n++)
        await tick();
      assert(!handle.getClientRects().length, "모바일에 스플리터 표시");
      root.style.removeProperty("width");
      await tick();
      app.destroy();
      app = await createApp(root, api, {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          values.set(key, value);
        },
      });
      button("AI 대화").click();
      await tick();
      const restored = root.querySelector(
        '[aria-label="AI 대화와 작업 영역 너비"]',
      );
      assert(
        Number(restored?.getAttribute("aria-valuenow")) ===
          Math.round(ratio * 100),
        "다시 열 때 AI 너비 복원 실패",
      );
      assert(
        !values.has("fastJira:splitRatio"),
        "기존 목록 스플리터 설정을 덮어씀",
      );
    },
  );
  await check(
    "AI 단축키로 답변 중 닫아도 초안·대기열·요청을 유지한다",
    async () => {
      const mac = /Mac|iPhone|iPad/.test(navigator.platform);
      const press = () =>
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "i",
            code: "KeyI",
            ctrlKey: true,
            metaKey: mac,
            altKey: !mac,
            bubbles: true,
            cancelable: true,
          }),
        );
      await app.select(issue.key);
      input().value = "계속 진행할 요청";
      root.querySelector<HTMLFormElement>(".command-form")?.requestSubmit();
      await tick();
      input().value = "대기할 요청";
      root.querySelector<HTMLFormElement>(".command-form")?.requestSubmit();
      await tick();
      input().value = "남겨둘 초안";
      const before = runs;
      press();
      await tick();
      assert(
        !root.querySelector<HTMLDialogElement>(".ai-modal")?.open,
        "단축키 닫기 누락",
      );
      press();
      await tick();
      assert(
        root.querySelector<HTMLDialogElement>(".ai-modal")?.open &&
          input().value === "남겨둘 초안" &&
          runs === before,
        "단축키가 요청을 재실행하거나 초안을 지움",
      );
      assert(
        root.querySelector<HTMLElement>(".workspace")?.dataset.pane ===
          "detail",
        "대화 재열기가 보고 있던 상세를 목록으로 바꿈",
      );
      assert(
        root.querySelector('[aria-label="답변 중단"]')?.getClientRects()
          .length &&
          root.querySelector(".chat-queue-text")?.textContent === "대기할 요청",
        "진행 중 요청이나 대기열 유실",
      );
      release?.();
    },
  );
  document.body.dataset.result = failures ? "failed" : "passed";
} else {
  root.querySelector<HTMLAnchorElement>(".command-answer a")?.click();
  await tick();
}
if (new URLSearchParams(location.search).get("theme") === "dark")
  document.documentElement.dataset.theme = "dark";
window.addEventListener("pagehide", () => app.destroy(), { once: true });
