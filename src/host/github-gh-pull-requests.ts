import type { CommandResult, CommandRunner } from "../process/command.ts";
import {
  PullRequestIdentityError,
  PullRequestNotFoundError,
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
  GitHubPullRequestResponseError,
} from "./github-gh-pull-request-errors.ts";
import {
  assertGitHubHeadBranch,
  assertPullRequestNumber,
  githubRepositorySelector,
  parseCreatedGitHubPullRequest,
  parseGitHubPullRequest,
  parseGitHubPullRequestExistence,
  parseGitHubPullRequests,
  parseGitHubRemoteRepositorySelector,
  parseGitHubRepositoryIdentity,
} from "./github-gh-pull-request-parsing.ts";

const REPOSITORY_JSON_FIELDS = "nameWithOwner,url";
const PULL_REQUEST_JSON_FIELDS =
  "number,url,state,mergeCommit,baseRefName,headRefName,headRefOid,headRepository,body";
const DEFAULT_DISCOVERY_LIMIT = 1000;
const PULL_REQUEST_EXISTENCE_QUERY =
  "query PatchmillPullRequestExists($owner: String!, $repository: String!, $number: Int!) { repository(owner: $owner, name: $repository) { nameWithOwner pullRequest(number: $number) { number } } }";
export type GitHubGhPullRequestHostOptions = {
  runner: CommandRunner;
  repoRoot: string;
  pushRemote: string;
  discoveryLimit?: number;
};
type Options = Required<GitHubGhPullRequestHostOptions>;

