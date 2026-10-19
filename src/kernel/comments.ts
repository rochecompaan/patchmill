import type { Facts } from "./facts.ts";

export const KERNEL_COMMENT = "<!-- patchmill:kernel-comment -->";

export function planningGateComment(facts: Facts): string {
  const pr = facts.pullRequest;
  const reason =
    pr?.state === "closed"
      ? `The ${facts.stage} pull request is closed, not merged. Reopen or replace it before continuing.`
      : pr?.state === "merged"
        ? `The ${facts.stage} pull request is merged. Run Patchmill again to continue.`
        : `The ${facts.stage} pull request is ready. Waiting for it to be merged before continuing. Review approval alone does not advance this gate.`;
  return [reason, facts.specPath, facts.planPath, pr?.url]
    .filter(Boolean)
    .join("\n\n");
}
