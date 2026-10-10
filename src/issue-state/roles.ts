import type { IssueWorkflowRole } from "./types.ts";

export const ISSUE_WORKFLOW_ROLES = [
  "agent-ready",
  "needs-info",
  "agent-unsuitable",
  "blocked",
  "in-progress",
  "agent-done",
  "spec-review",
  "spec-approved",
  "plan-review",
  "plan-approved",
] as const satisfies readonly IssueWorkflowRole[];

export const ISSUE_WORKFLOW_ROLE_SET = new Set<IssueWorkflowRole>(
  ISSUE_WORKFLOW_ROLES,
);

export function isIssueWorkflowRole(value: string): value is IssueWorkflowRole {
  return ISSUE_WORKFLOW_ROLE_SET.has(value as IssueWorkflowRole);
}

export function uniqueWorkflowRoles(
  roles: readonly IssueWorkflowRole[],
): IssueWorkflowRole[] {
  return [...new Set(roles)];
}
