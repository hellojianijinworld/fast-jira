import "../src/client/styles.css";
import { createApi } from "../src/client/api.ts";
import type { VoiceCallbacks } from "../src/client/codex-voice.ts";
import { type JsonValue, textDocument } from "../src/domain/adf.ts";
import type { IssueDraft } from "../src/domain/create-issue.ts";
import { emptyIssue } from "../src/domain/wire.ts";
import { createCommandPalette } from "../src/ui/command-palette.ts";
import { creationField } from "../src/ui/create-field.ts";
import { createIssueDialog } from "../src/ui/create-issue.ts";
import { element } from "../src/ui/dom.ts";

const host = document.querySelector<HTMLElement>("#fixture");
if (!host) throw new Error("fixture missing");
const results = document.querySelector("#results");
let failures = 0,
  created = "",
  writes = 0,
  failSave = false,
  promptSent = "",
  voiceCallbacks: VoiceCallbacks | undefined;
const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
const wait = async (condition: () => boolean) => {
  for (let index = 0; index < 100 && !condition(); index++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert(condition(), "UI 응답 시간 초과");
};
const change = (control: HTMLSelectElement, value: string) => {
  control.value = value;
  control.dispatchEvent(new Event("change", { bubbles: true }));
};
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("검사 요소 누락");
  return value;
}
const input = (name: string) =>
  required(host.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`));
const select = (name: string) =>
  required(
    host.querySelector<HTMLSelectElement>(`select[aria-label="${name}"]`),
  );
const button = (text: string) =>
  required(
    [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === text,
    ),
  );
const issue = {
  ...emptyIssue("AA-1"),
  project: "AA",
  issueTypeId: "1",
  hierarchyLevel: 1,
  summary: "10월 11월 배포",
};
const draft: IssueDraft = {
  project: "AA",
  type: "2",
  parent: "AA-1",
  fields: {
    summary: "배포 오류 수정",
    description: textDocument(
      "슬랙 https://example.slack.com/archives/A/p1",
    ) as unknown as JsonValue,
    customfield_88: [{ accountId: "me", displayName: "나" }],
  },
};
const api = createApi(async (path, init) => {
  const url = new URL(String(path), location.origin);
  if (url.pathname === "/api/create-types")
    return Response.json([
      { id: "1", name: "에픽", hierarchyLevel: 1, project: "AA" },
      { id: "2", name: "작업", hierarchyLevel: 0, project: "AA" },
      { id: "3", name: "서브태스크", hierarchyLevel: -1, project: "AA" },
    ]);
  if (url.pathname === "/api/create-metadata")
    return Response.json({
      project: url.searchParams.get("project"),
      type: url.searchParams.get("type"),
      level: url.searchParams.get("type") === "3" ? -1 : 0,
      fields: [
        {
          id: "summary",
          name: "제목",
          type: "string",
          items: "",
          required: true,
          allowed: [],
        },
        {
          id: "description",
          name: "설명",
          type: "string",
          items: "",
          required: false,
          allowed: [],
        },
        {
          id: "priority",
          name: "우선순위",
          type: "priority",
          items: "",
          required: false,
          allowed: [{ id: "1", name: "보통" }],
          defaultValue: { id: "1" },
        },
        {
          id: "duedate",
          name: "마감일",
          type: "date",
          items: "",
          required: false,
          allowed: [],
        },
        {
          id: "assignee",
          name: "담당자",
          type: "user",
          items: "",
          required: false,
          allowed: [],
        },
        {
          id: "customfield_88",
          name: "디자인",
          type: "array",
          items: "user",
          required: false,
          allowed: [],
        },
      ],
    });
  if (url.pathname === "/api/create-parents")
    return Response.json({ issues: [issue], nextPageToken: null });
  if (url.pathname === "/api/create-users")
    return Response.json([{ id: "me", name: "나", avatar: "" }]);
  if (url.pathname === "/api/assistant/status")
    return Response.json({
      ready: true,
      error: "",
      models: [{ id: "codex-test", name: "Codex 검사 모델", isDefault: true }],
      providers: [{ id: "codex", ready: true, error: "" }],
    });
  if (url.pathname === "/api/assistant/run") {
    promptSent = JSON.parse(String(init?.body)).prompt;
    return Response.json({
      answer: "채웠습니다.",
      conversationId: "draft",
      proposals: [],
      creations: [draft],
    });
  }
  if (url.pathname === "/api/create-issue") {
    writes++;
    return failSave
      ? Response.json({ error: "필수값을 확인하세요." }, { status: 400 })
      : Response.json({ key: "AA-11" });
  }
  throw new Error(`예상하지 못한 API ${url.pathname}`);
});
const creator = createIssueDialog({
  host,
  api,
  projects: () => [{ key: "AA", name: "클리포", avatar: "" }],
  site: "fixture.atlassian.net",
  me: { id: "me", name: "나", avatar: "" },
  created: async (key) => {
    created = key;
  },
  notice: () => {},
  voice: (callbacks) => {
    voiceCallbacks = callbacks;
    return {
      start() {
        callbacks.state(true, "녹음");
        callbacks.transcript("10월 11월 배포 오류를 수정하는 작업");
        callbacks.state(false, "");
      },
      stop() {},
      destroy() {},
    };
  },
});
async function check(name: string, action: () => Promise<void>) {
  try {
    await action();
    results?.append(element("li", "", `통과: ${name}`));
  } catch (error) {
    failures++;
    results?.append(
      element(
        "li",
        "error",
        `${name}: ${error instanceof Error ? error.message : error}`,
      ),
    );
  }
}
await check(
  "명령 생성은 프로젝트 선택 후 필드를 불러오고 상위를 검색할 수 있다",
  async () => {
    await creator.open();
    assert(!button("생성").disabled === false, "프로젝트 선택 전 저장 금지");
    change(select("프로젝트"), "AA");
    await wait(
      () =>
        !!host.querySelector('input[aria-label="제목"]') &&
        !button("생성").disabled,
    );
    assert(!select("유형").disabled, "유형 선택 가능");
    assert(select("상위 이슈").options.length === 2, "상위 후보 표시");
    change(select("상위 이슈"), "AA-1");
  },
);
await check(
  "상위 검색은 생성하지 않고 프로젝트 변경도 제목·설명을 보존한다",
  async () => {
    input("제목").value = "보존할 제목";
    const description = host.querySelector<HTMLElement>('[aria-label="설명"]');
    if (!description) throw new Error("설명 누락");
    description.textContent = "보존할 설명";
    host
      .querySelector<HTMLButtonElement>('button[aria-label="상위 이슈"]')
      ?.click();
    await wait(() => !!host.querySelector(".select-search input"));
    const search = host.querySelector<HTMLFormElement>(".select-search");
    search?.requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert(writes === 0, "상위 검색의 submit이 이슈를 생성하면 안 됨");
    host
      .querySelector<HTMLButtonElement>('button[aria-label="상위 이슈"]')
      ?.click();
    change(select("프로젝트"), "AA");
    await wait(() => !button("생성").disabled);
    assert(input("제목").value === "보존할 제목", "프로젝트 변경 시 제목 유지");
    assert(
      host
        .querySelector('[aria-label="설명"]')
        ?.textContent?.includes("보존할 설명"),
      "프로젝트 변경 시 설명 유지",
    );
  },
);
await check(
  "날짜시간 기본값은 사라지지 않고 시간대를 포함해 저장한다",
  async () => {
    const dateField = creationField(
      {
        id: "customfield_99",
        name: "배포 시간",
        type: "datetime",
        items: "",
        required: true,
        allowed: [],
      },
      "2026-10-27T10:30:00.000+0900",
      {
        api,
        project: "AA",
        type: "2",
        site: "fixture.atlassian.net",
        me: { id: "me", name: "나", avatar: "" },
      },
    );
    const value = dateField.read();
    assert(
      typeof value === "string" &&
        Date.parse(value) === Date.parse("2026-10-27T10:30:00.000+0900"),
      "시간대 보존",
    );
    dateField.destroy();
  },
);
await check(
  "실패 시 제목을 유지하고 명시적 생성 성공 후 상세 콜백을 호출한다",
  async () => {
    input("제목").value = "수동 작성";
    failSave = true;
    button("생성").click();
    await wait(() => !button("생성").disabled);
    assert(input("제목").value === "수동 작성", "입력 보존");
    failSave = false;
    button("생성").click();
    await wait(() => created === "AA-11");
    assert(writes === 2, "명시적 저장만 두 번");
  },
);
await check(
  "에픽 진입은 실제 다음 계층만 선택하고 부모 없는 태스크도 생성 창을 연다",
  async () => {
    await creator.open({ parent: issue });
    assert(
      select("유형").options.length === 1 && select("유형").value === "2",
      "다음 계층",
    );
    assert(select("상위 이슈").value === "AA-1", "부모 자동 지정");
    button("취소").click();
    await creator.open({
      parent: { ...issue, key: "AA-2", issueTypeId: "2", hierarchyLevel: 0 },
    });
    assert(select("유형").value === "3", "서브태스크 유형");
    button("취소").click();
  },
);
await check(
  "마이크 입력과 AI 요청은 폼을 채우며 실제 저장을 하지 않는다",
  async () => {
    await creator.open({ project: "AA" });
    await wait(() => !!voiceCallbacks && !button("AI로 채우기").disabled);
    const mic = required(
      host.querySelector<HTMLButtonElement>(
        '[aria-label="생성 요청 음성 입력"]',
      ),
    );
    mic.click();
    const prompt = required(
      host.querySelector<HTMLTextAreaElement>('[aria-label="AI 생성 요청"]'),
    );
    assert(prompt.value.includes("10월 11월"), "음성 전사");
    button("AI로 채우기").click();
    await wait(
      () =>
        input("제목")?.value === "배포 오류 수정" && !button("생성").disabled,
    );
    assert(promptSent.includes("10월 11월"), "프롬프트 전달");
    assert(select("상위 이슈").value === "AA-1", "AI 상위 연결");
    assert(
      host
        .querySelector('[aria-label="설명"]')
        ?.textContent?.includes("slack.com"),
      "링크 보존",
    );
    assert(writes === 2, "AI 저장 금지");
  },
);
await check("명령 팔레트의 이슈 생성은 공통 생성 창으로 연결한다", async () => {
  button("취소").click();
  let opened = false;
  const palette = createCommandPalette({
    host,
    api,
    site: "fixture.atlassian.net",
    context: () => ({ projects: ["AA"], issue: "", keys: [] }),
    recent: () => [],
    localIssues: () => [],
    order: () => [],
    select() {},
    changed: async () => {},
    canMutate: () => true,
    notice() {},
    create: () => {
      opened = true;
      void creator.open();
    },
  });
  palette.openCommands();
  button("이슈 생성").click();
  await wait(() => opened);
  assert(
    host.querySelector("dialog[open]")?.getAttribute("aria-label") ===
      "이슈 생성",
    "생성 창 연결",
  );
  palette.destroy();
  await creator.open({ draft });
});
document.body.dataset.failures = String(failures);
document.body.dataset.done = "true";
