import type { PatchmillConfig } from "../config/types.ts";
import type { IssueHostProvider } from "../host/types.ts";
import type { PatchmillLabelCatalog } from "../policy/label-catalog.ts";
import { createCommentIssueStateProvider } from "./comments.ts";
import { createLabelIssueStateProvider } from "./labels.ts";
import type { IssueStateProvider, IssueStateTransition } from "./types.ts";

export type {
  IssueStateProvider,
  IssueStateTransition,
  IssueWorkflowRole,
  IssueWorkflowRoles,
} from "./types.ts";
export { ISSUE_WORKFLOW_ROLES, isIssueWorkflowRole } from "./roles.ts";
export {
  createLabelIssueStateProvider,
  labelsAfterWorkflowRoleTransition,
  workflowRolesFromLabels,
  type LabelIssueStateOptions,
} from "./labels.ts";
export {
  createCommentIssueStateProvider,
  formatPatchmillStateComment,
  parsePatchmillStateComment,
  resolveCommentIssueWorkflowRoles,
} from "./comments.ts";

export async function createIssueStateProvider(
  host: Pick<
    IssueHostProvider,
    "applyLabels" | "commentIssue" | "trustedTriageCommentAuthors"
  >,
  config: Pick<PatchmillConfig, "issueState">,
  labelCatalog: Pick<
    PatchmillLabelCatalog,
    "triagePolicy" | "workflowApprovalPolicy"
  >,
): Promise<IssueStateProvider> {
  const issueState = config.issueState ?? ({ provider: "labels" } as const);
  if (issueState.provider === "comments") {
    return createCommentIssueStateProvider(host, issueState);
  }
  return createLabelIssueStateProvider(host, {
    triagePolicy: labelCatalog.triagePolicy,
    approvalPolicy: labelCatalog.workflowApprovalPolicy,
  });
}

export async function setIssueWorkflowRoles(
  provider: IssueStateProvider,
  transition: IssueStateTransition,
): Promise<void> {
  await provider.setRoles(transition);
}
