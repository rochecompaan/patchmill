import { resolve } from "node:path";
import { PlanningPublicationGit } from "../../../git/planning-publication-git.ts";
import { PlanningRemoteBaseGit } from "../../../git/planning-remote-base.ts";
import { PlanningWorkspaceGit } from "../../../git/planning-workspace-git.ts";
import {
  createPullRequestHost,
  createRunOnceHostProvider,
} from "../../../host/factory.ts";
import { PlanningStateStore } from "../../../workflow/planning-state-store.ts";
import { phaseWorkspaceIdentity } from "../../../workflow/planning-pull-requests.ts";
import type { PlanningIssueLock } from "../../../workflow/planning-issue-lock.ts";
import type { PlanningStateV1 } from "../../../workflow/planning-state-types.ts";
import { createPlanningArtifactAgent } from "./planning-phase-artifacts.ts";
import { coordinatePlanningPhases } from "./planning-phase-coordinator.ts";
import { runPlanningPhase } from "./planning-phase-runner.ts";
import { createPlanningFinishEffects } from "./planning-finish-effects.ts";
import { createPlanningImplementationAdapter } from "./planning-implementation-adapter.ts";
import type { AgentIssueConfig, CommandRunner, IssueSummary } from "./types.ts";
import type { RunOnceHostProvider } from "../../../host/types.ts";

export type PlanningRuntime = {
  coordinate: (
    state: PlanningStateV1,
    lock: PlanningIssueLock,
  ) => ReturnType<typeof coordinatePlanningPhases>;
};
export type PlanningRuntimeInput = {
  runner: CommandRunner;
  config: AgentIssueConfig;
  issue: IssueSummary;
  labels: string[];
  readyLabel: string;
  inProgressLabel: string;
  doneLabel: string;
  needsInfoLabel: string;
  piAgentDir: string;
  tokenUsageState: { total: number };
  progressReporter?: Parameters<
    typeof createPlanningImplementationAdapter
  >[0]["progressReporter"];
  streamPiOutput?: ((chunk: string) => void) | undefined;
  verbosePiOutput?: boolean | undefined;
  heartbeatMs?: number | undefined;
  piSessionPath?: string | undefined;
  now?: () => Date;
  host?: RunOnceHostProvider;
};

/** Constructs boring Git, host, and coordinator services for planning-pr-v1. */
export function createPlanningRuntime(
  input: PlanningRuntimeInput,
): PlanningRuntime {
  const stateStore = new PlanningStateStore(input.config.runStateDir);
  const remoteBase = new PlanningRemoteBaseGit({
    runner: input.runner,
    repoRoot: input.config.repoRoot,
    specsDir: input.config.specsDir,
    plansDir: input.config.plansDir,
  });
  const workspaces = new PlanningWorkspaceGit({
    runner: input.runner,
    repoRoot: input.config.repoRoot,
    worktreeRoot: resolve(input.config.repoRoot, input.config.worktreeDir),
  });
  const publicationGit = new PlanningPublicationGit({
    runner: input.runner,
    repoRoot: input.config.repoRoot,
  });
  const prHost = createPullRequestHost({
    runner: input.runner,
    repoRoot: input.config.repoRoot,
    remote: input.config.remote,
    host: input.config.host,
  });
  const host =
    input.host ??
    createRunOnceHostProvider({
      runner: input.runner,
      repoRoot: input.config.repoRoot,
      host: input.config.host,
    });
  const artifactAgent = createPlanningArtifactAgent({
    runner: input.runner,
    repoRoot: input.config.repoRoot,
    skills: input.config.skills,
    taskContract: input.config.projectPolicy.pi.taskContract,
    issueNumber: input.issue.number,
    runOptions: {
      ...(input.piSessionPath === undefined
        ? {}
        : { sessionRoot: input.piSessionPath }),
      ...(input.progressReporter === undefined
        ? {}
        : { progress: input.progressReporter }),
      ...(input.streamPiOutput === undefined
        ? {}
        : { streamOutput: input.streamPiOutput }),
      ...(input.verbosePiOutput === undefined
        ? {}
        : { verbosePiOutput: input.verbosePiOutput }),
      ...(input.heartbeatMs === undefined
        ? {}
        : { heartbeatMs: input.heartbeatMs }),
      tokenUsageState: input.tokenUsageState,
    },
  });
  const git = {
    baseBranch: input.config.baseBranch,
    baseRef: input.config.baseRef,
    remote: input.config.remote,
    branchPrefix: input.config.branchPrefix,
    worktreeDir: input.config.worktreeDir,
    worktreePrefix: input.config.worktreePrefix,
    slugLength: input.config.slugLength,
    allowDirectLand: false,
  };
  return {
    coordinate: (state, lock) =>
      coordinatePlanningPhases({
        state,
        issue: input.issue,
        planOnly: input.config.planOnly,
        runPlanningPhase: ({ state: current, phaseIndex, phase, planOnly }) =>
          runPlanningPhase({
            state: current,
            phaseIndex,
            phase,
            planOnly,
            issue: input.issue,
            lock,
            stateStore,
            host: prHost,
            remoteBase,
            publicationGit,
            workspaces,
            artifactAgent,
            config: {
              repoRoot: input.config.repoRoot,
              remote: input.config.remote,
              baseBranch: input.config.baseBranch,
              specsDir: input.config.specsDir,
              plansDir: input.config.plansDir,
              projectPolicy: input.config.projectPolicy,
              skills: input.config.skills,
              triageLabels: {
                ready: input.readyLabel,
                needsInfo: input.needsInfoLabel,
              },
              workspaceIdentity: (planned) => {
                const identity = phaseWorkspaceIdentity({
                  issueNumber: input.issue.number,
                  title: input.issue.title,
                  phase: planned.kind,
                  strategy: git,
                });
                return {
                  ...identity,
                  worktreePath: resolve(
                    input.config.repoRoot,
                    identity.worktreePath,
                  ),
                };
              },
            },
            implementation: {
              implementation: createPlanningImplementationAdapter({
                runner: input.runner,
                config: input.config,
                issue: input.issue,
                labels: input.labels,
                git,
                piAgentDir: input.piAgentDir,
                tokenUsageState: input.tokenUsageState,
                progressReporter: input.progressReporter,
                streamPiOutput: input.streamPiOutput,
                verbosePiOutput: input.verbosePiOutput,
                heartbeatMs: input.heartbeatMs,
                piSessionPath: input.piSessionPath,
                now: input.now,
              }),
              finish: createPlanningFinishEffects({
                runner: input.runner,
                config: input.config,
                issue: input.issue,
                labels: input.labels,
                readyLabel: input.readyLabel,
                inProgressLabel: input.inProgressLabel,
                doneLabel: input.doneLabel,
                needsInfoLabel: input.needsInfoLabel,
                host,
                phaseIndex,
                progressReporter: input.progressReporter,
                now: input.now,
              }),
            },
            ...(input.now === undefined ? {} : { now: input.now }),
          }),
      }),
  };
}
