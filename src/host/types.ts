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
  /** owner/repo the head branch lives in; null once that repository is deleted. */
  headRepository: string | null;
  headBranch: string;
  baseBranch: string;
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
  /** owner/repo that origin points at, where issue branches are pushed. */
  pushRepository(): Promise<string>;
  /**
   * Pull requests into this repository whose head branch is named `branch`,
   * from any head repository. Use the kernel's findPullRequest to pick one.
   */
  listPullRequests(branch: string): Promise<PullRequest[]>;
  updatePullRequestBody(n: number, body: string): Promise<void>;
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
