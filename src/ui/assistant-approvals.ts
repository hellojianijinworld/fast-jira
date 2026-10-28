import type { Api } from "../client/api.ts";
import type { JsonValue } from "../domain/adf.ts";
import type { AssistantApproval } from "../domain/assistant-approval.ts";
import { actionButton, element, externalLink, safeHref } from "./dom.ts";

/** 승인 화면의 클릭만 서버에 전달한다. 모델 응답이나 대화 문장으로 승인하지 않는다. */
export function createAssistantApprovalPanel(
  api: Pick<Api, "assistantApprovals" | "approveAssistant">,
  changed: (waiting: boolean) => void,
) {
  const root = element("section", "assistant-approvals");
  root.setAttribute("aria-label", "AI 작업 확인");
  let generation = 0,
    timer: ReturnType<typeof setTimeout> | undefined;
  let stopCurrent = () => {};
  function start(requestId: string, signal: AbortSignal) {
    stopCurrent();
    const version = ++generation;
    let signature = "",
      alive = true,
      pollVersion = 0;
    const alert = element("p", "error");
    alert.setAttribute("role", "alert");
    function card(request: AssistantApproval) {
      const form = element("form", "assistant-approval"),
        title = element("h3", "", request.title),
        description = element("p", "", request.description),
        error = element("p", "error"),
        actions = element("div", "assistant-approval-actions");
      error.setAttribute("role", "alert");
      form.append(title, description);
      if (request.details) {
        const details = element("details");
        details.append(
          element("summary", "", "실행 대상·내용 확인"),
          element("pre", "", request.details),
        );
        details.open = true;
        form.append(details);
      }
      if (request.url && safeHref(request.url))
        form.append(externalLink(request.url, "연결 서비스에서 확인 ↗"));
      const inputs = new Map<
        string,
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >();
      for (const field of request.fields) {
        const label = element("label", "assistant-approval-field", field.label);
        const input = field.options
          ? element("select")
          : field.type === "json"
            ? element("textarea")
            : element("input");
        if (input instanceof HTMLSelectElement) {
          input.append(
            new Option("선택하세요", ""),
            ...(field.options ?? []).map((value) => new Option(value, value)),
          );
        } else if (input instanceof HTMLInputElement)
          input.type =
            field.type === "boolean"
              ? "checkbox"
              : field.type === "number"
                ? "number"
                : "text";
        input.required = field.required && field.type !== "boolean";
        input.setAttribute("aria-label", field.label);
        inputs.set(field.key, input);
        label.append(input);
        form.append(label);
      }
      const deny = actionButton("거절", "x"),
        approve = actionButton("이번 요청만 승인", "check", "primary");
      approve.type = "submit";
      actions.append(deny, approve);
      form.append(error, actions);
      async function decide(approved: boolean) {
        const values: Record<string, JsonValue> = Object.create(null);
        try {
          if (approve.disabled) return;
          if (approved)
            for (const field of request.fields) {
              const input = inputs.get(field.key);
              if (
                !input ||
                (!field.required && field.type !== "boolean" && !input.value)
              )
                continue;
              values[field.key] =
                field.type === "boolean" && input instanceof HTMLInputElement
                  ? input.checked
                  : field.type === "number"
                    ? Number(input.value)
                    : field.type === "json"
                      ? JSON.parse(input.value)
                      : input.value;
            }
          deny.disabled = approve.disabled = true;
          await api.approveAssistant(requestId, request.id, approved, values);
          if (alive && version === generation) {
            pollVersion++;
            signature = "";
            form.remove();
            void poll();
          }
        } catch (reason) {
          if (alive && version === generation) {
            error.textContent =
              reason instanceof Error
                ? reason.message
                : "승인 응답을 전달하지 못했어요.";
            deny.disabled = approve.disabled = false;
          }
        }
      }
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void decide(true);
      });
      deny.addEventListener("click", () => void decide(false));
      return form;
    }
    async function poll() {
      clearTimeout(timer);
      if (!alive || signal.aborted || version !== generation) return;
      const currentPoll = ++pollVersion;
      try {
        const requests = await api.assistantApprovals(requestId, signal);
        if (!alive || version !== generation || currentPoll !== pollVersion)
          return;
        const key = JSON.stringify(requests.map((request) => request.id));
        if (key !== signature) {
          signature = key;
          root.replaceChildren(...requests.map(card));
          changed(requests.length > 0);
        }
        alert.remove();
      } catch (reason) {
        if (
          alive &&
          !signal.aborted &&
          version === generation &&
          currentPoll === pollVersion
        ) {
          alert.textContent =
            reason instanceof Error
              ? reason.message
              : "확인 요청을 불러오지 못했어요.";
          root.append(alert);
        }
      }
      if (
        alive &&
        !signal.aborted &&
        version === generation &&
        currentPoll === pollVersion
      )
        timer = setTimeout(() => void poll(), 1000);
    }
    const stop = () => {
      alive = false;
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      root.replaceChildren();
      changed(false);
    };
    stopCurrent = stop;
    signal.addEventListener("abort", stop, { once: true });
    void poll();
    return stop;
  }
  return {
    element: root,
    start,
    destroy() {
      generation++;
      stopCurrent();
      root.remove();
    },
  };
}
