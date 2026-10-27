import appHtml from "../index.html?raw";
import { createApi } from "../src/client/api.ts";
import { readPreferences } from "../src/client/preferences.ts";
import type { AppUpdateStatus } from "../src/domain/app-update.ts";
import { appUpdate } from "../src/ui/app-update.ts";
import { element } from "../src/ui/dom.ts";
import { showModal } from "../src/ui/modal.ts";
import { settingsContent } from "../src/ui/settings.ts";
import "../src/client/styles.css";

const fixture = document.querySelector("#fixture"),
  results = document.querySelector("#results");
if (!fixture || !results) throw new Error("검사 화면 없음");
const favicon = new DOMParser()
  .parseFromString(appHtml, "text/html")
  .querySelector<HTMLLinkElement>('link[rel="icon"]');
if (!favicon) throw new Error("기본 파비콘 없음");
document.head.append(favicon);
const originalFavicon = favicon.getAttribute("href");
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
function assert(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function until(ready: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (ready()) return;
    await wait(20);
  }
  throw new Error("화면 갱신 시간 초과");
}
let failures = 0;
async function check(name: string, run: () => Promise<void>) {
  try {
    await run();
    results?.append(element("li", "", `통과 · ${name}`));
  } catch (error) {
    failures++;
    results?.append(
      element(
        "li",
        "error",
        `실패 · ${name}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
}
function mount(feature: ReturnType<typeof appUpdate>) {
  const modal = element("dialog", "settings-modal");
  const settings = settingsContent(
    readPreferences({ getItem: () => null, setItem: () => {} }),
    "연결된 계정",
    () => {},
    undefined,
    undefined,
    feature.element,
  );
  fixture?.append(modal);
  showModal(modal, { title: "설정", content: settings.element });
  [...modal.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find((button) => button.textContent === "관리")
    ?.click();
  return modal;
}
const release = {
  version: "0.1.1",
  commit: "a".repeat(40),
  notes: "목록 탐색과 연결 화면을 개선했어요.\n<img src=x onerror=alert(1)>",
  url: "https://github.com/hellojianijinworld/fast-jira/releases/tag/v0.1.1",
};
const base: AppUpdateStatus = {
  currentVersion: "0.1.0",
  supported: true,
  phase: "idle",
  checkedAt: null,
  release: null,
  message: "아직 확인하지 않았어요.",
  job: null,
};

await check(
  "직접 확인만으로 설치하지 않고 선택한 새 버전 확인 후에만 재시작한다",
  async () => {
    let installs = 0,
      reloads = 0,
      running = false;
    const forces: boolean[] = [];
    const feature = appUpdate(
      createApi(async (input, init) => {
        const path = String(input);
        if (path === "/api/app-update/status")
          return Response.json(
            running
              ? {
                  ...base,
                  currentVersion: "0.1.1",
                  job: {
                    id: "browser-job",
                    version: "0.1.1",
                    phase: "complete",
                    startedAt: Date.now(),
                    message: "완료",
                  },
                }
              : base,
          );
        if (path === "/api/app-update/check") {
          assert(
            init?.method === "POST" &&
              typeof JSON.parse(String(init.body)).force === "boolean",
            "수동 확인이 강제 확인으로 전달되지 않음",
          );
          forces.push(JSON.parse(String(init?.body)).force);
          return Response.json({
            ...base,
            phase: "available",
            release,
            checkedAt: Date.now(),
            message: "새 버전을 설치할 수 있어요.",
          });
        }
        assert(path === "/api/app-update/install", "예상하지 않은 요청");
        assert(
          JSON.parse(String(init?.body)).commit === release.commit,
          "선택한 코드 기준 누락",
        );
        installs++;
        running = true;
        return Response.json({
          ...base,
          release,
          phase: "available",
          job: {
            id: "browser-job",
            version: "0.1.1",
            phase: "preparing",
            startedAt: Date.now(),
            message: "준비 중",
          },
        });
      }),
      {
        active: () => true,
        reload: () => {
          reloads++;
        },
      },
    );
    const modal = mount(feature);
    try {
      await until(
        () =>
          feature.element.textContent?.includes("새 버전이 있어요") === true,
      );
      assert(
        favicon.getAttribute("href") !== originalFavicon,
        "새 버전 파비콘 점 표시 누락",
      );
      const markedSvg = decodeURIComponent(
        favicon.getAttribute("href")?.split(",")[1] ?? "",
      );
      assert(
        markedSvg.includes("🦓") &&
          markedSvg.includes('data-update-badge="true"') &&
          markedSvg.includes('fill="#f97316"'),
        "얼룩말 또는 업데이트 점 누락",
      );
      const check = feature.element.querySelector<HTMLButtonElement>(
        '[aria-label="직접 업데이트 확인"]',
      );
      assert(check !== null, "직접 확인 버튼 누락");
      check.click();
      await until(() => !check.disabled);
      assert(forces.includes(true), "직접 확인이 강제 확인으로 전달되지 않음");
      assert(
        installs === 0 &&
          feature.element.textContent?.includes("새 버전이 있어요") === true,
        "업데이트 확인이 설치를 시작하거나 새 버전 표시 누락",
      );
      assert(
        feature.element.querySelector("img") === null &&
          feature.element.textContent?.includes("<img") === true,
        "릴리스 내용을 HTML로 실행함",
      );
      assert(
        feature.element.querySelector(".tool-button") === null &&
          !feature.element.textContent?.includes("5분마다") &&
          !feature.element.textContent?.includes("별도로 진행"),
        "이전 업데이트 버튼이나 안내가 남음",
      );
      assert(
        Boolean(
          feature.element
            .closest('[role="tabpanel"]')
            ?.getAttribute("aria-labelledby"),
        ),
        "설정 내부 배치 누락",
      );
      const install = feature.element.querySelector<HTMLButtonElement>(
        '[aria-label="업데이트하고 다시 시작"]',
      );
      assert(install !== null && !install.disabled, "설치 버튼 누락");
      install.click();
      await until(() => Number(installs) === 1);
      assert(
        Number(installs) === 1 && reloads === 0,
        "설치 전송·완료 대기 누락",
      );
      assert(install.disabled, "중복 설치 가능");
      await wait(2100);
      await until(() => Number(reloads) === 1);
      assert(Number(reloads) === 1, "새 버전 확인 후 새로고침 누락");
      assert(
        favicon.getAttribute("href") === originalFavicon,
        "업데이트 완료 후 파비콘 복원 누락",
      );
    } finally {
      feature.destroy();
      modal.close();
      modal.remove();
    }
  },
);

await check(
  "릴리스 없음과 소스 실행 환경을 최신·설치 가능으로 잘못 표시하지 않는다",
  async () => {
    const feature = appUpdate(
      createApi(async (input) =>
        Response.json(
          String(input).endsWith("/status")
            ? { ...base, supported: false }
            : {
                ...base,
                supported: false,
                phase: "unavailable",
                message: "아직 공개된 릴리스가 없어요.",
                checkedAt: Date.now(),
              },
        ),
      ),
      { active: () => false, reload: () => {} },
    );
    const modal = mount(feature);
    try {
      await wait();
      feature.element
        .querySelector<HTMLButtonElement>('[aria-label="직접 업데이트 확인"]')
        ?.click();
      await until(
        () =>
          feature.element.textContent?.includes("아직 공개된 릴리스") === true,
      );
      assert(
        favicon.getAttribute("href") === originalFavicon,
        "릴리스가 없는데 파비콘 점 표시",
      );
      assert(
        feature.element.textContent?.includes("아직 공개된 릴리스") === true,
        "미배포 안내 누락",
      );
      assert(
        feature.element.querySelector<HTMLButtonElement>(
          '[aria-label="업데이트하고 다시 시작"]',
        )?.disabled === true,
        "소스 실행에서 업데이트 허용",
      );
    } finally {
      feature.destroy();
      modal.close();
      modal.remove();
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
      : "전체 업데이트 검사 통과 · 실제 릴리스 설치 없음",
  ),
);

// 실제 배포를 변경하지 않는 디자인 확인용 모의 상태.
const demo = appUpdate(
  createApi(async () =>
    Response.json({
      ...base,
      phase: "available",
      checkedAt: Date.now(),
      release: {
        ...release,
        notes:
          "• 목록 탐색과 필터를 더 편하게 개선했어요.\n• 연결 안내를 한 화면으로 정리했어요.\n• 작은 화면의 간격을 다듬었어요.",
      },
      message: "새 버전을 설치할 수 있어요.",
    }),
  ),
  { active: () => false, reload: () => {} },
);
mount(demo);
