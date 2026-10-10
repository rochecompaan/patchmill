import { createPullRequestHost } from "../../../host/factory.ts";
import { PlanningPublicationGit } from "../../../git/planning-publication-git.ts";
import { PlanningRemoteBaseGit } from "../../../git/planning-remote-base.ts";
import { parseCanonicalPullRequestUrl } from "../../../host/pull-request-reference.ts";
import type { CommandRunner } from "../../../command/types.ts";
import type { RepositoryMutationContext } from "../../../git/repository-mutation.ts";
import type { AgentIssueConfig, AgentIssueRunState } from "./types.ts";
import { reconcileLegacyImplementationPr } from "./legacy-pr-reconciliation.ts";
import { findOwnedImplementationPullRequest } from "../../../workflow/implementation-pr-reconciliation.ts";

export function legacyPrServices(
  runner: CommandRunner,
  config: AgentIssueConfig,
  mutation?: RepositoryMutationContext,
) {
  const host = createPullRequestHost({
    runner,
    repoRoot: config.repoRoot,
    remote: config.remote,
    host: config.host,
  });
  const base = new PlanningRemoteBaseGit({
    runner,
    repoRoot: config.repoRoot,
    specsDir: config.specsDir,
    plansDir: config.plansDir,
    ...(mutation ? { mutation } : {}),
  });
  return {
    host,
    reconcile: async (state: AgentIssueRunState) =>
      reconcileLegacyImplementationPr({
        state,
        issueNumber: state.issueNumber,
        baseBranch: config.baseBranch,
        remote: config.remote,
        host,
        git: new PlanningPublicationGit({ runner, repoRoot: config.repoRoot }),
        fetchBase: async () =>
          base.fetch({
            issueNumber: state.issueNumber,
            remote: config.remote,
            baseBranch: config.baseBranch,
            targetRepository:
              state.implementationPr?.publication.targetRepository ??
              (await host.resolveTargetRepositoryIdentity()),
          }),
      }),
  };
}

export async function discoverLegacyImplementationPr(
  runner: CommandRunner,
  config: AgentIssueConfig,
  issueNumber: number,
  branch: string,
) {
  const services = legacyPrServices(runner, config);
  const head = await runner.run(
    "git",
    ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`],
    { cwd: config.repoRoot },
  );
  if (
    head.code !== 0 ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(head.stdout.trim())
  )
    throw new Error("Publication recovery needs the current owned branch head");
  return findOwnedImplementationPullRequest({
    host: services.host,
    issueNumber,
    evidence: {
      publication: {
        targetRepository: await services.host.resolveTargetRepositoryIdentity(),
        headRepository: await services.host.resolveRemoteRepositoryIdentity(
          config.remote,
        ),
        baseBranch: config.baseBranch,
        headBranch: branch,
        headOid: head.stdout.trim(),
      },
      ownershipMarkerRequired: true,
    },
  });
}

/** New handoffs require the marker and a pinned current local head. */
export async function captureLegacyImplementationPr(input: {
  runner: CommandRunner;
  config: AgentIssueConfig;
  state: AgentIssueRunState;
  mutation?: RepositoryMutationContext;
}) {
  const services = legacyPrServices(input.runner, input.config, input.mutation);
  const targetRepository =
    await services.host.resolveTargetRepositoryIdentity();
  const parsed =
    input.state.prUrl &&
    parseCanonicalPullRequestUrl(input.state.prUrl, targetRepository);
  if (!parsed || !input.state.branch)
    throw new Error("Implementation PR URL or branch is invalid");
  const head = await input.runner.run(
    "git",
    ["rev-parse", "--verify", `refs/heads/${input.state.branch}^{commit}`],
    { cwd: input.config.repoRoot },
  );
  if (
    head.code !== 0 ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(head.stdout.trim())
  )
    throw new Error("Implementation branch has no valid current head");
  const headRepository = await services.host.resolveRemoteRepositoryIdentity(
    input.config.remote,
  );
  const evidence = {
    ...parsed,
    publication: {
      targetRepository,
      headRepository,
      baseBranch: input.config.baseBranch,
      headBranch: input.state.branch,
      headOid: head.stdout.trim(),
    },
    ownershipMarkerRequired: true,
  };
  const result = await services.reconcile({
    ...input.state,
    implementationPr: evidence,
  });
  if (result.kind === "blocked") throw new Error(result.reason);
  return result;
}
