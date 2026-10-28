import {
  type ParticipantField,
  participantUsers,
} from "../domain/participants.ts";
import { element } from "./dom.ts";
import { avatar } from "./meta.ts";

/** 상세·목록·최근·즐겨찾기에서 같은 참여자 표시를 사용한다. */
export function participantAvatars(
  fields: readonly ParticipantField[],
  currentUserId = "",
) {
  const users = participantUsers(fields, currentUserId);
  const root = element("span", "participant-avatars");
  root.setAttribute("role", "img");
  const names = users
    .map((user) => `${user.name}${user.id === currentUserId ? " (나)" : ""}`)
    .join(", ");
  root.title = fields
    .filter((field) => field.users.length)
    .map(
      (field) =>
        `${field.name}: ${field.users.map((user) => `${user.name}${user.id === currentUserId ? " (나)" : ""}`).join(", ")}`,
    )
    .join("\n");
  root.setAttribute("aria-label", `작업참여자: ${names}`);
  for (const user of users.slice(0, 4)) {
    const image = avatar(user);
    root.append(image);
  }
  if (users.length > 4)
    root.append(
      element("span", "participant-overflow", `+${users.length - 4}`),
    );
  return root;
}
