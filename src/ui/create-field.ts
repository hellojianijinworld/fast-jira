import type { Api } from "../client/api.ts";
import {
  decodeAdfDocument,
  type JsonValue,
  textDocument,
} from "../domain/adf.ts";
import type { CreateField } from "../domain/create-issue.ts";
import type { UserOption } from "../domain/issue.ts";
import type { ParticipantRecents } from "../domain/participants.ts";
import { uniqueParticipants } from "../domain/participants.ts";
import { isRecord } from "../domain/validation.ts";
import { adfEditor } from "./adf-editor.ts";
import { actionButton, element, elementId, iconButton } from "./dom.ts";
import { personPill } from "./meta.ts";
import { enhanceSelect } from "./select-menu.ts";

export function creationField(
  field: CreateField,
  initial: JsonValue | undefined,
  config: {
    api: Api;
    project: string;
    type: string;
    site: string;
    me: UserOption;
    recents?: ParticipantRecents;
    onChange?: () => void;
  },
) {
  const labels: Record<string, string> = {
    summary: "제목",
    description: "설명",
    duedate: "마감일",
    priority: "우선순위",
  };
  const name = labels[field.id] ?? field.name;
  const root = element("div", "create-field"),
    label = element(
      "label",
      "field-label",
      name + (field.required ? " *" : ""),
    );
  root.dataset.field = field.id;
  root.append(label);
  let read: () => JsonValue | undefined = () => initial,
    destroy = () => {},
    editable: HTMLElement | undefined;
  let supported = true;
  let people: () => UserOption[] = () => [];
  const identify = (control: HTMLElement) => {
    control.id = elementId("create-field");
    label.htmlFor = control.id;
    control.setAttribute("aria-label", name);
    root.append(control);
  };
  if (field.type === "user" || field.items === "user") {
    const multi = field.type === "array",
      chips = element("div", "participant-people"),
      select = element("select");
    let users: UserOption[] = [],
      alive = true;
    const raw = Array.isArray(initial) ? initial : initial ? [initial] : [];
    let selected = raw.flatMap((item) =>
      isRecord(item) && typeof item.accountId === "string"
        ? [
            {
              id: item.accountId,
              name:
                typeof item.displayName === "string"
                  ? item.displayName
                  : item.accountId,
              avatar: "",
            },
          ]
        : [],
    );
    people = () => selected;
    const prompt = new Option("참여자 선택", "");
    root.append(chips);
    identify(select);
    select.append(prompt);
    const menu = enhanceSelect(select, {
      focusSearch: false,
      renderOption: (option) => {
        const user = users.find((user) => user.id === option.value);
        return user
          ? personPill(user)
          : document.createTextNode(option.textContent ?? "");
      },
      beforeOpen: async () => {
        const fetched = await config.api.creationUsers(
          config.project,
          config.type,
          field.id,
        );
        if (!alive) return false;
        users = uniqueParticipants([
          ...(config.recents?.recent() ?? []),
          config.me,
          ...fetched,
        ]).filter((user) => fetched.some((item) => item.id === user.id));
        render();
        return true;
      },
    });
    function choose(user: UserOption) {
      selected = multi ? uniqueParticipants([...selected, user]) : [user];
      config.recents?.remember(user);
      render();
    }
    function render() {
      chips.replaceChildren();
      for (const user of selected) {
        const chip = personPill(user);
        chip.classList.add("participant-chip");
        const remove = iconButton(`${user.name} 해제`, "x", { size: "sm" });
        remove.addEventListener("click", () => {
          selected = selected.filter((item) => item.id !== user.id);
          render();
        });
        chip.append(remove);
        chips.append(chip);
      }
      select.replaceChildren(
        prompt,
        ...users
          .filter((user) => !selected.some((item) => item.id === user.id))
          .map((user) => new Option(user.name, user.id)),
      );
      select.value = "";
      menu.sync();
      config.onChange?.();
    }
    const self = actionButton("나에게 할당", "user", { size: "sm" });
    self.addEventListener("click", async () => {
      self.disabled = true;
      try {
        const candidates = await config.api.creationUsers(
          config.project,
          config.type,
          field.id,
        );
        if (alive && candidates.some((user) => user.id === config.me.id))
          choose(config.me);
      } catch (reason) {
        if (alive) {
          error.textContent =
            reason instanceof Error
              ? reason.message
              : "참여자를 불러오지 못했습니다.";
        }
      } finally {
        if (alive) self.disabled = false;
      }
    });
    const error = element("small", "error");
    error.setAttribute("role", "alert");
    root.append(self, error);
    select.addEventListener("change", () => {
      const user = users.find((user) => user.id === select.value);
      if (user) choose(user);
    });
    render();
    read = () =>
      multi
        ? selected.map((user) => ({ accountId: user.id }))
        : selected[0]
          ? { accountId: selected[0].id }
          : undefined;
    destroy = () => {
      alive = false;
      menu.destroy();
    };
  } else if (field.id === "description" || field.type === "textarea") {
    const editor = adfEditor(
      initial
        ? typeof initial === "string"
          ? textDocument(initial)
          : decodeAdfDocument(initial)
        : null,
      { url: `https://${config.site}`, key: "" },
      false,
    );
    identify(editor.element);
    editable = editor.element;
    read = () =>
      editor.element.textContent?.trim()
        ? (editor.document() as unknown as JsonValue)
        : undefined;
  } else if (field.allowed.length) {
    const select = element("select");
    select.multiple = field.type === "array";
    select.append(
      new Option("선택 안 함", ""),
      ...field.allowed.map((item) => new Option(item.name, item.id)),
    );
    const valueId = (value: JsonValue | undefined) =>
      isRecord(value)
        ? String(value.id ?? value.value ?? "")
        : String(value ?? "");
    const selected = (Array.isArray(initial) ? initial : [initial]).map(
      valueId,
    );
    for (const option of select.options)
      option.selected = selected.includes(option.value);
    identify(select);
    // 다중 선택은 각 선택 상태를 보존하는 기본 컨트롤을 사용한다.
    const menu = select.multiple ? undefined : enhanceSelect(select);
    read = () => {
      const values = [...select.selectedOptions]
        .filter((option) => option.value)
        .map((option) => ({ id: option.value }));
      return select.multiple ? values : values[0];
    };
    destroy = () => menu?.destroy();
  } else if (
    ["string", "number", "date", "datetime", "boolean", "array"].includes(
      field.type,
    ) &&
    (field.type !== "array" || field.items === "string")
  ) {
    const control = element("input");
    control.type =
      field.type === "number"
        ? "number"
        : field.type === "date"
          ? "date"
          : field.type === "datetime"
            ? "datetime-local"
            : field.type === "boolean"
              ? "checkbox"
              : "text";
    if (field.id === "summary") control.maxLength = 255;
    if (field.type === "boolean") control.checked = initial === true;
    else
      control.value =
        field.type === "datetime" &&
        typeof initial === "string" &&
        Number.isFinite(Date.parse(initial))
          ? new Date(
              Date.parse(initial) -
                new Date(initial).getTimezoneOffset() * 60000,
            )
              .toISOString()
              .slice(0, 16)
          : Array.isArray(initial)
            ? initial.join(", ")
            : initial == null
              ? ""
              : String(initial);
    if (field.type === "array") control.placeholder = "쉼표로 구분";
    identify(control);
    read = () =>
      field.type === "boolean"
        ? control.checked
        : !control.value
          ? undefined
          : field.type === "number"
            ? Number(control.value)
            : field.type === "datetime"
              ? new Date(control.value).toISOString()
              : field.type === "array"
                ? control.value
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean)
                : control.value;
  } else {
    supported = false;
    if (initial !== undefined)
      root.append(
        element(
          "pre",
          "create-unsupported-value",
          JSON.stringify(initial, null, 2),
        ),
      );
    root.append(
      element("small", "muted", "이 필드는 Jira에서 입력해야 합니다."),
    );
  }
  return {
    people,
    id: field.id,
    required: field.required,
    element: root,
    read,
    destroy,
    supported,
    editable,
  };
}
