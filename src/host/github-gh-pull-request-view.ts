import type { CommandResult } from "../command/types.ts";
import {
  PullRequestNotFoundError,
  type PullRequestReference,
  type PullRequestSummary,
  type RepositoryIdentity,
} from "./pull-requests.ts";
import {
  GitHubPullRequestCommandError,
  GitHubPullRequestResponseError,
} from "./github-gh-pull-request-errors.ts";
import {
  parseGitHubPullRequest,
  parseGitHubPullRequestExistence,
} from "./github-gh-pull-request-parsing.ts";

const EXISTENCE_QUERY =
  "query PatchmillPullRequestExists($owner: String!, $repository: String!, $number: Int!) { repository(owner: $owner, name: $repository) { nameWithOwner pullRequest(number: $number) { number } } }";

export class GitHubPullRequestView {
  private readonly runGh: (args: string[]) => Promise<CommandResult>;
  private readonly fields: string;

  constructor(
    runGh: (args: string[]) => Promise<CommandResult>,
    fields: string,
  ) {
    this.runGh = runGh;
    this.fields = fields;
  }

  private async ensureExists(reference: PullRequestReference): Promise<void> {
    const result = await this.runGh([
      "api",
      "graphql",
      "--hostname",
      reference.targetRepository.host,
      "--raw-field",
      `query=${EXISTENCE_QUERY}`,
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

  async get(
    reference: PullRequestReference,
    targetRepository: RepositoryIdentity,
    selector: string,
  ): Promise<PullRequestSummary> {
    await this.ensureExists(reference);
    const result = await this.runGh([
      "pr",
      "view",
      String(reference.number),
      "--repo",
      selector,
      "--json",
      this.fields,
    ]);
    if (result.code !== 0)
      throw new GitHubPullRequestCommandError(
        "view-pull-request",
        "gh",
        result,
      );
    return parseGitHubPullRequest(
      result.stdout,
      targetRepository,
      reference.number,
    );
  }
}
