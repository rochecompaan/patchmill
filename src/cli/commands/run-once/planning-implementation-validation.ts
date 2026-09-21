import type { PlanningPublicationOperations } from "../../../git/planning-publication-git.ts";
import type { PlanningWorkspaceLifecycle } from "../../../git/planning-workspaces.ts";
import {
  PullRequestNotFoundError,
  sameRepositoryIdentity,
  type PullRequestHost,
} from "../../../host/pull-requests.ts";
import { parseCanonicalPullRequestUrl } from "../../../host/pull-request-reference.ts";
import { assertImplementationClosingReference } from "../../../workflow/planning-implementation-body.ts";
import {
  assertPlanningImplementationAncestry,
  PlanningImplementationAncestryError,
} from "./planning-implementation-ancestry.ts";
import {
  assertPlanningPublicationRepositories,
  PlanningPullRequestValidationError,
  type PlanningPullRequestValidationReason,
  validatePlanningPullRequestSummary,
} from "../../../workflow/planning-pull-request-validation.ts";
import type {
  ImplementationBranchPushedPlanningPhase,
  PlanningPublicationEvidence,
  PlanningPullRequestEvidence,
  PlanningStateV1,
} from "../../../workflow/planning-state-types.ts";

export type PlanningImplementationValidationReason =
  | "workspace"
  | "local-head"
  | "remote-head"
  | "target-repository"
  | "head-repository"
  | "url"
  | "missing"
  | "status"
  | "closing-reference"
  | "ancestry"
  | PlanningPullRequestValidationReason;

type ValidationFacts = {
  expected?: readonly string[];
  observed?: readonly string[];
};

export class PlanningImplementationValidationError extends Error {
  readonly validationReason: PlanningImplementationValidationReason;
  readonly facts: ValidationFacts;

  constructor(
    validationReason: PlanningImplementationValidationReason,
    facts: ValidationFacts = {},
  ) {
    super(`Implementation pull request is invalid: ${validationReason}`);
    this.name = "PlanningImplementationValidationError";
    this.validationReason = validationReason;
    this.facts = facts;
  }
}

function fail(
  validationReason: PlanningImplementationValidationReason,
  facts?: ValidationFacts,
): never {
  throw new PlanningImplementationValidationError(validationReason, facts);
}

function repositoryIdentity(input: {
  host: string;
  owner: string;
  repository: string;
}): string {
  return `${input.host}/${input.owner}/${input.repository}`;
}

function workspaceIdentity(input: {
  state: string;
  clean?: boolean;
  headOid?: string;
}): string[] {
  return [
    `state=${input.state}`,
    ...(input.clean === undefined ? [] : [`clean=${input.clean}`]),
    ...(input.headOid === undefined ? [] : [`headOid=${input.headOid}`]),
  ];
}

export type PlanningImplementationValidationInput = {
  state: PlanningStateV1;
  phase: ImplementationBranchPushedPlanningPhase;
  host: PullRequestHost;
  workspaces: Pick<PlanningWorkspaceLifecycle, "inspect">;
  git: Pick<
    PlanningPublicationOperations,
    "inspectRemoteHead" | "assertAncestor"
  >;
};

