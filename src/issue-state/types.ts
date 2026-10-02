import type { IssueSummary } from "../issue/types.ts";

export type IssueWorkflowRole =
  | "agent-ready"
  | "needs-info"
  | "agent-unsuitable"
  | "blocked"
  | "in-progress"
  | "agent-done"
  | "spec-review"
  | "spec-approved"
  | "plan-review"
  | "plan-approved";

export type IssueWorkflowRoles = {
  roles: IssueWorkflowRole[];
};

export type IssueStateTransition = {
  issue: IssueSummary;
  roles: IssueWorkflowRole[];
  message?: string | undefined;
};

export type IssueStateProvider = {
  resolveRoles(issue: IssueSummary): IssueWorkflowRoles;
  setRoles(transition: IssueStateTransition): Promise<void>;
};
