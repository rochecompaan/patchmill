import {
  PullRequestNotFoundError,
  sameRepositoryIdentity,
  type PullRequestHost,
  type PullRequestReference,
  type PullRequestSummary,
} from "../host/pull-requests.ts";
import { parseCanonicalPullRequestUrl } from "../host/pull-request-reference.ts";
import {
  PlanningPublicationGitError,
  type PlanningPublicationOperations,
} from "../git/planning-publication-git.ts";
import {
  assertImplementationClosingReference,
  PlanningImplementationBodyError,
} from "./planning-implementation-body.ts";
import {
  PlanningPullRequestValidationError,
  validatePlanningPullRequestSummary,
} from "./planning-pull-request-validation.ts";
import type { PlanningPublicationEvidence } from "./planning-state-types.ts";

export type ImplementationPrEvidence = {
  reference: PullRequestReference;
  url: string;
  publication: PlanningPublicationEvidence;
  ownershipMarkerRequired: boolean;
};
export type ImplementationPrReconciliation =
  | { kind: "open" }
  | { kind: "merged"; mergeOid: string; mergedBaseOid: string }
  | { kind: "blocked"; reason: string };
export class ImplementationPrEvidenceError extends Error {
  constructor(reason: string) {
    super(`Implementation PR evidence is invalid: ${reason}`);
    this.name = "ImplementationPrEvidenceError";
  }
}
function validate(
  summary: PullRequestSummary,
  issueNumber: number,
  evidence: Omit<ImplementationPrEvidence, "reference" | "url">,
  expectedReference?: PullRequestReference,
) {
  const validated = validatePlanningPullRequestSummary({
    summary,
    issueNumber,
    phase: "implementation",
    publication: evidence.publication,
    ownershipMarkerRequired: evidence.ownershipMarkerRequired,
    ...(expectedReference ? { expectedReference } : {}),
  });
  assertImplementationClosingReference(summary.body, issueNumber);
  return validated;
}

/** Discovery never publishes or invents review evidence. An ambiguous branch stays blocked. */
export async function findOwnedImplementationPullRequest(input: {
  host: PullRequestHost;
  issueNumber: number;
  evidence: Omit<ImplementationPrEvidence, "reference" | "url">;
}): Promise<ImplementationPrEvidence | undefined> {
  const publication = input.evidence.publication;
  const pulls = await input.host.findPullRequests({
    targetRepository: publication.targetRepository,
    headRepository: publication.headRepository,
    baseBranch: publication.baseBranch,
    headBranch: publication.headBranch,
  });
  if (pulls.length === 0) return undefined;
  if (pulls.length !== 1)
    throw new ImplementationPrEvidenceError("ambiguous owned branch");
  const validated = validate(pulls[0]!, input.issueNumber, input.evidence);
  if (validated.summary.status === "closed-unmerged")
    throw new ImplementationPrEvidenceError(
      "owned PR is closed without a merge",
    );
  return {
    ...input.evidence,
    reference: validated.reference,
    url: validated.url,
  };
}

/** Proves the saved publication against host identity and the freshly fetched target. */
export async function reconcileImplementationPullRequest(input: {
  host: PullRequestHost;
  issueNumber: number;
  evidence: ImplementationPrEvidence;
  fetchBase: () => Promise<{ baseOid: string }>;
  git: Pick<PlanningPublicationOperations, "assertAncestor">;
}): Promise<ImplementationPrReconciliation> {
  const { evidence } = input;
  const canonical = parseCanonicalPullRequestUrl(
    evidence.url,
    evidence.publication.targetRepository,
  );
  if (
    !canonical ||
    canonical.url !== evidence.url ||
    canonical.reference.number !== evidence.reference.number ||
    !sameRepositoryIdentity(
      canonical.reference.targetRepository,
      evidence.reference.targetRepository,
    )
  )
    return { kind: "blocked", reason: "saved PR URL and reference conflict" };
  const repository = await input.host.resolveTargetRepositoryIdentity();
  if (
    !sameRepositoryIdentity(repository, evidence.publication.targetRepository)
  )
    return { kind: "blocked", reason: "target repository changed" };
  let summary: PullRequestSummary;
  try {
    summary = await input.host.getPullRequest(evidence.reference);
    const validated = validate(
      summary,
      input.issueNumber,
      evidence,
      evidence.reference,
    );
    if (validated.url !== evidence.url)
      return { kind: "blocked", reason: "saved PR URL changed" };
  } catch (error) {
    if (
      error instanceof PullRequestNotFoundError ||
      error instanceof PlanningPullRequestValidationError ||
      error instanceof PlanningImplementationBodyError
    )
      return { kind: "blocked", reason: error.message };
    throw error;
  }
  if (summary.status === "open") return { kind: "open" };
  if (summary.status === "closed-unmerged")
    return { kind: "blocked", reason: "saved PR is closed without a merge" };
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(summary.mergeCommit))
    return { kind: "blocked", reason: "merged PR has no valid merge object" };
  const { baseOid } = await input.fetchBase();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(baseOid))
    return { kind: "blocked", reason: "fetched target has no valid object" };
  try {
    await input.git.assertAncestor({
      ancestorOid: summary.mergeCommit,
      descendantOid: baseOid,
    });
  } catch (error) {
    if (
      error instanceof PlanningPublicationGitError &&
      error.reason === "not-ancestor"
    )
      return {
        kind: "blocked",
        reason: "PR merge is not contained in the fetched target",
      };
    throw error;
  }
  return {
    kind: "merged",
    mergeOid: summary.mergeCommit,
    mergedBaseOid: baseOid,
  };
}
