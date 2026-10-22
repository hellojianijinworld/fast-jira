/** 브라우저와 서버가 공유하는 값이다. Jira 응답 검증 후 이 형태로 정규화한다. */
export interface Issue {
  id: string;
  key: string;
  summary: string;
  project: string;
  parent: string;
  parentSummary: string;
  status: string;
  statusId: string;
  statusCategory: string;
  issueType: string;
  issueTypeId: string;
  hierarchyLevel: number | null;
  issueTypeIcon: string;
  priority: string;
  priorityId: string;
  defaultPriorityId: string;
  priorityIcon: string;
  assignee: string;
  assigneeId: string;
  relatedUserIds?: readonly string[];
  assigneeAvatar: string;
  updated: string;
  dueDate: string;
  commentCount: number;
  hasChildren: boolean;
}

export interface IssueType {
  id: string;
  name: string;
  project: string;
  hierarchyLevel: number | null;
}

export interface UserOption {
  id: string;
  name: string;
  avatar: string;
}
export interface EditOptions {
  users: UserOption[];
  statuses: string[];
}
export interface ChildPage {
  issues: Map<string, Issue>;
}
export type SelectionFilter = readonly string[] | null;
export type PeopleFilter = "all" | "mine" | "assigned" | "related";

export interface BranchDefaults {
  sort: string;
  people: PeopleFilter;
  excludeDone: boolean;
  statuses: SelectionFilter;
  assignees: SelectionFilter;
}
export interface ChildSettings extends BranchDefaults {
  projects: readonly string[];
}
export interface BranchOverrides {
  sort?: string;
  people?: PeopleFilter | "inherit";
  done?: "include" | "exclude" | "inherit";
  statuses?: SelectionFilter | "inherit";
  assignees?: SelectionFilter | "inherit";
}

export type EditableField =
  | "summary"
  | "status"
  | "assignee"
  | "priority"
  | "dueDate";
