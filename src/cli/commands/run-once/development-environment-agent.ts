import { resolve } from "node:path";
import {
  profileExtensionArgs,
  runOnceDevelopmentEnvironmentPiProfile,
} from "../../../pi/resource-profiles.ts";
import { parseDevelopmentEnvironmentResult, runPiPrompt } from "./pi.ts";
import { buildDevelopmentEnvironmentPrompt } from "./prompts.ts";
import type { CommandRunner } from "../../../command/types.ts";
import type { IssueSummary } from "../../../issue/types.ts";
import type {
  AgentIssueConfig,
  AgentIssueDevelopmentEnvironmentHandoff,
  AgentIssueDevelopmentEnvironmentNotReadyResult,
  AgentIssueProgressEvent,
  ProgressReporter,
} from "./types.ts";

export type DevelopmentEnvironmentAgentOutcome =
  | { kind: "ready"; handoff: AgentIssueDevelopmentEnvironmentHandoff }
  | {
      kind: "not-ready";
      result: AgentIssueDevelopmentEnvironmentNotReadyResult;
    };

export type DevelopmentEnvironmentAgentInput = {
  runner: CommandRunner;
  config: AgentIssueConfig;
  issue: IssueSummary;
  labels: string[];
  planPath: string;
  branch: string;
  worktreePath: string;
  completedAt: string;
  piAgentDir: string;
  tokenUsageState: { total: number };
  progressReporter?: ProgressReporter | undefined;
  streamPiOutput?: ((chunk: string) => void) | undefined;
  verbosePiOutput?: boolean | undefined;
  heartbeatMs?: number | undefined;
  piSessionPath?: string | undefined;
  progress: (
    level: AgentIssueProgressEvent["level"],
    stage: string,
    message: string,
    extras?: Partial<Pick<AgentIssueProgressEvent, "issueNumber">>,
  ) => Promise<void>;
  runStep: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
  observePi: (
    stage: "pi-development-environment",
  ) => (observation: AgentIssueProgressEvent["observation"]) => Promise<void>;
};

export async function runDevelopmentEnvironmentAgent(
  input: DevelopmentEnvironmentAgentInput,
): Promise<DevelopmentEnvironmentAgentOutcome> {
  const developmentEnvironmentSkill =
    input.config.skills.developmentEnvironment;
  if (!developmentEnvironmentSkill)
    throw new Error(
      "Development environment stage requires skills.developmentEnvironment",
    );
  const worktreeRoot = resolve(input.config.repoRoot, input.worktreePath);
  const profile = runOnceDevelopmentEnvironmentPiProfile(
    input.config.skills,
    input.config.repoRoot,
  );
  const result = await input.runStep("development environment", async () => {
    await input.progress(
      "info",
      "development-environment",
      "running development environment with pi",
      { issueNumber: input.issue.number },
    );
    return runPiPrompt(
      input.runner,
      worktreeRoot,
      buildDevelopmentEnvironmentPrompt({
        issue: { ...input.issue, labels: input.labels },
        planPath: input.planPath,
        branch: input.branch,
        worktreePath: input.worktreePath,
        projectPolicy: input.config.projectPolicy,
        skills: input.config.skills,
      }),
      {
        progress: input.progressReporter,
        stage: "pi-development-environment",
        parseResult: parseDevelopmentEnvironmentResult,
        skillPaths: profile.additionalSkillPaths,
        extensionArgs: profileExtensionArgs(profile),
        streamOutput: input.streamPiOutput,
        issueNumber: input.issue.number,
        repoRoot: worktreeRoot,
        heartbeatMs: input.heartbeatMs,
        tokenUsageState: input.tokenUsageState,
        observeSession: true,
        sessionRoot: input.piSessionPath,
        verbosePiOutput: input.verbosePiOutput,
        onObservation: input.observePi("pi-development-environment"),
        taskContract: input.config.projectPolicy.pi.taskContract,
        piAgentDir: input.piAgentDir,
      },
    );
  });
  return result.status === "not-ready"
    ? { kind: "not-ready", result }
    : { kind: "ready", handoff: { ...result, completedAt: input.completedAt } };
}
