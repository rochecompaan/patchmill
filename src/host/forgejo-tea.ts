import {
  applyIssueLabels,
  commentIssue,
  createLabel,
  hydrateIssueComments,
  listLabels,
  listOpenIssues,
  listIssuesByNumbers as listIssuesByNumbersWithTea,
  viewIssue as viewIssueWithTea,
} from "../cli/commands/triage/forgejo.ts";
import type { CommandRunner } from "../cli/commands/triage/types.ts";
import type {
  HostCliCheck,
  IssueHostProvider,
  IssueSummary,
  LabelChangePlan,
  LabelDefinition,
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

  listOpenIssues(): Promise<IssueSummary[]> {
    return listOpenIssues(
      this.options.runner,
      this.options.repoRoot,
      this.options.login,
    );
  }

  listIssuesByNumbers(
    issueNumbers: readonly number[],
  ): Promise<IssueSummary[]> {
    return listIssuesByNumbersWithTea(
      this.options.runner,
      this.options.repoRoot,
      issueNumbers,
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
