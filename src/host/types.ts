export type HostProviderId = "github-gh" | "forgejo-tea";
export type IssueComment = { author: string; body: string; createdAt: string };
export type Issue = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: "open" | "closed";
  url: string;
  author: string;
  createdAt: string;
  comments: IssueComment[];
};
export type PullRequest = {
  number: number;
  url: string;
  state: "open" | "merged" | "closed";
  draft: boolean;
  body: string;
  headBranch: string;
};
export type LabelDefinition = {
  name: string;
  color: string;
  description: string;
};
export type HostCliCheck = { ok: boolean; message: string; login?: string };
export type Repository = { owner: string; repo: string; defaultBranch: string };
export interface Host {
  checkCli(): Promise<HostCliCheck>;
  repository(): Promise<Repository>;
  listOpenIssues(): Promise<Issue[]>; // comments may be empty
  viewIssue(n: number): Promise<Issue>; // comments populated
  listLabels(): Promise<string[]>;
  createLabel(label: LabelDefinition): Promise<void>;
  setLabels(n: number, add: string[], remove: string[]): Promise<void>;
  commentIssue(n: number, body: string): Promise<void>;
  findPullRequestByHead(branch: string): Promise<PullRequest | undefined>;
}
export type RepositoryTarget = { owner: string; repo: string; slug: string };
export interface RepositorySetupHost {
  displayName: string;
  checkCli(): Promise<HostCliCheck>;
  getRepository(
    target: RepositoryTarget,
  ): Promise<{ publicUrl: string; gitRemoteUrl: string } | undefined>;
  createPublicRepo(target: RepositoryTarget): Promise<void>;
  deleteRepo(target: RepositoryTarget): Promise<void>;
  cloneCommand(target: RepositoryTarget): string;
  listLabels(target: RepositoryTarget): Promise<string[]>;
  createLabel(target: RepositoryTarget, label: LabelDefinition): Promise<void>;
  createIssue(
    target: RepositoryTarget,
    issue: { title: string; body: string; labels: string[] },
  ): Promise<void>;
}
