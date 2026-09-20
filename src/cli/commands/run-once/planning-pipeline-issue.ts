import {
  PlanningIssueLockConflictError,
  acquirePlanningIssueLock,
  releasePlanningIssueLock,
  type PlanningIssueLock,
} from "../../../workflow/planning-issue-lock.ts";
import {
  PlanningStateStore,
  planningStatePath,
} from "../../../workflow/planning-state-store.ts";
import {
  PlanningStateValidationError,
  type PlanningStateV1,
} from "../../../workflow/planning-state.ts";
import type { IssueSummary } from "../../../issue/types.ts";
import {
  legacyConflictsWithPlanning,
  planningIssueEligible,
} from "./planning-selection.ts";
import {
  planningBlocked,
  planningIdentityFailure,
  planningLockFailure,
} from "./planning-pipeline-diagnostics.ts";
import { runOnceFailure } from "./result-diagnostics.ts";
import type { PlanningCoordinatorOutcome } from "./planning-phase-coordinator.ts";
import type { PlanningPipelineResult } from "./planning-pipeline.ts";
import type { AgentIssueConfig } from "./types.ts";

export type PlanningIssueInput = {
  issue: IssueSummary;
  config: AgentIssueConfig;
  state: PlanningStateV1;
  /** Whether selection observed durable planning state before acquiring the lock. */
  expectedStatePresence: "present" | "absent";
  runStateDir: string;
  stateStore: Pick<PlanningStateStore, "read" | "initialize">;
  readIssue: () => Promise<IssueSummary>;
  readLegacy: () => Promise<
    import("./types.ts").AgentIssueRunState | undefined
  >;
  eligible?: (
    issue: IssueSummary,
    state: PlanningStateV1 | undefined,
  ) => boolean;
  reconcileCleanupPendingPublication?: (input: {
    issue: IssueSummary;
    state: PlanningStateV1;
  }) => Promise<PlanningCoordinatorOutcome | undefined>;
  mutate: (
    issue: IssueSummary,
    fresh: boolean,
    state: PlanningStateV1,
  ) => Promise<string[]>;
  coordinate: (
    state: PlanningStateV1,
    lock: PlanningIssueLock,
    issue: IssueSummary,
    labels: string[],
  ) => Promise<PlanningCoordinatorOutcome>;
  acquire?: typeof acquirePlanningIssueLock;
  release?: typeof releasePlanningIssueLock;
};

async function releaseOwnedPlanningLock(input: {
  lock: PlanningIssueLock;
  release: typeof releasePlanningIssueLock;
  workFailure: unknown;
}): Promise<void> {
  try {
    await input.release(input.lock);
  } catch (releaseFailure) {
    if (input.workFailure !== undefined)
      throw new AggregateError(
        [input.workFailure, releaseFailure],
        "Planning issue work and lock release failed",
        { cause: releaseFailure },
      );
    throw new Error("Planning lock release failed", { cause: releaseFailure });
  }
}

/**
 * Owns one planning issue attempt. Selection is advisory; every identity and
 * workflow check is repeated after the ownership-ID lock is acquired.
 */
