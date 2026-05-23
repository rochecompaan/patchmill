export type GitWorktreeStrategyConfig = {
  baseBranch: string;
  baseRef: string;
  remote: string;
  branchPrefix: string;
  worktreeDir: string;
  worktreePrefix: string;
  slugLength: number;
  allowDirectLand: boolean;
};
