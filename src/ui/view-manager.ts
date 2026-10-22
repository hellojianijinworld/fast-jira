import type { ViewController } from "../client/view-controller.ts";
import { createViewDraft } from "../client/view-editor-controller.ts";
import type { ViewOptions } from "../client/view-options.ts";
import type { SavedView, ViewDefinition } from "../domain/views.ts";
import { actionButton, element } from "./dom.ts";
import { showModal } from "./modal.ts";
import { createViewEditor, viewSummary } from "./view-editor.ts";

export function createViewManager(
  views: ViewController,
  options: () => Promise<ViewOptions>,
  me: { accountId: string; displayName: string },
  closed: () => void,
) {
  const dialog = element("dialog", "settings-modal view-manager");
  const content = element("div", "view-manager-content");
  document.body.append(dialog);
  let editor: ReturnType<typeof createViewEditor> | null = null;
  let revision = 0;
  dialog.addEventListener("close", () => {
    revision++;
    editor?.destroy();
    editor = null;
    closed();
  });
  function locations(id: string): string[] {
    const parents = Object.entries(views.state.branches)
      .filter(
        ([, binding]) => binding.kind === "saved" && binding.viewId === id,
      )
      .map(([key]) => key);
    return views.state.global.kind === "saved" &&
      views.state.global.viewId === id
      ? ["전체 목록", ...parents]
      : parents;
  }
  const usage = (id: string) => locations(id).length;
  function showList(message = "") {
    revision++;
    editor?.destroy();
    editor = null;
    content.replaceChildren();
    const toolbar = element("div", "view-manager-toolbar");
    toolbar.append(
      element(
        "p",
        "view-help",
        "자주 쓰는 필터와 정렬을 저장해 두고 여러 목록에서 사용할 수 있어요.",
      ),
    );
    const create = actionButton("새 뷰", "layers");
    create.addEventListener(
      "click",
      () => void edit(null, views.resolve({ kind: "global" }), ""),
    );
    toolbar.append(create);
    content.append(toolbar);
    if (message) content.append(element("p", "view-feedback", message));
    if (!views.state.saved.length)
      content.append(
        element(
          "p",
          "view-empty",
          "저장한 뷰가 없습니다. 목록에서 조건을 편집한 뒤 뷰로 등록해 보세요.",
        ),
      );
    for (const view of views.state.saved) {
      const row = element("section", "saved-view-row");
      row.dataset.viewId = view.id;
      const copy = element("div", "saved-view-copy");
      copy.append(
        element("h3", "", view.name),
        element("p", "view-help", viewSummary(view.definition)),
        element("small", "view-usage", `${usage(view.id)}곳에서 사용 중`),
      );
      if (usage(view.id)) {
        const details = element("details", "view-usage-details"),
          summary = element("summary", "", "사용 위치 보기");
        const places = element("ul");
        places.append(
          ...locations(view.id).map((place) => element("li", "", place)),
        );
        details.append(summary, places);
        copy.append(details);
      }
      const actions = element("div", "saved-view-actions");
      const modify = actionButton("편집", "square-pen"),
        duplicate = actionButton("복제하여 편집", "copy"),
        remove = actionButton("삭제", "x");
      modify.setAttribute("aria-label", `${view.name} 편집`);
      duplicate.setAttribute("aria-label", `${view.name} 복제하여 편집`);
      remove.setAttribute("aria-label", `${view.name} 삭제`);
      modify.addEventListener(
        "click",
        () => void edit(view, view.definition, view.name),
      );
      duplicate.addEventListener(
        "click",
        () => void edit(null, view.definition, `${view.name} 복사`),
      );
      remove.addEventListener("click", () => {
        row.querySelector(".view-delete-confirm")?.remove();
        const confirmation = element("div", "view-delete-confirm");
        confirmation.append(
          element(
            "p",
            "view-help",
            "삭제해도 각 목록에 적용된 필터와 정렬은 그대로 남습니다.",
          ),
        );
        const cancel = actionButton("취소", "x"),
          apply = actionButton("삭제", "x");
        cancel.addEventListener("click", () => confirmation.remove());
        apply.addEventListener("click", () => {
          try {
            views.delete(view.id);
            showList("뷰를 삭제했어요. 적용된 조건은 유지됩니다.");
          } catch (reason) {
            confirmation.append(element("p", "error", messageOf(reason)));
          }
        });
        confirmation.append(cancel, apply);
        row.append(confirmation);
      });
      actions.append(modify, duplicate, remove);
      row.append(copy, actions);
      content.append(row);
    }
  }
  async function edit(
    saved: SavedView | null,
    initial: ViewDefinition,
    initialName: string,
  ) {
    const generation = ++revision;
    editor?.destroy();
    editor = null;
    const draft = createViewDraft(initial),
      name = element("input");
    name.value = initialName;
    name.maxLength = 80;
    name.placeholder = "예: QA 확인";
    name.setAttribute("aria-label", "뷰 이름");
    const label = element("label", "view-name-field", "뷰 이름");
    label.append(name);
    const impact = element(
      "p",
      "view-help",
      saved
        ? `${usage(saved.id)}곳에서 사용 중입니다. 저장하면 이 뷰를 사용하는 모든 목록에 함께 반영됩니다.`
        : "등록만 하며 현재 목록의 뷰는 바꾸지 않습니다.",
    );
    const editorHost = element("div"),
      error = element("p", "error"),
      match = element("p", "view-match");
    error.setAttribute("role", "alert");
    editorHost.append(element("p", "view-help", "선택지를 불러오는 중…"));
    const footer = element("div", "view-manager-footer");
    const cancel = actionButton("취소", "x"),
      save = actionButton(saved ? "저장" : "등록", "check", "");
    save.disabled = true;
    cancel.addEventListener("click", () => showList());
    save.addEventListener("click", () => {
      try {
        if (saved) views.update(saved.id, name.value, draft.value);
        else views.create(draft.value, name.value);
        showList(saved ? "뷰를 저장했어요." : "뷰를 등록했어요.");
      } catch (reason) {
        error.textContent = messageOf(reason);
      }
    });
    footer.append(cancel, save);
    content.replaceChildren(label, impact, editorHost, match, error, footer);
    function hint() {
      const found = !saved ? views.match(draft.value) : undefined;
      match.textContent = found
        ? `‘${found.name}’과 같은 조건입니다. 등록하면 기존 뷰를 사용합니다.`
        : "";
    }
    try {
      const choices = await options();
      if (generation !== revision || !dialog.open) return;
      editor = createViewEditor(draft, choices, me, hint);
      editorHost.replaceChildren(editor.element);
      save.disabled = false;
      hint();
      name.focus();
    } catch (reason) {
      if (generation === revision) {
        editorHost.replaceChildren();
        error.textContent = messageOf(reason);
      }
    }
  }
  return {
    open() {
      showList();
      showModal(dialog, { title: "뷰 관리", content });
    },
    destroy() {
      revision++;
      editor?.destroy();
      if (dialog.open) dialog.close();
      dialog.remove();
    },
  };
}
const messageOf = (reason: unknown) =>
  reason instanceof Error ? reason.message : "뷰를 저장하지 못했어요.";
