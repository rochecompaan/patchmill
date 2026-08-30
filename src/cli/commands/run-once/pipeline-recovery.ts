import { createHash } from "node:crypto";

import {
  readRunStateSnapshot,
  adoptRunStateLeaseProtocol,
} from "./run-state.ts";
import type { ResolvedIssueArtifactSources } from "./artifact-sources.ts";
import {
  formatRunRecoveryDecision,
  hasBlockedRunRecoveryState,
  planRunRecovery,
} from "./recovery.ts";
import { readRunLegacyMigrationFence } from "./recovery-lease-repair.ts";
import { executeRunRecoveryMutation } from "./recovery-mutation.ts";
import { AgentIssueSafetyError } from "./pipeline-lifecycle.ts";
import type {
  AgentIssueConfig,
  AgentIssueRunState,
  CommandRunner,
  IssueRunLease,
} from "./types.ts";

/** Adopts a fenced legacy active state before the caller performs pipeline effects. */
export async function adoptLegacyRecoveryLease(input: {
  config: AgentIssueConfig;
  issueNumber: number;
  state: AgentIssueRunState | undefined;
  lease: IssueRunLease;
}): Promise<AgentIssueRunState | undefined> {
  const { state } = input;
  if (
    !state ||
    state.leaseProtocolVersion === 1 ||
    !["claimed", "planning", "implementing"].includes(state.status)
  )
    return state;
  const snapshot = await readRunStateSnapshot(
    input.config.runStateDir,
    input.issueNumber,
  );
  const fence = await readRunLegacyMigrationFence(
    input.config.runStateDir,
    input.issueNumber,
  );
  const hash =
    snapshot && createHash("sha256").update(snapshot.raw).digest("hex");
  if (
    !snapshot ||
    !fence ||
    fence.issueNumber !== input.issueNumber ||
    fence.status !== snapshot.state.status ||
    fence.stateSha256 !== hash
  )
    throw new AgentIssueSafetyError(
      "Legacy active Run state is unfenced; repair its lease before continuing",
    );
  return adoptRunStateLeaseProtocol({
    snapshot,
    expectedStateSha256: hash,
    lease: input.lease,
  });
}

/** Reassesses and applies only a safe blocked-workspace recovery under the held lease. */
export async function recoverBlockedWorkspace(input: {
  runner: CommandRunner;
  config: AgentIssueConfig;
  issueNumber: number;
  existingState: AgentIssueRunState | undefined;
  expectedWorkspace: { branch: string; worktreePath: string };
  ignoredPaths: string[];
  resolvedArtifacts: ResolvedIssueArtifactSources;
  lease: IssueRunLease | undefined;
}): Promise<void> {
  if (!hasBlockedRunRecoveryState(input.existingState) || !input.lease) return;
  const snapshot = await readRunStateSnapshot(
    input.config.runStateDir,
    input.issueNumber,
  );
  if (!snapshot)
    throw new AgentIssueSafetyError(
      `Blocked Run recovery state for issue #${input.issueNumber} disappeared`,
    );
  let recoveryPaths:
    | { quarantinePath: string; stagingPath: string }
    | undefined;
  const reassess = async () => {
    const current = await readRunStateSnapshot(
      input.config.runStateDir,
      input.issueNumber,
    );
    if (!current || current.raw !== snapshot.raw)
      throw new AgentIssueSafetyError(
        "Run recovery state changed before mutation",
      );
    return planRunRecovery({
      intent: "retry",
      runner: input.runner,
      repoRoot: input.config.repoRoot,
      runStatePath: current.path,
      state: current.state,
      baseRef: input.config.baseRef,
      expectedWorkspace: input.expectedWorkspace,
      ignoredPaths: input.ignoredPaths,
      resolvedArtifacts: input.resolvedArtifacts,
      leaseOwnerToken: input.lease!.record.ownerToken,
      snapshotRaw: current.raw,
      legacyMigrationFence: await readRunLegacyMigrationFence(
        input.config.runStateDir,
        input.issueNumber,
      ),
      recoveryPaths,
    });
  };
  const decision = await reassess();
  if (decision.action === "refuse")
    throw new AgentIssueSafetyError(formatRunRecoveryDecision(decision));
  if (decision.action === "refresh-and-resume")
    recoveryPaths = {
      quarantinePath: decision.refresh.quarantinePath,
      stagingPath: decision.refresh.stagingPath,
    };
  else if (decision.action === "recreate-and-resume")
    recoveryPaths = {
      quarantinePath: `${decision.recreation.stagingPath}.quarantine`,
      stagingPath: decision.recreation.stagingPath,
    };
  if (decision.action !== "resume")
    await executeRunRecoveryMutation({
      decision,
      runner: input.runner,
      repoRoot: input.config.repoRoot,
      reassess,
    });
}
