import type { IssueDetails } from "../domain/details.ts";
import { type EditableField, fieldValue } from "../domain/issue.ts";
import type { Api } from "./api.ts";

export interface EditorCallbacks {
  state(): void;
  changed(issue: IssueDetails): void | Promise<void>;
  notice(text: string, undo?: () => Promise<void>): void;
}
const labels: Record<EditableField, string> = {
  summary: "제목",
  status: "상태",
  assignee: "담당자",
  priority: "우선순위",
  dueDate: "마감일",
};
/** 저장 결과와 되돌리기만 조정한다. DOM·목록 멤버십은 호출자에게 맡긴다. */
export function createIssueEditor(
  api: Pick<Api, "update">,
  initial: IssueDetails,
  callbacks: EditorCallbacks,
) {
  let issue = initial,
    busy: EditableField | null = null;
  let contentVersion = 0;
  async function change(
    field: EditableField,
    value: string,
    canUndo = true,
    expected?: string,
  ): Promise<boolean> {
    if (busy) return false;
    const previous = fieldValue(issue, field);
    if (previous === value) return true;
    const version = contentVersion;
    busy = field;
    callbacks.state();
    try {
      const updated = await api.update(issue.key, field, value, expected);
      if (updated.key !== issue.key)
        throw new Error("변경 응답의 이슈가 일치하지 않습니다.");
      // 변경 응답은 메타정보만 담는다. 빈 본문·첨부로 이미 읽은 내용을 지우지 않는다.
      issue = {
        ...updated,
        description: issue.description,
        attachments: issue.attachments,
        commentCount:
          version === contentVersion
            ? updated.commentCount
            : issue.commentCount,
      };
    } catch (reason) {
      busy = null;
      callbacks.state();
      callbacks.notice(
        `${canUndo ? "변경" : "되돌리기"} 실패: ${reason instanceof Error ? reason.message : "다시 시도해 주세요."}`,
      );
      return false;
    }
    const after = fieldValue(issue, field);
    const undo =
      canUndo && (field !== "priority" || previous)
        ? async () => {
            if (fieldValue(issue, field) !== after)
              throw new Error("이후 변경된 값이 있어 되돌리지 않았어요.");
            await change(field, previous, false, after);
          }
        : undefined;
    callbacks.state();
    try {
      await callbacks.changed(issue);
      callbacks.notice(
        canUndo
          ? `${labels[field]} 변경됨 · ${issue.key}`
          : "변경을 되돌렸어요.",
        undo,
      );
    } catch {
      // Jira 저장 성공을 화면 갱신 실패로 뒤집지 않는다. 되돌리기 정보도 유지한다.
      callbacks.notice("변경은 완료됐지만 목록을 갱신하지 못했어요.", undo);
    } finally {
      busy = null;
      callbacks.state();
    }
    return true;
  }
  return {
    change,
    mergeParticipants(updated: IssueDetails) {
      issue = {
        ...issue,
        assignee: updated.assignee,
        assigneeId: updated.assigneeId,
        assigneeAvatar: updated.assigneeAvatar,
        participantFields: updated.participantFields ?? [],
        ...(updated.relatedUserIds === undefined
          ? {}
          : { relatedUserIds: updated.relatedUserIds }),
        updated: updated.updated,
      };
      callbacks.state();
      return issue;
    },
    mergeContent(
      patch: Partial<Pick<IssueDetails, "description" | "commentCount">>,
    ) {
      contentVersion++;
      issue = { ...issue, ...patch };
    },
    get issue() {
      return issue;
    },
    get busy() {
      return busy;
    },
  };
}
