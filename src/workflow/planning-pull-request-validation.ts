import type {
  PullRequestReference,
  PullRequestSummary,
} from "../host/pull-requests.ts";
import { parsePullRequestUrl } from "../host/pull-request-reference.ts";
import {
  parsePlanningPullRequestMarker,
  PlanningPullRequestMarkerError,
} from "./planning-pull-request-markers.ts";
import type { PlanningPublicationEvidence } from "./planning-state-types.ts";
import {
  assertPlanningPublicationRepositories as assertPublicationRepositories,
  PlanningPublicationRepositoryError,
  sameRepositoryIdentity,
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
  phase: "spec" | "plan";
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
    const segment =
      summary.targetRepository.provider === "github-gh" ? "pull" : "pulls";
    const parsed = parsePullRequestUrl(summary.url, segment);
    if (
      `${parsed.hostname}${parsed.port === "" ? "" : `:${parsed.port}`}`.toLowerCase() !==
        summary.targetRepository.host.toLowerCase() ||
      parsed.owner.toLowerCase() !==
        summary.targetRepository.owner.toLowerCase() ||
      parsed.repository.toLowerCase() !==
        summary.targetRepository.repository.toLowerCase() ||
      parsed.number !== summary.number
    )
      fail("url");
    const reference = {
      targetRepository: summary.targetRepository,
      number: summary.number,
    };
    if (
      input.expectedReference !== undefined &&
      (!sameRepositoryIdentity(
        reference.targetRepository,
        input.expectedReference.targetRepository,
      ) ||
        reference.number !== input.expectedReference.number)
    )
      fail("reference");
    return { summary, reference, url: summary.url };
  } catch (error) {
    if (error instanceof PlanningPullRequestValidationError) throw error;
    if (error instanceof PlanningPullRequestMarkerError)
      fail("ownership-marker");
    fail("malformed-summary");
  }
}
