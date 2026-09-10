import { resolve } from "node:path";
import { PlanningPublicationGit } from "../../../git/planning-publication-git.ts";
import { PlanningRemoteBaseGit } from "../../../git/planning-remote-base.ts";
import { PlanningWorkspaceGit } from "../../../git/planning-workspace-git.ts";
import {
  createPullRequestHost,
  createRunOnceHostProvider,
} from "../../../host/factory.ts";
import { runCleanupHookScript } from "../../../pi/hooks.ts";
import { ensureAutomationLabel } from "./automation-labels.ts";
import { runImplementationAgent } from "./implementation-agent.ts";
import { createPlanningArtifactAgent } from "./planning-phase-artifacts.ts";
import { coordinatePlanningPhases } from "./planning-phase-coordinator.ts";
import { handoffComment } from "./pipeline-comments.ts";
import { publishPrRunCost } from "./pr-cost-publication.ts";
import { runPlanningPhase } from "./planning-phase-runner.ts";
import { validateVisualEvidenceReferences } from "./visual-evidence.ts";
import { cleanupLabelsForImplementation } from "./workflow-state.ts";
import { nextLabels } from "./pipeline-lifecycle.ts";
import { planLabelChange } from "../triage/labels.ts";
import { PlanningStateStore } from "../../../workflow/planning-state-store.ts";
import { phaseWorkspaceIdentity } from "../../../workflow/planning-pull-requests.ts";
import type { PlanningIssueLock } from "../../../workflow/planning-issue-lock.ts";
import type { PlanningStateV1 } from "../../../workflow/planning-state-types.ts";
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
    typeof runImplementationAgent
  >[0]["progressReporter"];
  streamPiOutput?: ((chunk: string) => void) | undefined;
  verbosePiOutput?: boolean | undefined;
  heartbeatMs?: number | undefined;
  piSessionPath?: string | undefined;
  now?: () => Date;
  host?: RunOnceHostProvider;
};

function planPath(state: PlanningStateV1): string {
  for (const phase of state.phases)
    if ("artifacts" in phase) {
      const path = phase.artifacts.find(
        (artifact) => artifact.kind === "plan",
      )?.path;
      if (path) return path;
    }
  throw new Error("Planning implementation requires a durable plan path");
}

