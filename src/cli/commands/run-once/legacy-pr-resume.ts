import { randomUUID } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { CommandRunner } from "../../../command/types.ts";
import type { RunOnceHostProvider } from "../../../host/types.ts";
import type { IssueSummary } from "../../../issue/types.ts";
import { planLabelChange } from "../triage/labels.ts";
import { assertIssueRunLeaseOwned } from "./recovery-lease.ts";
import { legacyPrServices } from "./legacy-pr-evidence.ts";
import {
  readRunStateSnapshot,
  validateRecoveryRunState,
  writeRunState,
} from "./run-state.ts";
import {
  configuredWorktreeStrategy,
  expectedIssueWorkspace,
} from "./pipeline-workspace.ts";
import {
  lifecycleLabels,
  nextLabels,
  successfulImplementationFromState,
} from "./pipeline-lifecycle.ts";
import { runPipelineFinishStage } from "./pipeline-finish.ts";
import { runOnceFailure } from "./result-diagnostics.ts";
import { repositoryMutationContext } from "./repository-mutation-context.ts";
import type {
  AgentIssueConfig,
  AgentIssuePipelineResult,
  AgentIssueRunState,
  IssueRunLease,
} from "./types.ts";
import type { RunOneIssueOptions } from "./pipeline-legacy-types.ts";

/** Finish-only recovery runs before workspace creation, artifact loading, or agents. */
export async function resumeLegacyPublishedPr(input: {
  runner: CommandRunner;
  config: AgentIssueConfig;
  host: RunOnceHostProvider;
  issue: IssueSummary;
  state: AgentIssueRunState;
  lease: IssueRunLease;
  options: RunOneIssueOptions;
}): Promise<AgentIssuePipelineResult> {
  const { runner, config, issue, lease } = input;
  const assertOwned = () =>
    assertIssueRunLeaseOwned(lease, {
      runStateDir: config.runStateDir,
      issueNumber: issue.number,
    });
  await assertOwned();
  validateRecoveryRunState(input.state, issue.number);
  const blocked = (reason: string): AgentIssuePipelineResult => ({
    status: "blocked",
    issue,
    reason,
    questions: [],
    commits: input.state.commits ?? [],
    validation: input.state.validation ?? [],
    publicFailure: runOnceFailure("implementation-evidence", {
      issueNumber: issue.number,
      status: "blocked",
      validation: reason,
    }),
  });
  const expected = expectedIssueWorkspace(
    issue.number,
    input.state.title,
    configuredWorktreeStrategy(config),
  );
  if (
    input.state.title !== issue.title ||
    input.state.branch !== expected.branch ||
    !input.state.worktreePath ||
    resolve(config.repoRoot, input.state.worktreePath) !==
      resolve(config.repoRoot, expected.worktreePath)
  )
    return blocked(
      "Saved legacy workspace identity changed; preserve its PR and checkpoint.",
    );
  const mutation = repositoryMutationContext(
    runner,
    input.options,
    issue.number,
  );
  const result = await legacyPrServices(runner, config, mutation).reconcile(
    input.state,
  );
  if (result.kind === "blocked") return blocked(result.reason);
  if (issue.state !== "open" && result.kind !== "merged")
    return blocked(
      "Issue is closed but its PR is unmerged; do not reopen it automatically.",
    );
  await assertOwned();
  let state = input.state;
  if (state.status === "finished" && !state.merge) {
    const snapshot = await readRunStateSnapshot(
      config.runStateDir,
      issue.number,
    );
    if (!snapshot || JSON.stringify(snapshot.state) !== JSON.stringify(state))
      throw new Error(
        "Legacy completion changed before compatibility archival",
      );
    const archive = join(
      config.runStateDir,
      "archive",
      `issue-${issue.number}`,
      `unverified-completion-${randomUUID()}.json`,
    );
    await mkdir(join(config.runStateDir, "archive", `issue-${issue.number}`), {
      recursive: true,
    });
    const handle = await open(archive, "wx", 0o600);
    try {
      await handle.writeFile(snapshot.raw);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertOwned();
    if ((await readFile(snapshot.path, "utf8")) !== snapshot.raw)
      throw new Error(
        "Legacy completion changed before compatibility replacement",
      );
    const {
      doneLabelEnsured: _ensured,
      doneLabelApplied: _applied,
      ...checkpoints
    } = state.checkpoints ?? {};
    await writeRunState(
      config.runStateDir,
      {
        ...state,
        status: "implementing",
        checkpoints,
        resetCheckpoints: true,
        implementationPr: result.evidence,
      },
      lease,
    );
    if (result.kind === "open" && issue.state === "open") {
      const labels = lifecycleLabels(config);
      if (
        config.issueState?.provider === "comments" &&
        config.issueStateProvider
      )
        await config.issueStateProvider.setRoles({
          issue,
          roles: ["in-progress"],
        });
      else
        await input.host.applyLabels(
          planLabelChange(
            issue.number,
            issue.labels,
            nextLabels(
              issue.labels,
              [labels.done, labels.ready, labels.needsInfo],
              [labels.inProgress],
            ),
          ),
        );
    }
  }
  state = await writeRunState(
    config.runStateDir,
    {
      issueNumber: issue.number,
      status: "implementing",
      implementationPr: result.evidence,
      ...(result.kind === "merged"
        ? {
            merge: {
              mergeOid: result.mergeOid,
              mergedBaseOid: result.mergedBaseOid,
            },
          }
        : {}),
    },
    lease,
  );
  const implemented = successfulImplementationFromState(state);
  if (!implemented || implemented.status !== "pr-created")
    return blocked(
      "Saved PR has no complete validation receipt; preserve it for explicit checks and review.",
    );
  const labels = lifecycleLabels(config);
  const outcome = await runPipelineFinishStage({
    lease,
    ...(mutation ? { mutation } : {}),
    runner,
    host: input.host,
    config,
    issue,
    labels: issue.labels,
    readyLabel: labels.ready,
    inProgressLabel: labels.inProgress,
    doneLabel: labels.done,
    needsInfoLabel: labels.needsInfo,
    implemented,
    implementationPr: result.evidence,
    ...(state.merge ? { merge: state.merge } : {}),
    checkpoints: { ...state.checkpoints },
    runCostReport: state.runCostReport,
    specPath: state.specPath,
    specCommit: state.specCommit,
    planPath: state.planPath,
    planCommit: state.planCommit,
    branch: state.branch,
    worktreePath: state.worktreePath!,
    timestamp: (input.options.now ?? new Date()).toISOString(),
    runOptions: input.options,
    runStep: async (_label, action) => action(),
  });
  if (outcome.kind === "unexpected") throw outcome.error;
  return outcome.result;
}
