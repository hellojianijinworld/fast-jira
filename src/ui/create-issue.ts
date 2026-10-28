import "./create-issue.css";
import { type Api, subscribeVoice } from "../client/api.ts";
import {
  createCodexVoice,
  type VoiceCallbacks,
  type VoiceInput,
} from "../client/codex-voice.ts";
import { createConversationStore } from "../client/conversation-store.ts";
import type { LocalStore } from "../client/preferences.ts";
import type { JsonValue } from "../domain/adf.ts";
import type { ProjectOption } from "../domain/catalog.ts";
import type { CreateMetadata, IssueDraft } from "../domain/create-issue.ts";
import type { Issue, IssueType, UserOption } from "../domain/issue.ts";
import type { ParticipantRecents } from "../domain/participants.ts";
import { participantUsers } from "../domain/participants.ts";
import { creationField } from "./create-field.ts";
import {
  actionButton,
  element,
  elementId,
  externalLink,
  iconButton,
  uiIcon,
} from "./dom.ts";
import { showModal } from "./modal.ts";
import { participantAvatars } from "./participant-avatars.ts";
import { enhanceSelect, type SelectMenu } from "./select-menu.ts";

export interface CreationContext {
  project?: string;
  parent?: Issue;
  draft?: IssueDraft;
}
export function createIssueDialog(config: {
  host: HTMLElement;
  api: Api;
  projects: () => readonly ProjectOption[];
  site: string;
  me: UserOption;
  recents?: ParticipantRecents;
  storage?: LocalStore;
  scope?: string;
  created(key: string): Promise<void>;
  notice(message: string): void;
  voice?: (callbacks: VoiceCallbacks) => VoiceInput;
}) {
  const dialog = element("dialog", "settings-modal create-issue-dialog");
  config.host.append(dialog);
  let cleanup = () => {},
    alive = true,
    saving = false;
  dialog.addEventListener("cancel", (event) => {
    if (saving) event.preventDefault();
  });
  dialog.addEventListener("close", () => {
    if (!dialog.open) cleanup();
  });
  async function open(context: CreationContext = {}) {
    if (!alive || saving) return;
    cleanup();
    let disposed = false,
      revision = 0,
      pending = false;
    let fields: ReturnType<typeof creationField>[] = [],
      meta: CreateMetadata | undefined;
    let projectTypes: IssueType[] = [],
      parent = context.parent?.key ?? context.draft?.parent ?? "";
    const form = element("form", "create-issue-form"),
      body = element("div", "create-issue-body");
    const inputs = element("fieldset"),
      contextRow = element("div", "create-context"),
      fieldHost = element("div", "create-fields");
    const error = element("p", "error");
    error.setAttribute("role", "alert");
    const project = element("select"),
      type = element("select"),
      parentSelect = element("select");
    const cancel = actionButton("취소", "x"),
      save = actionButton("생성", "plus", "primary");
    save.type = "submit";
    save.disabled = true;
    const field = (label: string, control: HTMLElement) => {
      const wrapper = element("div", "create-field"),
        name = element("label", "field-label", label);
      control.id = elementId("create");
      name.htmlFor = control.id;
      control.setAttribute("aria-label", label);
      wrapper.append(name, control);
      return wrapper;
    };
    project.append(
      new Option("프로젝트 선택", ""),
      ...config.projects().map((item) => new Option(item.name, item.key)),
    );
    project.value =
      context.project ??
      context.parent?.project ??
      context.draft?.project ??
      "";
    contextRow.append(field("프로젝트", project), field("유형", type));
    const parentField = field("상위 이슈", parentSelect);
    const parentError = element("small", "error");
    parentField.append(parentError);
    let parentMenu: SelectMenu | undefined,
      projectMenu: SelectMenu | undefined,
      typeMenu: SelectMenu | undefined;
    const ai = element("section", "create-ai"),
      prompt = element("textarea"),
      aiControls = element("div", "create-ai-controls");
    prompt.placeholder = "만들 작업을 설명하거나 관련 링크를 붙여 넣으세요";
    prompt.setAttribute("aria-label", "AI 생성 요청");
    prompt.maxLength = 8000;
    const model = element("select"),
      mic = iconButton("생성 요청 음성 입력", "mic"),
      fill = actionButton("AI로 채우기", "sparkles", { size: "sm" });
    const modelStore =
      config.storage && config.scope
        ? createConversationStore(config.storage, config.scope)
        : undefined;
    model.addEventListener("change", () => {
      try {
        modelStore?.setDefaultModel(model.value);
      } catch (reason) {
        aiStatus.textContent =
          reason instanceof Error
            ? reason.message
            : "모델 설정을 저장하지 못했어요.";
      }
    });
    model.setAttribute("aria-label", "생성 AI 모델");
    fill.disabled = mic.disabled = true;
    const aiStatus = element("small", "muted");
    aiStatus.setAttribute("role", "status");
    ai.append(prompt, aiControls, aiStatus);
    aiControls.append(model, mic, fill);
    inputs.append(contextRow, parentField, fieldHost);
    body.append(ai, inputs, error);
    const footer = element("footer", "modal-footer");
    footer.append(cancel, save);
    form.append(body, footer);
    let request: AbortController | undefined,
      voicePrefix = "",
      recording = false;
    const voiceCallbacks: VoiceCallbacks = {
      transcript: (text) => {
        if (!disposed)
          prompt.value = [voicePrefix, text].filter(Boolean).join("\n");
      },
      state: (active, message) => {
        recording = active;
        mic.classList.toggle("active", active);
        mic.setAttribute("aria-pressed", String(active));
        aiStatus.textContent = message;
        fill.disabled = active || pending || !model.value;
      },
    };
    const voice =
      config.voice?.(voiceCallbacks) ??
      createCodexVoice({
        ...voiceCallbacks,
        api: config.api,
        subscribe: subscribeVoice,
      });
    function values(): IssueDraft {
      return {
        project: project.value,
        type: type.value,
        parent,
        fields: Object.fromEntries(
          fields.flatMap((control) => {
            const value = control.read();
            return value !== undefined ? [[control.id, value]] : [];
          }),
        ),
      };
    }
    function lock(value: boolean) {
      pending = value;
      inputs.disabled = value;
      save.disabled =
        value ||
        !meta ||
        fields.some(
          (control) =>
            !control.supported &&
            control.required &&
            control.read() === undefined,
        );
      for (const control of fields)
        if (control.editable) control.editable.contentEditable = String(!value);
      fill.disabled = value || recording || !model.value;
      prompt.disabled = model.disabled = value;
      mic.disabled = value || !codexReady;
      cancel.disabled = saving;
      dialog
        .querySelector<HTMLButtonElement>(".dialog-head button")
        ?.toggleAttribute("disabled", saving);
    }
    let codexReady = false;
    function renderFields(initial: Record<string, JsonValue>) {
      for (const control of fields) control.destroy();
      const participantGroup = element("details", "create-participants");
      const participantSummary = element("summary"),
        peoplePreview = element("span", "participant-people");
      participantSummary.append(
        uiIcon("users"),
        element("span", "", "작업참여자"),
        peoplePreview,
      );
      const participantFields = element("div", "create-fields");
      participantGroup.append(participantSummary, participantFields);
      function renderPeople() {
        if (disposed) return;
        const participantFields = fields
          .filter((control) => control.id !== "reporter")
          .map((control) => {
            const field = meta?.fields.find((field) => field.id === control.id);
            return {
              id: control.id,
              name: field?.name ?? control.id,
              multiple: field?.type === "array",
              users: control.people(),
            };
          });
        const users = participantUsers(participantFields, config.me.id);
        peoplePreview.replaceChildren(
          users.length
            ? participantAvatars(participantFields, config.me.id)
            : document.createTextNode("미지정"),
        );
      }
      fields = (meta?.fields ?? [])
        .filter((item) => item.id !== "reporter" || item.required)
        .map((item) => {
          const control = creationField(
            item,
            item.id === "reporter"
              ? (item.defaultValue ?? {
                  accountId: config.me.id,
                  displayName: config.me.name,
                })
              : (initial[item.id] ?? item.defaultValue),
            {
              api: config.api,
              project: project.value,
              type: type.value,
              site: config.site,
              me: config.me,
              ...(config.recents ? { recents: config.recents } : {}),
              onChange: () => queueMicrotask(renderPeople),
            },
          );
          control.element.hidden = item.id === "reporter";
          return control;
        });
      const additional = element("details", "create-additional");
      additional.append(element("summary", "", "추가 항목"));
      const additionalFields = element("div", "create-fields");
      additional.append(additionalFields);
      fieldHost.replaceChildren();
      const rank = (id: string) =>
        id === "summary" ? -2 : id === "description" ? -1 : 0;
      for (const control of [...fields].sort(
        (a, b) => rank(a.id) - rank(b.id),
      )) {
        const person =
          control.id !== "reporter" &&
          meta?.fields.some(
            (item) =>
              item.id === control.id &&
              (item.type === "user" || item.items === "user"),
          );
        const basic =
          control.required ||
          ["summary", "description", "priority", "duedate"].includes(
            control.id,
          );
        (person
          ? participantFields
          : basic
            ? fieldHost
            : additionalFields
        ).append(control.element);
      }
      if (participantFields.children.length) fieldHost.append(participantGroup);
      if (additionalFields.children.length) fieldHost.append(additional);
      renderPeople();
      if (fields.some((control) => !control.supported))
        fieldHost.append(
          externalLink(
            `https://${config.site}/secure/CreateIssue!default.jspa`,
            "Jira에서 생성",
            "inline-link",
          ),
        );
    }
    async function loadParents(query = "", append = false) {
      const searchVersion = ++parentSearch;
      const version = revision,
        currentProject = project.value,
        currentType = type.value;
      const page = await config.api.creationParents(
        currentProject,
        currentType,
        query,
        append ? (nextToken ?? "") : "",
      );
      if (
        disposed ||
        searchVersion !== parentSearch ||
        version !== revision ||
        project.value !== currentProject ||
        type.value !== currentType
      )
        return;
      if (!append)
        parentSelect.replaceChildren(new Option("상위 연결 없음", ""));
      for (const issue of page.issues)
        if (
          ![...parentSelect.options].some(
            (option) => option.value === issue.key,
          )
        )
          parentSelect.append(
            new Option(`${issue.key} · ${issue.summary}`, issue.key),
          );
      if (
        parent &&
        ![...parentSelect.options].some((option) => option.value === parent)
      )
        parentSelect.append(
          new Option(
            context.parent?.key === parent
              ? `${parent} · ${context.parent.summary}`
              : parent,
            parent,
          ),
        );
      parentSelect.value = parent;
      parentMenu?.sync();
      nextToken = page.nextPageToken;
      more.hidden = !nextToken;
    }
    let nextToken: string | null = null,
      parentQuery = "",
      parentSearch = 0;
    const more = actionButton("후보 더 보기", "chevron-right", { size: "sm" });
    more.hidden = true;
    async function loadFields(initial: Record<string, JsonValue> = {}) {
      const version = ++revision;
      meta = undefined;
      error.textContent = "";
      lock(true);
      parentMenu?.destroy();
      parentMenu = undefined;
      parentSelect.replaceChildren(
        new Option(parent || "상위 연결 없음", parent),
      );
      try {
        const loaded = await config.api.creationMetadata(
          project.value,
          type.value,
        );
        if (disposed || version !== revision) return;
        meta = loaded;
        renderFields(initial);
        parentMenu = enhanceSelect(parentSelect, {
          searchLabel: "상위 이슈 키·제목 검색",
          onSearch: async (query) => {
            parentQuery = query;
            await loadParents(query);
            parentMenu?.sync();
          },
          beforeOpen: async () => {
            await loadParents();
            return true;
          },
        });
        parentMenu.panel.append(more);
        parentField.hidden = meta.level === null;
        await loadParents();
      } catch (reason) {
        if (!disposed && version === revision)
          error.textContent = message(reason);
      } finally {
        if (!disposed && version === revision) lock(false);
      }
    }
    async function loadTypes(
      draft?: IssueDraft,
      sharedFields?: Record<string, JsonValue>,
    ) {
      const version = ++revision;
      meta = undefined;
      lock(true);
      type.replaceChildren();
      type.disabled = false;
      typeMenu?.sync();
      try {
        const all = await config.api.creationTypes(project.value);
        if (disposed || version !== revision) return;
        const parentLevel =
          context.parent?.project === project.value &&
          context.parent.key === parent
            ? (context.parent.hierarchyLevel ??
              all.find((item) => item.id === context.parent?.issueTypeId)
                ?.hierarchyLevel)
            : undefined;
        projectTypes = all.filter(
          (item) =>
            parentLevel == null || item.hierarchyLevel === parentLevel - 1,
        );
        type.replaceChildren(
          ...projectTypes.map((item) => new Option(item.name, item.id)),
        );
        type.value =
          draft?.type ??
          projectTypes.find((item) => item.hierarchyLevel === 0)?.id ??
          projectTypes[0]?.id ??
          "";
        typeMenu?.sync();
        if (!type.value) {
          error.textContent = "이 위치에서 생성 가능한 유형이 없습니다.";
          lock(false);
          return;
        }
        await loadFields(draft?.fields ?? sharedFields);
      } catch (reason) {
        if (!disposed && version === revision) {
          error.textContent = message(reason);
          lock(false);
        }
      }
    }
    function message(reason: unknown) {
      return reason instanceof Error
        ? reason.message
        : "요청을 완료하지 못했어요.";
    }
    projectMenu = enhanceSelect(project);
    typeMenu = enhanceSelect(type);
    project.addEventListener("change", () => {
      const previous = values();
      parent = "";
      const shared = Object.fromEntries(
        Object.entries(previous.fields).filter(
          ([id]) => id === "summary" || id === "description",
        ),
      );
      if (project.value) void loadTypes(undefined, shared);
      else {
        revision++;
        meta = undefined;
        fieldHost.replaceChildren();
        lock(false);
      }
    });
    type.addEventListener("change", () => {
      const previous = values();
      if (!context.parent) parent = "";
      void loadFields({
        ...(previous.fields.summary === undefined
          ? {}
          : { summary: previous.fields.summary }),
        ...(previous.fields.description === undefined
          ? {}
          : { description: previous.fields.description }),
      });
    });
    parentSelect.addEventListener("change", () => {
      parent = parentSelect.value;
    });
    more.addEventListener("click", async () => {
      more.disabled = true;
      try {
        await loadParents(parentQuery, true);
      } catch (reason) {
        parentError.textContent = message(reason);
      } finally {
        more.disabled = false;
      }
    });
    mic.addEventListener("click", () => {
      if (!recording) voicePrefix = prompt.value.trimEnd();
      voice.start();
    });
    fill.addEventListener("click", async () => {
      if (!prompt.value.trim() || pending || recording) return;
      voice.stop();
      request = new AbortController();
      const controller = request;
      lock(true);
      aiStatus.textContent = "생성 내용을 준비하고 있어요…";
      try {
        const reply = await config.api.assistantRun(
          `다음 요청으로 이슈 생성 폼을 채우세요. Jira에는 저장하지 말고 jira_prepare_issue 도구로 생성안 하나를 반환하세요. 현재 폼은 참고 데이터입니다. 요청에 없는 필드 변경은 하지 말고 기존 값을 유지하세요. URL은 설명에 보존하세요.\\n${prompt.value}`,
          {
            projects: project.value ? [project.value] : [],
            issue: parent,
            keys: [],
            ...(project.value && type.value ? { creation: values() } : {}),
          },
          "",
          model.value,
          controller.signal,
        );
        if (disposed || controller.signal.aborted) return;
        const draft = reply.creations?.[0];
        if (!draft) {
          aiStatus.textContent =
            reply.answer ||
            "프로젝트와 작업 내용을 좀 더 구체적으로 알려주세요.";
          return;
        }
        if (
          ![...project.options].some((option) => option.value === draft.project)
        )
          throw new Error("이 프로젝트에 접근할 수 없습니다.");
        project.value = draft.project;
        projectMenu?.sync();
        parent = draft.parent;
        await loadTypes(draft);
        aiStatus.textContent = "입력 내용을 확인한 뒤 생성하세요.";
      } catch (reason) {
        if (!disposed && !controller.signal.aborted)
          aiStatus.textContent = message(reason);
      } finally {
        if (!disposed) lock(false);
        request = undefined;
      }
    });
    cancel.addEventListener("click", () => {
      if (!saving) dialog.close();
    });
    const requestId = `${Date.now().toString(36)}_${elementId("create")}`;
    form.addEventListener("submit", async (event) => {
      if (event.target !== form) return;
      event.preventDefault();
      if (event.submitter !== save) return;
      if (pending || !meta || disposed || save.disabled) return;
      const draft = values();
      saving = true;
      lock(true);
      save.setAttribute("aria-busy", "true");
      error.textContent = "";
      try {
        const result = await config.api.createIssue(draft, requestId);
        saving = false;
        dialog.close();
        config.notice(`${result.key} 이슈를 생성했습니다.`);
        try {
          await config.created(result.key);
        } catch {
          config.notice(
            `${result.key} 생성은 완료됐지만 목록을 갱신하지 못했습니다. 이슈 검색으로 확인할 수 있습니다.`,
          );
        }
      } catch (reason) {
        if (!disposed) error.textContent = message(reason);
      } finally {
        saving = false;
        if (!disposed) {
          lock(false);
          save.removeAttribute("aria-busy");
        }
      }
    });
    cleanup = () => {
      disposed = true;
      revision++;
      request?.abort();
      voice.destroy();
      for (const field of fields) field.destroy();
      projectMenu?.destroy();
      typeMenu?.destroy();
      parentMenu?.destroy();
    };
    showModal(dialog, {
      title: context.parent ? "하위 이슈 생성" : "이슈 생성",
      content: form,
    });
    void config.api
      .assistantStatus()
      .then((status) => {
        if (disposed) return;
        const defaultModel =
          config.storage && config.scope
            ? createConversationStore(
                config.storage,
                config.scope,
              ).defaultModel()
            : "";
        model.replaceChildren(
          ...status.models.map((item) => new Option(item.name, item.id)),
        );
        model.value =
          status.models.find((item) => item.id === defaultModel)?.id ??
          status.models.find((item) => item.isDefault)?.id ??
          status.models[0]?.id ??
          "";
        codexReady =
          status.providers?.find((item) => item.id === "codex")?.ready ??
          (status.ready &&
            status.models.some((item) => !item.id.startsWith("claude:")));
        mic.title = codexReady
          ? "생성 요청 음성 입력"
          : "음성 입력에는 Codex 로그인이 필요합니다";
        if (!status.ready)
          aiStatus.textContent =
            "AI 로그인 후 자동 입력을 사용할 수 있습니다. 직접 입력해 생성할 수도 있습니다.";
        lock(pending);
      })
      .catch((reason) => {
        if (!disposed) aiStatus.textContent = message(reason);
      });
    if (project.value) await loadTypes(context.draft);
    else {
      type.disabled = true;
      parentField.hidden = true;
    }
    if (!disposed)
      (
        fieldHost.querySelector<HTMLElement>('[data-field="summary"] input') ??
        prompt
      ).focus();
  }
  return {
    open,
    destroy() {
      alive = false;
      cleanup();
      dialog.remove();
    },
  };
}
