import { createAssistantConnection } from "../src/client/assistant-connection.ts";
import type {
  InstallationManagement,
  RepairRequest,
} from "../src/domain/installation-management.ts";
import { installationStatus } from "../src/ui/installation-status.ts";
import { startTooltips, TOOLTIP_DELAY_MS } from "../src/ui/tooltip.ts";
import "../src/client/styles.css";

const host = document.querySelector<HTMLElement>("#app");
const results = document.querySelector<HTMLOListElement>("#results");
if (!host || !results) throw Error("검사 영역 누락");
function assert(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
let phase: InstallationManagement["job"] = null,
  calls: RepairRequest[] = [],
  fail = false,
  consent = false,
  domainReady = false;
let assistantChecks = 0;
const notices: string[] = [];
const connection = createAssistantConnection(async () => {
  assistantChecks++;
  return {
    ready: false,
    models: [],
    error: "",
    availability: "unavailable",
    providers: [
      { id: "codex", ready: false, error: "", reason: "login_required" },
      { id: "claude", ready: false, error: "", reason: "missing_cli" },
    ],
  };
});
const ui = installationStatus({
  api: {
    installationStatus: async () => {
      if (fail) throw Error("private secret");
      return {
        supported: true,
        url: domainReady ? "https://fast-jira.local" : "http://localhost:4173",
        domain: domainReady,
        platforms: ["codex"],
        job: phase,
      };
    },
    repairInstallation: async (request) => {
      calls.push(request);
      phase = {
        id: "11111111-1111-1111-1111-111111111111",
        target: request.target,
        phase: "pending",
        startedAt: Date.now(),
      };
      return phase;
    },
  },
  assistant: connection,
  notice: (message) => notices.push(message),
  confirmDomain: () => consent,
  active: () => false,
});
host.append(ui.element);
startTooltips();
try {
  await ui.refresh();
  assert(host.textContent?.includes("로그인 버튼을 눌러"), "로그인 상태 누락");
  assert(
    host.textContent?.includes("실행 파일을 찾지 못했어요"),
    "설치 누락 상태 누락",
  );
  assert(
    host.querySelector(".installation-row:first-child .installation-state")
      ?.textContent === "실행 중",
    "앱 상태 배지 누락",
  );
  assert(
    host.querySelector('.installation-row [aria-label="Codex 도구 연결"]'),
    "도구 재등록 동작 구분 누락",
  );
  const help = host.querySelector<HTMLButtonElement>(
    '[aria-label="간편 주소 안내"]',
  );
  assert(help, "간편 주소 안내 버튼 누락");
  assert(
    help.title.includes("fast-jira.local") &&
      help.title.includes("시스템 승인"),
    "공통 툴팁 안내 누락",
  );
  assert(!help.hasAttribute("aria-expanded"), "본문 펼침 방식이 남음");
  help.click();
  await new Promise((resolve) => setTimeout(resolve, TOOLTIP_DELAY_MS + 30));
  assert(
    document
      .querySelector(".ui-tooltip:popover-open")
      ?.textContent?.includes("fast-jira.local"),
    "클릭 툴팁 열기 실패",
  );
  help.click();
  assert(
    !document.querySelector(".ui-tooltip:popover-open"),
    "클릭 툴팁 닫기 실패",
  );
  assert(
    host.querySelector(".installation-row:last-child .installation-state")
      ?.textContent === location.host &&
      !host.textContent?.includes("현재 사용 중"),
    "주소 종류와 이용 상태가 섞임",
  );
  assert(
    !host.querySelector(".installation-recovery"),
    "별도 연결 문제 해결 영역이 남음",
  );
  const login = host.querySelector<HTMLButtonElement>(
    '[aria-label="Codex 로그인"]',
  );
  assert(login && !login.disabled, "공식 로그인 동작 누락");
  login.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(
    calls.length === 1 && calls[0]?.target === "codex-login",
    "다른 명령 실행",
  );
  assert(
    host.querySelectorAll("button:disabled").length >= 3,
    "작업 중 중복 실행 허용",
  );
  const last = calls.at(-1);
  assert(last, "작업 상태 누락");
  phase = {
    id: "11111111-1111-1111-1111-111111111111",
    target: last.target,
    startedAt: Date.now(),
    phase: "complete",
  };
  await ui.refresh();
  assert(notices.includes("연결을 마쳤어요."), "완료 토스트 누락");
  domainReady = true;
  phase = null;
  await ui.refresh();
  assert(
    !host.querySelector('[aria-label="간편 주소 설정"]'),
    "정상 도메인 재설정 버튼 노출",
  );
  assert(
    host.querySelector('a[href="https://fast-jira.local"]'),
    "검증된 도메인 열기 누락",
  );
  domainReady = false;
  await ui.refresh();
  const domain = host.querySelector<HTMLButtonElement>(
    '[aria-label="간편 주소 설정"]',
  );
  assert(domain, "도메인 복구 누락");
  const countBeforeDomain = calls.length;
  domain.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(calls.length === countBeforeDomain, "동의 취소 후 도메인 설정 실행");
  consent = true;
  domain.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(
    calls.at(-1)?.target === "domain" && calls.at(-1)?.consent === true,
    "명시적 도메인 동의 누락",
  );
  fail = true;
  const beforeFailure = assistantChecks;
  await ui.refresh();
  assert(
    assistantChecks === beforeFailure + 1,
    "앱 관리 실패 때문에 AI 상태 조회를 건너뜀",
  );
  assert(
    host.querySelectorAll('.installation-state[data-state="login_required"]')
      .length === 1,
    "AI별 상태 배지 누락",
  );
  assert(
    host.textContent?.includes("앱과 접속 주소의 상태를 확인하지 못했어요"),
    "어느 상태 조회가 실패했는지 누락",
  );
  assert(
    host.querySelector(".installation-row:first-child .installation-state")
      ?.textContent === "확인 못함",
    "조회 실패 뒤 이전 앱 상태 유지",
  );
  assert(!host.textContent?.includes("private secret"), "내부 오류 원문 노출");
  results.textContent = "전체 검사 통과 · 실제 설치·로그인·Jira 변경 없음";
  results.dataset.result = "passed";
} catch (error) {
  results.textContent = String(error);
  results.dataset.result = "failed";
}

if (new URLSearchParams(location.search).has("preview")) {
  fail = false;
  phase = null;
  await ui.refresh();
  const { settingsContent } = await import("../src/ui/settings.ts");
  const { readPreferences } = await import("../src/client/preferences.ts");
  const { showModal } = await import("../src/ui/modal.ts");
  const modal = document.createElement("dialog");
  modal.className = "settings-modal";
  const params = new URLSearchParams(location.search);
  if (params.has("narrow"))
    modal.style.width = "min(360px, calc(100vw - 24px))";
  if (params.get("theme") === "dark")
    document.documentElement.dataset.theme = "dark";
  host.replaceChildren(modal);
  const content = settingsContent(
    readPreferences({ getItem: () => null, setItem: () => {} }),
    { name: "모의 계정", site: "fixture.atlassian.net" },
    () => {},
    undefined,
    undefined,
    ui.element,
    "관리",
  );
  showModal(modal, {
    title: "설정",
    headerContent: content.navigation,
    content: content.element,
    actions: [],
  });
}
