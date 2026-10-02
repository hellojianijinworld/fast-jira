import type { Api } from "../client/api.ts";
import type { AdfDocument } from "../domain/adf.ts";
import { adfEditor } from "./adf-editor.ts";
import type { AdfContext } from "./adf-render.ts";
import { actionButton, element } from "./dom.ts";
import { mentionPicker } from "./mention-picker.ts";

/** 본문·댓글·답글의 작성/실패/정리 동작을 공유한다. 실제 저장은 호출자가 맡는다. */
export function documentForm(config: {
  initial: AdfDocument | null;
  issue: AdfContext;
  imageEnabled: boolean;
  api: Pick<Api, "mentionUsers">;
  label: string;
  submitLabel: string;
  validate?: (document: AdfDocument) => AdfDocument;
  save: (document: AdfDocument) => Promise<void>;
  close: () => void;
}) {
  const form = element("form", "document-form"),
    editor = adfEditor(config.initial, config.issue, config.imageEnabled);
  editor.element.setAttribute("aria-label", config.label);
  const picker = mentionPicker(editor, (query) =>
    config.api.mentionUsers(config.issue.key, query),
  );
  const actions = element("div", "document-actions"),
    save = actionButton(config.submitLabel, "check"),
    cancel = actionButton("취소", "x"),
    error = element("p", "error");
  save.type = "submit";
  error.setAttribute("role", "alert");
  actions.append(save, cancel);
  form.append(editor.element, picker.element, actions, error);
  let busy = false,
    alive = true;
  cancel.addEventListener("click", () => {
    if (!busy) config.close();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !alive) return;
    busy = true;
    error.textContent = "";
    save.disabled = cancel.disabled = true;
    form.setAttribute("aria-busy", "true");
    editor.element.contentEditable = "false";
    try {
      const document = editor.document();
      await config.save(config.validate ? config.validate(document) : document);
      if (alive) config.close();
    } catch (reason) {
      if (alive)
        error.textContent =
          reason instanceof Error
            ? reason.message
            : "저장하지 못했어요. 다시 시도해 주세요.";
    } finally {
      busy = false;
      if (alive) {
        save.disabled = cancel.disabled = false;
        form.setAttribute("aria-busy", "false");
        editor.element.contentEditable = "true";
      }
    }
  });
  return {
    element: form,
    focus() {
      editor.element.focus();
    },
    destroy() {
      alive = false;
      picker.destroy();
      form.remove();
    },
  };
}
