import {
  sameRepositoryIdentity,
  type PullRequestReference,
  type PullRequestSummary,
} from "../host/pull-requests.ts";
import { parseCanonicalPullRequestUrl } from "../host/pull-request-reference.ts";
import {
  parsePlanningPullRequestMarker,
  PlanningPullRequestMarkerError,
} from "./planning-pull-request-markers.ts";
import type { PlanningPublicationEvidence } from "./planning-state-types.ts";
import type { PlanningPhaseKind } from "./planning-pull-request-markers.ts";
import {
  assertPlanningPublicationRepositories as assertPublicationRepositories,
  PlanningPublicationRepositoryError,
} from "./planning-publication-repositories.ts";

export type ValidatedPlanningPullRequest = Readonly<{
  summary: PullRequestSummary;
  reference: PullRequestReference;
  url: string;
}>;
export class PlanningPullRequestValidationError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`Planning pull request is invalid: ${reason}`);
    this.name = "PlanningPullRequestValidationError";
    this.reason = reason;
  }
}
function fail(reason: string): never {
  throw new PlanningPullRequestValidationError(reason);
}
export function assertPlanningPublicationRepositories(input: {
  targetRepository: PlanningPublicationEvidence["targetRepository"];
  headRepository: PlanningPublicationEvidence["headRepository"];
}): void {
  try {
    assertPublicationRepositories(input);
  } catch (error) {
    if (error instanceof PlanningPublicationRepositoryError) fail(error.reason);
    throw error;
  }
}
export function validatePlanningPullRequestSummary(input: {
  summary: PullRequestSummary;
  issueNumber: number;
  phase: PlanningPhaseKind;
  publication: PlanningPublicationEvidence;
  expectedReference?: PullRequestReference;
}): ValidatedPlanningPullRequest {
  try {
    assertPlanningPublicationRepositories(input.publication);
    const { summary, publication } = input;
    if (
      !sameRepositoryIdentity(
        summary.targetRepository,
        publication.targetRepository,
      )
    )
      fail("target-repository");
    if (
      !sameRepositoryIdentity(
        summary.headRepository,
        publication.headRepository,
      )
    )
      fail("head-repository");
    if (summary.baseBranch !== publication.baseBranch) fail("base-branch");
    if (summary.headBranch !== publication.headBranch) fail("head-branch");
    if (summary.headSha !== publication.headOid) fail("head-oid");
    const marker = parsePlanningPullRequestMarker(summary.body);
    if (
      marker === undefined ||
      marker.issueNumber !== input.issueNumber ||
      marker.phase !== input.phase
    )
      fail("ownership-marker");
    const canonical = parseCanonicalPullRequestUrl(
      summary.url,
      summary.targetRepository,
    );
    if (
      canonical === undefined ||
      canonical.reference.number !== summary.number
    )
      fail("url");
    const reference = canonical.reference;
    if (
      input.expectedReference !== undefined &&
      (!sameRepositoryIdentity(
        reference.targetRepository,
        input.expectedReference.targetRepository,
      ) ||
        reference.number !== input.expectedReference.number)
    )
      fail("reference");
    return { summary, reference, url: canonical.url };
  } catch (error) {
    if (error instanceof PlanningPullRequestValidationError) throw error;
    if (error instanceof PlanningPullRequestMarkerError)
      fail("ownership-marker");
    fail("malformed-summary");
  }
}
