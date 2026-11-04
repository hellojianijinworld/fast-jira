import type { Api } from "../client/api.ts";
import type { createAssistantConnection } from "../client/assistant-connection.ts";
import {
  type InstallationManagement,
  type RepairRequest,
  type RepairTarget,
  repairing,
} from "../domain/installation-management.ts";
import { actionButton, element, externalLink } from "./dom.ts";
import { providerGuidance } from "./installation-guidance.ts";

/** 일반 화면에서 숨긴 AI도 설정에서 다시 연결할 수 있게 한다. */
export function installationStatus(options: {
  api: Pick<Api, "installationStatus" | "repairInstallation">;
  assistant: ReturnType<typeof createAssistantConnection>;
  active?: () => boolean;
  canManage?: () => boolean;
  confirmDomain?: () => boolean;
  notice?: (message: string) => void;
}) {
  const root = element("section", "installation-status"),
    heading = element("div", "installation-heading"),
    check = actionButton("상태 새로고침", "refresh-cw", {
      size: "sm",
      variant: "outline",
    }),
    summary = element("p", "installation-summary"),
    description = element(
      "p",
      "setting-help",
      "Jira 연결과 별도로 AI 대화와 간편 주소의 상태를 확인해요.",
    ),
    body = element("div", "installation-rows"),
    message = element("p", "setting-help");
  root.setAttribute("aria-label", "앱과 AI 연결");
  check.setAttribute("aria-label", "앱·AI 연결 상태 새로고침");
  message.setAttribute("role", "status");
  heading.append(element("h3", "", "AI·간편 주소 연결"), check);
  summary.setAttribute("role", "status");
  root.append(heading, description, summary, body, message);
  let state: InstallationManagement | undefined,
    checking = false,
    submitting: RepairTarget | undefined,
    error = "",
    alive = true,
    timer: ReturnType<typeof setTimeout> | undefined,
    pending: Promise<void> | undefined;
  const active =
    options.active ?? (() => !document.hidden && document.hasFocus());
  const busy = () => Boolean(submitting || repairing(state?.job));
  function render() {
    check.disabled = checking || !!submitting;
    check.setAttribute("aria-busy", String(checking));
    const checkLabel = check.querySelector("span");
    if (checkLabel)
      checkLabel.textContent = checking ? "확인 중…" : "상태 새로고침";
    body.replaceChildren();
    const row = (title: string, text: string, label = "", status = "") => {
      const node = element("div", "installation-row"),
        copy = element("div", "installation-copy"),
        actions = element("div", "installation-actions");
      const name = element("div", "installation-row-title");
      name.append(element("strong", "", title));
      if (label) {
        const badge = element("span", "installation-state", label);
        badge.dataset.state = status;
        name.append(badge);
      }
      copy.append(name, element("small", "setting-help", text));
      node.append(copy, actions);
      body.append(node);
      return actions;
    };
    const action = (
      parent: HTMLElement,
      label: string,
      target: RepairTarget,
    ) => {
      const button = actionButton(
        label,
        target.endsWith("-login") ? "external-link" : "refresh-cw",
        { size: "sm", variant: "outline" },
      );
      button.setAttribute("aria-label", label);
      button.disabled = !state?.supported || busy();
      button.setAttribute(
        "aria-busy",
        String(
          submitting === target ||
            (repairing(state?.job) && state?.job?.target === target),
        ),
      );
      button.addEventListener("click", () => void repair(target));
      parent.append(button);
    };
    row(
      "Fast Jira 앱",
      state?.supported
        ? "이 컴퓨터에서 실행 중이에요."
        : state
          ? "소스 실행이라 이 화면의 자동 복구를 지원하지 않아요. AI 연결은 실행 환경에서 직접 설정해 주세요."
          : "앱 관리 정보를 받지 못했어요. 아래 AI 연결 상태와는 별도로 확인해요.",
    );
    const snapshot = options.assistant.snapshot;
    const summaries: string[] = [];
    for (const id of ["codex", "claude"] as const) {
      const provider = snapshot.status?.providers?.find(
          (item) => item.id === id,
        ),
        title = id === "codex" ? "Codex" : "Claude";
      const guidance = providerGuidance(provider, snapshot);
      summaries.push(`${title} ${guidance.label}`);
      const actions = row(
        title,
        guidance.detail,
        guidance.label,
        guidance.state,
      );
      if (provider?.reason === "login_required")
        action(actions, `${title} 로그인`, `${id}-login`);
      if (state?.platforms.includes(id))
        action(actions, `${title} 플러그인 연결 확인`, id);
    }
    summary.textContent = summaries.join(" · ");
    const domain = row(
      "간편 주소",
      !state
        ? "간편 주소의 연결 상태를 아직 확인하지 못했어요."
        : state.domain
          ? "간편 주소를 사용할 수 있어요."
          : "localhost로 사용할 수 있어요. 원하면 간편 주소를 연결해 주세요.",
    );
    if (state?.domain)
      domain.append(externalLink("https://fast-jira.local", "간편 주소 열기"));
    else if (state) action(domain, "간편 주소 연결", "domain");
    const phase = state?.job?.phase;
    message.textContent =
      error ||
      (busy()
        ? state?.job?.target.endsWith("-login")
          ? "열린 브라우저에서 로그인을 마쳐 주세요. 이 화면은 그대로 두셔도 돼요."
          : "연결 작업 중이에요. 시스템 승인창이 뜨면 용도를 확인해 주세요."
        : phase === "complete"
          ? "연결 작업을 마쳤어요. 현재 연결 상태를 확인해 주세요."
          : phase === "failed" || phase === "interrupted"
            ? "연결 작업을 마치지 못했어요. 다시 시도하거나 사용 중인 AI에게 Fast Jira 연결을 요청해 주세요."
            : "");
    message.hidden = !message.textContent;
    message.classList.toggle(
      "error",
      Boolean(error) || phase === "failed" || phase === "interrupted",
    );
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const job = state?.job;
    if (
      alive &&
      active() &&
      job &&
      repairing(job) &&
      Date.now() - job.startedAt < 900000
    )
      timer = setTimeout(() => {
        void refresh(false);
      }, 2000);
  }
  function refresh(checkAssistant = true): Promise<void> {
    if (!alive) return Promise.resolve();
    if (pending) return pending;
    checking = true;
    render();
    pending = (async () => {
      try {
        const wasRunning = repairing(state?.job);
        const [management] = await Promise.allSettled([
          Promise.resolve().then(() => options.api.installationStatus()),
          checkAssistant ? options.assistant.refresh(true) : Promise.resolve(),
        ]);
        if (!alive) return;
        if (management.status === "fulfilled") {
          state = management.value;
          error = "";
          if (!checkAssistant && wasRunning && !repairing(state.job))
            await options.assistant.refresh(true);
        } else {
          error =
            "앱·간편 주소의 관리 정보를 불러오지 못했어요. AI 연결 결과는 위에서 따로 확인할 수 있어요. 계속 같으면 사용 중인 AI에게 Fast Jira 연결 점검을 요청해 주세요.";
        }
      } catch {
        if (alive)
          error =
            "상태 확인을 마치지 못했어요. 사용 중인 AI에게 Fast Jira 연결 점검을 요청해 주세요.";
      } finally {
        checking = false;
        pending = undefined;
        if (alive) {
          render();
          schedule();
        }
      }
    })();
    return pending;
  }
  async function repair(target: RepairTarget) {
    if (busy() || !state?.supported) return;
    if (options.canManage?.() === false) {
      options.notice?.("진행 중인 작업을 마친 뒤 다시 시도해 주세요.");
      return;
    }
    if (
      target === "domain" &&
      !(
        options.confirmDomain ??
        (() =>
          window.confirm(
            "fast-jira.local 주소를 연결하려면 앱을 잠시 다시 시작하고 시스템 설정을 변경해요. 작성 중인 내용을 저장했나요? 계속하려면 확인을 눌러 주세요.",
          ))
      )()
    )
      return;
    submitting = target;
    error = "";
    render();
    const request: RepairRequest = {
      target,
      ...(target === "domain" ? { consent: true } : {}),
    };
    try {
      const job = await options.api.repairInstallation(request);
      if (alive && state) state = { ...state, job };
    } catch {
      if (alive)
        error = "연결 작업을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.";
    } finally {
      submitting = undefined;
      if (alive) {
        render();
        schedule();
      }
    }
  }
  const resume = () => {
    if (active() && repairing(state?.job)) void refresh(false);
    else schedule();
  };
  const unsubscribe = options.assistant.subscribe(() => {
    if (alive) render();
  });
  check.addEventListener("click", () => void refresh());
  window.addEventListener("focus", resume);
  document.addEventListener("visibilitychange", resume);
  render();
  return {
    element: root,
    refresh,
    destroy() {
      alive = false;
      if (timer) clearTimeout(timer);
      unsubscribe();
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    },
  };
}
