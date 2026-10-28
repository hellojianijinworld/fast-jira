import type { Api } from "../client/api.ts";
import { createIssueEditor } from "../client/issue-editor.ts";
import { unembeddedImages } from "../domain/attachments.ts";
import type { PriorityOption } from "../domain/catalog.ts";
import {
  createDetailState,
  createEditOptions,
} from "../domain/detail-state.ts";
import type { IssueDetails, LookupResult } from "../domain/details.ts";
import { type EditableField, fieldValue, type Issue } from "../domain/issue.ts";
import type { ParticipantRecents } from "../domain/participants.ts";
import { decodeEditOptions } from "../domain/wire.ts";
import { renderADF } from "./adf-render.ts";
import { issueKeyCopy } from "./clipboard.ts";
import { type DetailChildOptions, detailChildren } from "./detail-children.ts";
import { documentForm } from "./document-form.ts";
import {
  actionButton,
  element,
  externalLink,
  iconButton,
  safeHref,
  uiIcon,
} from "./dom.ts";
import { issueBreadcrumbs } from "./issue-breadcrumbs.ts";
import { issueComments } from "./issue-comments.ts";
import { issueHistory } from "./issue-history.ts";
import { dueTime, issueTypeIcon, priorityPill, statusPill } from "./meta.ts";
import { participantsField } from "./participants.ts";
import { enhanceSelect, type SelectMenu } from "./select-menu.ts";

