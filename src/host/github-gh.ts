import type {
  CommandResult,
  CommandRunner,
} from "../cli/commands/triage/types.ts";
import type {
  HostCliCheck,
  HostIssueCreateInput,
  IssueCommentSummary,
  IssueHostProvider,
  IssueSummary,
  LabelChangePlan,
  LabelDefinition,
  RepositoryInfo,
  RepositorySetupHostProvider,
  RepositoryTarget,
} from "./types.ts";

const ISSUE_LIST_JSON_FIELDS =
  "number,title,body,state,labels,author,updatedAt,url";
const ISSUE_VIEW_JSON_FIELDS = `${ISSUE_LIST_JSON_FIELDS},comments`;
const REPOSITORY_VIEW_JSON_FIELDS = "name,url,sshUrl";

export type GitHubGhHostOptions = {
  runner: CommandRunner;
  repoRoot: string;
};

function commandOutput(result: CommandResult): string {
  return (
    [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n") ||
    "no output"
  );
}

function stripLeadingHash(color: string): string {
  return color.replace(/^#/u, "");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/u.test(value)) return value;
  if (value.length === 0) return "''";
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function parseJson(stdout: string, context: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `${context} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function labelNames(labels: unknown): string[] {
  if (labels === undefined || labels === null) return [];
  if (typeof labels === "string") {
    return labels
      .split(/[,\s]+/u)
      .map((label) => label.trim())
      .filter((label) => label.length > 0);
  }
  if (!Array.isArray(labels)) throw new Error("Unexpected labels payload");
  return labels.map((label) => {
    if (typeof label === "string") return label;
    if (
      label &&
      typeof label === "object" &&
      "name" in label &&
      typeof label.name === "string"
    )
      return label.name;
    throw new Error(`Unexpected label payload: ${JSON.stringify(label)}`);
  });
}

function issueNumber(value: unknown): number | undefined {
  if (Number.isInteger(value) && Number(value) > 0) return Number(value);
  if (typeof value === "string" && /^[1-9]\d*$/u.test(value))
    return Number(value);
  return undefined;
}

function authorName(author: unknown): string | undefined {
  if (typeof author === "string") return author;
  if (
    author &&
    typeof author === "object" &&
    "login" in author &&
    typeof author.login === "string"
  )
    return author.login;
  return undefined;
}

function parseIssueComment(comment: unknown): IssueCommentSummary | undefined {
  if (!comment || typeof comment !== "object") return undefined;
  const entry = comment as Record<string, unknown>;
  if (typeof entry.body !== "string") return undefined;

  const parsed: IssueCommentSummary = { body: entry.body };
  const authorLogin = authorName(entry.author);
  if (authorLogin !== undefined) parsed.authorLogin = authorLogin;
  if (typeof entry.createdAt === "string") parsed.created = entry.createdAt;
  if (typeof entry.created === "string" && !parsed.created) {
    parsed.created = entry.created;
  }
  return parsed;
}

function issueComments(comments: unknown): IssueCommentSummary[] | undefined {
  if (!Array.isArray(comments)) return undefined;
  return comments.flatMap((comment) => {
    const parsed = parseIssueComment(comment);
    return parsed ? [parsed] : [];
  });
}

function parseIssuePayload(payload: unknown, context: string): IssueSummary {
  if (!payload || typeof payload !== "object")
    throw new Error(`${context} returned unexpected issue payload`);

  const issue = payload as Record<string, unknown>;
  const number = issueNumber(issue.number);
  if (number === undefined || typeof issue.title !== "string") {
    throw new Error(`${context} returned unexpected issue payload`);
  }

  const parsed: IssueSummary = {
    number,
    title: issue.title,
    body: typeof issue.body === "string" ? issue.body : "",
    state: typeof issue.state === "string" ? issue.state.toLowerCase() : "open",
    labels: labelNames(issue.labels),
  };

  const author = authorName(issue.author);
  if (author !== undefined) parsed.author = author;
  if (typeof issue.updatedAt === "string") parsed.updated = issue.updatedAt;
  const comments = issueComments(issue.comments);
  if (comments !== undefined) parsed.comments = comments;
  if (typeof issue.url === "string") parsed.url = issue.url;
  if (typeof issue.html_url === "string" && !parsed.url) {
    parsed.url = issue.html_url;
  }

  return parsed;
}

function parseIssueArray(stdout: string, context: string): IssueSummary[] {
  const parsed = parseJson(stdout, context);
  if (!Array.isArray(parsed))
    throw new Error(`${context} returned a non-array payload`);
  return parsed.map((entry) => parseIssuePayload(entry, context));
}

function parseIssueObject(stdout: string, context: string): IssueSummary {
  return parseIssuePayload(parseJson(stdout, context), context);
}

function parseLabelNames(stdout: string, context: string): string[] {
  const parsed = parseJson(stdout, context);
  if (!Array.isArray(parsed))
    throw new Error(`${context} returned a non-array payload`);
  return parsed
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (
        entry &&
        typeof entry === "object" &&
        "name" in entry &&
        typeof entry.name === "string"
      )
        return entry.name;
      throw new Error(`Unexpected label payload: ${JSON.stringify(entry)}`);
    })
    .sort((a, b) => a.localeCompare(b));
}

function parseRepositoryInfo(
  stdout: string,
  target: RepositoryTarget,
): RepositoryInfo {
  const parsed = parseJson(stdout, "gh repo view");
  if (!parsed || typeof parsed !== "object") {
    throw new Error("gh repo view returned unexpected repository payload");
  }
  const repository = parsed as Record<string, unknown>;
  if (typeof repository.url !== "string") {
    throw new Error(
      `gh repo view did not return a public URL for ${target.slug}`,
    );
  }
  if (typeof repository.sshUrl !== "string") {
    throw new Error(
      `gh repo view did not return an SSH URL for ${target.slug}`,
    );
  }
  return {
    publicUrl: repository.url,
    gitRemoteUrl: repository.sshUrl,
  };
}

function isRepositoryNotFound(result: CommandResult): boolean {
  return /Could not resolve to a Repository|Not Found|repository not found/iu.test(
    commandOutput(result),
  );
}

export class GitHubGhHostProvider
  implements IssueHostProvider, RepositorySetupHostProvider
{
  readonly id = "github-gh" as const;
  readonly displayName = "GitHub via gh";

  private readonly options: GitHubGhHostOptions;

  constructor(options: GitHubGhHostOptions) {
    this.options = options;
  }

  async checkCli(): Promise<HostCliCheck> {
    const version = await this.runGh(["--version"]);
    if (version.code !== 0) return this.cliFailure("gh --version", version);

    const auth = await this.runGh(["auth", "status"]);
    if (auth.code !== 0) return this.cliFailure("gh auth status", auth);

    return { ok: true, message: "github via gh" };
  }

  missingLabelRemediation(label: LabelDefinition): string {
    return [
      "  gh label create",
      shellQuote(label.name),
      "--color",
      shellQuote(stripLeadingHash(label.color)),
      "--description",
      shellQuote(label.description),
    ].join(" ");
  }

  async listOpenIssues(): Promise<IssueSummary[]> {
    const result = await this.runGh([
      "issue",
      "list",
      "--state",
      "open",
      "--limit",
      "1000",
      "--json",
      ISSUE_LIST_JSON_FIELDS,
    ]);
    if (result.code !== 0)
      throw new Error(`gh issue list failed: ${commandOutput(result)}`);
    return parseIssueArray(result.stdout, "gh issue list");
  }

  async hydrateIssueComments(issues: IssueSummary[]): Promise<IssueSummary[]> {
    for (const issue of issues) {
      const viewed = await this.viewIssue(issue.number);
      issue.comments = viewed.comments ?? [];
    }
    return issues;
  }

  async trustedTriageCommentAuthors(): Promise<string[]> {
    const result = await this.runGh(["api", "user", "--jq", ".login"]);
    if (result.code !== 0) {
      throw new Error(
        `gh api user failed while resolving trusted triage author: ${commandOutput(result)}`,
      );
    }

    const login = result.stdout.trim();
    return login ? [login] : [];
  }

  async listLabels(): Promise<string[]>;
  async listLabels(target: RepositoryTarget): Promise<string[]>;
  async listLabels(target?: RepositoryTarget): Promise<string[]> {
    const args = ["label", "list"];
    if (target) args.push("--repo", target.slug);
    args.push("--limit", "1000", "--json", "name");

    const result = await this.runGh(args);
    if (result.code !== 0)
      throw new Error(`gh label list failed: ${commandOutput(result)}`);
    return parseLabelNames(result.stdout, "gh label list");
  }

  async createLabel(label: LabelDefinition): Promise<void>;
  async createLabel(
    target: RepositoryTarget,
    label: LabelDefinition,
  ): Promise<void>;
  async createLabel(
    first: RepositoryTarget | LabelDefinition,
    second?: LabelDefinition,
  ): Promise<void> {
    const target = second ? (first as RepositoryTarget) : undefined;
    const label = second ?? (first as LabelDefinition);
    const args = ["label", "create", label.name];
    if (target) args.push("--repo", target.slug);
    args.push(
      "--color",
      stripLeadingHash(label.color),
      "--description",
      label.description,
    );

    const result = await this.runGh(args);
    if (result.code !== 0)
      throw new Error(
        `gh label create failed for ${label.name}: ${commandOutput(result)}`,
      );
  }

  async applyLabels(change: LabelChangePlan): Promise<void> {
    if (change.addLabels.length === 0 && change.removeLabels.length === 0)
      return;

    const args = ["issue", "edit", String(change.issueNumber)];
    if (change.addLabels.length > 0) {
      args.push("--add-label", change.addLabels.join(","));
    }
    if (change.removeLabels.length > 0) {
      args.push("--remove-label", change.removeLabels.join(","));
    }

    const result = await this.runGh(args);
    if (result.code !== 0)
      throw new Error(
        `gh issue edit labels failed for #${change.issueNumber}: ${commandOutput(result)}`,
      );
  }

  async commentIssue(issueNumber: number, body: string): Promise<void> {
    const result = await this.runGh([
      "issue",
      "comment",
      String(issueNumber),
      "--body",
      body,
    ]);
    if (result.code !== 0)
      throw new Error(
        `gh issue comment failed for #${issueNumber}: ${commandOutput(result)}`,
      );
  }

  async getRepository(
    target: RepositoryTarget,
  ): Promise<RepositoryInfo | undefined> {
    const result = await this.runGh([
      "repo",
      "view",
      target.slug,
      "--json",
      REPOSITORY_VIEW_JSON_FIELDS,
    ]);
    if (result.code !== 0) {
      if (isRepositoryNotFound(result)) return undefined;
      throw new Error(
        `gh repo view failed for ${target.slug}: ${commandOutput(result)}`,
      );
    }
    return parseRepositoryInfo(result.stdout, target);
  }

  async createPublicRepo(target: RepositoryTarget): Promise<void> {
    const result = await this.runGh([
      "repo",
      "create",
      target.slug,
      "--public",
    ]);
    if (result.code !== 0) {
      throw new Error(
        `gh repo create failed for ${target.slug}: ${commandOutput(result)}`,
      );
    }
  }

  async deleteRepo(target: RepositoryTarget): Promise<void> {
    const result = await this.runGh(["repo", "delete", target.slug, "--yes"]);
    if (result.code !== 0) {
      throw new Error(
        `gh repo delete failed for ${target.slug}: ${commandOutput(result)}`,
      );
    }
  }

  cloneCommand(target: RepositoryTarget): string {
    return `gh repo clone ${target.slug}`;
  }

  async createIssue(
    target: RepositoryTarget,
    issue: HostIssueCreateInput,
  ): Promise<void> {
    const args = [
      "issue",
      "create",
      "--repo",
      target.slug,
      "--title",
      issue.title,
      "--body",
      issue.body,
    ];
    if (issue.labels.length > 0) args.push("--label", issue.labels.join(","));

    const result = await this.runGh(args);
    if (result.code !== 0) {
      throw new Error(
        `gh issue create failed for ${issue.title}: ${commandOutput(result)}`,
      );
    }
  }

  async viewIssue(issueNumber: number): Promise<IssueSummary> {
    const result = await this.runGh([
      "issue",
      "view",
      String(issueNumber),
      "--json",
      ISSUE_VIEW_JSON_FIELDS,
    ]);
    if (result.code !== 0)
      throw new Error(
        `gh issue view failed for #${issueNumber}: ${commandOutput(result)}`,
      );
    return parseIssueObject(result.stdout, `gh issue view #${issueNumber}`);
  }

  private runGh(args: string[]): Promise<CommandResult> {
    return this.options.runner.run("gh", args, {
      cwd: this.options.repoRoot,
      env: { GH_REPO: undefined },
    });
  }

  private cliFailure(command: string, result: CommandResult): HostCliCheck {
    return {
      ok: false,
      message: `${command} failed: ${commandOutput(result)}`,
      remediation: [
        "Install and authenticate gh, then rerun:",
        "  gh auth login",
        "  patchmill doctor",
      ],
    };
  }
}
