import "../src/client/styles.css";
import { createApi } from "../src/client/api.ts";
import { applicationCommands } from "../src/client/palette-actions.ts";
import { faqEntries } from "../src/domain/faq.ts";
import { createCommandPalette } from "../src/ui/command-palette.ts";

const host = document.querySelector<HTMLElement>("#fixture");
const results = document.querySelector("#results");
if (!host || !results) throw Error("fixture 누락");
let theme: "light" | "dark" | "system" = "light";
let activeView = "one",
  requests = 0,
  failures = 0;
const views = [{ id: "one", name: "내 작업", icon: "" }];
const calls: string[] = [];
const palette = createCommandPalette({
  host,
  api: createApi(async () => {
    requests++;
    throw Error("예상하지 않은 요청");
  }),
  site: "fixture.atlassian.net",
  context: () => ({ projects: [], keys: [], issue: "" }),
  recent: () => [],
  localIssues: () => [],
  order: () => [],
  select: () => {},
  changed: async () => {},
  canMutate: () => false,
  notice: (value) => calls.push(value),
  aiAvailable: () => false,
  storage: { getItem: () => null, setItem: () => {} },
  actions: () =>
    applicationCommands({
      theme,
      activeView,
      views,
      setTheme: (value) => {
        theme = value;
        document.documentElement.dataset.theme = value;
      },
      selectView: (id) => {
        activeView = id;
      },
      createView: () => {
        calls.push("create");
      },
      editView: () => {
        calls.push("edit");
      },
      settings: (tab) => {
        calls.push(tab ?? "settings");
      },
      help: () => {},
      onboarding: () => {},
      feedback: () => {},
    }),
});
function assert(value: unknown, message: string) {
  if (!value) throw Error(message);
}
async function check(name: string, work: () => void | Promise<void>) {
  const row = document.createElement("li");
  try {
    await work();
    row.textContent = `통과: ${name}`;
  } catch (error) {
    failures++;
    row.textContent = `실패: ${name}: ${error}`;
  }
  results?.append(row);
}
await check(
  "설정 단축키는 공통 설정 액션을 열고 팔레트에도 같은 키를 안내한다",
  async () => {
    const before = calls.length;
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: ",",
        code: "Comma",
        metaKey: /Mac/.test(navigator.platform),
        ctrlKey: !/Mac/.test(navigator.platform),
        bubbles: true,
      }),
    );
    await Promise.resolve();
    assert(
      calls.length === before + 1 && calls.at(-1) === "settings",
      "설정 실행 누락",
    );
    palette.openCommands();
    const settings = host.querySelector<HTMLButtonElement>(
      '[aria-label="설정 열기"]',
    );
    assert(
      settings?.querySelector("kbd")?.textContent?.includes(","),
      "설정 단축키 안내 누락",
    );
    const frame = host
      .querySelector(".command-picker-modal")
      ?.getBoundingClientRect();
    const scroll = host.querySelector(".command-menu")?.getBoundingClientRect();
    assert(
      frame &&
        scroll &&
        Math.abs(frame.right - scroll.right) <= 2 &&
        Math.abs(frame.bottom - scroll.bottom) <= 2,
      "팔레트 스크롤이 모달 끝에 맞지 않음",
    );
    host.querySelector(".command-picker")?.closest("dialog")?.close();
    calls.splice(before);
  },
);
function query(value: string) {
  palette.openCommands();
  const input = host?.querySelector<HTMLInputElement>(".command-picker input");
  if (!input) throw Error("입력 누락");
  input.value = value;
  input.dispatchEvent(new Event("input"));
  return input;
}
function action(label: string) {
  const button = [
    ...(host?.querySelectorAll<HTMLButtonElement>(".command-menu button") ??
      []),
  ].find((item) => item.getAttribute("aria-label") === label);
  if (!button) throw Error(`명령 누락: ${label}`);
  return button;
}
await check("테마 전환·현재 표시·키보드 실행", () => {
  const input = query("다크모드로 전환");
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  assert(theme === "dark", "테마 미적용");
  assert(
    !host.querySelector(".command-picker-modal[open]"),
    "실행 후 팔레트 유지",
  );
  query("다크");
  assert(
    action("다크 모드로 전환").querySelector(".command-current"),
    "현재 표시 누락",
  );
});
await check("생성 이후 추가된 뷰·중복 이름을 ID로 구분", () => {
  views.push(
    { id: "two", name: "가나라", icon: "emoji:🍎" },
    { id: "three", name: "가나라", icon: "" },
  );
  query("'가나라' 뷰로 전환");
  const buttons = host.querySelectorAll<HTMLButtonElement>(
    ".command-menu button",
  );
  assert(buttons.length === 2, "새 뷰 검색 누락");
  assert(
    buttons[0]?.querySelector(".command-action-label")?.textContent ===
      "가나라 뷰로 전환",
    "뷰 아이콘과 레이블이 섞임",
  );
  buttons[1]?.click();
  assert(activeView === "three", "중복 이름의 다른 뷰 실행");
});
await check("설정·뷰 생성 연결과 AI 미연결 명령 제외", () => {
  query("Jira 연결 설정");
  action("Jira 연결 설정 열기").click();
  query("뷰생성");
  action("뷰 만들기").click();
  assert(calls.join(",") === "Jira 연결,create", "다른 UI 동작 실행");
  query("AI");
  assert(!host.querySelector('[aria-label="AI 대화"]'), "미연결 AI 명령 표시");
});
await check("FAQ JSON의 질문·키워드·본문 검색과 질문 직접 열기", () => {
  const entry = faqEntries.find((item) => item.id === "tree");
  if (!entry) throw Error("FAQ 누락");
  query("브레드크럼");
  action(entry.question).click();
  assert(
    host.querySelector(".faq-dialog[open] .faq-item[open] summary")
      ?.textContent === entry.question,
    "다른 질문 열림",
  );
  query("오른쪽에 상세");
  assert(action(entry.question), "FAQ 본문 검색 누락");
});
await check("명령 조회는 네트워크·Jira 변경을 호출하지 않음", () => {
  assert(requests === 0, `${requests}회 요청 발생`);
});
palette.destroy();
document.body.dataset.failures = String(failures);
document.body.dataset.done = "true";
