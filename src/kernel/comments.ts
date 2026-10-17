import type { Facts } from "./facts.ts";

export const KERNEL_COMMENT = "<!-- patchmill:kernel-comment -->";

export function specReviewComment(facts: Facts): string {
  return [
    "The spec is ready for review. Approval is required.",
    facts.specPath,
    facts.pullRequest?.url,
  ]
    .filter(Boolean)
    .join("\n\n");
}