/** Proves the exact local, remote, and host PR facts before finish effects. */
export async function validatePlanningImplementation(
  input: PlanningImplementationValidationInput,
): Promise<{
  publication: PlanningPublicationEvidence;
  pullRequest: PlanningPullRequestEvidence;
  headOid: string;
}> {
  const { phase } = input;
  const workspace = await input.workspaces.inspect(phase.workspace.identity);
  if (
    workspace.state !== "ready" ||
    !workspace.clean ||
    workspace.headOid !== phase.workspace.headOid
  )
    fail("workspace", {
      expected: [
        "state=ready",
        "clean=true",
        `headOid=${phase.workspace.headOid}`,
      ],
      observed: workspaceIdentity(workspace),
    });
  if (workspace.headOid !== phase.publication.headOid)
    fail("local-head", {
      expected: [`headOid=${phase.publication.headOid}`],
      observed: [`headOid=${workspace.headOid}`],
    });
  const remoteHead = await input.git.inspectRemoteHead({
    remote: phase.workspace.remote,
    branch: phase.workspace.identity.branch,
  });
  if (
    remoteHead.state !== "present" ||
    remoteHead.headOid !== workspace.headOid
  )
    fail("remote-head", {
      expected: [`state=present`, `headOid=${workspace.headOid}`],
      observed: [
        `state=${remoteHead.state}`,
        ...(remoteHead.state === "present"
          ? [`headOid=${remoteHead.headOid}`]
          : []),
      ],
    });
  const [targetRepository, headRepository] = await Promise.all([
    input.host.resolveTargetRepositoryIdentity(),
    input.host.resolveRemoteRepositoryIdentity(phase.workspace.remote),
  ]);
  if (
    !sameRepositoryIdentity(
      targetRepository,
      phase.publication.targetRepository,
    )
  )
    fail("target-repository", {
      expected: [repositoryIdentity(phase.publication.targetRepository)],
      observed: [repositoryIdentity(targetRepository)],
    });
  if (!sameRepositoryIdentity(headRepository, phase.publication.headRepository))
    fail("head-repository", {
      expected: [repositoryIdentity(phase.publication.headRepository)],
      observed: [repositoryIdentity(headRepository)],
    });
  assertPlanningPublicationRepositories(phase.publication);
  const canonical = parseCanonicalPullRequestUrl(
    phase.implementation.prUrl,
    targetRepository,
  );
  if (canonical === undefined)
    fail("url", {
      expected: [`repository=${repositoryIdentity(targetRepository)}`],
      observed: [`url=${phase.implementation.prUrl}`],
    });
  const { number } = canonical.reference;
  let validated: ReturnType<typeof validatePlanningPullRequestSummary>;
  let summary:
    | Awaited<ReturnType<PullRequestHost["getPullRequest"]>>
    | undefined;
  try {
    summary = await input.host.getPullRequest({
      targetRepository,
      number,
    });
    validated = validatePlanningPullRequestSummary({
      summary,
      issueNumber: input.state.issueNumber,
      phase: "implementation",
      publication: phase.publication,
      expectedReference: { targetRepository, number },
    });
  } catch (error) {
    if (error instanceof PullRequestNotFoundError)
      fail("missing", {
        expected: [`url=${phase.implementation.prUrl}`],
        observed: ["pull request not found"],
      });
    if (error instanceof PlanningPullRequestValidationError)
      fail(error.reason, {
        expected: [
          `targetRepository=${repositoryIdentity(phase.publication.targetRepository)}`,
          `headRepository=${repositoryIdentity(phase.publication.headRepository)}`,
          `baseBranch=${phase.publication.baseBranch}`,
          `headBranch=${phase.publication.headBranch}`,
          `headOid=${phase.publication.headOid}`,
        ],
        ...(summary === undefined
          ? {}
          : {
              observed: [
                `targetRepository=${repositoryIdentity(summary.targetRepository)}`,
                `headRepository=${repositoryIdentity(summary.headRepository)}`,
                `baseBranch=${summary.baseBranch}`,
                `headBranch=${summary.headBranch}`,
                `headOid=${summary.headSha}`,
                `status=${summary.status}`,
                `url=${summary.url}`,
              ],
            }),
      });
    throw error;
  }
  if (phase.implementation.prUrl !== validated.url)
    fail("url", {
      expected: [`url=${phase.implementation.prUrl}`],
      observed: [`url=${validated.url}`],
    });
  if (validated.summary.status !== "open")
    fail("status", {
      expected: ["status=open"],
      observed: [`status=${validated.summary.status}`],
    });
  try {
    assertImplementationClosingReference(
      validated.summary.body,
      input.state.issueNumber,
    );
  } catch {
    fail("closing-reference", {
      expected: [`Closes #${input.state.issueNumber}`],
      observed: ["pull request body has no unambiguous closing reference"],
    });
  }
  try {
    await assertPlanningImplementationAncestry({
      state: input.state,
      baseOid: phase.base.baseOid,
      savedHeadOid: phase.workspace.headOid,
      headOid: workspace.headOid,
      commits: phase.implementation.commits,
      git: input.git,
    });
  } catch (error) {
    if (error instanceof PlanningImplementationAncestryError)
      fail("ancestry", {
        expected: [
          `baseOid=${phase.base.baseOid}`,
          `savedHeadOid=${phase.workspace.headOid}`,
        ],
        observed: [
          `headOid=${workspace.headOid}`,
          ...phase.implementation.commits.map((commit) => `commit=${commit}`),
        ],
      });
    throw error;
  }
  return {
    publication: phase.publication,
    pullRequest: { reference: validated.reference, url: validated.url },
    headOid: workspace.headOid,
  };
}
