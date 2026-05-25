import {
  applyIssueLabels,
  commentIssue,
  createLabel,
  hydrateIssueComments,
  listLabels,
  listOpenIssues,
} from "../cli/commands/triage/forgejo.ts";
import type { CommandRunner } from "../cli/commands/triage/types.ts";
import type {
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

export class ForgejoTeaHostProvider implements IssueHostProvider {
  private readonly options: ForgejoTeaHostOptions;

  constructor(options: ForgejoTeaHostOptions) {
    this.options = options;
  }

  listOpenIssues(): Promise<IssueSummary[]> {
    return listOpenIssues(
      this.options.runner,
      this.options.repoRoot,
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