/** 본문과 메타정보 표시를 한곳에 둔다. 데스크톱과 모달에서 같은 요소를 사용한다. */
export function issueDetail(
  result: LookupResult,
  order: readonly string[],
  close: () => void,
  copied: (message: string, undo?: () => Promise<void>) => void,
  api: Api,
  me: { accountId: string; displayName: string; avatar?: string },
  changed: (
    issue: LookupResult["parent"],
    content?: "description" | "commentCount",
  ) => void | Promise<void>,
  refreshReady: () => void,
  select: (key: string) => void,
  known: ReadonlyMap<string, Issue> = new Map(),
  childOptions?: DetailChildOptions,
  favorite?: HTMLButtonElement,
  people?: ParticipantRecents,
  createChild?: (issue: Issue) => void,
) {
  const issue = result.parent,
    root = element("article", "issue-detail");
  const head = element("div", "detail-head");
  const identity = element("div", "detail-identity");
  const url = safeHref(issue.url);
  const current = element("span", "breadcrumb-current");
  current.append(issueTypeIcon(issue), issueKeyCopy(issue.key, url, copied));
  current.setAttribute("aria-current", "page");
  const breadcrumbs = issueBreadcrumbs(issue, known, api, select);
  const separator = uiIcon("chevron-right");
  separator.classList.add("breadcrumb-current-separator");
  identity.append(breadcrumbs.element, separator, current);
  const history = issueHistory(api, issue.key, issue);
  root.append(history.panel);
  const dismiss = iconButton("이슈 상세 닫기", "x");
  dismiss.addEventListener("click", close);
  const actions = element("div", "detail-head-actions");
  if (favorite) actions.append(favorite);
  actions.append(history.trigger, dismiss);
  head.append(identity, actions);
  const titleRow = element("div", "detail-title-row");
  const title = element("h2", "detail-title", issue.summary);
  title.tabIndex = -1;
  const pencil = iconButton("제목 수정", "square-pen", { size: "sm" });
  const form = element("form", "detail-title-editor");
  const input = element("input");
  input.maxLength = 255;
  input.setAttribute("aria-label", "제목");
  const save = actionButton("저장", "check");
  save.type = "submit";
  const cancel = actionButton("취소", "x");
  form.append(input, save, cancel);
  form.hidden = true;
  titleRow.append(title, pencil, form);
  root.append(head, titleRow);
  let alive = true;
  const refresh = createDetailState(() => {
    if (alive) refreshReady();
  });
  let releaseTitle: (() => void) | null = null,
    releaseBody: (() => void) | null = null,
    releaseField: (() => void) | null = null;
  const menus: SelectMenu[] = [];
  const controls = new Map<
    EditableField,
    HTMLSelectElement | HTMLInputElement
  >();
  const holders = new Map<EditableField, HTMLElement>();
  const options = createEditOptions(
    () =>
      api.request(
        `/api/transitions?key=${encodeURIComponent(issue.key)}`,
        decodeEditOptions,
      ),
    issue.key,
  );
  let priorities: PriorityOption[] | undefined;
  const dueLabel = element("span");
  let participantsSaving = false;
  let participants: ReturnType<typeof participantsField> | undefined;
  const editor = createIssueEditor(api, issue, {
    notice: copied,
    changed: async (updated) => {
      options.invalidate();
      history.invalidate();
      await changed(updated);
    },
    state: syncEditor,
  });
  function syncEditor() {
    if (!alive) return;
    if (editor.busy && !releaseField) releaseField = refresh.hold();
    if (!editor.busy && releaseField) {
      const release = releaseField;
      releaseField = null;
      release();
      if (!alive) return;
    }
    title.textContent = editor.issue.summary;
    dueLabel.replaceChildren(
      ...(editor.issue.dueDate ? [dueTime(editor.issue.dueDate)] : []),
    );
    for (const [name, control] of controls) {
      control.disabled =
        participantsSaving ||
        editor.busy !== null ||
        (name === "dueDate" && !result.dateEditing);
      const value = fieldValue(editor.issue, name);
      if (control instanceof HTMLSelectElement) {
        const text =
          name === "status" ? editor.issue.status : editor.issue.priority;
        let option = [...control.options].find((item) => item.value === value);
        if (!option) {
          option = element("option");
          option.value = value;
          control.append(option);
        }
        option.textContent = text;
      }
      control.value = value;
      holders
        .get(name)
        ?.setAttribute("aria-busy", String(editor.busy === name));
    }
    for (const menu of menus) menu.sync();
    form.setAttribute("aria-busy", String(editor.busy === "summary"));
    input.disabled =
      save.disabled =
      cancel.disabled =
      pencil.disabled =
        participantsSaving || editor.busy !== null;
    participants?.sync(
      editor.issue,
      participantsSaving || editor.busy !== null,
    );
  }
  async function contentChanged(
    patch: Partial<Pick<IssueDetails, "description" | "commentCount">>,
  ) {
    editor.mergeContent(patch);
    await changed(
      editor.issue,
      "description" in patch ? "description" : "commentCount",
    );
  }
  function endTitle() {
    form.hidden = true;
    title.hidden = pencil.hidden = false;
    releaseTitle?.();
    releaseTitle = null;
  }
  pencil.addEventListener("click", () => {
    releaseTitle ??= refresh.hold();
    input.value = editor.issue.summary;
    title.hidden = pencil.hidden = true;
    form.hidden = false;
    input.focus();
  });
  cancel.addEventListener("click", endTitle);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !editor.busy) {
      event.preventDefault();
      endTitle();
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (await editor.change("summary", input.value.trim())) endTitle();
  });
  const meta = element("div", "detail-fields");
  function field(label: string, value: Node) {
    const field = element("div", "detail-field");
    field.append(element("small", "field-label", label), value);
    meta.append(field);
    return field;
  }
  function chooser(name: "status" | "priority", label: string) {
    const select = element("select");
    select.setAttribute("aria-label", label);
    function add(value: string, text: string) {
      select.append(new Option(text, value));
    }
    add(
      fieldValue(issue, name),
      name === "status" ? issue.status : issue.priority,
    );
    const holder = field(label, select);
    holders.set(name, holder);
    controls.set(name, select);
    const menu = enhanceSelect(select, {
      renderOption: (option) =>
        name === "status"
          ? statusPill(option.textContent ?? "", order)
          : priorityPill(
              {
                priority: option.textContent ?? "",
                priorityIcon:
                  priorities?.find((item) => item.id === option.value)?.icon ??
                  editor.issue.priorityIcon,
              },
              true,
            ),
      async beforeOpen() {
        const current = fieldValue(editor.issue, name);
        if (name === "priority") {
          priorities ??= await api.priorities(issue.key);
          if (!alive) return false;
          select.replaceChildren();
          for (const priority of priorities) add(priority.id, priority.name);
        } else {
          const data = await options.get();
          if (!alive) return false;
          const names = [...new Set([editor.issue.status, ...data.statuses])];
          names.sort(
            (a, b) =>
              (order.includes(a) ? order.indexOf(a) : Infinity) -
              (order.includes(b) ? order.indexOf(b) : Infinity),
          );
          select.replaceChildren();
          for (const status of names) add(status, status);
        }
        if (![...select.options].some((option) => option.value === current)) {
          add(current, editor.issue.priority);
          const option = select.options[select.options.length - 1];
          if (option) option.disabled = true;
        }
        select.value = current;
        menu.sync();
        return true;
      },
    });
    menus.push(menu);
    select.addEventListener("change", () => {
      void editor.change(name, select.value);
    });
    return holder;
  }
  chooser("status", "상태");
  chooser("priority", "우선순위");
  const date = element("input");
  date.type = "date";
  date.value = issue.dueDate;
  date.setAttribute("aria-label", "마감일");
  date.disabled = !result.dateEditing;
  const due = field("마감일", date);
  controls.set("dueDate", date);
  holders.set("dueDate", due);
  if (issue.dueDate) dueLabel.append(dueTime(issue.dueDate));
  due.append(dueLabel);
  date.addEventListener("change", () => {
    void editor.change("dueDate", date.value);
  });
  participants = participantsField(api, issue, {
    me: { id: me.accountId, name: me.displayName, avatar: me.avatar ?? "" },
    ...(people ? { recents: people } : {}),
    hold: refresh.hold,
    busy(value) {
      participantsSaving = value;
      syncEditor();
    },
    async saved(updated) {
      const current = editor.mergeParticipants(updated);
      options.invalidate();
      history.invalidate();
      await changed(current);
    },
    notice: copied,
  });
  meta.append(participants.element);
  root.append(meta);
  if (createChild && issue.hierarchyLevel !== -1) {
    const actions = element("div", "detail-create-actions");
    const create = actionButton("하위 이슈 생성", "plus", { size: "sm" });
    create.addEventListener("click", () => createChild(editor.issue));
    actions.append(create);
    root.append(actions);
  }
  const body = element("section", "detail-description");
  body.setAttribute("aria-label", "이슈 설명");
  const descriptionHead = element("div", "description-head"),
    edit = actionButton("수정", "square-pen"),
    rendered = element("div", "adf");
  descriptionHead.append(element("h3", "", "설명"), edit);
  const attachments = element("section", "detail-attachments");
  function renderAttachments() {
    attachments.replaceChildren();
    const imageLinks = element("div", "attachment-image-links");
    for (const file of unembeddedImages(
      result.imageEnabled ? editor.issue.description : null,
      issue.attachments,
    )) {
      const href = safeHref(file.url);
      if (href)
        imageLinks.append(
          externalLink(href, `이미지 ${imageLinks.children.length + 1} 열기`),
        );
    }
    if (imageLinks.children.length) {
      const images = element("section", "attachment-images");
      images.setAttribute("aria-label", "첨부 이미지");
      images.append(
        element("h3", "", `첨부 이미지 ${imageLinks.children.length}개`),
        imageLinks,
      );
      attachments.append(images);
    }
    const files = element("ul", "attachments");
    files.setAttribute("aria-label", "첨부 파일");
    for (const file of issue.attachments) {
      const href = safeHref(file.url);
      if (file.mimeType.startsWith("image/") || !href) continue;
      const row = element("li");
      row.append(externalLink(href, file.name));
      files.append(row);
    }
    if (files.children.length) attachments.append(files);
    attachments.hidden = !attachments.children.length;
  }
  function renderDescription() {
    rendered.replaceChildren(
      editor.issue.description
        ? renderADF(editor.issue.description, editor.issue, result.imageEnabled)
        : element("p", "empty", "설명이 없습니다."),
    );
    renderAttachments();
  }
  renderDescription();
  body.append(descriptionHead, rendered);
  let writing: ReturnType<typeof documentForm> | null = null;
  function closeWriting() {
    writing?.destroy();
    writing = null;
    rendered.hidden = edit.hidden = false;
    releaseBody?.();
    releaseBody = null;
  }
  edit.addEventListener("click", () => {
    if (writing) return;
    releaseBody = refresh.hold();
    writing = documentForm({
      initial: editor.issue.description,
      issue: editor.issue,
      imageEnabled: result.imageEnabled,
      api,
      label: "이슈 본문",
      submitLabel: "저장",
      close: closeWriting,
      async save(document) {
        const description = await api.description(issue.key, document);
        history.invalidate();
        void contentChanged({ description }).catch(() =>
          copied("본문은 저장됐지만 목록을 갱신하지 못했어요."),
        );
        if (alive) renderDescription();
        copied(`본문 변경됨 · ${issue.key}`);
      },
    });
    rendered.hidden = edit.hidden = true;
    body.append(writing.element);
    writing.focus();
  });
  const comments = issueComments(
    api,
    issue,
    result.imageEnabled,
    copied,
    me.accountId,
    (count) => contentChanged({ commentCount: count }),
    refresh.hold,
  );
  root.append(body, attachments);
  const children = detailChildren(
    result,
    api,
    {
      ...(url ? { site: new URL(url).hostname } : {}),
      currentUserId: me.accountId,
      copied,
      get statusOrder() {
        return order;
      },
      onSelect: select,
    },
    childOptions,
  );
  if (children) root.append(children.element);
  root.append(comments.element);
  return {
    element: root,
    canRefresh: refresh.canRefresh,
    refreshStatusOrder(next: readonly string[]) {
      if (
        next.length === order.length &&
        next.every((name, i) => name === order[i])
      )
        return;
      order = next;
      for (const menu of menus) menu.sync();
    },
    refreshChildren: () => children?.refresh(),
    get issue() {
      return editor.issue;
    },
    destroy() {
      alive = false;
      breadcrumbs.destroy();
      children?.destroy();
      history.destroy();
      participants?.destroy();
      comments.destroy();
      writing?.destroy();
      for (const menu of menus) menu.destroy();
    },
  };
}
