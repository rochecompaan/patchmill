import type { PatchmillHostProviderId } from "../config/types.ts";

export type IssueCommentSummary = {
  body: string;
  authorLogin?: string;
  created?: string;
};

export type IssueSummary = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: string;
  author?: string;
  created?: string;
  updated?: string;
  url?: string;
  comments?: IssueCommentSummary[];
};

export type LabelDefinition = {
  name: string;
  color: string;
  description: string;
};

export type RepositoryTarget = {
  owner: string;
  repo: string;
  slug: string;
};

export type HostIssueCreateInput = {
  title: string;
  body: string;
  labels: string[];
};

export type RepositoryInfo = {
  publicUrl: string;
  gitRemoteUrl: string;
};

export type RepositorySetupHostProvider = {
  readonly id: PatchmillHostProviderId;
  readonly displayName: string;
  checkCli(): Promise<HostCliCheck>;
  getRepository(target: RepositoryTarget): Promise<RepositoryInfo | undefined>;
  createPublicRepo(target: RepositoryTarget): Promise<void>;
  deleteRepo(target: RepositoryTarget): Promise<void>;
  cloneCommand(target: RepositoryTarget): string;
  listLabels(target: RepositoryTarget): Promise<string[]>;
  createLabel(target: RepositoryTarget, label: LabelDefinition): Promise<void>;
  createIssue(
    target: RepositoryTarget,
    issue: HostIssueCreateInput,
  ): Promise<void>;
};

export type LabelChangePlan = {
  issueNumber: number;
  oldLabels: string[];
  newLabels: string[];
  addLabels: string[];
  removeLabels: string[];
};

export type HostCliCheck =
  | { ok: true; message: string }
  | { ok: false; message: string; remediation: string[] };

export type PullRequestBodyHostProvider = {
  readPullRequestBody(prUrl: string): Promise<string>;
  updatePullRequestBody(prUrl: string, body: string): Promise<void>;
};

export type IssueHostProvider = {
  readonly id: PatchmillHostProviderId;
  readonly displayName: string;
  checkCli(): Promise<HostCliCheck>;
  missingLabelRemediation(label: LabelDefinition): string;
  listOpenIssues(): Promise<IssueSummary[]>;
  viewIssue(issueNumber: number): Promise<IssueSummary>;
  hydrateIssueComments(issues: IssueSummary[]): Promise<IssueSummary[]>;
  trustedTriageCommentAuthors(): Promise<string[]>;
  listLabels(): Promise<string[]>;
  createLabel(label: LabelDefinition): Promise<void>;
  applyLabels(change: LabelChangePlan): Promise<void>;
  commentIssue(issueNumber: number, body: string): Promise<void>;
};

export type RunOnceHostProvider = IssueHostProvider &
  PullRequestBodyHostProvider;
