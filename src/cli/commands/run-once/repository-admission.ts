import { randomUUID } from "node:crypto";
import type { CommandRunner } from "../../../command/types.ts";
import { createPullRequestHost } from "../../../host/factory.ts";
import { resolveRunRepositoryNamespace } from "../../../workflow/run-repository-namespace.ts";
import {
  withRunAdmission,
  type RunAdmission,
} from "../../../workflow/run-admission.ts";
import type { AgentIssueConfig } from "./types.ts";

export async function resolveRunOnceRepositoryNamespace(
  runner: CommandRunner,
  config: AgentIssueConfig,
) {
  const hostRepository = await createPullRequestHost({
    runner,
    repoRoot: config.repoRoot,
    remote: config.remote,
    host: config.host,
  }).resolveTargetRepositoryIdentity();
  return resolveRunRepositoryNamespace(runner, {
    repoRoot: config.repoRoot,
    hostRepository,
    runStateDir: config.runStateDir,
    worktreeRoot: config.worktreeDir,
    todoRoot: config.projectPolicy.pi.taskContract.todoRoot,
  });
}

export async function withRunRecoveryAdmission<T>(
  runner: CommandRunner,
  config: AgentIssueConfig,
  issueNumber: number,
  action: (admission: RunAdmission) => Promise<T>,
  attemptId: string = randomUUID(),
): Promise<T> {
  const namespace = await resolveRunOnceRepositoryNamespace(runner, config);
  return withRunAdmission(
    { namespace, mode: "recovery", issueNumber, attemptId },
    action,
  );
}
