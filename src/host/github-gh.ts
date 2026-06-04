import type {
  CommandResult,
  CommandRunner,
} from "../cli/commands/triage/types.ts";
import type {
  HostCliCheck,
  IssueHostProvider,
  IssueSummary,
  LabelChangePlan,
  LabelDefinition,
} from "./types.ts";

const ISSUE_LIST_JSON_FIELDS =
  "number,title,body,state,labels,author,updatedAt,url";
const ISSUE_VIEW_JSON_FIELDS = `${ISSUE_LIST_JSON_FIELDS},comments`;

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
  if (Array.isArray(issue.comments)) parsed.comments = issue.comments;
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

export class GitHubGhHostProvider implements IssueHostProvider {
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

  async listIssuesByNumbers(
    issueNumbers: readonly number[],
  ): Promise<IssueSummary[]> {
    const issues: IssueSummary[] = [];
    for (const issueNumber of issueNumbers) {
      issues.push(await this.viewIssue(issueNumber));
    }
    return issues.sort((a, b) => a.number - b.number);
  }

  async hydrateIssueComments(issues: IssueSummary[]): Promise<IssueSummary[]> {
    for (const issue of issues) {
      const viewed = await this.viewIssue(issue.number);
      issue.comments = viewed.comments ?? [];
    }
    return issues;
  }

  async listLabels(): Promise<string[]> {
    const result = await this.runGh([
      "label",
      "list",
      "--limit",
      "1000",
      "--json",
      "name",
    ]);
    if (result.code !== 0)
      throw new Error(`gh label list failed: ${commandOutput(result)}`);
    return parseLabelNames(result.stdout, "gh label list");
  }

  async createLabel(label: LabelDefinition): Promise<void> {
    const result = await this.runGh([
      "label",
      "create",
      label.name,
      "--color",
      stripLeadingHash(label.color),
      "--description",
      label.description,
    ]);
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
    return this.options.runner.run("gh", args, { cwd: this.options.repoRoot });
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
