import type { Host, Issue, Repository } from "../host/types.ts";
import type { WorkflowState } from "./workflow-state.ts";
import type { Facts, FactsResult } from "./facts.ts";
import type { HumanChannel } from "./human-channel.ts";
import { derivePhase } from "./phase.ts";
import { wrongTarget } from "./pull-request.ts";
import { closesIssue } from "./verify.ts";

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

/** The review-wait text. The Console agent relays it, so it speaks as "I". */
export function reviewWaitMessage(input: {
  url: string;
  issue: number;
  recheck: boolean;
}): string {
  const { url, issue } = input;
  if (input.recheck)
    return [
      `Pull request ${url} is not merged yet. The wait continues.`,
      "",
      "- Merge the pull request, then tell me to continue.",
      "- If the pull request needs changes, tell me what to change.",
      "- To stop the wait, quit or pause the session.",
    ].join("\n");
  return [
    `Pull request ready for review: ${url}`,
    "",
    "- You review and merge the pull request. Patchmill does not check for the merge by itself.",
    `- After the merge, tell me to continue. Patchmill then confirms the merge and removes the worktrees and branches of issue #${issue}.`,
    "- If the pull request needs changes, tell me what to change. I make the changes on the issue branch and push them. The wait continues.",
    `- To stop the wait, quit or pause the session. The next start of issue #${issue} continues the wait.`,
  ].join("\n");
}

/** Owns the review wait, including its already-published restart path. */
export async function reviewWait(input: {
  facts: Facts;
  issue: number;
  host: Host;
  workflow: WorkflowState;
  human: HumanChannel;
  restart: boolean;
  refresh: () => Promise<Facts>;
  publish: () => Promise<void>;
  update: (
    facts: Facts,
    label: "done" | "needsInfo",
    summary: string,
  ) => void | Promise<void>;
}): Promise<void> {
  const { issue, host, workflow, human } = input;
  let facts = input.facts;
  if (input.restart) await workflow.setStatus(issue, { status: "done" });
  else await input.publish();
  await input.update(facts, "done", "The pull request was verified.");
  let recheck = false;
  while (
    (await human.awaitContinue({
      kind: "review",
      message: reviewWaitMessage({
        url: facts.pullRequest!.url,
        issue,
        recheck,
      }),
    })) === "continue"
  ) {
    recheck = true;
    facts = await input.refresh();
    const repository = await host.repository();
    const decision = derivePhase(facts);
    if (
      decision.kind === "stop" &&
      decision.label === "done" &&
      facts.pullRequest &&
      closesIssue(facts.pullRequest.body, issue, repository)
    ) {
      await input.update(facts, "done", "The pull request is merged.");
      return;
    }
    if (isReviewWait(facts, issue, repository)) continue;
    await input.update(
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
