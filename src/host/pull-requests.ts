import type { PatchmillHostProviderId } from "../config/types.ts";

export type RepositoryIdentity = {
  provider: PatchmillHostProviderId;
  host: string;
  owner: string;
  repository: string;
};

export type PullRequestStatus = "open" | "merged" | "closed-unmerged";

export type PullRequestReference = {
  targetRepository: RepositoryIdentity;
  number: number;
};

type PullRequestSummaryIdentity = {
  number: number;
  url: string;
  targetRepository: RepositoryIdentity;
  baseBranch: string;
  headRepository: RepositoryIdentity;
  headBranch: string;
  headSha: string;
  body: string;
};

export type PullRequestSummary = PullRequestSummaryIdentity &
  (
    | { status: "open"; mergeCommit?: undefined }
    | { status: "merged"; mergeCommit: string }
    | { status: "closed-unmerged"; mergeCommit?: undefined }
  );

export type CreatePullRequestInput = {
  title: string;
  body: string;
  baseBranch: string;
  headBranch: string;
};

export type FindPullRequestsQuery = {
  targetRepository: RepositoryIdentity;
  baseBranch: string;
  headRepository: RepositoryIdentity;
  headBranch: string;
};

function sameCaseInsensitiveValue(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function sameRepositoryIdentity(
  left: RepositoryIdentity,
  right: RepositoryIdentity,
): boolean {
  return (
    left.provider === right.provider &&
    sameCaseInsensitiveValue(left.host, right.host) &&
    sameCaseInsensitiveValue(left.owner, right.owner) &&
    sameCaseInsensitiveValue(left.repository, right.repository)
  );
}

export class IncompletePullRequestSearchError extends Error {
  readonly query: FindPullRequestsQuery;
  readonly limit?: number;

  constructor(query: FindPullRequestsQuery, limit?: number) {
    super(
      limit === undefined
        ? "Pull request search was incomplete"
        : `Pull request search stopped at provider limit ${limit}`,
    );
    this.name = "IncompletePullRequestSearchError";
    this.query = query;
    if (limit !== undefined) this.limit = limit;
  }
}

export class PullRequestNotFoundError extends Error {
  readonly reference: PullRequestReference;

  constructor(reference: PullRequestReference) {
    super(`Pull request #${reference.number} was not found`);
    this.name = "PullRequestNotFoundError";
    this.reference = reference;
  }
}

export class PullRequestIdentityError extends Error {
  readonly reason: string;
  readonly expected?: RepositoryIdentity;
  readonly actual?: Partial<RepositoryIdentity>;

  constructor(
    reason: string,
    identities: {
      expected?: RepositoryIdentity;
      actual?: Partial<RepositoryIdentity>;
    } = {},
  ) {
    super(`Pull request identity is invalid: ${reason}`);
    this.name = "PullRequestIdentityError";
    this.reason = reason;
    if (identities.expected !== undefined) {
      this.expected = identities.expected;
    }
    if (identities.actual !== undefined) {
      this.actual = identities.actual;
    }
  }
}

export interface PullRequestHost {
  readonly id: PatchmillHostProviderId;

  resolveTargetRepositoryIdentity(): Promise<RepositoryIdentity>;

  resolveRemoteRepositoryIdentity(remote: string): Promise<RepositoryIdentity>;

  createPullRequest(input: CreatePullRequestInput): Promise<PullRequestSummary>;

  findPullRequests(
    query: FindPullRequestsQuery,
  ): Promise<readonly PullRequestSummary[]>;

  getPullRequest(reference: PullRequestReference): Promise<PullRequestSummary>;

  readPullRequestBody(reference: PullRequestReference): Promise<string>;

  updatePullRequestBody(
    reference: PullRequestReference,
    body: string,
  ): Promise<void>;
}
