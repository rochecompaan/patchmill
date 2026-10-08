import { withIssueRunLease } from "../../src/cli/commands/run-once/recovery-lease.ts";
import {
  writeRunState,
  replaceRunStateAfterReset,
} from "../../src/cli/commands/run-once/run-state.ts";
import type { AgentIssueRunStateUpdate } from "../../src/cli/commands/run-once/types.ts";

/** Seed a checkpoint through the real ownership protocol, never a production bypass. */
export function writeFixtureRunState(
  runStateDir: string,
  update: AgentIssueRunStateUpdate,
  now?: string,
) {
  return withIssueRunLease(
    { runStateDir, issueNumber: update.issueNumber },
    (lease) => writeRunState(runStateDir, update, lease, now),
  );
}

export function replaceFixtureRunStateAfterReset(
  runStateDir: string,
  input: Parameters<typeof replaceRunStateAfterReset>[1],
  now?: string,
) {
  return withIssueRunLease(
    { runStateDir, issueNumber: input.issueNumber },
    (lease) => replaceRunStateAfterReset(runStateDir, input, lease, now),
  );
}
