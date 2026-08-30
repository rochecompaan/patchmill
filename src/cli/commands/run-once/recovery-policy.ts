import type {
  RunRecoveryAssessment,
  RunRecoveryDecision,
  RunRecoveryIntent,
  RunResetSeed,
} from "./types.ts";

function refusal(
  assessment: RunRecoveryAssessment,
  reason: Extract<
    RunRecoveryDecision,
    { action: "refuse"; assessment: RunRecoveryAssessment }
  >["reason"],
): Extract<
  RunRecoveryDecision,
  { action: "refuse"; assessment: RunRecoveryAssessment }
> {
  const detail =
    reason === "dirty-worktree"
      ? assessment.worktree.dirtyStatus
      : reason === "ignored-worktree-content"
        ? assessment.worktree.ignoredEntries.join(", ")
        : reason === "unmerged-commits"
          ? assessment.actualUniqueCommits
              .concat(assessment.savedCommits)
              .join(", ")
          : undefined;
  return {
    action: "refuse",
    assessment,
    reason,
    guidance: [
      detail
        ? `Recovery is unsafe: ${detail}`
        : `Recovery is unsafe: ${reason}.`,
      `Inspect the preserved workspace, then retry with: patchmill run reset --issue ${assessment.issueNumber}`,
    ],
  };
}
function seed(assessment: RunRecoveryAssessment): RunResetSeed {
  return {
    issueNumber: assessment.issueNumber,
    title: assessment.title,
    ...(assessment.artifacts.spec.valid
      ? {
          specPath: assessment.artifacts.spec.path,
          specCommit: assessment.artifacts.spec.commit,
        }
      : {}),
    ...(assessment.artifacts.plan.valid
      ? {
          planPath: assessment.artifacts.plan.path,
          planCommit: assessment.artifacts.plan.commit,
        }
      : {}),
    ...(assessment.startedCommentPosted
      ? { startedCommentPosted: true as const }
      : {}),
  };
}
function paths(assessment: RunRecoveryAssessment): {
  quarantinePath: string;
  stagingPath: string;
} {
  const base = `${assessment.expectedWorkspace.worktreePath}.recovery-${Date.now()}`;
  return {
    quarantinePath: `${base}-quarantine`,
    stagingPath: `${base}-staging`,
  };
}
export function decideRunRecovery(
  intent: RunRecoveryIntent,
  assessment: RunRecoveryAssessment,
): RunRecoveryDecision {
  if (intent === "retry" && !assessment.blocked)
    return refusal(assessment, "not-blocked");
  if (
    [
      "workspace-unverifiable",
      "dirty-worktree",
      "ignored-worktree-content",
      "unmerged-commits",
      "legacy-active-unfenced",
    ].includes(assessment.classification)
  )
    return refusal(assessment, assessment.classification);
  if (
    intent === "reset" &&
    assessment.classification === "resumable-with-commits"
  )
    return refusal(assessment, "unmerged-commits");
  const { quarantinePath, stagingPath } = paths(assessment);
  if (intent === "reset")
    return {
      action: "archive-reset-and-start",
      assessment,
      seed: seed(assessment),
      cleanup: {
        branch: assessment.branch.exists
          ? assessment.expectedWorkspace.branch
          : undefined,
        expectedWorktreePath: assessment.worktree.registered
          ? assessment.expectedWorkspace.worktreePath
          : undefined,
        expectedBranchOid: assessment.branch.oid,
        quarantinePath: assessment.worktree.registered
          ? quarantinePath
          : undefined,
        pruneStaleRegistration:
          assessment.worktree.registered && !assessment.worktree.exists,
      },
    };
  if (assessment.classification === "resumable-stale-base")
    return {
      action: "refresh-and-resume",
      assessment,
      refresh: {
        branch: assessment.expectedWorkspace.branch,
        expectedWorktreePath: assessment.expectedWorkspace.worktreePath,
        expectedBranchOid: assessment.branch.oid!,
        baseOid: assessment.baseOid,
        quarantinePath,
        stagingPath,
      },
    };
  if (assessment.classification === "recreatable-clean")
    return {
      action: "recreate-and-resume",
      assessment,
      recreation: {
        branch: assessment.expectedWorkspace.branch,
        expectedWorktreePath: assessment.expectedWorkspace.worktreePath,
        mode: assessment.branch.exists ? "reuse-existing" : "create-from-base",
        expectedBranchOid: assessment.branch.oid,
        targetOid: assessment.branch.oid ?? assessment.baseOid,
        pruneStaleRegistration:
          assessment.worktree.registered && !assessment.worktree.exists,
        stagingPath,
      },
    };
  return { action: "resume", assessment };
}
