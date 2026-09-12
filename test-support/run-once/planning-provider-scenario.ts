import {
  PlanningStateStore,
  type PlanningStateV1,
} from "../../src/workflow/planning-state-store.ts";
import { resolve } from "node:path";
import { approvalPolicy, makeConfig } from "./pipeline-fixtures.ts";
import { issue } from "./issue-fixtures.ts";
import { runOneIssue } from "../../src/cli/commands/run-once/pipeline.ts";
import type { AgentIssuePipelineResult } from "../../src/cli/commands/run-once/types.ts";
import { createForgejoProcessFixture } from "./planning-forgejo-process-fixture.ts";
import { createGithubProcessFixture } from "./planning-github-process-fixture.ts";
import {
  createPlanningScenarioRepository,
  git,
  mergePlanningPull,
  remoteArtifactContents,
} from "./planning-provider-git.ts";
import { createPlanningRecoveryControl } from "./planning-provider-recovery-control.ts";
import { createPlanningProviderRunner } from "./planning-provider-runner.ts";
import { observePlanningStateReplacements } from "./planning-provider-state-observer.ts";
import type {
  PlanningScenarioEffect,
  PlanningScenarioFailurePoint,
  PlanningScenarioGates,
  PlanningScenarioProvider,
  PlanningScenarioPull,
  PlanningStateSnapshot,
  RecordedScenarioPullRequest,
} from "./planning-provider-scenario-types.ts";

export type {
  PlanningScenarioEffect,
  PlanningScenarioFailurePoint,
  PlanningScenarioGates,
  PlanningScenarioProvider,
  PlanningStateSnapshot,
  RecordedScenarioPullRequest,
} from "./planning-provider-scenario-types.ts";

const now = new Date("2099-01-01T00:00:00.000Z");

type ScenarioState = ReturnType<PlanningStateStore["read"]>;

export type PlanningProviderScenario = {
  run(options?: { planOnly?: boolean }): Promise<AgentIssuePipelineResult>;
  state(): ScenarioState;
  stateHistory(): readonly PlanningStateSnapshot[];
  pulls(): readonly RecordedScenarioPullRequest[];
  effects(): readonly PlanningScenarioEffect[];
  remoteRefs(): Promise<Readonly<Record<string, string>>>;
  mergeOpenPlanningPull(input?: {
    editArtifact?: (content: string) => string;
  }): Promise<void>;
  closeOpenPlanningPull(): void;
  removeSavedPlanningPull(): void;
  duplicateOpenPlanningPull(): void;
  failNextHostRead(): void;
  interruptAt(point: PlanningScenarioFailurePoint): void;
  restorePersistence(): Promise<void>;
  archiveExactStaleLock(): Promise<{
    fingerprint: string;
    archivePath: string;
  }>;
  installDeadProcessLock(): Promise<{ fingerprint: string }>;
  remoteArtifactContents(): Promise<Readonly<Record<string, string>>>;
  carriedArtifactContents(): Readonly<Record<string, string>>;
  cleanup(): Promise<void>;
};

function snapshot(state: PlanningStateV1): PlanningStateSnapshot {
  return {
    revision: state.revision,
    phases: state.phases.map((phase) => ({
      kind: phase.kind,
      status: phase.status,
      ...("finish" in phase
        ? { finish: Object.keys(phase.finish).sort() }
        : {}),
      ...("workspace" in phase
        ? {
            ownership: {
              branch: phase.workspace.identity.branch,
              worktreePath: phase.workspace.identity.worktreePath,
              cleanupState: phase.workspace.cleanup.state,
            },
          }
        : {}),
    })),
  };
}

function recordedPull(pull: PlanningScenarioPull): RecordedScenarioPullRequest {
  return {
    number: pull.number,
    phase:
      pull.number === 99
        ? "implementation"
        : pull.body.includes("phase=spec")
          ? "spec"
          : "plan",
    targetRepository: "acme/patchmill",
    headRepository: pull.headRepository,
    baseBranch: "main",
    headBranch: pull.branch,
    headOid: pull.headOid,
    body: pull.body,
    status: pull.merged ? "merged" : pull.closed ? "closed-unmerged" : "open",
    ...(pull.mergeOid ? { mergeOid: pull.mergeOid } : {}),
  };
}

