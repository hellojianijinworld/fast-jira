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
    const cards = new Map<string, HTMLFormElement>();
    const alert = element("p", "error");
    alert.setAttribute("role", "alert");
    function card(request: AssistantApproval) {
      const form = element("form", "assistant-approval");
      form.append(
        element("h3", "", request.title),
        element("p", "", request.description),
      );
      if (request.details) {
        const details = element("details");
        details.append(
          element("summary", "", "내용 보기"),
          element("pre", "", request.details),
        );
        form.append(details);
      }
      if (request.url && safeHref(request.url))
        form.append(externalLink(request.url, "연결 서비스에서 확인 ↗"));
      const inputs = new Map<
        string,
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >();
      for (const field of request.fields.filter(
        (field) => field.key !== "feedback",
      )) {
        const label = element("label", "assistant-approval-field", field.label);
        const input = field.options
          ? element("select")
          : field.type === "json"
            ? element("textarea")
            : element("input");
        if (input instanceof HTMLSelectElement)
          input.append(
            new Option("선택하세요", ""),
            ...(field.options ?? []).map((value) => new Option(value, value)),
          );
        else if (input instanceof HTMLInputElement)
          input.type =
            field.type === "boolean"
              ? "checkbox"
              : field.type === "number"
                ? "number"
                : "text";
        input.setAttribute("aria-label", field.label);
        inputs.set(field.key, input);
        label.append(input);
        form.append(label);
      }
      const choices = element("fieldset", "assistant-answer-options");
      choices.setAttribute("aria-label", "답변 선택");
      const radios = new Map<string, HTMLInputElement>();
      for (const [value, text] of [
        ["allow", "네, 진행해 주세요"],
        ["deny", "아니요, 건너뛸게요"],
        ["other", "다른 의견이 있어요"],
      ]) {
        const label = element("label", "assistant-answer-choice"),
          radio = element("input");
        radio.type = "radio";
        radio.name = `answer-${request.id}`;
        radio.value = value ?? "";
        radio.required = true;
        label.append(radio, element("span", "", text));
        choices.append(label);
        radios.set(value ?? "", radio);
      }
      const noteLabel = element(
          "label",
          "assistant-approval-field",
          "기타 의견",
        ),
        note = element("textarea");
      note.rows = 2;
      note.maxLength = 4000;
      note.setAttribute("aria-label", "기타 의견");
      note.placeholder = "의견을 적어주세요";
      noteLabel.append(note);
      noteLabel.hidden = true;
      const error = element("p", "error");
      error.setAttribute("role", "alert");
      const actions = element("div", "assistant-approval-actions"),
        send = actionButton("답변 보내기", "send", "primary");
      send.type = "submit";
      send.disabled = true;
      actions.append(send);
      form.append(choices, noteLabel, error, actions);
      let submitting = false,
        failed = false;
      function refresh() {
        const choice = [...radios].find(([, radio]) => radio.checked)?.[0];
        const focusNote = choice === "other" && noteLabel.hidden;
        noteLabel.hidden = choice !== "other";
        note.required = choice === "other";
        for (const field of request.fields) {
          const input = inputs.get(field.key);
          if (input) {
            input.disabled = choice !== "allow";
            input.required =
              choice === "allow" && field.required && field.type !== "boolean";
          }
        }
        send.disabled =
          submitting || !choice || (choice === "other" && !note.value.trim());
        actions.hidden = !failed && choice !== "other" && inputs.size === 0;
        if (focusNote)
          requestAnimationFrame(() => {
            note.focus();
            send.scrollIntoView({ block: "nearest" });
          });
      }
      form.addEventListener("input", (event) => {
        refresh();
        if (
          event.target instanceof HTMLInputElement &&
          event.target.type === "radio" &&
          event.target.value !== "other" &&
          form.checkValidity()
        )
          form.requestSubmit();
      });
      refresh();
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (submitting || send.disabled) return;
        void (async () => {
          try {
            const approved = radios.get("allow")?.checked === true,
              values: Record<string, JsonValue> = Object.create(null);
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
            if (radios.get("other")?.checked)
              values.feedback = note.value.trim();
            submitting = true;
            failed = false;
            error.textContent = "";
            send.disabled = true;
            for (const radio of radios.values()) radio.disabled = true;
            note.disabled = true;
            await api.approveAssistant(requestId, request.id, approved, values);
            if (alive && version === generation) {
              pollVersion++;
              signature = "";
              form.remove();
              cards.delete(request.id);
              void poll();
            }
          } catch (reason) {
            if (alive && version === generation) {
              error.textContent =
                reason instanceof Error
                  ? reason.message
                  : "답변을 전달하지 못했어요.";
              submitting = false;
              failed = true;
              for (const radio of radios.values()) radio.disabled = false;
              note.disabled = false;
              refresh();
            }
          }
        })();
      });
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
        const first = requests[0];
        const key = first?.id ?? "none";
        if (key !== signature) {
          signature = key;
          const active = new Set(first ? [first.id] : []);
          for (const [id, form] of cards)
            if (!active.has(id)) {
              form.remove();
              cards.delete(id);
            }
          for (const request of first ? [first] : [])
            if (!cards.has(request.id)) {
              const form = card(request);
              cards.set(request.id, form);
              root.append(form);
            }
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
      cards.clear();
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
