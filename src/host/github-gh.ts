import { CommandFailedError, commandOutput } from "../process/command.ts";
import type {
  CommandResult,
  CommandRunner,
  CommandRunOptions,
} from "../process/command.ts";
import type {
  Host,
  HostCliCheck,
  Issue,
  LabelDefinition,
  PullRequest,
  Repository,
  RepositorySetupHost,
  RepositoryTarget,
} from "./types.ts";

type RawIssue = Omit<Issue, "labels" | "author" | "comments" | "state"> & {
  labels: { name: string }[];
  author: { login: string };
  state: string;
  comments?: { author: { login: string }; body: string; createdAt: string }[];
};
type RawPullRequest = Omit<PullRequest, "draft" | "headBranch" | "state"> & {
  isDraft: boolean;
  headRefName: string;
  state: string;
};
type RawRepository = {
  nameWithOwner: string;
  defaultBranchRef: { name: string };
};
const issueFields = "number,title,body,labels,state,url,author,createdAt";
function parseJson(stdout: string, label: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}
const mapIssue = (raw: RawIssue): Issue => ({
  ...raw,
  labels: raw.labels.map((label) => label.name),
  author: raw.author.login,
  state: raw.state.toLowerCase() as Issue["state"],
  comments: (raw.comments ?? []).map((comment) => ({
    ...comment,
    author: comment.author.login,
  })),
});
const mapPullRequest = (raw: RawPullRequest): PullRequest => ({
  number: raw.number,
  url: raw.url,
  state: raw.state.toLowerCase() as PullRequest["state"],
  draft: raw.isDraft,
  body: raw.body,
  headBranch: raw.headRefName,
});
const mapRepository = (raw: RawRepository): Repository => {
  const slash = raw.nameWithOwner.indexOf("/");
  return {
    owner: raw.nameWithOwner.slice(0, slash),
    repo: raw.nameWithOwner.slice(slash + 1),
    defaultBranch: raw.defaultBranchRef.name,
  };
};