/** Composes real Git, provider-process, and recovery test fixtures for one Issue. */
export async function createPlanningProviderScenario(input: {
  provider: PlanningScenarioProvider;
  gates: PlanningScenarioGates;
}): Promise<PlanningProviderScenario> {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    allowDirectLand: true,
    approvalPolicy: approvalPolicy(input.gates),
    host: { provider: input.provider, login: "" },
    cleanupHook: "cleanup.sh",
  });
  const repository = await createPlanningScenarioRepository(config);
  const selected = issue(190, ["agent-ready"], "Provider scenario");
  const pulls: PlanningScenarioPull[] = [];
  const effects: PlanningScenarioEffect[] = [];
  const history: PlanningStateSnapshot[] = [];
  const carriedArtifacts = new Map<string, string>();
  const stateStore = new PlanningStateStore(config.runStateDir);
  const state = () => stateStore.read(190);
  const record = (effect: PlanningScenarioEffect) => effects.push(effect);
  const stopObservingState = observePlanningStateReplacements(
    config.runStateDir,
    (current) => history.push(snapshot(current)),
  );
  const ownershipForBranch = async (branch: string) => {
    const phase = (await state())?.phases.find(
      (candidate) =>
        "workspace" in candidate &&
        candidate.workspace.identity.branch === branch,
    );
    if (phase === undefined || !("workspace" in phase))
      throw new Error(`saved workspace ownership missing for ${branch}`);
    return {
      phase: phase.kind,
      branch: phase.workspace.identity.branch,
      worktreePath: phase.workspace.identity.worktreePath,
    };
  };
  const recovery = createPlanningRecoveryControl({
    runStateDir: config.runStateDir,
    issueNumber: 190,
    now,
    record,
  });
  let nextPull = 1;
  let failHostRead = false;
  const addIssueComment = (body: string) => {
    selected.comments?.push({ author: { login: "patchmill" }, body });
  };
  const updateIssueLabels = (
    add: readonly string[],
    remove: readonly string[],
  ) => {
    selected.labels = selected.labels
      .filter((label) => !remove.includes(label))
      .concat(add.filter((label) => !selected.labels.includes(label)));
  };
  const ownershipForWorktree = async (worktreePath: string) => {
    const resolvedPath = resolve(config.repoRoot, worktreePath);
    const phase = (await state())?.phases.find(
      (candidate) =>
        "workspace" in candidate &&
        resolve(config.repoRoot, candidate.workspace.identity.worktreePath) ===
          resolvedPath,
    );
    if (phase === undefined || !("workspace" in phase))
      throw new Error(`saved workspace ownership missing for ${worktreePath}`);
    return {
      phase: phase.kind,
      branch: phase.workspace.identity.branch,
      worktreePath: phase.workspace.identity.worktreePath,
    };
  };
  const implementationFinish = async () => {
    const implementation = (await state())?.phases.find(
      (phase) => phase.kind === "implementation",
    );
    return (
      implementation?.kind === "implementation" &&
      implementation.status === "pull-request-open"
    );
  };
  const fixtures = {
    issue: selected,
    pulls,
    nextPull: () => nextPull++,
    headOid: async (branch: string) =>
      (
        await git(config.repoRoot, ["rev-parse", `refs/heads/${branch}`])
      ).stdout.trim(),
    ownershipForBranch,
    implementationFinish,
    interrupt: recovery.interruptAfter,
    consumeHostReadFailure: () => {
      if (!failHostRead) return false;
      failHostRead = false;
      return true;
    },
    addIssueComment,
    updateIssueLabels,
    record,
  };
  const github = createGithubProcessFixture(fixtures);
  const forgejo = createForgejoProcessFixture(fixtures);
  const planningPhaseMerged = async () => {
    const current = await state();
    return current?.phases.some(
      (phase) =>
        phase.kind !== "implementation" &&
        phase.status === "pull-request-open" &&
        pulls.some(
          (pull) =>
            pull.merged && pull.branch === phase.workspace.identity.branch,
        ),
    );
  };
  const runner = createPlanningProviderRunner({
    provider: input.provider,
    repoRoot: config.repoRoot,
    pulls,
    carriedArtifacts,
    ownershipForBranch,
    ownershipForWorktree,
    planningPhaseMerged,
    interruptAfter: recovery.interruptAfter,
    github,
    forgejo,
    record,
  });
  const run = async (options = {}) =>
    runOneIssue(
      runner,
      { ...config, planOnly: options.planOnly ?? false },
      { now },
    );
  return {
    run,
    state,
    stateHistory: () => history,
    pulls: () => pulls.map(recordedPull),
    effects: () => effects,
    remoteRefs: repository.remoteRefs,
    mergeOpenPlanningPull: async (merge) => {
      await mergePlanningPull({ repoRoot: config.repoRoot, pulls, ...merge });
    },
    closeOpenPlanningPull: () => {
      const pull = pulls.find((item) => item.number !== 99 && !item.merged);
      if (pull) pull.closed = true;
    },
    removeSavedPlanningPull: () => {
      const index = pulls.findIndex(
        (item) => item.number !== 99 && !item.merged,
      );
      if (index >= 0) pulls.splice(index, 1);
    },
    duplicateOpenPlanningPull: () => {
      const pull = pulls.find((item) => item.number !== 99 && !item.merged);
      if (pull) pulls.push({ ...pull, number: nextPull++ });
    },
    failNextHostRead: () => {
      failHostRead = true;
    },
    interruptAt: recovery.interruptAt,
    restorePersistence: recovery.restorePersistence,
    installDeadProcessLock: async () =>
      recovery.installDeadProcessLock(await state()),
    archiveExactStaleLock: recovery.archiveExactStaleLock,
    carriedArtifactContents: () => Object.fromEntries(carriedArtifacts),
    remoteArtifactContents: async () =>
      remoteArtifactContents(config.repoRoot, await state()),
    cleanup: async () => {
      stopObservingState();
      await recovery.cleanup();
      await repository.cleanup();
    },
  };
}
