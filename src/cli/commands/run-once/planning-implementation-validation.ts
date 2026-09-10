import {
  PlanningPublicationGitError,
  type PlanningPublicationOperations,
} from "../../../git/planning-publication-git.ts";
import type { PlanningWorkspaceLifecycle } from "../../../git/planning-workspaces.ts";
import {
  PullRequestNotFoundError,
  sameRepositoryIdentity,
  type PullRequestHost,
} from "../../../host/pull-requests.ts";
import { parsePullRequestUrl } from "../../../host/pull-request-reference.ts";
import { assertImplementationClosingReference } from "../../../workflow/planning-implementation-body.ts";
import {
  assertPlanningPublicationRepositories,
  PlanningPullRequestValidationError,
  validatePlanningPullRequestSummary,
} from "../../../workflow/planning-pull-request-validation.ts";
import type {
  ImplementationBranchPushedPlanningPhase,
  PlanningPublicationEvidence,
  PlanningPullRequestEvidence,
  PlanningStateV1,
} from "../../../workflow/planning-state-types.ts";

export class PlanningImplementationValidationError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`Implementation pull request is invalid: ${reason}`);
    this.name = "PlanningImplementationValidationError";
    this.reason = reason;
  }
}

function fail(reason: string): never {
  throw new PlanningImplementationValidationError(reason);
}

function sameExactPullRequestUrl(
  left: string,
  right: string,
  segment: "pull" | "pulls",
): boolean {
  try {
    const first = parsePullRequestUrl(left, segment);
    const second = parsePullRequestUrl(right, segment);
    return (
      first.protocol === second.protocol &&
      first.hostname === second.hostname &&
      first.port === second.port &&
      first.owner.toLowerCase() === second.owner.toLowerCase() &&
      first.repository.toLowerCase() === second.repository.toLowerCase() &&
      first.number === second.number &&
      first.hasTrailingSlash === second.hasTrailingSlash
    );
  } catch {
    return false;
  }
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
    fail("workspace");
  if (workspace.headOid !== phase.publication.headOid) fail("local-head");
  const remoteHead = await input.git.inspectRemoteHead({
    remote: phase.workspace.remote,
    branch: phase.workspace.identity.branch,
  });
  if (
    remoteHead.state !== "present" ||
    remoteHead.headOid !== workspace.headOid
  )
    fail("remote-head");
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
    fail("target-repository");
  if (!sameRepositoryIdentity(headRepository, phase.publication.headRepository))
    fail("head-repository");
  assertPlanningPublicationRepositories(phase.publication);
  const segment = targetRepository.provider === "github-gh" ? "pull" : "pulls";
  let number: number;
  try {
    const parsed = parsePullRequestUrl(phase.implementation.prUrl, segment);
    const host = `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
    if (
      host.toLowerCase() !== targetRepository.host.toLowerCase() ||
      parsed.owner.toLowerCase() !== targetRepository.owner.toLowerCase() ||
      parsed.repository.toLowerCase() !==
        targetRepository.repository.toLowerCase()
    )
      fail("url");
    number = parsed.number;
  } catch (error) {
    if (error instanceof PlanningImplementationValidationError) throw error;
    fail("url");
  }
  let validated: ReturnType<typeof validatePlanningPullRequestSummary>;
  try {
    const summary = await input.host.getPullRequest({
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
    if (error instanceof PullRequestNotFoundError) fail("missing");
    if (error instanceof PlanningPullRequestValidationError) fail(error.reason);
    throw error;
  }
  if (
    !sameExactPullRequestUrl(phase.implementation.prUrl, validated.url, segment)
  )
    fail("url");
  if (validated.summary.status !== "open") fail("status");
  try {
    assertImplementationClosingReference(
      validated.summary.body,
      input.state.issueNumber,
    );
  } catch {
    fail("closing-reference");
  }
  try {
    await input.git.assertAncestor({
      ancestorOid: phase.base.baseOid,
      descendantOid: workspace.headOid,
    });
  } catch (error) {
    if (
      error instanceof PlanningPublicationGitError &&
      error.reason === "not-ancestor"
    )
      fail("ancestry");
    throw error;
  }
  const workspaceArtifactCommits = input.state.phases.flatMap((item) =>
    "artifacts" in item
      ? item.artifacts
          .filter((artifact) => artifact.source === "workspace")
          .map((artifact) => artifact.commitOid)
      : [],
  );
  for (const commit of new Set([
    ...phase.implementation.commits,
    ...workspaceArtifactCommits,
  ])) {
    try {
      await input.git.assertAncestor({
        ancestorOid: phase.base.baseOid,
        descendantOid: commit,
      });
      await input.git.assertAncestor({
        ancestorOid: commit,
        descendantOid: workspace.headOid,
      });
    } catch (error) {
      if (
        error instanceof PlanningPublicationGitError &&
        error.reason === "not-ancestor"
      )
        fail("ancestry");
      throw error;
    }
  }
  return {
    publication: phase.publication,
    pullRequest: { reference: validated.reference, url: validated.url },
    headOid: workspace.headOid,
  };
}
