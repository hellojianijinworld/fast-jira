import type { Api } from "../client/api.ts";
import type { IssueDetails } from "../domain/details.ts";
import type { UserOption } from "../domain/issue.ts";
import {
  issueParticipantFields,
  type ParticipantChange,
  type ParticipantRecents,
  participantUsers,
  rememberParticipant,
  uniqueParticipants,
} from "../domain/participants.ts";
import { actionButton, element, iconButton } from "./dom.ts";
import { personPill } from "./meta.ts";
import { showModal } from "./modal.ts";
import { participantAvatars } from "./participant-avatars.ts";
import { enhanceSelect, type SelectMenu } from "./select-menu.ts";

/** 평소에는 사람만 합쳐 표시하고, 지정 중에만 Jira의 실제 필드를 구분한다. */
export function participantsField(
  api: Pick<
    Api,
    "participantOptions" | "participantUsers" | "updateParticipants"
  >,
  issue: IssueDetails,
  config: {
    me?: UserOption;
    recents?: ParticipantRecents;
    hold(): () => void;
    busy(value: boolean): void;
    saved(issue: IssueDetails): Promise<void>;
    notice(message: string): void;
  },
) {
  const root = element("div", "detail-field participant-field");
  const trigger = actionButton("", "users", "ghost");
  trigger.classList.add("participant-summary");
  trigger.setAttribute("aria-label", "작업참여자 변경");
  trigger.setAttribute("aria-haspopup", "dialog");
  const summary = element("span", "participant-people");
  trigger.lastElementChild?.remove();
  trigger.append(summary);
  const dialog = element("dialog", "settings-modal participant-dialog");
  root.append(element("small", "field-label", "작업참여자"), trigger, dialog);
  let fields = issueParticipantFields(issue),
    alive = true,
    saving = false,
    revision = 0;
  let release: (() => void) | undefined;
  let menus: SelectMenu[] = [];
  let recentChoices: UserOption[] = [];
  const recents = config.recents ?? {
    recent: () => recentChoices,
    remember: (user: UserOption) => {
      recentChoices = rememberParticipant(recentChoices, user);
    },
  };
  const errorMessage = (reason: unknown) =>
    reason instanceof Error ? reason.message : "다시 시도해 주세요.";
  function clearMenus() {
    for (const menu of menus) menu.destroy();
    menus = [];
  }
  function renderSummary() {
    const users = participantUsers(fields, config.me?.id);
    summary.replaceChildren(
      users.length
        ? participantAvatars(users, config.me?.id)
        : document.createTextNode("미지정"),
    );
  }
  function finish() {
    revision++;
    clearMenus();
    release?.();
    release = undefined;
  }
  dialog.addEventListener("cancel", (event) => {
    if (saving) event.preventDefault();
  });
  dialog.addEventListener("close", () => {
    if (!saving && !dialog.open) finish();
  });
  trigger.addEventListener("click", async () => {
    if (trigger.disabled || release) return;
    release = config.hold();
    const version = ++revision;
    const form = element("form", "participant-form");
    const content = element("div", "participant-edit-fields");
    const error = element("p", "error");
    error.setAttribute("role", "alert");
    const save = actionButton("저장", "check", "primary");
    save.type = "submit";
    save.disabled = true;
    const cancel = actionButton("취소", "x");
    cancel.addEventListener("click", () => dialog.close());
    const footer = element("footer", "modal-footer");
    footer.append(cancel, save);
    form.append(content, error, footer);
    content.setAttribute("aria-busy", "true");
    content.append(element("p", "muted", "지정할 수 있는 필드를 불러오는 중…"));
    showModal(dialog, { title: "작업참여자 지정", content: form });
    try {
      const options = await api.participantOptions(issue.key);
      if (!alive || !dialog.open || version !== revision || saving) return;
      content.replaceChildren();
      const drafts = new Map<string, UserOption[]>();
      const knownPeople = participantUsers(fields);
      const self =
        knownPeople.find((user) => user.id === config.me?.id) ?? config.me;
      for (const field of options) {
        const original =
          fields.find((value) => value.id === field.id)?.users ?? [];
        drafts.set(field.id, [...original]);
        const row = element("div", "detail-field participant-edit-row");
        const head = element("div", "participant-field-head");
        head.append(
          element(
            "small",
            "field-label",
            field.name + (field.required ? " *" : ""),
          ),
        );
        const selected = element("div", "participant-people");
        const select = element("select");
        select.setAttribute("aria-label", `${field.name} 지정`);
        row.append(head, selected, select);
        content.append(row);
        let candidates: UserOption[] = [];
        let defaults: UserOption[] | undefined;
        let defaultLoading = false;
        let candidateRevision = 0;
        const seeds = () =>
          uniqueParticipants([
            ...recents.recent(),
            ...knownPeople,
            ...(self ? [self] : []),
          ]);
        function choose(user: UserOption) {
          drafts.set(
            field.id,
            field.multiple
              ? [
                  ...(drafts.get(field.id) ?? []).filter(
                    (value) => value.id !== user.id,
                  ),
                  user,
                ]
              : [user],
          );
          recents.remember(user);
          renderSelected();
        }
        function renderSelected() {
          selected.replaceChildren();
          for (const user of drafts.get(field.id) ?? []) {
            const chip = personPill(user);
            chip.classList.add("participant-chip");
            const remove = iconButton(`${field.name} ${user.name} 해제`, "x", {
              size: "sm",
            });
            remove.addEventListener("click", () => {
              drafts.set(
                field.id,
                (drafts.get(field.id) ?? []).filter(
                  (value) => value.id !== user.id,
                ),
              );
              renderSelected();
            });
            chip.append(remove);
            selected.append(chip);
          }
          showCandidates(candidates);
        }
        const prompt = new Option(
          field.multiple ? "참여자 추가" : "참여자 선택",
          "",
        );
        prompt.hidden = true;
        select.append(prompt);
        const menu = enhanceSelect(select, {
          searchLabel: "이름으로 검색",
          renderOption: (option) =>
            !option.value
              ? document.createTextNode(option.textContent ?? "")
              : personPill(
                  candidates.find((user) => user.id === option.value) ?? {
                    name: option.textContent ?? "",
                    avatar: "",
                  },
                ),
          focusSearch: false,
          beforeOpen: async () => {
            showCandidates([...seeds(), ...(defaults ?? [])]);
            if (!defaults && !defaultLoading) {
              defaultLoading = true;
              void loadCandidates("")
                .catch((reason) => {
                  if (alive && dialog.open && version === revision && !saving)
                    error.textContent = `추가 후보 조회 실패: ${errorMessage(reason)}`;
                })
                .finally(() => {
                  defaultLoading = false;
                });
            }
            return true;
          },
          onSearch: loadCandidates,
        });
        function showCandidates(users: readonly UserOption[]) {
          candidates = uniqueParticipants(users);
          select.replaceChildren(
            prompt,
            ...candidates
              .filter(
                (user) =>
                  !drafts
                    .get(field.id)
                    ?.some((selected) => selected.id === user.id),
              )
              .map((user) => new Option(user.name, user.id)),
          );
          select.value = "";
          menu.sync();
        }
        async function loadCandidates(query: string) {
          const request = ++candidateRevision;
          const users = await api.participantUsers(issue.key, field.id, query);
          if (
            !alive ||
            !dialog.open ||
            version !== revision ||
            saving ||
            request !== candidateRevision
          )
            return;
          if (!query) defaults = users;
          showCandidates(query ? users : [...seeds(), ...users]);
        }
        menu.panel.classList.add("participant-options");
        menus.push(menu);
        select.addEventListener("change", () => {
          if (saving) return;
          const user = candidates.find((user) => user.id === select.value);
          if (user) choose(user);
          select.value = "";
          menu.sync();
        });
        if (self) {
          const assign = actionButton("나에게 할당", "user", {
            size: "sm",
            variant: "ghost",
          });
          assign.addEventListener("click", () => {
            if (!saving) {
              choose(self);
            }
          });
          head.append(assign);
        }
        renderSelected();
      }
      if (!options.length)
        content.append(
          element("p", "muted", "변경할 수 있는 작업참여자 필드가 없습니다."),
        );
      save.disabled = !options.length;
      form.addEventListener("submit", async (event) => {
        if (event.target !== form) return;
        event.preventDefault();
        if (saving) return;
        const changes: ParticipantChange[] = [];
        for (const field of options) {
          const users = drafts.get(field.id) ?? [];
          if (
            (field.required && !users.length) ||
            (!field.multiple && users.length > 1)
          ) {
            error.textContent = `${field.name} 지정값을 확인하세요.`;
            return;
          }
          const previous =
            fields.find((value) => value.id === field.id)?.users ?? [];
          if (
            users.length !== previous.length ||
            users.some(
              (user) => !previous.some((value) => value.id === user.id),
            )
          )
            changes.push({
              id: field.id,
              userIds: users.map((user) => user.id),
            });
        }
        if (!changes.length) {
          dialog.close();
          return;
        }
        saving = true;
        config.busy(true);
        error.textContent = "";
        save.setAttribute("aria-busy", "true");
        const disabled = [
          ...dialog.querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
            "button, select",
          ),
        ].map((button) => ({ button, disabled: button.disabled }));
        for (const { button } of disabled) button.disabled = true;
        for (const menu of menus) {
          menu.close();
          menu.sync();
        }
        try {
          const updated = await api.updateParticipants(issue.key, changes);
          fields = issueParticipantFields(updated);
          renderSummary();
          try {
            await config.saved(updated);
            config.notice(`작업참여자 변경됨 · ${issue.key}`);
          } catch {
            config.notice("작업참여자는 저장됐지만 목록을 갱신하지 못했어요.");
          }
          if (alive) dialog.close();
        } catch (reason) {
          if (alive) error.textContent = errorMessage(reason);
          config.notice(`작업참여자 변경 실패: ${errorMessage(reason)}`);
        } finally {
          saving = false;
          config.busy(false);
          save.removeAttribute("aria-busy");
          for (const { button, disabled: wasDisabled } of disabled)
            button.disabled = wasDisabled;
          for (const menu of menus) menu.sync();
          if (!dialog.open || !alive) finish();
        }
      });
    } catch (reason) {
      if (alive && dialog.open) {
        content.replaceChildren();
        error.textContent = errorMessage(reason);
      }
    } finally {
      content.removeAttribute("aria-busy");
    }
  });
  renderSummary();
  return {
    element: root,
    sync(next: IssueDetails, disabled: boolean) {
      fields = issueParticipantFields(next);
      trigger.disabled = disabled;
      renderSummary();
    },
    destroy() {
      alive = false;
      if (dialog.open) dialog.close();
      finish();
    },
  };
}
