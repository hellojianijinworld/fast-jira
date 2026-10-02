import type { PriorityOption } from "./catalog.ts";
import type { Issue, UserOption } from "./issue.ts";
export type BulkField =
  | "parent"
  | "status"
  | "assignee"
  | "dueDate"
  | "priority";
export interface BulkOptions {
  priorities: PriorityOption[];
  statuses: string[];
  users: UserOption[];
}
export interface BulkResult {
  issues: Issue[];
  failures: { key: string; error: string }[];
  warnings: { key: string; error: string }[];
  undoToken: string;
}
