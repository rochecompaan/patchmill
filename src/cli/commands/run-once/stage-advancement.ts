import { isAbsolute, join, relative } from "node:path";
import type { IssueHostProvider } from "../../../host/types.ts";
import { publishWorkflowArtifact } from "../../../workflow/artifacts/publish-artifact.ts";
import {
  profileExtensionArgs,
  runOncePlanningPiProfile,
} from "../../../pi/resource-profiles.ts";
import { planLabelChange } from "../triage/labels.ts";
import type { ResolvedIssueArtifactSources } from "./artifact-sources.ts";
import { ensureAutomationLabel } from "./automation-labels.ts";
import { runPiPrompt, type RunPiPromptOptions } from "./pi.ts";
import type { IssueWorktreeResult } from "./git.ts";
import { buildPlanCreationPrompt, buildSpecCreationPrompt } from "./prompts.ts";
import { writeRunState } from "./run-state.ts";
import {
  resolvePlanningArtifacts,
  type PlanningArtifactPolicy,
} from "./planning-artifacts.ts";
import type { AgentIssueProgressEvent } from "./progress.ts";
import type {
  AgentIssueBlockedResult,
  AgentIssueConfig,
  AgentIssuePipelineResult,
  AgentIssueRunCheckpoints,
  AgentIssueRunStateStatus,
  CommandRunner,
  IssueSummary,
} from "./types.ts";
import { mirrorConfiguredPathInWorktree } from "./pipeline-workspace.ts";
import {
  cleanupLabelsForPlanReview,
  cleanupLabelsForSpecReview,
  decidePlanApprovalGate,
} from "./workflow-state.ts";

type StageProgress = (
  level: AgentIssueProgressEvent["level"],
  stage: string,
  message: string,
  extras?: Partial<
    Pick<AgentIssueProgressEvent, "issueNumber" | "elapsedSeconds" | "data">
  >,
) => Promise<void>;

type RunStep = <T>(label: string, fn: () => Promise<T>) => Promise<T>;

type BlockIssue = (
  result: AgentIssueBlockedResult,
  details: {
    specPath?: string;
    specCommit?: string;
    planPath?: string;
    planCommit?: string;
    branch?: string;
    worktreePath?: string;
  },
) => Promise<AgentIssuePipelineResult>;

type PlanningArtifactWorkspace = Partial<
  Pick<IssueWorktreeResult, "branch" | "worktreePath">
> & {
  repoRoot: string;
};

type ExistingPlanningState = {
  status?: AgentIssueRunStateStatus;
  branch?: string;
  worktreePath?: string;
  blockedAt?: string;
  lastError?: string;
  specPath?: string;
  specCommit?: string;
  planPath?: string;
  planCommit?: string;
  checkpoints?: AgentIssueRunCheckpoints;
};

export type PlanningStageAdvanceResult =
  | {
      kind: "continue";
      labels: string[];
      specPath?: string;
      specCommit?: string;
      planPath: string;
      planCommit?: string;
    }
  | { kind: "finished"; result: AgentIssuePipelineResult };

export type AdvancePlanningStagesOptions = {
  runner: CommandRunner;
  host: IssueHostProvider;
  config: AgentIssueConfig;
  issue: IssueSummary;
  labels: string[];
  ready: string;
  inProgress: string;
  needsInfo: string;
  existingState?: ExistingPlanningState;
  resolvedArtifacts?: ResolvedIssueArtifactSources;
  artifactPolicy?: PlanningArtifactPolicy;
  ensurePlanningArtifactWorkspace?: () => Promise<PlanningArtifactWorkspace>;
  checkpoints: AgentIssueRunCheckpoints;
  timestamp: string;
  now: Date;
  runOptions: {
    progress?: { event(event: AgentIssueProgressEvent): void | Promise<void> };
    streamPiOutput?: (chunk: string) => void;
    verbosePiOutput?: boolean;
    heartbeatMs?: number;
    piSessionPath?: string;
  };
  piAgentDir: string;
  tokenUsageState: { total: number };
  progress: StageProgress;
  runStep: RunStep;
  observePi: (
    stage: "pi-plan" | "pi-implementation",
  ) => NonNullable<RunPiPromptOptions["onObservation"]>;
  emitSimpleStep: (issueNumber: number, label: string) => Promise<void>;
  blockIssue: BlockIssue;
};

