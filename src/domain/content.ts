import type { AdfDocument } from "./adf.ts";

export interface Comment {
  id: string;
  parentId: string;
  authorId: string;
  author: string;
  avatar: string;
  created: string;
  updated: string;
  body: AdfDocument;
}
export interface CommentPage {
  total: number;
  startAt: number;
  comments: Comment[];
}
export interface HistoryEntry {
  id: string;
  author: string;
  avatar: string;
  created: string;
  changes: { field: string; from: string; to: string }[];
}
export interface HistoryPage {
  before: number | null;
  entries: HistoryEntry[];
}
