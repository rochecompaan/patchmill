import type { CommandRunner } from "../../../command/types.ts";
import { PlanningRemoteBaseGit } from "../../../git/planning-remote-base.ts";
import { PlanningPublicationGit } from "../../../git/planning-publication-git.ts";
import { createPullRequestHost } from "../../../host/factory.ts";
import type { IssueSummary } from "../../../issue/types.ts";
import {
  assertPlanningIssueLockOwned,
  type PlanningIssueLock,
} from "../../../workflow/planning-issue-lock.ts";
import { reconcileImplementationPullRequest } from "../../../workflow/implementation-pr-reconciliation.ts";
import type { PlanningStateStore } from "../../../workflow/planning-state-store.ts";
import type { PlanningStateV1 } from "../../../workflow/planning-state-types.ts";
import { replacePlanningPhase } from "../../../workflow/planning-phase-replacement.ts";
import { repositoryMutationContext } from "./repository-mutation-context.ts";
import type { RunOneIssueOptions } from "./pipeline-legacy-types.ts";
import type { AgentIssueConfig } from "./types.ts";

/** Validates a saved handoff before labels, workspace creation, or agent reentry. */
export async function reconcileSavedPlanningImplementation(input: {
  runner: CommandRunner;
  config: AgentIssueConfig;
  options: RunOneIssueOptions;
  issue: IssueSummary;
  state: PlanningStateV1;
  lock: PlanningIssueLock;
  stateStore: PlanningStateStore;
}): Promise<
  | { kind: "ready"; state: PlanningStateV1 }
  | { kind: "blocked"; reason: string }
> {
  const phaseIndex = input.state.phases.length - 1;
  const phase = input.state.phases[phaseIndex];
  if (
    phase?.kind !== "implementation" ||
    (phase.status !== "pull-request-open" && phase.status !== "complete")
  )
    return { kind: "ready", state: input.state };
  const common = repositoryMutationContext(
    input.runner,
    input.options,
    input.issue.number,
  );
  const mutation = common && {
    ...common,
    assertOwned: async () => {
      await common.assertOwned();
      await assertPlanningIssueLockOwned(input.lock, {
        issueNumber: input.issue.number,
        runId: input.state.runId,
      });
    },
  };
  const remoteBase = new PlanningRemoteBaseGit({
    runner: input.runner,
    repoRoot: input.config.repoRoot,
    specsDir: input.config.specsDir,
    plansDir: input.config.plansDir,
    ...(mutation ? { mutation } : {}),
  });
  const host = createPullRequestHost({
    runner: input.runner,
    repoRoot: input.config.repoRoot,
    remote: input.config.remote,
    host: input.config.host,
  });
  const reconciliation = await reconcileImplementationPullRequest({
    host,
    issueNumber: input.issue.number,
    evidence: {
      ...phase.pullRequest,
      publication: phase.publication,
      ownershipMarkerRequired: true,
    },
    fetchBase: () =>
      remoteBase.fetch({
        issueNumber: input.issue.number,
        remote: input.config.remote,
        baseBranch: phase.publication.baseBranch,
        targetRepository: phase.publication.targetRepository,
      }),
    git: new PlanningPublicationGit({
      runner: input.runner,
      repoRoot: input.config.repoRoot,
    }),
  });
  if (reconciliation.kind === "blocked") return reconciliation;
  if (input.issue.state !== "open" && reconciliation.kind !== "merged")
    return {
      kind: "blocked",
      reason:
        "The Issue is closed but its saved implementation PR is unmerged. Do not reopen it automatically.",
    };
  if (
    phase.merge &&
    (reconciliation.kind !== "merged" ||
      phase.merge.mergeOid !== reconciliation.mergeOid)
  )
    return {
      kind: "blocked",
      reason: "Saved merge proof conflicts with the host PR",
    };
  let state = input.state;
  if (phase.status === "complete" && phase.merge === undefined) {
    if (input.config.issueNumber !== input.issue.number)
      return {
        kind: "blocked",
        reason: "Resume this older completion with an explicit --issue command",
      };
    await mutation?.assertOwned();
    state = await input.stateStore.reopenUnverifiedImplementation({
      issueNumber: input.issue.number,
      expectedRunId: state.runId,
      expectedRevision: state.revision,
      lock: input.lock,
    });
  }
  const current = state.phases[phaseIndex];
  if (
    reconciliation.kind === "merged" &&
    current?.kind === "implementation" &&
    current.status === "pull-request-open" &&
    current.merge === undefined
  ) {
    await mutation?.assertOwned();
    state = await replacePlanningPhase({
      stateStore: input.stateStore,
      state,
      lock: input.lock,
      phaseIndex,
      ...(input.options.now ? { now: () => input.options.now! } : {}),
      phase: {
        ...current,
        merge: {
          mergeOid: reconciliation.mergeOid,
          mergedBaseOid: reconciliation.mergedBaseOid,
        },
      },
    });
  }
  return { kind: "ready", state };
}
