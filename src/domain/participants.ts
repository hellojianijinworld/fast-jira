import type { Issue, UserOption } from "./issue.ts";

export interface ParticipantDefinition {
  id: string;
  name: string;
  multiple: boolean;
}
export interface ParticipantField extends ParticipantDefinition {
  users: UserOption[];
}
export interface ParticipantOption extends ParticipantDefinition {
  required: boolean;
}
export interface ParticipantChange {
  id: string;
  userIds: string[];
}
/** 표시만 합치고, 편집·저장은 실제 필드별 지정값을 유지한다. */
export function participantUsers(
  fields: readonly ParticipantField[],
  currentUserId = "",
): UserOption[] {
  const users = uniqueParticipants(fields.flatMap((field) => field.users));
  return currentUserId
    ? users.sort(
        (a, b) =>
          Number(b.id === currentUserId) - Number(a.id === currentUserId),
      )
    : users;
}
export function issueParticipantFields(
  issue: Pick<
    Issue,
    "assigneeId" | "assignee" | "assigneeAvatar" | "participantFields"
  >,
): ParticipantField[] {
  return [
    {
      id: "assignee",
      name: "담당자",
      multiple: false,
      users: issue.assigneeId
        ? [
            {
              id: issue.assigneeId,
              name: issue.assignee,
              avatar: issue.assigneeAvatar,
            },
          ]
        : [],
    },
    ...(issue.participantFields ?? []),
  ];
}

export interface ParticipantRecents {
  recent(): readonly UserOption[];
  remember(user: UserOption): void;
}
export function rememberParticipant(
  users: readonly UserOption[],
  user: UserOption,
): UserOption[] {
  return [user, ...users.filter((value) => value.id !== user.id)].slice(0, 12);
}

export function uniqueParticipants(users: readonly UserOption[]): UserOption[] {
  return [...new Map(users.map((user) => [user.id, user])).values()];
}
