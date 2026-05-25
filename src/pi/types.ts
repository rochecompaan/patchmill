import type { ResolvedAgentTeam } from "../../scripts/agent-issue/agent-team.ts";
import type { RunPiPromptOptions } from "../../scripts/agent-issue/pi.ts";
import type {
  AgentIssueImplementationResumeContext,
  AgentIssuePiResult,
  IssueSummary,
} from "../../scripts/agent-issue/types.ts";
import type { GitWorktreeStrategyConfig } from "../git/types.ts";
import type { RawTriageDocument } from "../cli/commands/triage/types.ts";
import type { PromptTriageLabels } from "../../scripts/agent-issue/prompts.ts";
import type { PatchmillProjectPolicy } from "../policy/types.ts";
import type { PatchmillSkillsConfig } from "../workflow/skills.ts";

export type TriagePiInput = {
  repoRoot: string;
  issues: IssueSummary[];
  projectPolicy?: PatchmillProjectPolicy;
  skills?: PatchmillSkillsConfig;
};

type PiRunnerRunOptions = Omit<
  RunPiPromptOptions,
  "stage" | "issueNumber" | "repoRoot"
>;

export type PlanPiInput = {
  repoRoot: string;
  issue: IssueSummary;
  planPath: string;
  projectPolicy?: PatchmillProjectPolicy;
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
  agentTeam: ResolvedAgentTeam;
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
  triage(input: TriagePiInput): Promise<RawTriageDocument>;
  plan(input: PlanPiInput): Promise<AgentIssuePiResult>;
  implementation(input: ImplementationPiInput): Promise<AgentIssuePiResult>;
};
