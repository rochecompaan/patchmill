import {
  readForgejoPullRequestBody,
  updateForgejoPullRequestBody,
} from "./forgejo-pr-body.ts";
import {
  applyIssueLabels,
  commentIssue,
  createLabel as createLabelWithTea,
  hydrateIssueComments,
  listLabels as listLabelsWithTea,
  listOpenIssues,
  viewIssue as viewIssueWithTea,
} from "../cli/commands/triage/forgejo.ts";
import type { CommandRunner } from "../cli/commands/triage/types.ts";
import type {
  HostCliCheck,
  HostIssueCreateInput,
  IssueHostProvider,
  IssueSummary,
  LabelChangePlan,
  LabelDefinition,
  RepositoryInfo,
  RepositorySetupHostProvider,
  RepositoryTarget,
  PullRequestBodyHostProvider,
} from "./types.ts";

export type ForgejoTeaHostOptions = {
  runner: CommandRunner;
  repoRoot: string;
  login?: string;
};

function commandOutput(result: {
  code: number;
  stdout: string;
  stderr: string;
}): string {
  return (
    [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n") ||
    "no output"
  );
}

function shellQuote(value: string): string {
  if (value.length === 0) return "''";
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

type TeaRepoPayload = Record<string, unknown>;

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

function ownerName(owner: unknown): string | undefined {
  if (typeof owner === "string") return owner;
  if (owner && typeof owner === "object") {
    const value = owner as Record<string, unknown>;
    if (typeof value.login === "string") return value.login;
    if (typeof value.name === "string") return value.name;
    if (typeof value.username === "string") return value.username;
  }
  return undefined;
}

function repoMatches(entry: TeaRepoPayload, target: RepositoryTarget): boolean {
  return ownerName(entry.owner) === target.owner && entry.name === target.repo;
}

function repoInfo(
  entry: TeaRepoPayload,
  target: RepositoryTarget,
): RepositoryInfo {
  if (typeof entry.url !== "string") {
    throw new Error(
      `tea repos search did not return a web URL for ${target.slug}`,
    );
  }
  if (typeof entry.ssh !== "string") {
    throw new Error(
      `tea repos search did not return an SSH URL for ${target.slug}`,
    );
  }
  return { publicUrl: entry.url, gitRemoteUrl: entry.ssh };
}

function parseLabelNames(stdout: string, context: string): string[] {
  const parsed = parseJson(stdout, context);
  if (!Array.isArray(parsed)) {
    throw new Error(`${context} returned a non-array payload`);
  }
  return parsed
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (
        entry &&
        typeof entry === "object" &&
        "name" in entry &&
        typeof entry.name === "string"
      ) {
        return entry.name;
      }
      throw new Error(`Unexpected label payload: ${JSON.stringify(entry)}`);
    })
    .sort((a, b) => a.localeCompare(b));
}

type TeaLoginEntry = {
  name?: string;
  user?: string;
  default?: boolean | string;
};

function teaLoginEntries(stdout: string): TeaLoginEntry[] {
  const parsed = parseJson(stdout, "tea logins list");
  if (!Array.isArray(parsed)) {
    throw new Error("tea logins list returned a non-array payload");
  }
  return parsed.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const value = entry as Record<string, unknown>;
    return [
      {
        name: typeof value.name === "string" ? value.name : undefined,
        user: typeof value.user === "string" ? value.user : undefined,
        default:
          typeof value.default === "boolean" ||
          typeof value.default === "string"
            ? value.default
            : undefined,
      },
    ];
  });
}

function isDefaultTeaLogin(entry: TeaLoginEntry): boolean {
  return entry.default === true || entry.default === "true";
}

