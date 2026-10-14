import { objectWithOptionalKeys, oid } from "./planning-state-codec.ts";
import { sameRepositoryIdentity } from "../host/pull-requests.ts";
import { pullRequestUrlMatchesReference } from "../host/pull-request-reference.ts";
import type {
  PlanningImplementationRevalidationEvidence,
  PlanningImplementationAgentEvidence,
  PlanningImplementationFinishCheckpoints,
  PlanningPublicationEvidence,
  PlanningPullRequestEvidence,
  PlanningWorkspaceEvidence,
  PlanningBaseEvidence,
} from "./planning-state-types.ts";

type Decoders = {
  publication(value: unknown, path: string): PlanningPublicationEvidence;
  pullRequest(value: unknown, path: string): PlanningPullRequestEvidence;
  implementationEvidence(
    value: unknown,
    path: string,
  ): PlanningImplementationAgentEvidence;
  implementationFinish(
    value: unknown,
    path: string,
  ): PlanningImplementationFinishCheckpoints;
  failState(reason: string, path: string): never;
};

export function implementationRevalidationEvidence(
  value: unknown,
  path: string,
  decode: Decoders,
): PlanningImplementationRevalidationEvidence {
  const parsed = objectWithOptionalKeys(
    value,
    ["publication", "implementation"],
    ["pullRequest", "finish", "observedHeadOid"],
    path,
  );
  const publication = decode.publication(
    parsed.publication,
    `${path}.publication`,
  );
  const implementation = decode.implementationEvidence(
    parsed.implementation,
    `${path}.implementation`,
  );
  const pullRequest =
    parsed.pullRequest === undefined
      ? undefined
      : decode.pullRequest(parsed.pullRequest, `${path}.pullRequest`);
  if (
    implementation.branch !== publication.headBranch ||
    (pullRequest !== undefined &&
      (implementation.prUrl !== pullRequest.url ||
        !sameRepositoryIdentity(
          publication.targetRepository,
          pullRequest.reference.targetRepository,
        ) ||
        !pullRequestUrlMatchesReference(
          pullRequest.url,
          pullRequest.reference,
        ))) ||
    (parsed.finish !== undefined && pullRequest === undefined)
  )
    decode.failState("implementation-mismatch", path);
  return {
    publication,
    implementation,
    ...(pullRequest === undefined ? {} : { pullRequest }),
    ...(parsed.finish === undefined
      ? {}
      : {
          finish: decode.implementationFinish(parsed.finish, `${path}.finish`),
        }),
    ...(parsed.observedHeadOid === undefined
      ? {}
      : {
          observedHeadOid: oid(
            parsed.observedHeadOid,
            `${path}.observedHeadOid`,
          ),
        }),
  };
}

export function assertRevalidationWorkspace(
  input: {
    base: PlanningBaseEvidence;
    workspace: PlanningWorkspaceEvidence;
    revalidation: PlanningImplementationRevalidationEvidence;
  },
  path: string,
  fail: Decoders["failState"],
) {
  if (
    input.revalidation.publication.baseBranch !== input.base.baseBranch ||
    input.revalidation.publication.headBranch !==
      input.workspace.identity.branch
  )
    fail("implementation-mismatch", `${path}.revalidation`);
}
