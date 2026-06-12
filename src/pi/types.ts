import type { RunPiPromptOptions } from "../cli/commands/run-once/pi.ts";
import type {
  AgentIssueImplementationResumeContext,
  AgentIssuePiResult,
  IssueSummary,
} from "../cli/commands/run-once/types.ts";
import type { PromptTriageLabels } from "../cli/commands/run-once/prompts.ts";
import type { GitWorktreeStrategyConfig } from "../git/types.ts";
import type { PatchmillProjectPolicy } from "../policy/types.ts";
import type { PatchmillSkillsConfig } from "../workflow/skills.ts";

type PiRunnerRunOptions = Omit<
  RunPiPromptOptions,
  "stage" | "issueNumber" | "repoRoot"
>;

export type PlanPiInput = {
  repoRoot: string;
  issue: IssueSummary;
  planPath: string;
  projectPolicy?: PatchmillProjectPolicy;
  planApprovalRequired?: boolean;
  skills?: PatchmillSkillsConfig;
  triageLabels?: Partial<PromptTriageLabels>;
  runOptions?: PiRunnerRunOptions;
};

export type ImplementationPiInput = {
  repoRoot: string;
  issue: IssueSummary;
  planPath: string;
  branch: string;
  worktreePath: string;
  git: Pick<
    GitWorktreeStrategyConfig,
    "baseBranch" | "remote" | "allowDirectLand"
  >;
  projectPolicy?: PatchmillProjectPolicy;
  skills?: PatchmillSkillsConfig;
  resume?: AgentIssueImplementationResumeContext;
  runOptions?: PiRunnerRunOptions;
};

export type PiPromptContracts = {
  plan(input: PlanPiInput): Promise<AgentIssuePiResult>;
  implementation(input: ImplementationPiInput): Promise<AgentIssuePiResult>;
};
