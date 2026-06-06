import {
  applyIssueLabels,
  commentIssue,
  createLabel,
  hydrateIssueComments,
  listLabels,
  listOpenIssues,
  viewIssue as viewIssueWithTea,
} from "../cli/commands/triage/forgejo.ts";
import type { CommandRunner } from "../cli/commands/triage/types.ts";
import { withTeaContext } from "./forgejo-tea-context.ts";
import type {
  HostCliCheck,
  HostIssueCreateInput,
  IssueHostProvider,
  IssueSummary,
  LabelChangePlan,
  LabelDefinition,
  RepositoryTarget,
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

type TeaRepoInfo = {
  webUrl: string;
  cloneUrl: string;
};

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
): TeaRepoInfo {
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
  return { webUrl: entry.url, cloneUrl: entry.ssh };
}

export class ForgejoTeaHostProvider implements IssueHostProvider {
  readonly id = "forgejo-tea" as const;
  readonly displayName = "Forgejo via tea";

  private readonly options: ForgejoTeaHostOptions;

  constructor(options: ForgejoTeaHostOptions) {
    this.options = options;
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

  private async repositoryInfo(
    target: RepositoryTarget,
  ): Promise<TeaRepoInfo | undefined> {
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

  async repoExists(target: RepositoryTarget): Promise<boolean> {
    return (await this.repositoryInfo(target)) !== undefined;
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

  async gitRemoteUrl(target: RepositoryTarget): Promise<string> {
    const info = await this.repositoryInfo(target);
    if (!info) throw new Error(`Repository not found: ${target.slug}`);
    return info.cloneUrl;
  }

  async publicRepoUrl(target: RepositoryTarget): Promise<string> {
    const info = await this.repositoryInfo(target);
    if (!info) throw new Error(`Repository not found: ${target.slug}`);
    return info.webUrl;
  }

  cloneCommand(target: RepositoryTarget): string {
    return `tea clone ${target.slug}`;
  }

  async createIssue(issue: HostIssueCreateInput): Promise<void> {
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

    const result = await this.options.runner.run(
      "tea",
      withTeaContext(args, this.options.repoRoot, this.options.login),
      { cwd: this.options.repoRoot },
    );
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

  listLabels(): Promise<string[]> {
    return listLabels(
      this.options.runner,
      this.options.repoRoot,
      this.options.login,
    );
  }

  createLabel(label: LabelDefinition): Promise<void> {
    return createLabel(
      this.options.runner,
      this.options.repoRoot,
      label,
      this.options.login,
    );
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
