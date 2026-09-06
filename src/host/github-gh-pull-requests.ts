import type { CommandRunner } from "../process/command.ts";
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
import {
  GitHubPullRequestCommandError,
  GitHubPullRequestInputError,
} from "./github-gh-pull-request-errors.ts";
import {
  assertGitHubHeadBranch,
  assertPullRequestNumber,
  githubRepositorySelector,
  parseCreatedGitHubPullRequest,
  parseGitHubPullRequests,
} from "./github-gh-pull-request-parsing.ts";
import { GitHubPullRequestCommands } from "./github-gh-pull-request-commands.ts";
import { GitHubPullRequestView } from "./github-gh-pull-request-view.ts";

const PULL_REQUEST_JSON_FIELDS =
  "number,url,state,mergeCommit,baseRefName,headRefName,headRefOid,headRepository,body";
const DEFAULT_DISCOVERY_LIMIT = 1000;

export type GitHubGhPullRequestHostOptions = {
  runner: CommandRunner;
  repoRoot: string;
  pushRemote: string;
  discoveryLimit?: number;
};

export class GitHubGhPullRequestHost implements PullRequestHost {
  readonly id = "github-gh" as const;
  private readonly commands: GitHubPullRequestCommands;
  private readonly view: GitHubPullRequestView;
  private readonly discoveryLimit: number;

  constructor(options: GitHubGhPullRequestHostOptions) {
    if (!options.pushRemote.trim())
      throw new GitHubPullRequestInputError(
        "blank-push-remote",
        "Push remote must not be blank",
      );
    const discoveryLimit = options.discoveryLimit ?? DEFAULT_DISCOVERY_LIMIT;
    if (!Number.isSafeInteger(discoveryLimit) || discoveryLimit <= 0)
      throw new GitHubPullRequestInputError(
        "invalid-discovery-limit",
        "Discovery limit must be a positive safe integer",
      );
    this.discoveryLimit = discoveryLimit;
    this.commands = new GitHubPullRequestCommands(
      options.runner,
      options.repoRoot,
      options.pushRemote,
    );
    this.view = new GitHubPullRequestView(
      (args) => this.commands.gh(args),
      PULL_REQUEST_JSON_FIELDS,
    );
  }

  resolveTargetRepositoryIdentity(): Promise<RepositoryIdentity> {
    return this.commands.resolveTarget();
  }

  resolveRemoteRepositoryIdentity(remote: string): Promise<RepositoryIdentity> {
    return this.commands.resolveRemote(remote);
  }

  private async getAfterValidation(
    reference: PullRequestReference,
  ): Promise<PullRequestSummary> {
    const context = await this.commands.context();
    if (
      !sameRepositoryIdentity(
        context.targetRepository,
        reference.targetRepository,
      )
    )
      throw new PullRequestIdentityError(
        "reference target does not match repository",
        {
          expected: context.targetRepository,
          actual: reference.targetRepository,
        },
      );
    return this.view.get(
      reference,
      context.targetRepository,
      context.repositorySelector,
    );
  }

  async createPullRequest(
    input: CreatePullRequestInput,
  ): Promise<PullRequestSummary> {
    assertGitHubHeadBranch(input.headBranch);
    const context = await this.commands.context();
    const result = await this.commands.gh([
      "pr",
      "create",
      "--repo",
      context.repositorySelector,
      "--base",
      input.baseBranch,
      "--head",
      `${context.targetRepository.owner}:${input.headBranch}`,
      "--title",
      input.title,
      "--body",
      input.body,
    ]);
    if (result.code !== 0)
      throw new GitHubPullRequestCommandError(
        "create-pull-request",
        "gh",
        result,
      );
    const reference = parseCreatedGitHubPullRequest(
      result.stdout,
      context.targetRepository,
    );
    return this.view.get(
      reference,
      context.targetRepository,
      context.repositorySelector,
    );
  }

  async findPullRequests(
    query: FindPullRequestsQuery,
  ): Promise<readonly PullRequestSummary[]> {
    assertGitHubHeadBranch(query.headBranch);
    const context = await this.commands.context();
    if (
      !sameRepositoryIdentity(context.targetRepository, query.targetRepository)
    )
      throw new PullRequestIdentityError(
        "query target does not match repository",
        {
          expected: context.targetRepository,
          actual: query.targetRepository,
        },
      );
    if (!sameRepositoryIdentity(context.targetRepository, query.headRepository))
      throw new PullRequestIdentityError(
        "query head repository does not match target",
        { expected: context.targetRepository, actual: query.headRepository },
      );
    const result = await this.commands.gh([
      "pr",
      "list",
      "--repo",
      context.repositorySelector,
      "--state",
      "all",
      "--base",
      query.baseBranch,
      "--head",
      query.headBranch,
      "--limit",
      String(this.discoveryLimit),
      "--json",
      PULL_REQUEST_JSON_FIELDS,
    ]);
    if (result.code !== 0)
      throw new GitHubPullRequestCommandError(
        "list-pull-requests",
        "gh",
        result,
      );
    return parseGitHubPullRequests(
      result.stdout,
      query,
      this.discoveryLimit,
      context.targetRepository,
    );
  }

  getPullRequest(reference: PullRequestReference): Promise<PullRequestSummary> {
    assertPullRequestNumber(reference.number);
    return this.getAfterValidation(reference);
  }

  async readPullRequestBody(reference: PullRequestReference): Promise<string> {
    assertPullRequestNumber(reference.number);
    return (await this.getAfterValidation(reference)).body;
  }

  async updatePullRequestBody(
    reference: PullRequestReference,
    body: string,
  ): Promise<void> {
    assertPullRequestNumber(reference.number);
    const summary = await this.getAfterValidation(reference);
    const result = await this.commands.gh([
      "pr",
      "edit",
      String(summary.number),
      "--repo",
      githubRepositorySelector(summary.targetRepository),
      "--body",
      body,
    ]);
    if (result.code !== 0)
      throw new GitHubPullRequestCommandError(
        "edit-pull-request",
        "gh",
        result,
      );
  }
}
