import type { AdfDocument } from "./adf.ts";
import type { Issue } from "./issue.ts";

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
}
export interface IssueDetails extends Issue {
  reporter: string;
  reporterAvatar: string;
  created: string;
  description: AdfDocument | null;
  attachments: Attachment[];
  url: string;
}
export interface LookupResult {
  parent: IssueDetails;
  children: Issue[];
  deferredChildren: boolean;
  dateEditing: boolean;
  imageEnabled: boolean;
}
