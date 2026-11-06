import type { UserOption } from "../domain/issue.ts";
import { uniqueParticipants } from "../domain/participants.ts";
import { element } from "./dom.ts";
import { personChip, personPill } from "./meta.ts";
import { enhanceSelect, type SelectConfig } from "./select-menu.ts";

/** 단일 지정은 선택값 안에, 여러 명 지정은 해제 가능한 배지로 표시한다. */
export function personSelect(
  select: HTMLSelectElement,
  config: {
    multiple: boolean;
    selected: () => readonly UserOption[];
    choose: (user: UserOption) => void;
    remove: (user: UserOption) => void;
    clear: () => void;
    removeLabel: (user: UserOption) => string;
    menu?: Omit<SelectConfig, "renderOption">;
  },
) {
  const chips = element("div", "participant-people");
  chips.hidden = !config.multiple;
  select.before(chips);
  let candidates: UserOption[] = [];
  const known = () => uniqueParticipants([...config.selected(), ...candidates]);
  const menu = enhanceSelect(select, {
    ...config.menu,
    renderOption: (option) => {
      const user = known().find((user) => user.id === option.value);
      return user
        ? personPill(user)
        : document.createTextNode(option.textContent ?? "");
    },
  });
  select.addEventListener("change", () => {
    if (select.disabled) return;
    const user = known().find((user) => user.id === select.value);
    if (user) config.choose(user);
    else if (!select.value && !config.multiple) config.clear();
  });
  return {
    menu,
    sync(users: readonly UserOption[]) {
      candidates = uniqueParticipants(users);
      const selected = config.selected();
      chips.replaceChildren(
        ...(config.multiple
          ? selected.map((user) =>
              personChip(
                known().find((value) => value.id === user.id) ?? user,
                config.removeLabel(user),
                () => config.remove(user),
              ),
            )
          : []),
      );
      const prompt = new Option(config.multiple ? "참여자 추가" : "미지정", "");
      prompt.hidden = config.multiple;
      const current = !config.multiple ? selected[0] : undefined;
      const currentOption = current
        ? new Option(current.name, current.id)
        : null;
      if (currentOption) currentOption.hidden = true;
      select.replaceChildren(
        prompt,
        ...(currentOption ? [currentOption] : []),
        ...candidates
          .filter((user) => !selected.some((value) => value.id === user.id))
          .map((user) => new Option(user.name, user.id)),
      );
      select.value = current?.id ?? "";
      menu.sync();
    },
    destroy: menu.destroy,
  };
}
