import type { Issue, IssueComment } from "../host/types.ts";
import type { WorkflowStatus } from "../state/store.ts";

export type TrackedComment = IssueComment & { fromPatchmill: boolean };
export type TrackedIssue = Omit<Issue, "comments"> & {
  status: WorkflowStatus | "untriaged";
  statusSince?: string;
  comments: TrackedComment[];
};
export type StatusUpdate = {
  status: WorkflowStatus;
  runId?: string;
  summary?: string;
  cost?: string;
  warnings?: string[];
  /** Text to ask a human. Required questions are posted before recording status. */
  question?: string;
};
export interface WorkflowState {
  sync(issue?: number): Promise<void>;
  openIssues(): Promise<TrackedIssue[]>;
  issue(n: number): Promise<TrackedIssue>;
  /**
   * Rejects when the status was not recorded. Resolves to warnings about
   * optional comments that failed after the status was recorded. When question
   * is set, posting is required before recording; a posting failure rejects
   * and leaves the status unchanged.
   */
  setStatus(n: number, update: StatusUpdate): Promise<string[]>;
}