export class ForgejoTeaHostProvider
  implements
    IssueHostProvider,
    RepositorySetupHostProvider,
    PullRequestBodyHostProvider
{
  readonly id = "forgejo-tea" as const;
  readonly displayName = "Forgejo via tea";

  private readonly options: ForgejoTeaHostOptions;

  constructor(options: ForgejoTeaHostOptions) {
    this.options = options;
  }

  readPullRequestBody(prUrl: string): Promise<string> {
    return readForgejoPullRequestBody(this.options, prUrl);
  }

  updatePullRequestBody(prUrl: string, body: string): Promise<void> {
    return updateForgejoPullRequestBody(this.options, prUrl, body);
  }

  async checkCli(): Promise<HostCliCheck> {
    const result = await this.options.runner.run("tea", ["--help"], {
      cwd: this.options.repoRoot,
    });
    if (result.code === 0) {
      return {
        ok: true,
        message: this.options.login
          ? `forgejo via tea as ${this.options.login}`
          : "forgejo via tea",
      };
    }
    return {
      ok: false,
      message: `tea unavailable: ${commandOutput(result)}`,
      remediation: [
        "Install and authenticate tea, then rerun:",
        "  patchmill doctor",
      ],
    };
  }

  missingLabelRemediation(label: LabelDefinition): string {
    return [
      "  tea labels create --name",
      shellQuote(label.name),
      "--color",
      shellQuote(label.color),
      "--description",
      shellQuote(label.description),
    ].join(" ");
  }

  private runTea(
    args: string[],
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const withLogin = this.options.login
      ? [...args, "--login", this.options.login]
      : args;
    return this.options.runner.run("tea", withLogin, {
      cwd: this.options.repoRoot,
    });
  }

  private runTeaForTarget(
    target: RepositoryTarget,
    args: string[],
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const [command, subcommand, ...rest] = args;
    if (!command || !subcommand) {
      throw new Error("tea target command requires a command and subcommand");
    }
    const withRepo = [command, subcommand, "--repo", target.slug, ...rest];
    const withLogin = this.options.login
      ? [...withRepo, "--login", this.options.login]
      : withRepo;
    return this.options.runner.run("tea", withLogin, {
      cwd: this.options.repoRoot,
    });
  }

  private async repositoryInfo(
    target: RepositoryTarget,
  ): Promise<RepositoryInfo | undefined> {
    const result = await this.runTea([
      "repos",
      "search",
      target.repo,
      "--owner",
      target.owner,
      "--fields",
      "owner,name,ssh,url",
      "--limit",
      "50",
      "--output",
      "json",
    ]);
    if (result.code !== 0) {
      throw new Error(
        `tea repos search failed for ${target.slug}: ${commandOutput(result)}`,
      );
    }
    const parsed = parseJson(result.stdout, "tea repos search");
    if (!Array.isArray(parsed)) {
      throw new Error("tea repos search returned a non-array payload");
    }
    const match = parsed.find(
      (entry): entry is TeaRepoPayload =>
        Boolean(entry) &&
        typeof entry === "object" &&
        repoMatches(entry as TeaRepoPayload, target),
    );
    return match ? repoInfo(match, target) : undefined;
  }

  getRepository(target: RepositoryTarget): Promise<RepositoryInfo | undefined> {
    return this.repositoryInfo(target);
  }

  async createPublicRepo(target: RepositoryTarget): Promise<void> {
    const result = await this.runTea([
      "repos",
      "create",
      "--name",
      target.repo,
      "--owner",
      target.owner,
      "--output",
      "json",
    ]);
    if (result.code !== 0) {
      throw new Error(
        `tea repos create failed for ${target.slug}: ${commandOutput(result)}`,
      );
    }
  }

  async deleteRepo(target: RepositoryTarget): Promise<void> {
    const result = await this.runTea([
      "repos",
      "delete",
      "--name",
      target.repo,
      "--owner",
      target.owner,
      "--force",
    ]);
    if (result.code !== 0) {
      throw new Error(
        `tea repos delete failed for ${target.slug}: ${commandOutput(result)}`,
      );
    }
  }

  cloneCommand(target: RepositoryTarget): string {
    return `tea clone ${target.slug}`;
  }

  async createIssue(
    target: RepositoryTarget,
    issue: HostIssueCreateInput,
  ): Promise<void> {
    const args = [
      "issues",
      "create",
      "--title",
      issue.title,
      "--description",
      issue.body,
    ];
    if (issue.labels.length > 0) {
      args.push("--labels", issue.labels.join(","));
    }

    const result = await this.runTeaForTarget(target, args);
    if (result.code !== 0) {
      throw new Error(
        `tea issues create failed for ${issue.title}: ${commandOutput(result)}`,
      );
    }
  }

  listOpenIssues(): Promise<IssueSummary[]> {
    return listOpenIssues(
      this.options.runner,
      this.options.repoRoot,
      this.options.login,
    );
  }

  viewIssue(issueNumber: number): Promise<IssueSummary> {
    return viewIssueWithTea(
      this.options.runner,
      this.options.repoRoot,
      issueNumber,
      this.options.login,
    );
  }

  async hydrateIssueComments(issues: IssueSummary[]): Promise<IssueSummary[]> {
    await hydrateIssueComments(
      this.options.runner,
      this.options.repoRoot,
      issues,
      this.options.login,
    );
    return issues;
  }

  async trustedTriageCommentAuthors(): Promise<string[]> {
    const result = await this.options.runner.run(
      "tea",
      ["logins", "list", "--output", "json"],
      { cwd: this.options.repoRoot },
    );
    if (result.code !== 0) {
      throw new Error(
        `tea logins list failed while resolving trusted triage author: ${commandOutput(result)}`,
      );
    }

    const entries = teaLoginEntries(result.stdout);
    const selected = this.options.login
      ? entries.find((entry) => entry.name === this.options.login)
      : entries.find(isDefaultTeaLogin);
    const defaultLogin = entries.find(isDefaultTeaLogin);
    return [selected?.user, defaultLogin?.user]
      .map((user) => user?.trim() ?? "")
      .filter((user) => user.length > 0)
      .filter((user, index, users) => users.indexOf(user) === index);
  }

  listLabels(): Promise<string[]>;
  listLabels(target: RepositoryTarget): Promise<string[]>;
  async listLabels(target?: RepositoryTarget): Promise<string[]> {
    if (!target) {
      return listLabelsWithTea(
        this.options.runner,
        this.options.repoRoot,
        this.options.login,
      );
    }

    const result = await this.runTeaForTarget(target, [
      "labels",
      "list",
      "--limit",
      "1000",
      "--output",
      "json",
    ]);
    if (result.code !== 0) {
      throw new Error(
        `tea labels list failed for ${target.slug}: ${commandOutput(result)}`,
      );
    }
    return parseLabelNames(result.stdout, "tea labels list");
  }

  createLabel(label: LabelDefinition): Promise<void>;
  createLabel(target: RepositoryTarget, label: LabelDefinition): Promise<void>;
  async createLabel(
    first: RepositoryTarget | LabelDefinition,
    second?: LabelDefinition,
  ): Promise<void> {
    if (!second) {
      return createLabelWithTea(
        this.options.runner,
        this.options.repoRoot,
        first as LabelDefinition,
        this.options.login,
      );
    }

    const target = first as RepositoryTarget;
    const label = second;
    const result = await this.runTeaForTarget(target, [
      "labels",
      "create",
      "--name",
      label.name,
      "--color",
      label.color,
      "--description",
      label.description,
    ]);
    if (result.code !== 0) {
      throw new Error(
        `tea labels create failed for ${label.name}: ${commandOutput(result)}`,
      );
    }
  }

  applyLabels(change: LabelChangePlan): Promise<void> {
    return applyIssueLabels(
      this.options.runner,
      this.options.repoRoot,
      change,
      this.options.login,
    );
  }

  commentIssue(issueNumber: number, body: string): Promise<void> {
    return commentIssue(
      this.options.runner,
      this.options.repoRoot,
      issueNumber,
      body,
      this.options.login,
    );
  }
}
