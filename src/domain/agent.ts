import type { BulkField } from "./bulk.ts";
import { parseIssueKey, record } from "./validation.ts";

export const agentBulkFields = [
  "parent",
  "status",
  "assignee",
  "dueDate",
  "priority",
] as const;
export interface ChangeProposal {
  keys: string[];
  field: BulkField;
  value: string;
}
export function agentIssueKeys(value: unknown, site: string): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 50)
    throw new Error("이슈를 1~50개 지정하세요.");
  return [...new Set(value.map((key) => parseIssueKey(key, site)))];
}
/** AI의 제안은 명령이 아니라 입력 데이터다. 실제 저장은 별도 동작에서 처리한다. */
export function changeProposal(value: unknown, site: string): ChangeProposal {
  const input = record(value);
  if (!agentBulkFields.some((field) => field === input.field))
    throw new Error("지원하는 변경 항목을 지정하세요.");
  if (
    typeof input.value !== "string" ||
    input.value.length > 10000 ||
    input.value.includes("\0")
  )
    throw new Error("변경 값을 문자열로 지정하세요.");
  return {
    keys: agentIssueKeys(input.keys, site),
    field: input.field as BulkField,
    value: input.value,
  };
}