export class GitHubHost implements Host, RepositorySetupHost {
  readonly displayName = "GitHub (gh)";
  private readonly runner: CommandRunner;
  private readonly repoRoot: string;
  constructor(options: { runner: CommandRunner; repoRoot: string }) {
    this.runner = options.runner;
    this.repoRoot = options.repoRoot;
  }
  private gh(args: string[], options: CommandRunOptions = {}) {
    return this.runner("gh", args, { ...options, cwd: this.repoRoot });
  }
  private async ghOk(args: string[], options?: CommandRunOptions) {
    const result = await this.gh(args, options);
    if (result.code !== 0) throw new CommandFailedError("gh", args, result);
    return result;
  }
  async checkCli(): Promise<HostCliCheck> {
    const fail = (label: string, result: CommandResult): HostCliCheck => ({
      ok: false,
      message: `${label} failed: ${commandOutput(result)}`,
    });
    const version = await this.gh(["--version"]);
    if (version.code !== 0) return fail("gh --version", version);
    const auth = await this.gh(["auth", "status"]);
    if (auth.code !== 0) return fail("gh auth status", auth);
    const user = await this.gh(["api", "user", "--jq", ".login"]);
    if (user.code !== 0) return fail("gh api user", user);
    const login = user.stdout.trim();
    return { ok: true, message: `gh authenticated as ${login}`, login };
  }
  async repository(): Promise<Repository> {
    const result = await this.ghOk([
      "repo",
      "view",
      "--json",
      "nameWithOwner,defaultBranchRef",
    ]);
    return mapRepository(
      parseJson(result.stdout, "gh repo view") as RawRepository,
    );
  }
  async listOpenIssues(): Promise<Issue[]> {
    const result = await this.ghOk([
      "issue",
      "list",
      "--state",
      "open",
      "--limit",
      "200",
      "--json",
      issueFields,
    ]);
    return (parseJson(result.stdout, "gh issue list") as RawIssue[]).map(
      mapIssue,
    );
  }
  async viewIssue(n: number): Promise<Issue> {
    const result = await this.ghOk([
      "issue",
      "view",
      String(n),
      "--json",
      `${issueFields},comments`,
    ]);
    return mapIssue(parseJson(result.stdout, "gh issue view") as RawIssue);
  }
  async listLabels(target?: RepositoryTarget): Promise<string[]> {
    const result = await this.ghOk([
      "label",
      "list",
      "--limit",
      "200",
      "--json",
      "name",
      ...(target ? ["--repo", target.slug] : []),
    ]);
    return (
      parseJson(result.stdout, "gh label list") as { name: string }[]
    ).map((label) => label.name);
  }
  async createLabel(
    first: LabelDefinition | RepositoryTarget,
    second?: LabelDefinition,
  ): Promise<void> {
    const label = second ?? (first as LabelDefinition);
    await this.ghOk([
      "label",
      "create",
      label.name,
      "--color",
      label.color.replace(/^#/, ""),
      "--description",
      label.description,
      ...(second ? ["--repo", (first as RepositoryTarget).slug] : []),
    ]);
  }
  async setLabels(n: number, add: string[], remove: string[]): Promise<void> {
    if (!add.length && !remove.length) return;
    await this.ghOk([
      "issue",
      "edit",
      String(n),
      ...(add.length ? ["--add-label", add.join(",")] : []),
      ...(remove.length ? ["--remove-label", remove.join(",")] : []),
    ]);
  }
  async commentIssue(n: number, body: string): Promise<void> {
    await this.ghOk(["issue", "comment", String(n), "--body-file", "-"], {
      stdin: body,
    });
  }
  async findPullRequestByHead(
    branch: string,
  ): Promise<PullRequest | undefined> {
    const result = await this.ghOk([
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "all",
      "--limit",
      "20",
      "--json",
      "number,url,state,isDraft,body,headRefName",
    ]);
    const entries = (
      parseJson(result.stdout, "gh pr list") as RawPullRequest[]
    ).filter((entry) => entry.headRefName === branch);
    const selected = ["OPEN", "MERGED", "CLOSED"]
      .map((state) => entries.find((entry) => entry.state === state))
      .find((entry) => entry !== undefined);
    return selected ? mapPullRequest(selected) : undefined;
  }
  async getRepository(
    target: RepositoryTarget,
  ): Promise<{ publicUrl: string; gitRemoteUrl: string } | undefined> {
    const args = ["repo", "view", target.slug, "--json", "url,sshUrl"];
    const result = await this.gh(args);
    if (result.code !== 0) {
      if (
        /Could not resolve to a Repository|Not Found|repository not found/i.test(
          `${result.stderr}\n${result.stdout}`,
        )
      )
        return undefined;
      throw new CommandFailedError("gh", args, result);
    }
    const raw = parseJson(result.stdout, "gh repo view") as {
      url: string;
      sshUrl: string;
    };
    return { publicUrl: raw.url, gitRemoteUrl: raw.sshUrl };
  }
  async createPublicRepo(target: RepositoryTarget): Promise<void> {
    await this.ghOk(["repo", "create", target.slug, "--public"]);
  }
  async deleteRepo(target: RepositoryTarget): Promise<void> {
    await this.ghOk(["repo", "delete", target.slug, "--yes"]);
  }
  cloneCommand(target: RepositoryTarget): string {
    return `gh repo clone ${target.slug}`;
  }
  async createIssue(
    target: RepositoryTarget,
    issue: { title: string; body: string; labels: string[] },
  ): Promise<void> {
    await this.ghOk([
      "issue",
      "create",
      "--repo",
      target.slug,
      "--title",
      issue.title,
      "--body",
      issue.body,
      ...(issue.labels.length ? ["--label", issue.labels.join(",")] : []),
    ]);
  }
}
