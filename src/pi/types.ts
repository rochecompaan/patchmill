import type { ResolvedAgentTeam } from "../../scripts/agent-issue/agent-team.ts";
import type { RunPiPromptOptions } from "../../scripts/agent-issue/pi.ts";
import type {
  AgentIssueImplementationResumeContext,
  AgentIssuePiResult,
  IssueSummary,
} from "../../scripts/agent-issue/types.ts";
import type { RawTriageDocument } from "../../scripts/agent-issue-triage/types.ts";

export type TriagePiInput = {
  repoRoot: string;
  issues: IssueSummary[];
};

type PiRunnerRunOptions = Omit<RunPiPromptOptions, "stage" | "issueNumber" | "repoRoot">;

export type PlanPiInput = {
  repoRoot: string;
  issue: IssueSummary;
  planPath: string;
  runOptions?: PiRunnerRunOptions;
};

export type ImplementationPiInput = {
  repoRoot: string;
  issue: IssueSummary;
  planPath: string;
  branch: string;
  worktreePath: string;
  agentTeam: ResolvedAgentTeam;
  resume?: AgentIssueImplementationResumeContext;
  runOptions?: PiRunnerRunOptions;
};

export type PiPromptContracts = {
  triage(input: TriagePiInput): Promise<RawTriageDocument>;
  plan(input: PlanPiInput): Promise<AgentIssuePiResult>;
  implementation(input: ImplementationPiInput): Promise<AgentIssuePiResult>;
};