export async function runPlanningIssue(
  input: PlanningIssueInput,
): Promise<PlanningPipelineResult> {
  const acquire = input.acquire ?? acquirePlanningIssueLock;
  const release = input.release ?? releasePlanningIssueLock;
  let lock: PlanningIssueLock | undefined;
  let workFailure: unknown;
  try {
    try {
      lock = await acquire(input.runStateDir, {
        issueNumber: input.issue.number,
        runId: input.state.runId,
      });
    } catch (error) {
      if (error instanceof PlanningIssueLockConflictError) {
        const publicFailure = planningLockFailure(
          input.issue,
          error.diagnostic,
        );
        if (publicFailure.reason === "issue-locked")
          return {
            status: "stopped",
            issue: input.issue,
            reason: "issue-locked",
            publicFailure,
          };
        return planningBlocked(
          input.issue,
          publicFailure.reason,
          publicFailure,
        );
      }
      throw error;
    }
    let retriedAuthoritativeRun = false;
    while (true) {
      let issue: IssueSummary;
      let saved: PlanningStateV1 | undefined;
      let legacy: Awaited<ReturnType<PlanningIssueInput["readLegacy"]>>;
      try {
        [issue, saved, legacy] = await Promise.all([
          input.readIssue(),
          input.stateStore.read(input.issue.number),
          input.readLegacy(),
        ]);
      } catch (error) {
        if (error instanceof PlanningStateValidationError)
          return planningBlocked(
            input.issue,
            "planning-state-invalid",
            runOnceFailure("planning-state-invalid", {
              issueNumber: input.issue.number,
              status: "blocked",
              statePath:
                error.statePath ??
                planningStatePath(input.runStateDir, input.issue.number),
              validation: `${error.reason} at ${error.path}`,
            }),
          );
        throw error;
      }
      if (
        (input.expectedStatePresence === "present" && saved === undefined) ||
        (retriedAuthoritativeRun && saved === undefined)
      )
        return planningBlocked(
          input.issue,
          "planning-identity-changed",
          planningIdentityFailure({
            expected: [
              `issueNumber=${input.issue.number}`,
              `title=${input.issue.title}`,
              "planningState=present",
            ],
            observed: [
              `issueNumber=${input.issue.number}`,
              "planningState=absent",
            ],
          }),
        );
      const current = saved ?? input.state;
      const planningActive = current.phases.some(
        (phase) => phase.status !== "complete",
      );
      const legacyConflict = legacyConflictsWithPlanning(legacy);
      if (
        issue.number !== input.issue.number ||
        issue.title !== input.issue.title ||
        current.issueNumber !== input.issue.number ||
        issue.state !== "open" ||
        !planningActive ||
        legacyConflict
      )
        return planningBlocked(
          input.issue,
          "planning-identity-changed",
          planningIdentityFailure({
            expected: [
              `issueNumber=${input.issue.number}`,
              `title=${input.issue.title}`,
              "issueState=open",
              "planningState=active",
              "legacyState=not-active",
            ],
            observed: [
              `issueNumber=${issue.number}`,
              `title=${issue.title}`,
              `issueState=${issue.state}`,
              `planningState=${planningActive ? "active" : "inactive"}`,
              `legacyState=${legacyConflict ? "active" : "not-active"}`,
              `stateIssueNumber=${current.issueNumber}`,
            ],
          }),
        );
      if (saved !== undefined && saved.runId !== lock.record.runId) {
        if (input.expectedStatePresence !== "absent" || retriedAuthoritativeRun)
          return planningBlocked(
            input.issue,
            "planning-identity-changed",
            planningIdentityFailure({
              expected: [`runId=${lock.record.runId}`],
              observed: [`runId=${saved.runId}`],
            }),
          );
        const provisionalLock = lock;
        lock = undefined;
        await releaseOwnedPlanningLock({
          lock: provisionalLock,
          release,
          workFailure: undefined,
        });
        retriedAuthoritativeRun = true;
        try {
          lock = await acquire(input.runStateDir, {
            issueNumber: input.issue.number,
            runId: saved.runId,
          });
        } catch (error) {
          if (error instanceof PlanningIssueLockConflictError) {
            const publicFailure = planningLockFailure(
              input.issue,
              error.diagnostic,
            );
            if (publicFailure.reason === "issue-locked")
              return {
                status: "stopped",
                issue: input.issue,
                reason: "issue-locked",
                publicFailure,
              };
            return planningBlocked(
              input.issue,
              publicFailure.reason,
              publicFailure,
            );
          }
          throw error;
        }
        continue;
      }
      if (current.runId !== lock.record.runId)
        return planningBlocked(
          input.issue,
          "planning-run-id-mismatch",
          runOnceFailure("planning-run-id-mismatch", {
            issueNumber: input.issue.number,
            status: "blocked",
            statePath: planningStatePath(input.runStateDir, input.issue.number),
            savedRunId: current.runId,
            lockRunId: lock.record.runId,
          }),
        );
      const reconciled = await input.reconcileCleanupPendingPublication?.({
        issue,
        state: current,
      });
      if (reconciled !== undefined)
        return { status: "coordinated", issue, outcome: reconciled };
      const eligible = planningIssueEligible({
        issue,
        config: input.config,
        state: current,
        activeOwnedWorkflow: saved !== undefined && planningActive,
      });
      if (
        !eligible ||
        (input.eligible !== undefined && !input.eligible(issue, saved))
      )
        return planningBlocked(
          input.issue,
          "planning-identity-changed",
          planningIdentityFailure({
            expected: ["eligible=true"],
            observed: ["eligible=false"],
          }),
        );
      const fresh = saved === undefined;
      if (fresh) await input.stateStore.initialize({ state: current, lock });
      const labels = await input.mutate(issue, fresh, current);
      return {
        status: "coordinated",
        issue,
        outcome: await input.coordinate(current, lock, issue, labels),
      };
    }
  } catch (error) {
    workFailure = error;
    throw error;
  } finally {
    if (lock) await releaseOwnedPlanningLock({ lock, release, workFailure });
  }
}
