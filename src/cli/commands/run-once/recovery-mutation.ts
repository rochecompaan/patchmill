import type { CommandRunner, RunRecoveryDecision } from "./types.ts";
export class RunRecoveryMutationError extends Error {
  readonly action: Exclude<RunRecoveryDecision["action"], "refuse">;
  readonly completed: RunRecoveryMutationResult["completed"];
  readonly quarantinePaths: string[];
  readonly stagingPaths: string[];
  readonly preservedPaths: string[];
  constructor(
    cause: unknown,
    action: Exclude<RunRecoveryDecision["action"], "refuse">,
    completed: RunRecoveryMutationResult["completed"],
    quarantinePaths: string[],
    stagingPaths: string[],
  ) {
    super(
      `Recovery mutation failed during ${action}: ${cause instanceof Error ? cause.message : String(cause)}\nCompleted actions: ${completed.map((entry) => entry.kind).join(", ") || "none"}\nPreserved paths: ${[...new Set([...quarantinePaths, ...stagingPaths, ...completed.flatMap((entry) => (entry.kind === "publish-worktree" ? [entry.to] : []))])].join(", ") || "none"}`,
    );
    this.name = "RunRecoveryMutationError";
    this.cause = cause;
    this.action = action;
    this.completed = completed;
    this.quarantinePaths = quarantinePaths;
    this.stagingPaths = stagingPaths;
    this.preservedPaths = [
      ...new Set([
        ...quarantinePaths,
        ...stagingPaths,
        ...completed.flatMap((entry) =>
          entry.kind === "publish-worktree" ? [entry.to] : [],
        ),
      ]),
    ];
  }
}
export type RunRecoveryMutationResult = {
  action: Exclude<RunRecoveryDecision["action"], "refuse">;
  completed: Array<
    | { kind: "stage-worktree"; path: string; oid: string }
    | { kind: "quarantine-worktree"; from: string; to: string }
    | { kind: "restore-worktree"; from: string; to: string }
    | { kind: "detach-quarantine"; path: string; oid: string }
    | { kind: "update-branch"; branch: string; from?: string; to?: string }
    | { kind: "publish-worktree"; from: string; to: string }
    | { kind: "recreate-worktree"; worktreePath: string; oid: string }
  >;
  quarantinePaths: string[];
  stagingPaths: string[];
};
import { executeResetRecoveryMutation } from "./recovery-mutation-reset.ts";
import { executeRefreshRecoveryMutation } from "./recovery-mutation-refresh.ts";
import { executeRecreateRecoveryMutation } from "./recovery-mutation-recreate.ts";
export async function executeRunRecoveryMutation(input: {
  decision: Exclude<RunRecoveryDecision, { action: "refuse" }>;
  runner: CommandRunner;
  repoRoot: string;
  reassess: () => Promise<RunRecoveryDecision>;
}): Promise<RunRecoveryMutationResult> {
  const completed: RunRecoveryMutationResult["completed"] = [];
  const quarantinePaths: string[] = [];
  const stagingPaths: string[] = [];
  try {
    if (input.decision.action === "resume")
      return { action: "resume", completed, quarantinePaths, stagingPaths };
    if (input.decision.action === "refresh-and-resume") {
      await executeRefreshRecoveryMutation({
        ...input,
        decision: input.decision,
        completed,
        quarantinePaths,
        stagingPaths,
      });
      return {
        action: input.decision.action,
        completed,
        quarantinePaths,
        stagingPaths,
      };
    }
    if (input.decision.action === "recreate-and-resume") {
      await executeRecreateRecoveryMutation({
        ...input,
        decision: input.decision,
        completed,
        stagingPaths,
      });
      return {
        action: input.decision.action,
        completed,
        quarantinePaths,
        stagingPaths,
      };
    }
    await executeResetRecoveryMutation({
      decision: input.decision,
      runner: input.runner,
      repoRoot: input.repoRoot,
      reassess: input.reassess,
      completed,
      quarantinePaths,
    });
    return {
      action: input.decision.action,
      completed,
      quarantinePaths,
      stagingPaths,
    };
  } catch (error) {
    throw new RunRecoveryMutationError(
      error,
      input.decision.action,
      completed,
      quarantinePaths,
      stagingPaths,
    );
  }
}
