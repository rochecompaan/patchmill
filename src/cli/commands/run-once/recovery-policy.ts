import type {
  RunRecoveryAssessment,
  RunRecoveryClassification,
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
  const preserveGuidance: Partial<
    Record<
      RunRecoveryClassification | "not-blocked" | "active-run",
      string | readonly string[]
    >
  > = {
    "dirty-worktree":
      "Commit, stash, or clean local modifications before retrying recovery.",
    "ignored-worktree-content":
      "Inspect and preserve ignored workspace content before retrying recovery.",
    "unmerged-commits":
      "Merge or preserve the unique branch commits before retrying recovery.",
    "workspace-unverifiable": [
      "Repair the workspace registration or inspect it manually before retrying recovery.",
      `Saved workspace: branch ${assessment.savedWorkspace.branch ?? "(none)"}, path ${assessment.savedWorkspace.worktreePath ?? "(none)"}.`,
      `Expected workspace: branch ${assessment.expectedWorkspace.branch}, path ${assessment.expectedWorkspace.worktreePath}.`,
    ],
    "legacy-active-unfenced":
      "Repair the legacy Run lease fence before retrying recovery.",
    "not-blocked":
      "Use normal run-once execution; this Run state is not blocked.",
    "active-run": "Wait for the active Run attempt before retrying recovery.",
  } as const;
  const guidance = preserveGuidance[reason] ?? `Recovery is unsafe: ${reason}.`;
  return {
    action: "refuse",
    assessment,
    reason,
    guidance: [
      detail
        ? `Recovery is unsafe: ${detail}`
        : `Recovery is unsafe: ${reason}.`,
      ...(Array.isArray(guidance) ? guidance : [guidance]),
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
/** Allocate mutation paths once at the orchestration boundary. The policy is
 * deterministic: it only selects among evidence and these already-pinned paths. */
export function createRunRecoveryPaths(input: {
  worktreePath: string;
  now: Date;
}): { quarantinePath: string; stagingPath: string } {
  const base = `${input.worktreePath}.recovery-${input.now.toISOString().replaceAll(/[:.]/gu, "-")}`;
  return {
    quarantinePath: `${base}-quarantine`,
    stagingPath: `${base}-staging`,
  };
}
export function decideRunRecovery(
  intent: RunRecoveryIntent,
  assessment: RunRecoveryAssessment,
  plannedPaths: { quarantinePath: string; stagingPath: string },
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
  const { quarantinePath, stagingPath } = plannedPaths;
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
        mode: !assessment.branch.exists
          ? "create-from-base"
          : assessment.divergence?.ahead === 0 &&
              (assessment.divergence.behind ?? 0) > 0
            ? "advance-to-base"
            : "reuse-existing",
        expectedBranchOid: assessment.branch.oid,
        targetOid:
          assessment.branch.exists &&
          assessment.divergence?.ahead === 0 &&
          (assessment.divergence.behind ?? 0) > 0
            ? assessment.baseOid
            : (assessment.branch.oid ?? assessment.baseOid),
        stagingPath,
      },
    };
  return { action: "resume", assessment };
}
