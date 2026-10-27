import type { UserOption } from "../domain/issue.ts";
import { element } from "./dom.ts";
import { avatar } from "./meta.ts";

/** 상세·목록·최근·즐겨찾기에서 같은 참여자 표시를 사용한다. */
export function participantAvatars(
  users: readonly UserOption[],
  currentUserId = "",
) {
  const root = element("span", "participant-avatars");
  root.setAttribute("role", "img");
  const names = users
    .map((user) => `${user.name}${user.id === currentUserId ? " (나)" : ""}`)
    .join(", ");
  root.title = names;
  root.setAttribute("aria-label", `작업참여자: ${names}`);
  for (const user of users.slice(0, 4)) {
    const image = avatar(user);
    image.title = user.name;
    root.append(image);
  }
  if (users.length > 4)
    root.append(
      element("span", "participant-overflow", `+${users.length - 4}`),
    );
  return root;
}
