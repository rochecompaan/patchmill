import {
  sameRepositoryIdentity,
  type RepositoryIdentity,
} from "../host/pull-requests.ts";

export type PlanningPublicationRepositoryReason =
  | "provider-mismatch"
  | "github-head-mismatch"
  | "forgejo-host-mismatch";

export class PlanningPublicationRepositoryError extends Error {
  readonly reason: PlanningPublicationRepositoryReason;

  constructor(reason: PlanningPublicationRepositoryReason) {
    super(`Planning publication repository is invalid: ${reason}`);
    this.name = "PlanningPublicationRepositoryError";
    this.reason = reason;
  }
}

function sameRepositoryHost(
  left: RepositoryIdentity,
  right: RepositoryIdentity,
): boolean {
  return left.host.toLowerCase() === right.host.toLowerCase();
}

export function assertPlanningPublicationRepositories(input: {
  targetRepository: RepositoryIdentity;
  headRepository: RepositoryIdentity;
}): void {
  const { targetRepository, headRepository } = input;
  if (targetRepository.provider !== headRepository.provider) {
    throw new PlanningPublicationRepositoryError("provider-mismatch");
  }
  if (
    targetRepository.provider === "github-gh" &&
    !sameRepositoryIdentity(targetRepository, headRepository)
  ) {
    throw new PlanningPublicationRepositoryError("github-head-mismatch");
  }
  if (
    targetRepository.provider === "forgejo-tea" &&
    !sameRepositoryHost(targetRepository, headRepository)
  ) {
    throw new PlanningPublicationRepositoryError("forgejo-host-mismatch");
  }
}
