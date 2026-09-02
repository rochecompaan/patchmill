import type { CommandResult, CommandRunner } from "../command/types.ts";
import {
  PullRequestIdentityError,
  sameRepositoryIdentity,
  type RepositoryIdentity,
} from "./pull-requests.ts";
import {
  GitHubPullRequestCommandError,
  GitHubPullRequestResponseError,
} from "./github-gh-pull-request-errors.ts";
import {
  githubRepositorySelector,
  parseGitHubRemoteRepositorySelector,
  parseGitHubRepositoryIdentity,
} from "./github-gh-pull-request-parsing.ts";

const REPOSITORY_JSON_FIELDS = "nameWithOwner,url";

export type GitHubPullRequestContext = {
  targetRepository: RepositoryIdentity;
  repositorySelector: string;
};

export class GitHubPullRequestCommands {
  private readonly runner: CommandRunner;
  private readonly repoRoot: string;
  private readonly pushRemote: string;

  constructor(runner: CommandRunner, repoRoot: string, pushRemote: string) {
    this.runner = runner;
    this.repoRoot = repoRoot;
    this.pushRemote = pushRemote;
  }

  gh(args: string[]): Promise<CommandResult> {
    return this.runner.run("gh", args, {
      cwd: this.repoRoot,
      env: { GH_REPO: undefined },
    });
  }

  private git(args: string[]): Promise<CommandResult> {
    return this.runner.run("git", args, { cwd: this.repoRoot });
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

  async resolveTarget(): Promise<RepositoryIdentity> {
    const result = this.ensure(
      await this.gh(["repo", "view", "--json", REPOSITORY_JSON_FIELDS]),
      "resolve-target-repository",
      "gh",
    );
    return parseGitHubRepositoryIdentity(result.stdout);
  }

  async resolveRemote(remote: string): Promise<RepositoryIdentity> {
    const result = this.ensure(
      await this.git(["remote", "get-url", "--push", "--all", "--", remote]),
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
        await this.gh([
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

  async context(): Promise<GitHubPullRequestContext> {
    const [targetRepository, remote] = await Promise.all([
      this.resolveTarget(),
      this.resolveRemote(this.pushRemote),
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
}
