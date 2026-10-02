import type { IssueType, UserOption } from "./issue.ts";

export interface CurrentUser extends UserOption {
  accountId: string;
  displayName: string;
  emailAddress: string;
}
export interface ProjectOption {
  key: string;
  name: string;
  avatar: string;
}
export interface PriorityOption {
  id: string;
  name: string;
  icon: string;
}
export interface StatusOption {
  id: string;
  name: string;
  category: string;
  projects: string[];
}

/** 목록·필터가 공유하는 Jira 메타정보. DOM과 조회 동작을 포함하지 않는다. */
export interface TreeCatalog {
  projects: readonly ProjectOption[];
  statuses: readonly StatusOption[];
  priorities: readonly PriorityOption[];
  types: readonly IssueType[];
}
