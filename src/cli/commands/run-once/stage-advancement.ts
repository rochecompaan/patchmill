import { isAbsolute, join, relative } from "node:path";
import type { IssueHostProvider } from "../../../host/types.ts";
import { skillInvocationPaths } from "../../../workflow/skills.ts";
import { planLabelChange } from "../triage/labels.ts";
import type { ResolvedIssueArtifactSources } from "./artifact-sources.ts";
import { ensureAutomationLabel } from "./automation-labels.ts";
import { pathExists } from "./paths.ts";
import { buildPlanPath, findIssuePlan } from "./plans.ts";
import { runPiPrompt, type RunPiPromptOptions } from "./pi.ts";
import { buildPlanCreationPrompt, buildSpecCreationPrompt } from "./prompts.ts";
import { writeRunState } from "./run-state.ts";
import { buildSpecPath, findIssueSpec } from "./specs.ts";
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
  },
) => Promise<AgentIssuePipelineResult>;

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

type WorkflowArtifactResolution = {
  path?: string;
  commit?: string;
  exists: boolean;
  fromState: boolean;
  created: boolean;
  generated: boolean;
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
  checkpoints: AgentIssueRunCheckpoints;
  timestamp: string;
  now: Date;
  runOptions: {
    progress?: { event(event: AgentIssueProgressEvent): void | Promise<void> };
    streamPiOutput?: (chunk: string) => void;
    verbosePiOutput?: boolean;
    heartbeatMs?: number;
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

function promptBodyPath(
  repoRoot: string,
  absoluteArtifactPath: string,
): string {
  return relative(repoRoot, absoluteArtifactPath);
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

async function resolveWorkflowArtifact(options: {
  repoRoot: string;
  issue: IssueSummary;
  artifactDir: string;
  savedPath?: string;
  savedCommit?: string;
  savedCreated?: boolean;
  explicit?:
    | ResolvedIssueArtifactSources["spec"]
    | ResolvedIssueArtifactSources["plan"];
  findArtifact: (
    artifactDir: string,
    issueNumber: number,
  ) => Promise<string | undefined>;
  buildArtifact?: (
    artifactDir: string,
    issueNumber: number,
    title: string,
    date: Date,
  ) => string;
  now: Date;
}): Promise<WorkflowArtifactResolution> {
  if (options.explicit) {
    return {
      path: options.explicit.path,
      commit: options.explicit.commit,
      exists: true,
      fromState: false,
      created: false,
      generated: false,
    };
  }

  if (options.savedPath) {
    const savedPath = repoPath(options.repoRoot, options.savedPath);
    if (await pathExists(savedPath.absolute)) {
      return {
        path: savedPath.relative,
        commit: options.savedCommit,
        exists: true,
        fromState: true,
        created: options.savedCreated === true,
        generated: false,
      };
    }
  }

  const foundArtifact = await options.findArtifact(
    options.artifactDir,
    options.issue.number,
  );
  if (foundArtifact) {
    return {
      path: repoPath(options.repoRoot, foundArtifact).relative,
      exists: true,
      fromState: false,
      created: false,
      generated: false,
    };
  }

  if (!options.buildArtifact) {
    return {
      exists: false,
      fromState: false,
      created: false,
      generated: false,
    };
  }

  return {
    path: promptBodyPath(
      options.repoRoot,
      options.buildArtifact(
        options.artifactDir,
        options.issue.number,
        options.issue.title,
        options.now,
      ),
    ),
    exists: false,
    fromState: false,
    created: false,
    generated: true,
  };
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

  const preexistingPlan = await resolveWorkflowArtifact({
    repoRoot: config.repoRoot,
    issue,
    artifactDir: config.plansDir,
    savedPath: existingState?.planPath,
    savedCommit: existingState?.planCommit,
    savedCreated: existingState?.checkpoints?.planCreated,
    explicit: resolvedArtifacts?.plan,
    findArtifact: findIssuePlan,
    now,
  });

  await progress("info", "spec", "finding spec", {
    issueNumber: issue.number,
  });
  const spec = await resolveWorkflowArtifact({
    repoRoot: config.repoRoot,
    issue,
    artifactDir: config.specsDir,
    savedPath: existingState?.specPath,
    savedCommit: existingState?.specCommit,
    savedCreated: existingState?.checkpoints?.specCreated,
    explicit: resolvedArtifacts?.spec,
    findArtifact: findIssueSpec,
    buildArtifact: preexistingPlan.exists ? undefined : buildSpecPath,
    now,
  });
  specPath = spec.path;
  specCommit = spec.commit;
  specCreated = spec.created;

  if (specPath) {
    await writeRunState(
      config.runStateDir,
      {
        issueNumber: issue.number,
        status: "planning",
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

  if (!spec.exists && !preexistingPlan.exists) {
    if (!specPath) throw new Error("Spec path was not resolved");
    const createdSpecPath = specPath;
    const specResult = await runStep("create spec", async () => {
      await progress("info", "pi-spec", "creating spec with pi", {
        issueNumber: issue.number,
      });
      return await runPiPrompt(
        runner,
        config.repoRoot,
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
          skillPaths: skillInvocationPaths(
            [config.skills.planning],
            config.repoRoot,
          ),
          streamOutput: runOptions.streamPiOutput,
          issueNumber: issue.number,
          repoRoot: config.repoRoot,
          heartbeatMs: runOptions.heartbeatMs,
          tokenUsageState,
          observeSession: true,
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
        result: await blockIssue(specResult, { specPath, specCommit }),
      };
    }
    if (specResult.status !== "spec-created") {
      throw new Error(
        `Expected spec-created from Pi but received ${specResult.status}`,
      );
    }

    specPath = repoPath(config.repoRoot, specResult.specPath).relative;
    specCommit = specResult.commit;
    specCreated = true;
    specCreatedThisRun = true;
    await writeRunState(
      config.runStateDir,
      {
        issueNumber: issue.number,
        status: "planning",
        specPath,
        specCommit,
        checkpoints: { specCreated: true },
      },
      timestamp,
    );
    checkpoints.specCreated = true;
    if (specCommit) await emitSimpleStep(issue.number, "commit spec");
  } else if (specPath) {
    await runStep("use existing spec", async () => {
      await progress("info", "spec", `using existing spec ${specPath}`, {
        issueNumber: issue.number,
      });
    });
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
  const plan = preexistingPlan.path
    ? preexistingPlan
    : await resolveWorkflowArtifact({
        repoRoot: config.repoRoot,
        issue,
        artifactDir: config.plansDir,
        savedPath: existingState?.planPath,
        savedCommit: existingState?.planCommit,
        savedCreated: existingState?.checkpoints?.planCreated,
        explicit: resolvedArtifacts?.plan,
        findArtifact: findIssuePlan,
        buildArtifact: buildPlanPath,
        now,
      });
  planPath = plan.path;
  planCommit = plan.commit;
  planCreated = plan.created;

  if (!planPath) throw new Error("Plan path was not resolved");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: issue.number,
      status: "planning",
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

  if (!plan.exists) {
    const planned = await runStep("create plan", async () => {
      await progress("info", "pi-plan", "creating plan with pi", {
        issueNumber: issue.number,
      });
      return await runPiPrompt(
        runner,
        config.repoRoot,
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
          skillPaths: skillInvocationPaths(
            [config.skills.planning],
            config.repoRoot,
          ),
          streamOutput: runOptions.streamPiOutput,
          issueNumber: issue.number,
          repoRoot: config.repoRoot,
          heartbeatMs: runOptions.heartbeatMs,
          tokenUsageState,
          observeSession: true,
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
        result: await blockIssue(planned, { specPath, specCommit, planPath }),
      };
    }
    if (planned.status !== "plan-created") {
      throw new Error(
        `Expected plan-created from Pi but received ${planned.status}`,
      );
    }

    planPath = repoPath(config.repoRoot, planned.planPath).relative;
    planCommit = planned.commit;
    planCreated = true;
    planCreatedThisRun = true;
    await writeRunState(
      config.runStateDir,
      {
        issueNumber: issue.number,
        status: "planning",
        specPath,
        specCommit,
        planPath,
        planCommit,
        checkpoints: { planCreated: true },
      },
      timestamp,
    );
    checkpoints.planCreated = true;
    if (planCommit) await emitSimpleStep(issue.number, "commit plan");
  } else {
    await runStep("use existing plan", async () => {
      await progress("info", "plan", `using existing plan ${planPath}`, {
        issueNumber: issue.number,
      });
    });
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
