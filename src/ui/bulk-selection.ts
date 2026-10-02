import type { Api } from "../client/api.ts";
import type { BulkField, BulkResult } from "../domain/bulk.ts";
import type { Issue } from "../domain/issue.ts";
import { copyText } from "./clipboard.ts";
import { actionButton, element, iconButton } from "./dom.ts";
import { popoverPosition } from "./geometry.ts";
import { personPill, priorityPill, statusPill } from "./meta.ts";
import { enhanceSelect, type SelectMenu } from "./select-menu.ts";

/** 선택은 명시적인 키 집합이다. 상위 선택을 하위 자동 선택으로 해석하지 않는다. */
export function createBulkSelection(config: {
  host: HTMLElement;
  mount: HTMLElement;
  site: string;
  toggle: HTMLButtonElement;
  api: Api;
  order: () => readonly string[];
  render: () => void;
  changed: (issues: Issue[]) => Promise<void>;
  notice: (message: string, undo?: () => Promise<void>) => void;
}) {
  const selected = new Set<string>(),
    bar = element("section", "bulk-bar"),
    panel = element("div", "bulk-editor");
  bar.setAttribute("aria-label", "선택 이슈 일괄 변경");
  panel.popover = "auto";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "일괄 변경 값");
  const head = element("div", "bulk-head"),
    count = element("strong"),
    exit = iconButton("선택 종료", "x");
  const actions = element("div", "bulk-actions"),
    result = element("div", "bulk-result"),
    undoButton = actionButton("되돌리기", "undo-2");
  result.setAttribute("role", "status");
  head.append(count, actions, undoButton, exit);
  bar.append(head, result);
  config.mount.append(bar);
  config.host.append(panel);
  let active = false,
    busy = false,
    revision = 0,
    alive = true,
    undoToken = "",
    menu: SelectMenu | null = null;
  function closeEditor() {
    revision++;
    if (panel.matches(":popover-open")) panel.hidePopover();
    menu?.destroy();
    menu = null;
  }
  function sync() {
    bar.hidden = !active;
    config.toggle.setAttribute("aria-pressed", String(active));
    config.toggle.disabled = busy;
    count.textContent = `${selected.size}개 선택`;
    for (const button of [exit, undoButton]) button.disabled = busy;
    for (const button of actions.querySelectorAll<HTMLButtonElement>("button"))
      button.disabled = busy || !selected.size;
    undoButton.hidden = !undoToken;
    for (const check of config.host.querySelectorAll<HTMLInputElement>(
      "[data-select-key]",
    )) {
      check.checked = selected.has(check.dataset.selectKey ?? "");
      check.disabled = busy;
    }
  }
  function reset() {
    if (busy) return;
    selected.clear();
    closeEditor();
    sync();
  }
  function choose(key: string, checked: boolean) {
    if (busy) return;
    if (checked && !selected.has(key) && selected.size >= 50) {
      config.notice("한 번에 최대 50개까지 선택할 수 있어요.");
      sync();
      return;
    }
    if (checked) selected.add(key);
    else selected.delete(key);
    closeEditor();
    sync();
  }
  async function finished(data: BulkResult, restoring = false) {
    undoToken = data.undoToken;
    const text = `${restoring ? "되돌리기" : "변경"} ${data.issues.length}개 완료${data.failures.length ? ` · ${data.failures.length}개 실패` : ""}`;
    result.replaceChildren(element("span", "", text));
    if (data.failures.length || data.warnings.length) {
      const details = element("details");
      details.append(element("summary", "", "처리 내역"));
      for (const item of [...data.failures, ...data.warnings])
        details.append(element("p", "", `${item.key}: ${item.error}`));
      result.append(details);
    }
    sync();
    config.notice(text, undoToken ? undo : undefined);
    // 저장 성공 뒤 화면 재조회 실패를 저장 실패로 바꾸지 않는다. 성공 항목의 되돌리기도 유지한다.
    try {
      await config.changed(data.issues);
    } catch {
      config.notice(
        "변경은 완료됐지만 목록을 갱신하지 못했어요.",
        undoToken ? undo : undefined,
      );
    }
  }
  async function undo() {
    if (busy || !undoToken || !alive) return;
    busy = true;
    sync();
    try {
      const data = await config.api.bulkUndo(undoToken);
      if (alive) await finished(data, true);
    } catch (reason) {
      config.notice(
        reason instanceof Error ? reason.message : "되돌리지 못했어요.",
      );
    } finally {
      busy = false;
      if (alive) sync();
    }
  }
  async function open(
    field: BulkField,
    label: string,
    anchor: HTMLButtonElement,
  ) {
    closeEditor();
    const version = revision;
    const holder = element("div"),
      hint = element(
        "p",
        "bulk-hint",
        `선택한 ${selected.size}개 이슈에 적용합니다.`,
      ),
      save = actionButton("일괄 적용", "check"),
      cancel = actionButton("취소", "x"),
      footer = element("div", "document-actions");
    save.disabled = true;
    cancel.addEventListener("click", closeEditor);
    footer.append(cancel, save);
    panel.replaceChildren(element("h3", "", label), hint, holder, footer);
    Object.assign(
      panel.style,
      popoverPosition(anchor.getBoundingClientRect(), {
        width: 480,
        maxHeight: 560,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      }),
    );
    panel.showPopover();
    let control: HTMLInputElement | HTMLSelectElement;
    try {
      if (field === "status" || field === "assignee" || field === "priority") {
        holder.textContent = "공통 선택지를 확인하는 중…";
        const options = await config.api.bulkOptions([...selected], field);
        if (!alive || version !== revision || !panel.matches(":popover-open"))
          return;
        const select = element("select");
        select.setAttribute("aria-label", label);
        function add(value: string, label: string) {
          const option = element("option", "", label);
          option.value = value;
          select.append(option);
        }
        if (field === "status") {
          const order = config.order();
          options.statuses.sort(
            (a, b) =>
              (order.includes(a) ? order.indexOf(a) : Infinity) -
              (order.includes(b) ? order.indexOf(b) : Infinity),
          );
          for (const status of options.statuses) add(status, status);
        } else if (field === "priority") {
          for (const priority of options.priorities)
            add(priority.id, priority.name);
        } else {
          add("", "미지정");
          for (const user of options.users) add(user.id, user.name);
        }
        holder.replaceChildren(select);
        control = select;
        hint.textContent =
          "모든 선택 이슈에서 가능한 값만 표시해요. 적용 결과는 이슈마다 다를 수 있어요.";
        if (!select.options.length) {
          holder.textContent = "공통으로 변경 가능한 값이 없습니다.";
          return;
        }
        menu = enhanceSelect(select, {
          renderOption: (option) =>
            field === "status"
              ? statusPill(option.textContent ?? "", config.order())
              : field === "priority"
                ? priorityPill(
                    {
                      priority: option.textContent ?? "",
                      priorityIcon:
                        options.priorities.find(
                          (priority) => priority.id === option.value,
                        )?.icon ?? "",
                    },
                    true,
                  )
                : personPill({
                    name: option.textContent ?? "",
                    avatar:
                      options.users.find((user) => user.id === option.value)
                        ?.avatar ?? "",
                  }),
        });
      } else {
        control = element("input");
        control.type = field === "dueDate" ? "date" : "text";
        control.setAttribute("aria-label", label);
        if (field === "parent") {
          control.placeholder = "상위 이슈 키 · 예: PROJ-123";
          hint.textContent =
            "같은 프로젝트의 바로 상위 단계 이슈를 지정해요. 빈 값은 부모 연결을 해제합니다.";
        } else hint.textContent = "빈 값은 선택한 이슈의 마감일을 해제합니다.";
        holder.append(control);
      }
      save.disabled = false;
      save.addEventListener("click", async () => {
        if (busy || version !== revision) return;
        busy = true;
        save.disabled = cancel.disabled = true;
        control.disabled = true;
        panel.setAttribute("aria-busy", "true");
        sync();
        try {
          const data = await config.api.bulkUpdate(
            [...selected],
            field,
            control.value.trim(),
          );
          if (!alive) return;
          closeEditor();
          await finished(data);
        } catch (reason) {
          if (alive)
            hint.textContent =
              reason instanceof Error ? reason.message : "변경하지 못했어요.";
        } finally {
          busy = false;
          if (alive) {
            save.disabled = cancel.disabled = control.disabled = false;
            panel.setAttribute("aria-busy", "false");
            sync();
          }
        }
      });
    } catch (reason) {
      if (alive && version === revision)
        holder.textContent =
          reason instanceof Error
            ? reason.message
            : "선택지를 불러오지 못했어요.";
    }
  }
  for (const [field, label, icon] of [
    ["parent", "부모 변경", "layers"],
    ["status", "상태 변경", "list-filter"],
    ["assignee", "담당자 변경", "user"],
    ["dueDate", "마감일 변경", "calendar"],
    ["priority", "우선순위 변경", "flag"],
  ] as const) {
    const button = actionButton(label, icon);
    button.title = label;
    button.addEventListener("click", () => {
      void open(field, label, button);
    });
    actions.append(button);
  }
  const copy = actionButton("링크 복사", "copy");
  copy.title = "선택한 이슈 링크 복사";
  copy.addEventListener("click", async () => {
    await copyText(
      [...selected]
        .map((key) => `https://${config.site}/browse/${key}`)
        .join("\n"),
      config.notice,
      `${selected.size}개 이슈 링크를 복사했어요.`,
    );
  });
  actions.append(copy);
  exit.addEventListener("click", () => {
    reset();
    active = false;
    sync();
    config.render();
  });
  config.toggle.addEventListener("click", () => {
    reset();
    active = !active;
    sync();
    config.render();
  });
  undoButton.addEventListener("click", () => {
    void undo();
  });
  sync();
  return {
    reset,
    decorate(issue: Issue, card: HTMLElement): HTMLElement {
      if (!active) return card;
      const wrapper = element("div", "bulk-card"),
        check = element("input");
      check.type = "checkbox";
      check.dataset.selectKey = issue.key;
      check.setAttribute("aria-label", `${issue.key} 선택`);
      check.checked = selected.has(issue.key);
      check.disabled = busy;
      check.addEventListener("change", () => choose(issue.key, check.checked));
      card.addEventListener(
        "click",
        (event) => {
          if (
            event.target instanceof Element &&
            event.target.closest(".card-copy")
          )
            return;
          event.preventDefault();
          event.stopImmediatePropagation();
          choose(issue.key, !selected.has(issue.key));
        },
        { capture: true },
      );
      wrapper.append(check, card);
      return wrapper;
    },
    get active() {
      return active;
    },
    get busy() {
      return busy;
    },
    destroy() {
      alive = false;
      closeEditor();
      bar.remove();
      panel.remove();
    },
  };
}
