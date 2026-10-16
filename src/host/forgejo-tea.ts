import { CommandFailedError, commandOutput } from "../process/command.ts";
import type { CommandRunner } from "../process/command.ts";
import type {
  Host,
  HostCliCheck,
  Issue,
  IssueComment,
  LabelDefinition,
  PullRequest,
  RepositorySetupHost,
  RepositoryTarget,
} from "./types.ts";

type RawIssue = {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  html_url: string;
  user: { login: string };
  created_at: string;
  labels: { name: string }[];
  pull_request?: unknown;
};
type RawComment = { user: { login: string }; body: string; created_at: string };
type RawPull = {
  number: number;
  html_url: string;
  state: string;
  merged: boolean;
  draft?: boolean;
  title: string;
  body: string | null;
  head: { ref: string };
};
function json<T>(stdout: string): T {
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new Error("tea returned invalid JSON");
  }
}
function mapIssue(raw: RawIssue, comments: IssueComment[] = []): Issue {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? "",
    state: raw.state,
    url: raw.html_url,
    author: raw.user.login,
    createdAt: raw.created_at,
    labels: raw.labels.map((label) => label.name),
    comments,
  };
}
function mapPull(raw: RawPull): PullRequest {
  return {
    number: raw.number,
    url: raw.html_url,
    state: raw.merged ? "merged" : raw.state === "open" ? "open" : "closed",
    draft:
      raw.draft === true ||
      /^(?:\[?(?:draft|wip)\]?\s*[:\-\s])/i.test(raw.title),
    body: raw.body ?? "",
    headBranch: raw.head.ref,
  };
}