export class GitHubGhPullRequestHost implements PullRequestHost {
  readonly id = "github-gh" as const;
  private readonly options: Options;
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
    this.options = { ...options, discoveryLimit };
  }
  private runGh(args: string[]): Promise<CommandResult> {
    return this.options.runner.run("gh", args, {
      cwd: this.options.repoRoot,
      env: { GH_REPO: undefined },
    });
  }
  private runGit(args: string[]): Promise<CommandResult> {
    return this.options.runner.run("git", args, { cwd: this.options.repoRoot });
  }
  private ensure(
    result: CommandResult,
    operation: ConstructorParameters<typeof GitHubPullRequestCommandError>[0],
    command: "git" | "gh",
  ): CommandResult {
    if (result.code !== 0)
      throw new GitHubPullRequestCommandError(operation, command, result);
    return result;
  }
  async resolveTargetRepositoryIdentity(): Promise<RepositoryIdentity> {
    const result = this.ensure(
      await this.runGh(["repo", "view", "--json", REPOSITORY_JSON_FIELDS]),
      "resolve-target-repository",
      "gh",
    );
    return parseGitHubRepositoryIdentity(result.stdout);
  }
  async resolveRemoteRepositoryIdentity(
    remote: string,
  ): Promise<RepositoryIdentity> {
    const result = this.ensure(
      await this.runGit(["remote", "get-url", "--push", "--all", "--", remote]),
      "read-push-remote-urls",
      "git",
    );
    const urls = result.stdout.split(/\r?\n/u);
    while (urls.at(-1) === "") urls.pop();
    if (!urls.length || urls.some((url) => !url))
      throw new GitHubPullRequestResponseError("remote-url-list", "git remote");
    let identity: RepositoryIdentity | undefined;
    for (const url of urls) {
      const selector = parseGitHubRemoteRepositorySelector(url);
      const resolved = this.ensure(
        await this.runGh([
          "repo",
          "view",
          githubRepositorySelector(selector),
          "--json",
          REPOSITORY_JSON_FIELDS,
        ]),
        "resolve-push-repository",
        "gh",
      );
      const parsed = parseGitHubRepositoryIdentity(
        resolved.stdout,
        selector.host,
      );
      if (identity && !sameRepositoryIdentity(identity, parsed))
        throw new PullRequestIdentityError("push remote destinations differ", {
          expected: identity,
          actual: parsed,
        });
      identity = parsed;
    }
    if (!identity)
      throw new GitHubPullRequestResponseError("remote-url-list", "git remote");
    return identity;
  }
  private async context(): Promise<{
    targetRepository: RepositoryIdentity;
    repositorySelector: string;
  }> {
    const [targetRepository, remote] = await Promise.all([
      this.resolveTargetRepositoryIdentity(),
      this.resolveRemoteRepositoryIdentity(this.options.pushRemote),
    ]);
    if (!sameRepositoryIdentity(targetRepository, remote))
      throw new PullRequestIdentityError(
        "target repository does not match push remote",
        { expected: targetRepository, actual: remote },
      );
    return {
      targetRepository,
      repositorySelector: githubRepositorySelector(targetRepository),
    };
  }
  private async ensureExists(reference: PullRequestReference): Promise<void> {
    const result = await this.runGh([
      "api",
      "graphql",
      "--hostname",
      reference.targetRepository.host,
      "--raw-field",
      `query=${PULL_REQUEST_EXISTENCE_QUERY}`,
      "--field",
      `owner=${reference.targetRepository.owner}`,
      "--field",
      `repository=${reference.targetRepository.repository}`,
      "--field",
      `number=${reference.number}`,
    ]);
    if (result.code !== 0 && result.code !== 1)
      throw new GitHubPullRequestCommandError(
        "probe-pull-request",
        "gh",
        result,
      );
    if (result.code === 1 && !result.stdout.trim())
      throw new GitHubPullRequestCommandError(
        "probe-pull-request",
        "gh",
        result,
      );
    const exists = parseGitHubPullRequestExistence(
      result.stdout,
      reference.targetRepository,
      reference.number,
    );
    if (result.code === 1 && exists === "missing")
      throw new PullRequestNotFoundError(reference);
    if (result.code === 1)
      throw new GitHubPullRequestCommandError(
        "probe-pull-request",
        "gh",
        result,
      );
    if (exists !== "present")
      throw new GitHubPullRequestResponseError(
        "pull-request-existence-payload",
        "gh api graphql",
      );
  }
  private async view(
    reference: PullRequestReference,
    selector: string,
  ): Promise<PullRequestSummary> {
    await this.ensureExists(reference);
    const result = this.ensure(
      await this.runGh([
        "pr",
        "view",
        String(reference.number),
        "--repo",
        selector,
        "--json",
        PULL_REQUEST_JSON_FIELDS,
      ]),
      "view-pull-request",
      "gh",
    );
    return parseGitHubPullRequest(
      result.stdout,
      reference.targetRepository,
      reference.number,
    );
  }
  private async getAfterValidation(
    reference: PullRequestReference,
  ): Promise<PullRequestSummary> {
    const context = await this.context();
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
    return this.view(reference, context.repositorySelector);
  }
  async createPullRequest(
    input: CreatePullRequestInput,
  ): Promise<PullRequestSummary> {
    assertGitHubHeadBranch(input.headBranch);
    const context = await this.context();
    const result = this.ensure(
      await this.runGh([
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
      ]),
      "create-pull-request",
      "gh",
    );
    return this.view(
      parseCreatedGitHubPullRequest(result.stdout, context.targetRepository),
      context.repositorySelector,
    );
  }
  async findPullRequests(
    query: FindPullRequestsQuery,
  ): Promise<readonly PullRequestSummary[]> {
    assertGitHubHeadBranch(query.headBranch);
    const context = await this.context();
    if (
      !sameRepositoryIdentity(context.targetRepository, query.targetRepository)
    )
      throw new PullRequestIdentityError(
        "query target does not match repository",
        { expected: context.targetRepository, actual: query.targetRepository },
      );
    if (!sameRepositoryIdentity(context.targetRepository, query.headRepository))
      throw new PullRequestIdentityError(
        "query head repository does not match target",
        { expected: context.targetRepository, actual: query.headRepository },
      );
    const result = this.ensure(
      await this.runGh([
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
        String(this.options.discoveryLimit),
        "--json",
        PULL_REQUEST_JSON_FIELDS,
      ]),
      "list-pull-requests",
      "gh",
    );
    return parseGitHubPullRequests(
      result.stdout,
      query,
      this.options.discoveryLimit,
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
    this.ensure(
      await this.runGh([
        "pr",
        "edit",
        String(summary.number),
        "--repo",
        githubRepositorySelector(summary.targetRepository),
        "--body",
        body,
      ]),
      "edit-pull-request",
      "gh",
    );
  }
}
