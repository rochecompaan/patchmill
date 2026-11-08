import type { Host, Issue, Repository } from "../host/types.ts";
import type { WorkflowState } from "./workflow-state.ts";
import type { Facts, FactsResult } from "./facts.ts";
import type { HumanChannel } from "./human-channel.ts";
import { derivePhase } from "./phase.ts";
import { wrongTarget } from "./pull-request.ts";
import { closesIssue } from "./verify.ts";
import { cleanupMergedIssue } from "./merged-cleanup.ts";
import type { CommandRunner } from "../process/command.ts";

/** D5: an open, ready implementation PR that closes the issue. */
export function isReviewWait(
  facts: Facts,
  issue: number,
  repository: Pick<Repository, "owner" | "repo">,
): boolean {
  const pr = facts.pullRequest;
  return (
    facts.stage === "implementation" &&
    !!pr &&
    pr.state === "open" &&
    !pr.draft &&
    !wrongTarget(pr, facts.baseBranch) &&
    closesIssue(pr.body, issue, repository)
  );
}

/** Owns the review wait, including its already-published restart path. */
export async function reviewWait(input: {
  facts: Facts;
  issue: number;
  host: Host;
  workflow: WorkflowState;
  human: HumanChannel;
  runner: CommandRunner;
  repoRoot: string;
  restart: boolean;
  refresh: () => Promise<Facts>;
  publish: () => Promise<void>;
  update: (facts: Facts, label: "done" | "needsInfo", summary: string) => void;
}): Promise<void> {
  const { issue, host, workflow, human } = input;
  let facts = input.facts;
  if (input.restart) await workflow.setStatus(issue, { status: "done" });
  else await input.publish();
  input.update(facts, "done", "The pull request was verified.");
  while (
    (await human.awaitContinue({
      kind: "review",
      message: `${facts.pullRequest!.url}: waiting for the merge.`,
    })) === "continue"
  ) {
    facts = await input.refresh();
    const repository = await host.repository();
    const decision = derivePhase(facts);
    if (
      decision.kind === "stop" &&
      decision.label === "done" &&
      facts.pullRequest &&
      closesIssue(facts.pullRequest.body, issue, repository)
    ) {
      input.update(facts, "done", "The pull request is merged.");
      await cleanupMergedIssue({ ...input, facts });
      return;
    }
    if (isReviewWait(facts, issue, repository)) continue;
    input.update(
      facts,
      "needsInfo",
      `The pull request no longer proves implementation completion for issue #${issue}.`,
    );
    await input.publish();
    return;
  }
}

/** Re-observe the same implementation branch while the lock remains held. */
export async function collectReviewFacts(
  workflow: WorkflowState,
  issue: number,
  facts: Facts,
  collect: (issue: Issue, workspace: Facts) => Promise<FactsResult>,
): Promise<Facts> {
  const result = await collect(await workflow.issue(issue), facts);
  if (result.kind !== "facts") throw new Error("Several issue branches exist.");
  return result.facts;
}
