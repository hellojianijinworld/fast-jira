import type { Api } from "../client/api.ts";
import { createAppUpdateController } from "../client/app-update-controller.ts";
import {
  actionButton,
  buttonGroup,
  element,
  externalLink,
  iconButton,
} from "./dom.ts";
import { createFaviconBadge } from "./favicon.ts";
import { relativeTime } from "./meta.ts";

export interface AppUpdateUi {
  element: HTMLElement;
  trigger: HTMLButtonElement;
}

export function appUpdate(
  api: Pick<Api, "appUpdateStatus" | "checkAppUpdate" | "installAppUpdate">,
  options: { active?: () => boolean; reload?: () => void } = {},
) {
  const badge = createFaviconBadge();
  const trigger = iconButton("업데이트 확인", "circle-arrow-up");
  trigger.classList.add("app-update-trigger");
  trigger.hidden = true;
  const root = element("section", "app-update-content");
  root.setAttribute("aria-label", "Fast Jira 업데이트");
  root.dataset.size = "sm";
  const title = element("h3"),
    versions = element("div", "app-update-versions");
  const current = element("span", "installation-state"),
    target = element("strong", "installation-state");
  current.dataset.state = "ready";
  versions.append(title, current, target);
  const message = element("p", "app-update-message");
  message.setAttribute("role", "status");
  const checked = element("small", "app-update-checked");
  const notes = element("pre", "app-update-notes");
  const releaseLink = externalLink(
    "https://github.com/hellojianijinworld/fast-jira/releases",
    "GitHub에서 변경 내용 보기 ↗",
  );
  const warning = element(
    "p",
    "app-update-warning",
    "작성 중인 내용을 저장한 뒤 진행해 주세요. 앱과 설치된 Fast Jira 플러그인을 함께 업데이트해요.",
  );
  const support = element("small", "app-update-support");
  const check = actionButton("직접 확인", "search", {
    size: "sm",
    variant: "outline",
  });
  check.setAttribute("aria-label", "직접 업데이트 확인");
  const install = actionButton("업데이트하고 다시 시작", "check", {
    size: "sm",
    variant: "primary",
  });
  install.setAttribute("aria-label", "업데이트하고 다시 시작");
  const actions = buttonGroup(element("div", "app-update-actions"), {
    size: "sm",
  });
  actions.append(check, install);
  const heading = element("div", "app-update-heading"),
    status = element("div", "app-update-status");
  heading.append(versions, actions);
  status.append(message, checked);
  root.append(heading, status, warning, notes, releaseLink, support);
  function render() {
    const state = controller.status;
    const running = controller.running;
    const available = Boolean(
      state?.release && state.release.version !== state.currentVersion,
    );
    badge(available);
    trigger.hidden = !available;
    trigger.title = available
      ? `새 버전 ${state?.release?.version} 업데이트`
      : "업데이트 확인";
    check.disabled = controller.checking || running;
    install.disabled =
      controller.checking ||
      running ||
      !state?.supported ||
      state.phase !== "available" ||
      !state.release;
    title.textContent = "버전";
    current.textContent = state?.currentVersion ?? "확인 중";
    current.setAttribute(
      "aria-label",
      `현재 버전 ${state?.currentVersion ?? "확인 중"}`,
    );
    install.hidden = !available && !running;
    target.hidden = !state?.release;
    target.textContent = state?.release ? `→ ${state.release.version}` : "";
    message.textContent =
      state?.phase === "current" && !controller.disconnected
        ? "최신 버전이에요."
        : controller.disconnected
          ? (state?.message ?? "")
          : (state?.job?.phase !== "complete" && state?.job?.message) ||
            state?.message ||
            "업데이트 상태를 불러오고 있어요…";
    message.classList.toggle(
      "error",
      controller.disconnected ||
        state?.phase === "error" ||
        state?.job?.phase === "failed",
    );
    checked.replaceChildren(document.createTextNode("마지막 확인: "));
    if (state?.checkedAt)
      checked.append(relativeTime(new Date(state.checkedAt).toISOString()));
    else checked.append(document.createTextNode("아직 확인하지 않음"));
    notes.hidden = !state?.release?.notes;
    notes.textContent = state?.release?.notes ?? "";
    releaseLink.hidden = !state?.release;
    if (state?.release) releaseLink.href = state.release.url;
    warning.hidden = !state?.release || running || !state.supported;
    support.hidden = state?.supported ?? true;
    support.textContent =
      "소스 실행에서는 설치할 수 없어요. 설치된 서비스 또는 Managing 가이드를 이용해 주세요.";
  }
  const controller = createAppUpdateController({
    api,
    active: options.active ?? (() => !document.hidden && document.hasFocus()),
    changed: render,
    reload: options.reload ?? (() => location.reload()),
  });
  check.addEventListener("click", () => void controller.check(true));
  install.addEventListener("click", () => void controller.install());
  const resume = () => controller.resume();
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("focus", resume);
  window.addEventListener("blur", resume);
  render();
  return {
    element: root,
    trigger,
    destroy() {
      controller.destroy();
      badge(false);
      trigger.remove();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("blur", resume);
    },
  };
}
