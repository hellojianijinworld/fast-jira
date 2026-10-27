import { randomUUID } from "node:crypto";
import type { BulkField, BulkOptions, BulkResult } from "../domain/bulk.ts";
import type { PriorityOption } from "../domain/catalog.ts";
import type { Issue, UserOption } from "../domain/issue.ts";
import { parseIssueKey } from "../domain/validation.ts";
import { JiraError } from "./jira-client.ts";

export interface BulkDependencies {
  detail(key: string): Promise<Issue>;
  applyUpdate(key: string, field: string, value: string): Promise<void>;
  transitionOptions(key: string): Promise<{ statuses: string[] }>;
  priorityOptions(key: string): Promise<PriorityOption[]>;
  assigneeOptions(key: string): Promise<UserOption[]>;
}
interface Entry {
  key: string;
  value: string;
  after?: string;
}
interface Receipt {
  field: BulkField;
  entries: Entry[];
  expires: number;
}
const invalid = (message: string) => new JiraError(message, 400);
function bulkField(field: string): BulkField {
  if (
    field === "parent" ||
    field === "status" ||
    field === "assignee" ||
    field === "dueDate" ||
    field === "priority"
  )
    return field;
  throw invalid("지원하는 변경 항목과 값을 선택하세요.");
}
const propertyOf = (field: BulkField) =>
  field === "assignee"
    ? "assigneeId"
    : field === "priority"
      ? "priorityId"
      : field;
const fieldValue = (issue: Issue, field: BulkField) =>
  issue[propertyOf(field)] || "";
export function createBulkService(
  service: BulkDependencies,
  now: () => number = Date.now,
) {
  const receipts = new Map<string, Receipt>();
  function keysOf(keys: string[]): string[] {
    if (!Array.isArray(keys) || !keys.length || keys.length > 50)
      throw invalid("이슈를 1~50개 선택하세요.");
    return [...new Set(keys.map((key) => parseIssueKey(key, "")))];
  }
  async function options(
    inputKeys: string[],
    field: string,
  ): Promise<BulkOptions> {
    if (field !== "status" && field !== "assignee" && field !== "priority")
      throw invalid("상태·담당자·우선순위 선택지를 요청하세요.");
    const keys = keysOf(inputKeys);
    if (field === "priority") {
      const all: PriorityOption[][] = [];
      for (let i = 0; i < keys.length; i += 4)
        all.push(
          ...(await Promise.all(
            keys.slice(i, i + 4).map((key) => service.priorityOptions(key)),
          )),
        );
      return {
        statuses: [],
        users: [],
        priorities: (all[0] ?? []).filter((priority) =>
          all.every((options) =>
            options.some((option) => option.id === priority.id),
          ),
        ),
      };
    }
    if (field === "status") {
      const all: { statuses: string[] }[] = [];
      for (let i = 0; i < keys.length; i += 4)
        all.push(
          ...(await Promise.all(
            keys.slice(i, i + 4).map((key) => service.transitionOptions(key)),
          )),
        );
      return {
        statuses: (all[0]?.statuses ?? []).filter((name) =>
          all.every((item) => item.statuses.includes(name)),
        ),
        users: [],
        priorities: [],
      };
    }
    const all: UserOption[][] = [];
    for (let i = 0; i < keys.length; i += 4)
      all.push(
        ...(await Promise.all(
          keys.slice(i, i + 4).map((key) => service.assigneeOptions(key)),
        )),
      );
    return {
      statuses: [],
      priorities: [],
      users: (all[0] ?? []).filter((user) =>
        all.every((users) =>
          users.some((candidate) => candidate.id === user.id),
        ),
      ),
    };
  }
  async function execute(
    entries: Entry[],
    field: BulkField,
    restoring = false,
  ) {
    const issues: Issue[] = [],
      failures: BulkResult["failures"] = [],
      warnings: BulkResult["warnings"] = [],
      changed: Entry[] = [];
    // Jira 변경은 하나의 트랜잭션이 아니다. 최대 4개씩 처리하고 각 성공·실패를 보존한다.
    for (let i = 0; i < entries.length; i += 4) {
      await Promise.all(
        entries.slice(i, i + 4).map(async (entry) => {
          try {
            const before = await service.detail(entry.key);
            if (restoring && fieldValue(before, field) !== entry.after)
              throw invalid("이후 변경된 값이 있어 되돌리지 않았습니다.");
            if (fieldValue(before, field) === entry.value) return;
            await service.applyUpdate(entry.key, field, entry.value);
            // 저장은 성공했는데 재조회만 실패한 경우도 되돌리기 이력을 잃지 않는다.
            const after = await service.detail(entry.key).catch(() => {
              warnings.push({
                key: entry.key,
                error:
                  "변경은 완료됐지만 최신 정보를 다시 불러오지 못했습니다.",
              });
              return { ...before, [propertyOf(field)]: entry.value };
            });
            issues.push(after);
            changed.push({
              key: entry.key,
              value: fieldValue(before, field),
              after: fieldValue(after, field),
            });
          } catch (error) {
            failures.push({
              key: entry.key,
              error:
                error instanceof Error ? error.message : "변경에 실패했습니다.",
            });
          }
        }),
      );
    }
    return { issues, failures, warnings, changed };
  }
  async function apply(
    inputKeys: string[],
    inputField: string,
    value: string,
  ): Promise<BulkResult> {
    const keys = keysOf(inputKeys),
      field = bulkField(inputField);
    if (typeof value !== "string")
      throw invalid("지원하는 변경 항목과 값을 선택하세요.");
    if (field === "parent" && value && keys.includes(parseIssueKey(value, "")))
      throw invalid("선택한 이슈를 서로의 부모로 지정할 수 없습니다.");
    const result = await execute(
      keys.map((key) => ({ key, value })),
      field,
    );
    for (const [id, receipt] of receipts)
      if (receipt.expires <= now()) receipts.delete(id);
    let undoToken = "";
    if (result.changed.length) {
      if (receipts.size >= 50) {
        const oldest = receipts.keys().next().value;
        if (oldest !== undefined) receipts.delete(oldest);
      }
      undoToken = randomUUID();
      receipts.set(undoToken, {
        field,
        entries: result.changed,
        expires: now() + 600000,
      });
    }
    return {
      issues: result.issues,
      failures: result.failures,
      warnings: result.warnings,
      undoToken,
    };
  }
  function receiptFor(token: string) {
    const receipt = receipts.get(token);
    if (!receipt || receipt.expires <= now()) {
      receipts.delete(token);
      throw invalid("되돌리기 시간이 만료되었거나 이미 처리했습니다.");
    }
    return receipt;
  }
  function previewUndo(token: string) {
    const receipt = receiptFor(token);
    return {
      field: receipt.field,
      changes: receipt.entries.map((entry) => ({ ...entry })),
    };
  }
  async function undo(token: string): Promise<BulkResult> {
    const receipt = receiptFor(token);
    // 실행 전에 소비해 중복 요청이 같은 변경을 두 번 되돌리지 못하게 한다.
    receipts.delete(token);
    const result = await execute(receipt.entries, receipt.field, true);
    return {
      issues: result.issues,
      failures: result.failures,
      warnings: result.warnings,
      undoToken: "",
    };
  }
  return { options, apply, undo, previewUndo };
}
