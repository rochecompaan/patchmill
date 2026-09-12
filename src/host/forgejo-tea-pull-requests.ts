import type { CommandRunner } from "../command/types.ts";
import { ForgejoTeaPullRequestCommands } from "./forgejo-tea-pull-request-commands.ts";
import {
  validateForgejoBranchName,
  validateForgejoPullRequestNumber,
  validateForgejoRemoteName,
  normalizeForgejoPullRequest,
} from "./forgejo-tea-pull-request-parsing.ts";
import {
  PullRequestIdentityError,
  sameRepositoryIdentity,
  type CreatePullRequestInput,
  type FindPullRequestsQuery,
  type PullRequestHost,
  type PullRequestReference,
  type PullRequestSummary,
  type RepositoryIdentity,
} from "./pull-requests.ts";

export type ForgejoTeaPullRequestHostOptions = {
  runner: CommandRunner;
  repoRoot: string;
  pushRemote: string;
  login?: string;
};
export class ForgejoTeaPullRequestHost implements PullRequestHost {
  readonly id = "forgejo-tea" as const;
  readonly options: ForgejoTeaPullRequestHostOptions;
  readonly commands: ForgejoTeaPullRequestCommands;
  constructor(options: ForgejoTeaPullRequestHostOptions) {
    validateForgejoRemoteName(options.pushRemote);
    this.options = options;
    this.commands = new ForgejoTeaPullRequestCommands(options);
  }
  resolveTargetRepositoryIdentity(): Promise<RepositoryIdentity> {
    return this.commands.resolveTargetRepositoryIdentity();
  }
  resolveRemoteRepositoryIdentity(remote: string): Promise<RepositoryIdentity> {
    return this.commands.resolveRemoteRepositoryIdentity(remote);
  }
  private async context(): Promise<{
    targetRepository: RepositoryIdentity;
    headRepository: RepositoryIdentity;
  }> {
    const [targetRepository, headRepository] = await Promise.all([
      this.commands.resolveTargetRepositoryIdentity(),
      this.commands.resolveRemoteRepositoryIdentity(this.options.pushRemote),
    ]);
    if (
      targetRepository.provider !== headRepository.provider ||
      targetRepository.host.toLowerCase() !== headRepository.host.toLowerCase()
    )
      throw new PullRequestIdentityError(
        "target and push remote hosts disagree",
        { expected: targetRepository, actual: headRepository },
      );
    return { targetRepository, headRepository };
  }
  async createPullRequest(
    input: CreatePullRequestInput,
  ): Promise<PullRequestSummary> {
    validateForgejoBranchName(input.baseBranch);
    validateForgejoBranchName(input.headBranch);
    const { targetRepository, headRepository } = await this.context();
    const result = normalizeForgejoPullRequest(
      await this.commands.createPullRequestPayload({
        ...input,
        headOwner: headRepository.owner,
      }),
      {
        operation: "create-pull-request",
        expectedTargetRepository: targetRepository,
        expectedHeadRepository: headRepository,
      },
    );
    if (
      result.baseBranch !== input.baseBranch ||
      result.headBranch !== input.headBranch
    )
      throw new PullRequestIdentityError(
        "created pull request branches disagree",
      );
    return result;
  }
  async findPullRequests(
    query: FindPullRequestsQuery,
  ): Promise<readonly PullRequestSummary[]> {
    validateForgejoBranchName(query.baseBranch);
    validateForgejoBranchName(query.headBranch);
    const { targetRepository, headRepository } = await this.context();
    if (!sameRepositoryIdentity(query.targetRepository, targetRepository))
      throw new PullRequestIdentityError("search target disagrees", {
        expected: targetRepository,
        actual: query.targetRepository,
      });
    if (!sameRepositoryIdentity(query.headRepository, headRepository))
      throw new PullRequestIdentityError("search head disagrees", {
        expected: headRepository,
        actual: query.headRepository,
      });
    const all = await this.commands.listPullRequests({
      query,
      normalize: (payload) =>
        normalizeForgejoPullRequest(payload, {
          operation: "list-pull-requests",
          expectedTargetRepository: targetRepository,
        }),
    });
    return all.filter(
      (entry) =>
        sameRepositoryIdentity(
          entry.targetRepository,
          query.targetRepository,
        ) &&
        entry.baseBranch === query.baseBranch &&
        sameRepositoryIdentity(entry.headRepository, query.headRepository) &&
        entry.headBranch === query.headBranch,
    );
  }
  async getPullRequest(
    reference: PullRequestReference,
  ): Promise<PullRequestSummary> {
    validateForgejoPullRequestNumber(reference.number);
    const { targetRepository, headRepository } = await this.context();
    if (!sameRepositoryIdentity(reference.targetRepository, targetRepository))
      throw new PullRequestIdentityError("pull request target disagrees", {
        expected: targetRepository,
        actual: reference.targetRepository,
      });
    return normalizeForgejoPullRequest(
      await this.commands.getPullRequestPayload(reference),
      {
        operation: "get-pull-request",
        expectedTargetRepository: targetRepository,
        expectedHeadRepository: headRepository,
        expectedNumber: reference.number,
      },
    );
  }
  async readPullRequestBody(reference: PullRequestReference): Promise<string> {
    return (await this.getPullRequest(reference)).body;
  }
  async updatePullRequestBody(
    reference: PullRequestReference,
    body: string,
  ): Promise<void> {
    validateForgejoPullRequestNumber(reference.number);
    await this.getPullRequest(reference);
    await this.commands.updatePullRequestBody(reference, body);
  }
}
