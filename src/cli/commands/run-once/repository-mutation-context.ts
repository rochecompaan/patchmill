import type { CommandRunner } from "../../../command/types.ts";
import type { RepositoryMutationContext } from "../../../git/repository-mutation.ts";
import type { RunOneIssueOptions } from "./pipeline-legacy-types.ts";
import { assertIssueRunLeaseOwned } from "./recovery-lease.ts";

export function repositoryMutationContext(
  runner: CommandRunner,
  options: Pick<RunOneIssueOptions, "admission" | "lease" | "attemptId">,
  issueNumber: number,
): RepositoryMutationContext | undefined {
  if (!options.admission || !options.lease) return undefined;
  const lease = options.lease;
  const namespace = options.admission.namespace;
  return {
    namespace,
    runner,
    attemptId: options.attemptId ?? lease.record.ownerToken,
    assertOwned: () =>
      assertIssueRunLeaseOwned(lease, {
        runStateDir: namespace.runStateDir,
        issueNumber,
      }),
  };
}
