import type { Api } from "../client/api.ts";
import { createIssueEditor, fieldValue } from "../client/issue-editor.ts";
import type { PriorityOption } from "../domain/catalog.ts";
import {
  createDetailState,
  createEditOptions,
} from "../domain/detail-state.ts";
import type { LookupResult } from "../domain/details.ts";
import type { EditableField, UserOption } from "../domain/issue.ts";
import { decodeEditOptions } from "../domain/wire.ts";
import { renderADF } from "./adf-render.ts";
import { copyText } from "./clipboard.ts";
import { detailChildren } from "./detail-children.ts";
import { documentForm } from "./document-form.ts";
import {
  actionButton,
  element,
  externalLink,
  iconButton,
  safeHref,
} from "./dom.ts";
import { issueComments } from "./issue-comments.ts";
import { issueHistory } from "./issue-history.ts";
import {
  dueTime,
  issueTypeIcon,
  personPill,
  priorityPill,
  relativeTime,
  statusPill,
} from "./meta.ts";
import { enhanceSelect, type SelectMenu } from "./select-menu.ts";

/** 본문과 메타정보 표시를 한곳에 둔다. 데스크톱과 모달에서 같은 요소를 사용한다. */
export function issueDetail(
  result: LookupResult,
  order: readonly string[],
  close: () => void,
  copied: (message: string, undo?: () => Promise<void>) => void,
  api: Api,
  me: { accountId: string; displayName: string },
  changed: (issue: LookupResult["parent"]) => void | Promise<void>,
  refreshReady: () => void,
  select: (key: string) => void,
) {
  const issue = result.parent,
    root = element("article", "issue-detail");
  const head = element("div", "detail-head");
  const identity = element("div", "detail-identity");
  const link = element("a", "key", issue.key),
    url = safeHref(issue.url);
  if (url) {
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  identity.append(issueTypeIcon(issue), link);
  const copy = actionButton("이슈 링크 복사", "copy", "secondary detail-copy");
  copy.disabled = !url;
  copy.addEventListener("click", async () => {
    if (!url) return;
    await copyText(url, copied);
  });
  const history = issueHistory(api, issue.key);
  identity.append(copy, history.trigger);
  root.append(history.panel);
  const dismiss = iconButton("이슈 상세 닫기", "x");
  dismiss.addEventListener("click", close);
  head.append(identity, dismiss);
  const titleRow = element("div", "detail-title-row");
  const title = element("h2", "detail-title", issue.summary);
  const pencil = iconButton("제목 수정", "square-pen");
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
    (path) => api.request(path, decodeEditOptions),
    issue.key,
  );
  let users: UserOption[] | undefined;
  let priorities: PriorityOption[] | undefined;
  const assign = actionButton("나에게 할당", "user");
  const dueLabel = element("span");
  const editor = createIssueEditor(api, issue, {
    notice: copied,
    changed: async (updated) => {
      options.invalidate();
      await changed(updated);
    },
    state() {
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
          editor.busy !== null || (name === "dueDate" && !result.dateEditing);
        const value = fieldValue(editor.issue, name);
        if (control instanceof HTMLSelectElement) {
          const text =
            name === "status"
              ? editor.issue.status
              : name === "assignee"
                ? editor.issue.assignee || "미지정"
                : editor.issue.priority;
          let option = [...control.options].find(
            (item) => item.value === value,
          );
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
      assign.disabled = editor.busy !== null;
      for (const menu of menus) menu.sync();
      form.setAttribute("aria-busy", String(editor.busy === "summary"));
      input.disabled =
        save.disabled =
        cancel.disabled =
        pencil.disabled =
          editor.busy !== null;
    },
  });
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
  function chooser(name: "status" | "assignee" | "priority", label: string) {
    const select = element("select");
    select.setAttribute("aria-label", label);
    function add(value: string, text: string) {
      const option = element("option", "", text);
      option.value = value;
      select.append(option);
    }
    add(
      fieldValue(issue, name),
      name === "status"
        ? issue.status
        : name === "assignee"
          ? issue.assignee || "미지정"
          : issue.priority,
    );
    const holder = field(label, select);
    holders.set(name, holder);
    controls.set(name, select);
    const menu = enhanceSelect(select, {
      renderOption: (option) =>
        name === "status"
          ? statusPill(option.textContent ?? "", order)
          : name === "assignee"
            ? personPill({
                name: option.textContent ?? "",
                avatar:
                  users?.find((user) => user.id === option.value)?.avatar ??
                  (option.value === editor.issue.assigneeId
                    ? editor.issue.assigneeAvatar
                    : ""),
              })
            : priorityPill(
                {
                  priority: option.textContent ?? "",
                  priorityIcon:
                    priorities?.find((item) => item.id === option.value)
                      ?.icon ?? editor.issue.priorityIcon,
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
          // 담당자 목록은 상태 변경 뒤에도 유지한다. 전환 목록만 다시 조회한다.
          const data =
            name === "assignee" && users
              ? { users, statuses: [] }
              : await options.get();
          if (!alive) return false;
          users = data.users;
          select.replaceChildren();
          if (name === "status") {
            const names = [...new Set([editor.issue.status, ...data.statuses])];
            names.sort(
              (a, b) =>
                (order.includes(a) ? order.indexOf(a) : Infinity) -
                (order.includes(b) ? order.indexOf(b) : Infinity),
            );
            for (const status of names) add(status, status);
          } else {
            add("", "미지정");
            for (const user of users) add(user.id, user.name);
          }
        }
        if (![...select.options].some((option) => option.value === current)) {
          add(
            current,
            name === "priority" ? editor.issue.priority : editor.issue.assignee,
          );
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
  const assignee = chooser("assignee", "담당자");
  assign.addEventListener("click", () => {
    void editor.change("assignee", me.accountId);
  });
  const assigneeValue = element("div", "assignee-value");
  const assigneeMenu = assignee.querySelector(".select-menu");
  if (assigneeMenu) assigneeValue.append(assigneeMenu);
  assigneeValue.append(assign);
  assignee.append(assigneeValue);
  const reporter = element("span", "reporter-value");
  reporter.append(
    personPill({ name: issue.reporter, avatar: issue.reporterAvatar }),
  );
  if (issue.created)
    reporter.append(relativeTime(issue.created, "reported-at", "보고 시점"));
  field("보고자", reporter);
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
  root.append(meta);
  const body = element("section", "detail-description");
  body.setAttribute("aria-label", "이슈 설명");
  const descriptionHead = element("div", "description-head"),
    edit = actionButton("수정", "square-pen"),
    rendered = element("div", "adf");
  descriptionHead.append(element("h3", "", "설명"), edit);
  function renderDescription() {
    rendered.replaceChildren(
      editor.issue.description
        ? renderADF(editor.issue.description, editor.issue, result.imageEnabled)
        : element("p", "empty", "설명이 없습니다."),
    );
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
        editor.mergeContent({ description });
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
    async (count) => {
      editor.mergeContent({ commentCount: count });
      await changed(editor.issue);
    },
    refresh.hold,
  );
  root.append(body);
  const files = element("ul", "attachments");
  files.setAttribute("aria-label", "첨부 파일");
  for (const file of issue.attachments) {
    const href = safeHref(file.url);
    if (file.mimeType.startsWith("image/") || !href) continue;
    const row = element("li");
    row.append(externalLink(href, file.name));
    files.append(row);
  }
  if (files.children.length) root.append(files);
  root.append(comments.element);
  const children = detailChildren(result, api, {
    ...(url ? { site: new URL(url).hostname } : {}),
    copied,
    statusOrder: order,
    onSelect: select,
  });
  if (children) root.append(children.element);
  return {
    element: root,
    canRefresh: refresh.canRefresh,
    get issue() {
      return editor.issue;
    },
    destroy() {
      alive = false;
      children?.destroy();
      history.destroy();
      comments.destroy();
      writing?.destroy();
      for (const menu of menus) menu.destroy();
    },
  };
}