/** Translate the Host boundary into tea's repository-scoped and unscoped commands. */
export class ForgejoHost implements Host, RepositorySetupHost {
  readonly displayName = "Forgejo (tea)";
  private readonly runner: CommandRunner;
  private readonly repoRoot: string;
  private readonly login: string;
  constructor(options: {
    runner: CommandRunner;
    repoRoot: string;
    login: string;
  }) {
    this.runner = options.runner;
    this.repoRoot = options.repoRoot;
    this.login = options.login;
  }
  private async run(args: string[], withLogin = true) {
    const argv = [
      ...args,
      ...(withLogin && this.login ? ["--login", this.login] : []),
    ];
    const result = await this.runner("tea", argv, { cwd: this.repoRoot });
    if (result.code !== 0) throw new CommandFailedError("tea", argv, result);
    return result;
  }
  private async slug(target?: RepositoryTarget): Promise<string> {
    if (target) return target.slug;
    const args = ["remote", "get-url", "origin"];
    const result = await this.runner("git", args, { cwd: this.repoRoot });
    if (result.code !== 0) throw new CommandFailedError("git", args, result);
    const origin = result.stdout.trim();
    let path: string | undefined;
    if (/^(?:https?|ssh):\/\//u.test(origin)) {
      try {
        const url = new URL(origin);
        if (url.hostname && !url.search && !url.hash)
          path = url.pathname.slice(1);
      } catch {
        /* Report the same origin error for every unsupported URL. */
      }
    } else path = /^[^@\s]+@[^:\s/]+:([^\s]+)$/u.exec(origin)?.[1];
    path = path?.replace(/\.git$/u, "");
    if (
      !path ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(path) ||
      path.split("/").some((part) => part === "." || part === "..")
    )
      throw new Error(`Cannot parse origin as owner/repo: ${origin}`);
    return path;
  }
  private async scoped(args: string[], target?: RepositoryTarget) {
    return this.run([...args, "--repo", await this.slug(target)]);
  }
  private async api<T>(endpoint: string): Promise<T> {
    return json<T>((await this.scoped(["api", endpoint])).stdout);
  }
  private async pages<T>(endpoint: string): Promise<T[]> {
    const entries: T[] = [];
    for (let page = 1; ; page++) {
      const batch = await this.api<T[]>(
        `${endpoint}${endpoint.includes("?") ? "&" : "?"}page=${page}&limit=50`,
      );
      if (!Array.isArray(batch))
        throw new Error("tea returned a non-array JSON payload");
      entries.push(...batch);
      if (batch.length < 50) return entries;
    }
  }
  async checkCli(): Promise<HostCliCheck> {
    try {
      await this.run(["--help"], false);
      const entries = json<
        { name: string; user: string; default: boolean | string }[]
      >((await this.run(["logins", "list", "--output", "json"], false)).stdout);
      const selected = entries.find((entry) =>
        this.login
          ? entry.name === this.login
          : entry.default === true || entry.default === "true",
      );
      if (!selected?.user?.trim())
        return {
          ok: false,
          message: `No configured tea login: ${this.login || "default"}`,
        };
      const login = selected.user.trim();
      return { ok: true, message: `tea authenticated as ${login}`, login };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof CommandFailedError
            ? commandOutput(error.result)
            : String(error),
      };
    }
  }
  async repository() {
    const slug = await this.slug();
    const raw = await this.api<{ default_branch: string }>(
      "/repos/{owner}/{repo}",
    );
    const [owner, repo] = slug.split("/") as [string, string];
    return { owner, repo, defaultBranch: raw.default_branch };
  }
  async listOpenIssues(): Promise<Issue[]> {
    return (
      await this.pages<RawIssue>("/repos/{owner}/{repo}/issues?state=open")
    )
      .filter((raw) => !raw.pull_request)
      .map((raw) => mapIssue(raw));
  }
  async viewIssue(n: number): Promise<Issue> {
    const raw = await this.api<RawIssue>(`/repos/{owner}/{repo}/issues/${n}`);
    const comments = await this.pages<RawComment>(
      `/repos/{owner}/{repo}/issues/${n}/comments`,
    );
    return mapIssue(
      raw,
      comments.map((comment) => ({
        author: comment.user.login,
        body: comment.body,
        createdAt: comment.created_at,
      })),
    );
  }
  async listLabels(target?: RepositoryTarget): Promise<string[]> {
    const result = await this.scoped(
      ["labels", "list", "--limit", "1000", "--output", "json"],
      target,
    );
    return json<{ name: string }[]>(result.stdout).map((label) => label.name);
  }
  async createLabel(
    first: RepositoryTarget | LabelDefinition,
    second?: LabelDefinition,
  ): Promise<void> {
    const label = second ?? (first as LabelDefinition);
    await this.scoped(
      [
        "labels",
        "create",
        "--name",
        label.name,
        "--color",
        label.color,
        "--description",
        label.description,
      ],
      second ? (first as RepositoryTarget) : undefined,
    );
  }
  async setLabels(n: number, add: string[], remove: string[]): Promise<void> {
    if (remove.length)
      await this.scoped([
        "issues",
        "edit",
        String(n),
        "--remove-labels",
        remove.join(","),
      ]);
    if (add.length)
      await this.scoped([
        "issues",
        "edit",
        String(n),
        "--add-labels",
        add.join(","),
      ]);
  }
  async commentIssue(n: number, body: string): Promise<void> {
    // Keep context before -- so tea does not interpret it as comment text.
    await this.run(
      [
        "comment",
        String(n),
        "--repo",
        await this.slug(),
        ...(this.login ? ["--login", this.login] : []),
        "--",
        body,
      ],
      false,
    );
  }
  async findPullRequestByHead(
    branch: string,
  ): Promise<PullRequest | undefined> {
    const pulls = (
      await this.pages<RawPull>("/repos/{owner}/{repo}/pulls?state=all")
    )
      .filter((raw) => raw.head.ref === branch)
      .map(mapPull);
    return ["open", "merged", "closed"]
      .map((state) => pulls.find((pr) => pr.state === state))
      .find((pr) => pr !== undefined);
  }
  async getRepository(
    target: RepositoryTarget,
  ): Promise<{ publicUrl: string; gitRemoteUrl: string } | undefined> {
    for (let page = 1; ; page++) {
      const result = await this.run([
        "repos",
        "search",
        target.repo,
        "--owner",
        target.owner,
        "--fields",
        "owner,name,ssh,url",
        "--page",
        String(page),
        "--limit",
        "50",
        "--output",
        "json",
      ]);
      const entries = json<
        {
          owner: string | { login: string };
          name: string;
          url: string;
          ssh: string;
        }[]
      >(result.stdout);
      if (!Array.isArray(entries))
        throw new Error("tea repos search returned a non-array JSON payload");
      const found = entries.find(
        (entry) =>
          (typeof entry.owner === "string"
            ? entry.owner
            : entry.owner.login) === target.owner && entry.name === target.repo,
      );
      if (found) {
        if (typeof found.url !== "string" || typeof found.ssh !== "string")
          throw new Error("tea repos search did not return repository URLs");
        return { publicUrl: found.url, gitRemoteUrl: found.ssh };
      }
      if (entries.length < 50) return undefined;
    }
  }
  async createPublicRepo(target: RepositoryTarget): Promise<void> {
    await this.run([
      "repos",
      "create",
      "--name",
      target.repo,
      "--owner",
      target.owner,
      "--output",
      "json",
    ]);
  }
  async deleteRepo(target: RepositoryTarget): Promise<void> {
    await this.run([
      "repos",
      "delete",
      "--name",
      target.repo,
      "--owner",
      target.owner,
      "--force",
    ]);
  }
  cloneCommand(target: RepositoryTarget): string {
    const login = this.login
      ? ` --login '${this.login.replaceAll("'", "'\"'\"'")}'`
      : "";
    return `tea clone${login} ${target.slug}`;
  }
  async createIssue(
    target: RepositoryTarget,
    issue: { title: string; body: string; labels: string[] },
  ): Promise<void> {
    await this.scoped(
      [
        "issues",
        "create",
        "--title",
        issue.title,
        "--description",
        issue.body,
        ...(issue.labels.length ? ["--labels", issue.labels.join(",")] : []),
      ],
      target,
    );
  }
}
