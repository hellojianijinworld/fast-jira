import { type MentionLoader, mentionPrompt } from "../domain/mention.ts";
import { textareaMentions } from "./mention-editors.ts";
import "./assistant-approvals.css";
import type { Api } from "../client/api.ts";
import type { VoiceCallbacks, VoiceInput } from "../client/codex-voice.ts";
import type { JsonValue } from "../domain/adf.ts";
import type { AssistantApproval } from "../domain/assistant-approval.ts";
import {
  buttonGroup,
  element,
  externalLink,
  iconButton,
  safeHref,
} from "./dom.ts";

/** 승인 화면의 클릭만 서버에 전달한다. 모델 응답이나 대화 문장으로 승인하지 않는다. */
export function createAssistantApprovalPanel(
  api: Pick<Api, "assistantApprovals" | "approveAssistant">,
  changed: (waiting: boolean) => void,
  record?: (
    request: AssistantApproval,
    answer: { approved: boolean; feedback: string; response: string },
  ) => void,
  options: {
    mentions?: MentionLoader;
    selectIssue?: (key: string) => void;
    voice?: (callbacks: VoiceCallbacks) => VoiceInput;
    voiceAvailable?: () => boolean;
    notice?: (message: string) => void;
  } = {},
) {
  const root = element("section", "assistant-approvals");
  root.setAttribute("aria-label", "AI 작업 확인");
  let generation = 0,
    timer: ReturnType<typeof setTimeout> | undefined;
  let stopCurrent = () => {};
  let stopVoice = () => {};
  function start(requestId: string, signal: AbortSignal) {
    stopCurrent();
    const version = ++generation;
    let signature = "",
      alive = true,
      pollVersion = 0;
    const cards = new Map<string, HTMLFormElement>();
    const alert = element("p", "error");
    alert.setAttribute("role", "alert");
    const disposals = new Map<string, () => void>();
    function remove(id: string) {
      disposals.get(id)?.();
      disposals.delete(id);
      cards.get(id)?.remove();
      cards.delete(id);
      stopVoice = () => {};
    }
    function card(request: AssistantApproval) {
      const form = element("form", "assistant-approval");
      form.append(element("h3", "", request.title));
      if (request.description)
        form.append(
          element("p", "assistant-question-context", request.description),
        );
      if (request.details)
        form.append(
          element("pre", "assistant-approval-details", request.details),
        );
      if (request.url && safeHref(request.url))
        form.append(externalLink(request.url, "연결 서비스에서 확인"));
      const fields = request.fields.filter((field) => field.key !== "feedback");
      const optionField =
        fields.length === 1 &&
        fields[0]?.type === "text" &&
        fields[0]?.options?.length
          ? fields[0]
          : undefined;
      const textQuestion =
        fields.length === 1 &&
        fields[0]?.label === request.title &&
        fields[0]?.type === "text" &&
        !optionField
          ? fields[0]
          : undefined;
      const inputs = new Map<
        string,
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >();
      for (const field of optionField || textQuestion ? [] : fields) {
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
      const answers =
        optionField?.options?.map((label, index) => [
          `option-${index}`,
          label,
        ]) ??
        (textQuestion
          ? []
          : [
              ["allow", "네, 진행해 주세요"],
              ["deny", "이번에는 건너뛸게요"],
            ]);
      for (const [value, text] of answers) {
        const label = element("label", "assistant-answer-choice"),
          radio = element("input");
        radio.type = "radio";
        radio.name = `answer-${request.id}`;
        radio.value = value ?? "";
        label.append(radio, element("span", "", text));
        choices.append(label);
        radios.set(value ?? "", radio);
      }
      const composer = element("div", "assistant-feedback");
      const note = element("textarea");
      note.rows = 1;
      note.maxLength = 4000;
      note.setAttribute("aria-label", textQuestion ? "답변" : "기타 의견");
      note.placeholder = textQuestion
        ? "답변을 입력하세요"
        : "다른 의견을 입력하세요";
      const actions = buttonGroup(
        element("div", "assistant-approval-actions"),
        { size: "sm" },
      );
      const mic = iconButton("의견 음성 입력", "mic", { size: "sm" });
      const send = iconButton("답변 보내기", "arrow-up", {
        size: "sm",
        purpose: "confirm",
      });
      send.type = "submit";
      send.disabled = true;
      mic.hidden = !options.voice || options.voiceAvailable?.() === false;
      actions.append(mic, send);
      const mentions = options.mentions
        ? textareaMentions(note, options.mentions, {
            select: options.selectIssue,
          })
        : undefined;
      composer.append(mentions?.element ?? note, actions);
      const error = element("p", "error");
      error.setAttribute("role", "alert");
      form.append(...(answers.length ? [choices] : []), composer, error);
      let submitting = false,
        recording = false,
        prefix = "";
      const voice = options.voice?.({
        transcript(text) {
          if (
            !alive ||
            version !== generation ||
            submitting ||
            !cards.has(request.id)
          )
            return;
          note.value = `${prefix}${prefix && text ? " " : ""}${text}`.slice(
            0,
            4000,
          );
          for (const radio of radios.values()) radio.checked = false;
          refresh();
        },
        state(active, message) {
          if (!alive || version !== generation) return;
          recording = active;
          mic.classList.toggle("active", active);
          mic.setAttribute("aria-pressed", String(active));
          mic.setAttribute(
            "aria-label",
            active ? "의견 음성 입력 중지" : "의견 음성 입력",
          );
          mic.title = active ? "의견 음성 입력 중지" : "의견 음성 입력";
          note.readOnly = active;
          refresh();
          if (message) options.notice?.(message);
        },
      });
      stopVoice = () => voice?.stop();
      disposals.set(request.id, () => {
        voice?.destroy();
        mentions?.destroy();
      });
      mic.addEventListener("click", () => {
        if (submitting || (!recording && options.voiceAvailable?.() === false))
          return;
        if (!recording) prefix = note.value.trimEnd();
        voice?.start();
      });
      function refresh() {
        mentions?.refresh();
        const choice = [...radios].find(([, radio]) => radio.checked)?.[0];
        choices.disabled = submitting || recording;
        mic.disabled = submitting;
        for (const field of fields) {
          const input = inputs.get(field.key);
          if (input) {
            input.disabled = choice !== "allow" || submitting;
            input.required =
              choice === "allow" && field.required && field.type !== "boolean";
          }
        }
        send.disabled =
          submitting || recording || (!choice && !note.value.trim());
      }
      form.addEventListener("input", (event) => {
        if (event.target === note)
          for (const radio of radios.values()) radio.checked = false;
        const selected =
          event.target instanceof HTMLInputElement &&
          event.target.type === "radio";
        if (selected) note.value = "";
        refresh();
        if (selected && form.checkValidity()) form.requestSubmit();
      });
      refresh();
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (submitting || send.disabled) return;
        void (async () => {
          try {
            const choice = [...radios].find(([, radio]) => radio.checked)?.[0];
            const feedback = note.value.trim();
            const approved = textQuestion
              ? Boolean(feedback)
              : !feedback && Boolean(choice) && choice !== "deny";
            const values: Record<string, JsonValue> = Object.create(null);
            if (approved && textQuestion)
              values[textQuestion.key] = mentionPrompt(
                feedback,
                mentions?.references(feedback),
              );
            else if (approved && optionField) {
              const index = answers.findIndex(([value]) => value === choice);
              values[optionField.key] = optionField.options?.[index] ?? "";
            } else if (approved)
              for (const field of fields) {
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
            if (feedback && !textQuestion)
              values.feedback = mentionPrompt(
                feedback,
                mentions?.references(feedback),
              );
            submitting = true;
            error.textContent = "";
            note.disabled = true;
            voice?.stop();
            refresh();
            await api.approveAssistant(requestId, request.id, approved, values);
            if (alive && version === generation) {
              record?.(request, {
                approved,
                feedback: textQuestion ? "" : feedback,
                response: textQuestion
                  ? feedback
                  : (answers.find(([value]) => value === choice)?.[1] ?? ""),
              });
              pollVersion++;
              signature = "";
              remove(request.id);
              void poll();
            }
          } catch (reason) {
            if (alive && version === generation) {
              error.textContent =
                reason instanceof Error
                  ? reason.message
                  : "답변을 전달하지 못했어요.";
              submitting = false;
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
          for (const id of cards.keys())
            if (!active.has(id)) {
              remove(id);
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
      for (const id of cards.keys()) remove(id);
      root.replaceChildren();
      stopVoice = () => {};
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
    stopVoice: () => stopVoice(),
    destroy() {
      generation++;
      stopCurrent();
      root.remove();
    },
  };
}