function repoPath(
  repoRoot: string,
  path: string,
): { absolute: string; relative: string } {
  if (isAbsolute(path)) {
    return { absolute: path, relative: relative(repoRoot, path) };
  }

  return { absolute: join(repoRoot, path), relative: path };
}

function nextLabels(
  labels: string[],
  remove: string[],
  add: string[],
): string[] {
  const removed = new Set(remove);
  const kept = labels.filter((label) => !removed.has(label));
  return [...kept, ...add.filter((label) => !kept.includes(label))];
}

function specComment(specPath: string, created: boolean): string {
  return `${created ? "Spec ready" : "Existing spec ready"}: \`${specPath}\``;
}

function planComment(planPath: string, created: boolean): string {
  return `${created ? "Plan ready" : "Existing plan ready"}: \`${planPath}\``;
}

function reviewStopStatus(
  existingState: ExistingPlanningState | undefined,
): "blocked" | "finished" {
  if (
    !existingState ||
    (!existingState.branch && !existingState.worktreePath)
  ) {
    return "finished";
  }
  return existingState.status === "blocked" ||
    (existingState.status === "finished" &&
      !!existingState.blockedAt &&
      !!existingState.lastError)
    ? "blocked"
    : "finished";
}

export async function advancePlanningStages({
  runner,
  host,
  config,
  issue,
  labels: initialLabels,
  ready,
  inProgress,
  needsInfo,
  existingState,
  resolvedArtifacts,
  artifactPolicy,
  ensurePlanningArtifactWorkspace,
  checkpoints,
  timestamp,
  now,
  runOptions,
  piAgentDir,
  tokenUsageState,
  progress,
  runStep,
  observePi,
  emitSimpleStep,
  blockIssue,
}: AdvancePlanningStagesOptions): Promise<PlanningStageAdvanceResult> {
  const labels = initialLabels;
  let specPath: string | undefined;
  let specCommit: string | undefined;
  let specCreated: boolean;
  let specCreatedThisRun = false;
  let planPath: string | undefined;
  let planCommit: string | undefined;
  let planCreated: boolean;
  let planCreatedThisRun = false;

  let planningArtifactWorkspace: PlanningArtifactWorkspace = {
    repoRoot: config.repoRoot,
  };
  let planningRepoRoot = planningArtifactWorkspace.repoRoot;
  let planningPlansDir = mirrorConfiguredPathInWorktree(
    config.repoRoot,
    planningRepoRoot,
    config.plansDir,
  );
  let planningSpecsDir = mirrorConfiguredPathInWorktree(
    config.repoRoot,
    planningRepoRoot,
    config.specsDir,
  );
  const planningWorkspaceState = () => ({
    ...(planningArtifactWorkspace.branch
      ? { branch: planningArtifactWorkspace.branch }
      : {}),
    ...(planningArtifactWorkspace.worktreePath
      ? { worktreePath: planningArtifactWorkspace.worktreePath }
      : {}),
  });
  const setPlanningArtifactWorkspace = (
    workspace: PlanningArtifactWorkspace,
  ): void => {
    planningArtifactWorkspace = workspace;
    planningRepoRoot = planningArtifactWorkspace.repoRoot;
    planningPlansDir = mirrorConfiguredPathInWorktree(
      config.repoRoot,
      planningRepoRoot,
      config.plansDir,
    );
    planningSpecsDir = mirrorConfiguredPathInWorktree(
      config.repoRoot,
      planningRepoRoot,
      config.specsDir,
    );
  };
  const freshArtifactPolicy = (): PlanningArtifactPolicy => ({
    kind: "fresh" as const,
    primary: {
      repoRoot: planningRepoRoot,
      specsDir: planningSpecsDir,
      plansDir: planningPlansDir,
      source: "primary-repo" as const,
    },
    fallbacks:
      planningRepoRoot === config.repoRoot
        ? undefined
        : [
            {
              repoRoot: config.repoRoot,
              specsDir: config.specsDir,
              plansDir: config.plansDir,
              source: "primary-repo" as const,
            },
          ],
    explicit: resolvedArtifacts,
    saved: {
      specPath: existingState?.specPath,
      specCommit: existingState?.specCommit,
      planPath: existingState?.planPath,
      planCommit: existingState?.planCommit,
      specCreated: existingState?.checkpoints?.specCreated,
      planCreated: existingState?.checkpoints?.planCreated,
    },
    allowGeneratedSpec: true,
    allowGeneratedPlan: true,
  });

  if (artifactPolicy?.kind === "implementation-resume") {
    planningArtifactWorkspace = {
      repoRoot: artifactPolicy.primary.repoRoot,
      ...(existingState?.branch ? { branch: existingState.branch } : {}),
      ...(existingState?.worktreePath
        ? { worktreePath: existingState.worktreePath }
        : {}),
    };
    planningRepoRoot = artifactPolicy.primary.repoRoot;
    planningSpecsDir = artifactPolicy.primary.specsDir;
    planningPlansDir = artifactPolicy.primary.plansDir;
  }

  let artifactPolicyForRun = artifactPolicy ?? freshArtifactPolicy();
  let planningArtifacts = await resolvePlanningArtifacts({
    policy: artifactPolicyForRun,
    issue,
    now,
  });
  if (
    !artifactPolicy &&
    ensurePlanningArtifactWorkspace &&
    (planningArtifacts.plan.generated ||
      (!planningArtifacts.plan.exists && planningArtifacts.spec.generated))
  ) {
    setPlanningArtifactWorkspace(await ensurePlanningArtifactWorkspace());
    artifactPolicyForRun = freshArtifactPolicy();
    planningArtifacts = await resolvePlanningArtifacts({
      policy: artifactPolicyForRun,
      issue,
      now,
    });
  }
  const preexistingPlan = planningArtifacts.plan;

  await progress("info", "spec", "finding spec", {
    issueNumber: issue.number,
  });
  const spec =
    preexistingPlan.exists && planningArtifacts.spec.generated
      ? {
          exists: false,
          fromState: false,
          created: false,
          generated: false,
        }
      : planningArtifacts.spec;
  specPath = spec.path;
  specCommit = spec.commit;
  specCreated = spec.created;

  if (specPath && !spec.generated) {
    await writeRunState(
      config.runStateDir,
      {
        issueNumber: issue.number,
        status: "planning",
        ...planningWorkspaceState(),
        specPath,
        specCommit,
        checkpoints: {
          specPathResolved: true,
          ...(specCreated ? { specCreated: true } : {}),
        },
      },
      timestamp,
    );
    checkpoints.specPathResolved = true;
    if (specCreated) checkpoints.specCreated = true;
  }

  const planningProfile = runOncePlanningPiProfile(
    config.skills,
    planningRepoRoot,
  );

  if (!spec.exists && !preexistingPlan.exists) {
    if (!specPath) throw new Error("Spec path was not resolved");
    const createdSpecPath = specPath;
    const specResult = await runStep("create spec", async () => {
      await progress("info", "pi-spec", "creating spec with pi", {
        issueNumber: issue.number,
      });
      return await runPiPrompt(
        runner,
        planningRepoRoot,
        buildSpecCreationPrompt({
          issue,
          specPath: createdSpecPath,
          projectPolicy: config.projectPolicy,
          specApprovalRequired: config.approvalPolicy.specApproval.required,
          skills: config.skills,
          triageLabels: { ready, needsInfo },
        }),
        {
          progress: runOptions.progress,
          stage: "pi-plan",
          skillPaths: planningProfile.additionalSkillPaths,
          extensionArgs: profileExtensionArgs(planningProfile),
          streamOutput: runOptions.streamPiOutput,
          issueNumber: issue.number,
          repoRoot: planningRepoRoot,
          heartbeatMs: runOptions.heartbeatMs,
          tokenUsageState,
          observeSession: true,
          sessionRoot: runOptions.piSessionPath,
          verbosePiOutput: runOptions.verbosePiOutput,
          onObservation: observePi("pi-plan"),
          taskContract: config.projectPolicy.pi.taskContract,
          piAgentDir,
        },
      );
    });
    if (specResult.status === "blocked") {
      return {
        kind: "finished",
        result: await blockIssue(specResult, {
          ...planningWorkspaceState(),
          specPath: spec.generated && !specCreated ? undefined : specPath,
          specCommit,
        }),
      };
    }
    if (specResult.status !== "spec-created") {
      throw new Error(
        `Expected spec-created from Pi but received ${specResult.status}`,
      );
    }

    specPath = repoPath(planningRepoRoot, specResult.specPath).relative;
    specCommit = specResult.commit;
    specCreated = true;
    specCreatedThisRun = true;
    await writeRunState(
      config.runStateDir,
      {
        issueNumber: issue.number,
        status: "planning",
        ...planningWorkspaceState(),
        specPath,
        specCommit,
        checkpoints: { specPathResolved: true, specCreated: true },
      },
      timestamp,
    );
    checkpoints.specPathResolved = true;
    checkpoints.specCreated = true;
    if (specCommit) await emitSimpleStep(issue.number, "commit spec");
  } else if (specPath) {
    await runStep("use existing spec", async () => {
      await progress("info", "spec", `using existing spec ${specPath}`, {
        issueNumber: issue.number,
      });
    });
  }

  if (
    config.approvalPolicy.specApproval.required &&
    specCreated &&
    specPath &&
    !specCommit
  ) {
    throw new Error(
      `Cannot publish spec artifact ${specPath} without a commit SHA`,
    );
  }

  if (
    config.approvalPolicy.specApproval.required &&
    specCreated &&
    specPath &&
    !checkpoints.specPublished
  ) {
    await runStep("publish spec artifact", async () => {
      try {
        await publishWorkflowArtifact({
          kind: "spec",
          issueNumber: issue.number,
          repoRoot: planningRepoRoot,
          artifactPath: specPath,
          artifactDir: planningSpecsDir,
          publishComment: async (issueNumber, body) => {
            await host.commentIssue(issueNumber, body);
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to publish spec artifact ${specPath}: ${message}`,
          { cause: error },
        );
      }
    });
    await writeRunState(
      config.runStateDir,
      {
        issueNumber: issue.number,
        title: issue.title,
        status: "planning",
        ...planningWorkspaceState(),
        specPath,
        specCommit,
        checkpoints: { specPublished: true },
      },
      timestamp,
    );
    checkpoints.specPublished = true;
    await emitSimpleStep(issue.number, "publish spec");
  }

  const hasCurrentSpecApproval =
    issue.labels.includes(config.approvalPolicy.specApproval.approvedLabel) &&
    !specCreatedThisRun;
  const mustStopForSpecReview =
    config.approvalPolicy.specApproval.required &&
    specPath !== undefined &&
    !hasCurrentSpecApproval;

  if (mustStopForSpecReview) {
    if (!specPath) throw new Error("Spec path was not resolved");
    const finalLabels = nextLabels(
      cleanupLabelsForSpecReview(labels, {
        readyLabel: ready,
        policy: config.approvalPolicy,
      }),
      [inProgress],
      [],
    );
    if (!checkpoints.specReadyCommentPosted) {
      await host.commentIssue(issue.number, specComment(specPath, specCreated));
      await writeRunState(
        config.runStateDir,
        {
          issueNumber: issue.number,
          status: "planning",
          ...planningWorkspaceState(),
          specPath,
          specCommit,
          checkpoints: { specReadyCommentPosted: true },
        },
        timestamp,
      );
      checkpoints.specReadyCommentPosted = true;
    }
    await ensureAutomationLabel(
      host,
      config,
      config.approvalPolicy.specApproval.reviewLabel,
    );
    await host.applyLabels(planLabelChange(issue.number, labels, finalLabels));
    await writeRunState(
      config.runStateDir,
      {
        issueNumber: issue.number,
        status: reviewStopStatus(existingState),
        ...planningWorkspaceState(),
        specPath,
        specCommit,
        checkpoints: { readyLabelRestored: true },
      },
      timestamp,
    );
    checkpoints.readyLabelRestored = true;
    const specStatus = specCreated ? "spec-created" : "spec-found";
    await emitSimpleStep(issue.number, `final result ${specStatus}`);
    return {
      kind: "finished",
      result: {
        status: specStatus,
        issue,
        specPath,
      },
    };
  }

  await progress("info", "plan", "finding plan", {
    issueNumber: issue.number,
  });
  const plan = preexistingPlan.path ? preexistingPlan : planningArtifacts.plan;
  planPath = plan.path;
  planCommit = plan.commit;
  planCreated = plan.created;

  if (!planPath) throw new Error("Plan path was not resolved");
  if (!plan.generated) {
    await writeRunState(
      config.runStateDir,
      {
        issueNumber: issue.number,
        status: "planning",
        ...planningWorkspaceState(),
        specPath,
        specCommit,
        planPath,
        checkpoints: {
          planPathResolved: true,
          ...(planCreated ? { planCreated: true } : {}),
        },
      },
      timestamp,
    );
    checkpoints.planPathResolved = true;
    if (planCreated) checkpoints.planCreated = true;
  }

  if (!plan.exists) {
    const planned = await runStep("create plan", async () => {
      await progress("info", "pi-plan", "creating plan with pi", {
        issueNumber: issue.number,
      });
      return await runPiPrompt(
        runner,
        planningRepoRoot,
        buildPlanCreationPrompt({
          issue,
          specPath,
          planPath,
          projectPolicy: config.projectPolicy,
          planApprovalRequired: config.approvalPolicy.planApproval.required,
          skills: config.skills,
          triageLabels: { ready, needsInfo },
        }),
        {
          progress: runOptions.progress,
          stage: "pi-plan",
          skillPaths: planningProfile.additionalSkillPaths,
          extensionArgs: profileExtensionArgs(planningProfile),
          streamOutput: runOptions.streamPiOutput,
          issueNumber: issue.number,
          repoRoot: planningRepoRoot,
          heartbeatMs: runOptions.heartbeatMs,
          tokenUsageState,
          observeSession: true,
          sessionRoot: runOptions.piSessionPath,
          verbosePiOutput: runOptions.verbosePiOutput,
          onObservation: observePi("pi-plan"),
          taskContract: config.projectPolicy.pi.taskContract,
          piAgentDir,
        },
      );
    });
    if (planned.status === "blocked") {
      return {
        kind: "finished",
        result: await blockIssue(planned, {
          ...planningWorkspaceState(),
          specPath: spec.generated && !specCreated ? undefined : specPath,
          specCommit,
          planPath: plan.generated && !planCreated ? undefined : planPath,
        }),
      };
    }
    if (planned.status !== "plan-created") {
      throw new Error(
        `Expected plan-created from Pi but received ${planned.status}`,
      );
    }

    planPath = repoPath(planningRepoRoot, planned.planPath).relative;
    planCommit = planned.commit;
    planCreated = true;
    planCreatedThisRun = true;
    await writeRunState(
      config.runStateDir,
      {
        issueNumber: issue.number,
        status: "planning",
        ...planningWorkspaceState(),
        specPath,
        specCommit,
        planPath,
        planCommit,
        checkpoints: { planPathResolved: true, planCreated: true },
      },
      timestamp,
    );
    checkpoints.planPathResolved = true;
    checkpoints.planCreated = true;
    if (planCommit) await emitSimpleStep(issue.number, "commit plan");
  } else {
    await runStep("use existing plan", async () => {
      await progress("info", "plan", `using existing plan ${planPath}`, {
        issueNumber: issue.number,
      });
    });
  }

  if (
    config.approvalPolicy.planApproval.required &&
    planCreated &&
    planPath &&
    !planCommit
  ) {
    throw new Error(
      `Cannot publish plan artifact ${planPath} without a commit SHA`,
    );
  }

  if (
    config.approvalPolicy.planApproval.required &&
    planCreated &&
    planPath &&
    !checkpoints.planPublished
  ) {
    await runStep("publish plan artifact", async () => {
      try {
        await publishWorkflowArtifact({
          kind: "plan",
          issueNumber: issue.number,
          repoRoot: planningRepoRoot,
          artifactPath: planPath,
          artifactDir: planningPlansDir,
          publishComment: async (issueNumber, body) => {
            await host.commentIssue(issueNumber, body);
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to publish plan artifact ${planPath}: ${message}`,
          { cause: error },
        );
      }
    });
    await writeRunState(
      config.runStateDir,
      {
        issueNumber: issue.number,
        title: issue.title,
        status: "planning",
        ...planningWorkspaceState(),
        specPath,
        specCommit,
        planPath,
        planCommit,
        checkpoints: { planPublished: true },
      },
      timestamp,
    );
    checkpoints.planPublished = true;
    await emitSimpleStep(issue.number, "publish plan");
  }

  const planGate = decidePlanApprovalGate({
    labels,
    planOnly: config.planOnly,
    planCreatedThisRun,
    policy: config.approvalPolicy,
  });

  if (planGate.action !== "proceed") {
    const finalLabels =
      planGate.action === "stop-for-plan-review"
        ? nextLabels(
            cleanupLabelsForPlanReview(labels, {
              readyLabel: ready,
              policy: config.approvalPolicy,
            }),
            [inProgress],
            [],
          )
        : nextLabels(labels, [inProgress], [ready]);
    if (!checkpoints.planReadyCommentPosted) {
      await host.commentIssue(issue.number, planComment(planPath, planCreated));
      await writeRunState(
        config.runStateDir,
        {
          issueNumber: issue.number,
          status: "planning",
          ...planningWorkspaceState(),
          specPath,
          specCommit,
          planPath,
          planCommit,
          checkpoints: { planReadyCommentPosted: true },
        },
        timestamp,
      );
      checkpoints.planReadyCommentPosted = true;
    }
    if (!checkpoints.readyLabelRestored) {
      if (planGate.action === "stop-for-plan-review") {
        await ensureAutomationLabel(host, config, planGate.reviewLabel);
      }
      await host.applyLabels(
        planLabelChange(issue.number, labels, finalLabels),
      );
      await writeRunState(
        config.runStateDir,
        {
          issueNumber: issue.number,
          status: reviewStopStatus(existingState),
          ...planningWorkspaceState(),
          specPath,
          specCommit,
          planPath,
          planCommit,
          checkpoints: { readyLabelRestored: true },
        },
        timestamp,
      );
      checkpoints.readyLabelRestored = true;
    }
    await writeRunState(
      config.runStateDir,
      {
        issueNumber: issue.number,
        status: reviewStopStatus(existingState),
        ...planningWorkspaceState(),
        specPath,
        specCommit,
        planPath,
        planCommit,
      },
      timestamp,
    );
    const planStatus = planCreated ? "plan-created" : "plan-found";
    await emitSimpleStep(issue.number, `final result ${planStatus}`);
    return {
      kind: "finished",
      result: {
        status: planStatus,
        issue,
        specPath,
        planPath,
      },
    };
  }

  return {
    kind: "continue",
    labels,
    specPath,
    specCommit,
    planPath,
    planCommit,
  };
}