/** Builds the production planning coordinator callback without legacy run state. */
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
        runPlanningPhase: async ({
          state: current,
          phaseIndex,
          phase,
          planOnly,
        }) =>
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
              workspaceIdentity: (planned) =>
                phaseWorkspaceIdentity({
                  issueNumber: input.issue.number,
                  title: input.issue.title,
                  phase: planned.kind,
                  strategy: git,
                }),
            },
            implementationInput: {
              configuredGit: git,
              runAgent: async ({
                state: durable,
                phase: implementation,
                git: policy,
                requiredPullRequestMarker,
              }) => {
                const durablePlan = planPath(durable);
                const result = await runImplementationAgent({
                  runner: input.runner,
                  config: input.config,
                  issue: input.issue,
                  labels: input.labels,
                  planPath: durablePlan,
                  branch: implementation.workspace.identity.branch,
                  worktreePath: implementation.workspace.identity.worktreePath,
                  worktree: {
                    branch: implementation.workspace.identity.branch,
                    worktreePath:
                      implementation.workspace.identity.worktreePath,
                    created: true,
                    hasExistingCommits: false,
                    existingCommits: [],
                  },
                  git: policy as typeof git,
                  resume: {
                    resumed: implementation.status !== "workspace-ready",
                  },
                  piAgentDir: input.piAgentDir,
                  tokenUsageState: input.tokenUsageState,
                  completedAt: (
                    input.now ?? (() => new Date())
                  )().toISOString(),
                  progressReporter: input.progressReporter,
                  streamPiOutput: input.streamPiOutput,
                  verbosePiOutput: input.verbosePiOutput,
                  heartbeatMs: input.heartbeatMs,
                  piSessionPath: input.piSessionPath,
                  requiredPullRequestMarker,
                  progress: async () => {},
                  runStep: async (_label, fn) => fn(),
                  stepStart: async () => {},
                  stepComplete: async () => {},
                  observePi: () => async () => {},
                });
                if (result.kind === "implemented") return result.result;
                if (result.kind === "blocked") return result.result;
                return {
                  status: "blocked",
                  reason: result.result.reason,
                  questions: [],
                  commits: [],
                  validation: [],
                };
              },
              ...(input.now === undefined ? {} : { now: input.now }),
            },
            finishInputForState: (durable) => ({
              effects: {
                publishCost: async () => {
                  const implementation = durable.phases[phaseIndex];
                  if (
                    implementation?.kind !== "implementation" ||
                    !("implementation" in implementation) ||
                    implementation.implementation.runCostReport === undefined ||
                    !("pullRequest" in implementation)
                  )
                    return;
                  const report = implementation.implementation.runCostReport;
                  await publishPrRunCost({
                    host,
                    prUrl: implementation.pullRequest.url,
                    report: {
                      stages: report.stages.map((stage) => ({
                        stage: stage.stage,
                        models: stage.models.map((model) => ({ ...model })),
                        promptTokens: stage.promptTokens,
                        outputTokens: stage.outputTokens,
                        estimatedCostUsd: stage.estimatedCostUsd,
                      })),
                      promptTokens: report.promptTokens,
                      outputTokens: report.outputTokens,
                      estimatedCostUsd: report.estimatedCostUsd,
                    },
                  });
                },
                validateVisualEvidence: async () => {
                  const implementation = durable.phases[phaseIndex];
                  if (
                    implementation?.kind === "implementation" &&
                    "implementation" in implementation
                  )
                    await validateVisualEvidenceReferences({
                      repoRoot: resolve(
                        input.config.repoRoot,
                        implementation.workspace.identity.worktreePath,
                      ),
                      evidence:
                        implementation.implementation.visualEvidence.map(
                          (item) => ({
                            screenshotPath: item.screenshotPath,
                            ...(item.caption === undefined
                              ? {}
                              : { caption: item.caption }),
                            ...(item.referencePaths === undefined
                              ? {}
                              : { referencePaths: [...item.referencePaths] }),
                            ...(item.url === undefined
                              ? {}
                              : { url: item.url }),
                          }),
                        ),
                      runner: input.runner,
                      referenceScreenshotPaths:
                        input.config.projectPolicy.visualEvidence
                          .referenceScreenshotPaths,
                    });
                },
                postHandoff: async (result) =>
                  host.commentIssue(
                    input.issue.number,
                    handoffComment(
                      planPath(durable),
                      result,
                      input.config.baseBranch,
                    ),
                  ),
                cleanupHook: async () => {
                  const implementation = durable.phases[phaseIndex];
                  if (
                    implementation?.kind !== "implementation" ||
                    !("workspace" in implementation)
                  )
                    return;
                  const results = await runCleanupHookScript(
                    input.runner,
                    input.config.repoRoot,
                    implementation.workspace.identity.worktreePath,
                    input.config.cleanupHook,
                  );
                  if (results.some((result) => result.status === "failed"))
                    throw new Error("Planning cleanup hook failed");
                },
                ensureDoneLabel: async () =>
                  ensureAutomationLabel(host, input.config, input.doneLabel),
                applyDoneLabels: async () =>
                  host.applyLabels(
                    planLabelChange(
                      input.issue.number,
                      input.labels,
                      nextLabels(
                        cleanupLabelsForImplementation(input.labels, {
                          readyLabel: input.readyLabel,
                          policy: input.config.approvalPolicy,
                        }),
                        [input.inProgressLabel, input.needsInfoLabel],
                        [input.doneLabel],
                      ),
                    ),
                  ),
              },
              ...(input.now === undefined ? {} : { now: input.now }),
            }),
            ...(input.now === undefined ? {} : { now: input.now }),
          }),
      }),
  };
}
