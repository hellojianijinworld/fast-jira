import type { Api } from "../client/api.ts";
import type { createAssistantConnection } from "../client/assistant-connection.ts";
import {
  type InstallationManagement,
  type RepairRequest,
  type RepairTarget,
  repairing,
} from "../domain/installation-management.ts";
import {
  actionButton,
  buttonGroup,
  element,
  externalLink,
  iconButton,
} from "./dom.ts";
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
    check = actionButton("다시 확인", "refresh-cw", {
      size: "sm",
      variant: "outline",
    }),
    body = element("div", "installation-rows"),
    message = element("p", "setting-help");
  root.setAttribute("aria-label", "앱과 AI 연결");
  check.setAttribute("aria-label", "앱·AI 연결 상태 새로고침");
  message.setAttribute("role", "status");
  heading.append(element("h3", "", "연결 관리"), check);
  root.append(heading, body, message);
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
      checkLabel.textContent = checking ? "확인 중…" : "다시 확인";
    body.replaceChildren();
    const row = (title: string, text: string, label = "", status = "") => {
      const node = element("div", "installation-row"),
        copy = element("div", "installation-copy"),
        actions = buttonGroup(element("div", "installation-actions"), {
          size: "sm",
        });
      const name = element("div", "installation-row-title");
      name.append(element("strong", "", title));
      if (label) {
        const badge = element("span", "installation-state", label);
        badge.dataset.state = status;
        name.append(badge);
      }
      copy.append(name);
      if (text) copy.append(element("small", "setting-help", text));
      node.append(copy, actions);
      body.append(node);
      return actions;
    };
    const action = (
      parent: HTMLElement,
      label: string,
      target: RepairTarget,
      text = label,
    ) => {
      const button = actionButton(
        text,
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
      return button;
    };
    row(
      "Fast Jira 앱",
      state && !state.supported
        ? "개발 환경에서는 이 화면의 연결 복구를 사용할 수 없어요."
        : "이 컴퓨터에서 Fast Jira를 사용하고 있어요.",
      state ? "실행 중" : checking ? "확인 중" : "확인 못함",
      state ? "ready" : checking ? "checking" : "unknown",
    );
    const snapshot = options.assistant.snapshot;
    for (const id of ["codex", "claude"] as const) {
      const provider = snapshot.status?.providers?.find(
          (item) => item.id === id,
        ),
        title = id === "codex" ? "Codex" : "Claude";
      const guidance = providerGuidance(provider, snapshot);
      const actions = row(
        title,
        provider?.ready
          ? "AI 대화에서 작업을 살펴보고 정리할 수 있어요."
          : guidance.detail,
        guidance.label,
        guidance.state,
      );
      if (provider?.reason === "login_required")
        action(actions, `${title} 로그인`, `${id}-login`, "로그인");
      if (state?.platforms.includes(id)) {
        const connect = action(actions, `${title} 도구 연결`, id, "도구 연결");
        connect.title = `${title}에서 Fast Jira 도구가 보이지 않을 때
연결 정보를 다시 등록해요.`;
      }
    }
    const domainUrl = "https://fast-jira.local";
    const usingDomain = location.origin === domainUrl;
    const domain = row(
      "접속 주소",
      usingDomain
        ? "간편 주소로 접속했어요. 다음에도 이 주소로 열면 돼요."
        : state?.domain
          ? "간편 주소가 준비됐어요. 이 주소로 접속해 보세요."
          : state
            ? "포트 번호 없이 접속하고 싶다면 간편 주소를 설정해 보세요."
            : checking
              ? "간편 주소의 설정 정보를 확인하고 있어요."
              : "간편 주소의 설정 정보를 확인하지 못했어요. 다시 확인해 주세요.",
      location.host,
      "unchecked",
    );
    const domainCopy =
      domain.parentElement?.querySelector(".installation-copy");
    const addressHelp = iconButton("간편 주소 안내", "circle-help", {
      size: "sm",
    });
    addressHelp.dataset.tooltipClick = "true";
    addressHelp.title =
      "이 컴퓨터에서 fast-jira.local로 접속할 수 있게 설정해요.\n시스템 승인이 필요할 수 있어요.";
    domainCopy?.querySelector(".installation-row-title")?.append(addressHelp);
    if (state?.domain && !usingDomain) {
      domainCopy?.append(element("code", "installation-address", domainUrl));
      domain.append(externalLink(domainUrl, "간편 주소로 열기"));
    }
    if (state && !state.domain && !usingDomain) {
      action(domain, "간편 주소 설정", "domain");
    }
    const phase = state?.job?.phase;
    message.textContent =
      error ||
      (busy()
        ? state?.job?.target.endsWith("-login")
          ? "열린 브라우저에서 로그인을 마쳐 주세요. 이 화면은 그대로 두셔도 돼요."
          : "연결 작업 중이에요. 시스템 승인창이 뜨면 용도를 확인해 주세요."
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
          if (wasRunning && state.job?.phase === "complete")
            options.notice?.("연결을 마쳤어요.");
          if (!checkAssistant && wasRunning && !repairing(state.job))
            await options.assistant.refresh(true);
        } else {
          state = undefined;
          error =
            "앱과 접속 주소의 상태를 확인하지 못했어요. 다시 확인해도 같으면 사용 중인 AI에게 Fast Jira 연결 점검을 요청해 주세요.";
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
