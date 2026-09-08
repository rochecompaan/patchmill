import { isAbsolute, relative, resolve } from "node:path";
import type { PlanningPublicationOperations } from "../../../git/planning-publication-git.ts";
import type { PlanningRemoteBaseSnapshot } from "../../../git/planning-workspaces.ts";
import {
  profileExtensionArgs,
  runOncePlanningPiProfile,
} from "../../../pi/resource-profiles.ts";
import type { PatchmillProjectPolicy } from "../../../policy/types.ts";
import type { PatchmillSkillsConfig } from "../../../workflow/skills.ts";
import type {
  PlannedPhase,
  PlanningArtifactKind,
} from "../../../workflow/planning-pull-requests.ts";
import type {
  PlanningArtifactEvidence,
  WorkspaceReadyPlanningPhase,
} from "../../../workflow/planning-state-types.ts";
import { buildPlanPath } from "./plans.ts";
import {
  buildSpecCreationPrompt,
  buildPlanCreationPrompt,
  type PromptTriageLabels,
} from "./prompts.ts";
import { configuredPathRelativeToRepo } from "./pipeline-workspace.ts";
import { buildSpecPath } from "./specs.ts";
import { runPiPrompt, type RunPiPromptOptions } from "./pi.ts";
import type {
  AgentIssueBlockedResult,
  AgentIssuePiResult,
  CommandRunner,
  IssueSummary,
} from "./types.ts";

export type PlanningPhaseArtifactResolution =
  | Readonly<{
      kind: "satisfied-by-base";
      artifacts: readonly PlanningArtifactEvidence[];
    }>
  | Readonly<{
      kind: "workspace-required";
      artifacts: readonly PlanningArtifactEvidence[];
      missing: readonly PlanningArtifactKind[];
    }>;
export interface PlanningArtifactAgent {
  run(input: {
    kind: PlanningArtifactKind;
    cwd: string;
    prompt: string;
  }): Promise<AgentIssuePiResult>;
}
export type PlanningArtifactCheckpoint = (
  phase: WorkspaceReadyPlanningPhase,
) => Promise<void>;

export function createPlanningArtifactAgent(input: {
  runner: CommandRunner;
  skills: PatchmillSkillsConfig;
  issueNumber: number;
  runOptions?: Omit<
    RunPiPromptOptions,
    | "stage"
    | "issueNumber"
    | "repoRoot"
    | "skillPaths"
    | "extensionArgs"
    | "observeSession"
  >;
}): PlanningArtifactAgent {
  return {
    async run({ cwd, prompt }) {
      const profile = runOncePlanningPiProfile(input.skills, cwd);
      return runPiPrompt(input.runner, cwd, prompt, {
        ...input.runOptions,
        stage: "pi-plan",
        issueNumber: input.issueNumber,
        repoRoot: cwd,
        skillPaths: profile.additionalSkillPaths,
        extensionArgs: profileExtensionArgs(profile),
        observeSession: true,
      });
    },
  };
}
export class PlanningPhaseArtifactError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`Planning phase artifact failed: ${reason}`);
    this.name = "PlanningPhaseArtifactError";
    this.reason = reason;
  }
}
export function resolvePlanningPhaseArtifacts(input: {
  phase: PlannedPhase;
  base: PlanningRemoteBaseSnapshot;
}): PlanningPhaseArtifactResolution {
  const artifacts: PlanningArtifactEvidence[] = [];
  const missing: PlanningArtifactKind[] = [];
  for (const kind of input.phase.artifactKinds) {
    const candidates = input.base.artifactCandidates[kind];
    if (candidates.length > 1)
      throw new PlanningPhaseArtifactError("ambiguous-base-artifact");
    if (candidates.length === 1)
      artifacts.push({
        kind,
        path: candidates[0]!,
        source: "remote-base",
        commitOid: input.base.baseOid,
      });
    else missing.push(kind);
  }
  return missing.length === 0
    ? { kind: "satisfied-by-base", artifacts }
    : { kind: "workspace-required", artifacts, missing };
}
function mergedBaseSpecPath(
  current: WorkspaceReadyPlanningPhase,
): string | undefined {
  const candidates = current.base.artifactCandidates.spec;
  return candidates.length === 1 ? candidates[0] : undefined;
}
function reviewContext(
  phase: PlannedPhase,
  kind: PlanningArtifactKind,
  current: WorkspaceReadyPlanningPhase,
) {
  return phase.kind === "implementation"
    ? ("implementation-pull-request" as const)
    : phase.artifactKinds.length > 1
      ? ("same-phase-pull-request" as const)
      : kind === "plan" &&
          (current.artifacts.some((artifact) => artifact.kind === "spec") ||
            mergedBaseSpecPath(current) !== undefined)
        ? ("merged-base" as const)
        : ("dedicated-pull-request" as const);
}
function containedPath(
  repoRoot: string,
  directory: string,
  value: string,
): string {
  if (isAbsolute(value) || value.includes("\\"))
    throw new PlanningPhaseArtifactError("invalid-artifact-path");
  const root = resolve(repoRoot);
  const expected = resolve(root, configuredPathRelativeToRepo(root, directory));
  const absolute = resolve(root, value);
  if (
    relative(expected, absolute).startsWith("..") ||
    relative(expected, absolute) === ""
  )
    throw new PlanningPhaseArtifactError("invalid-artifact-path");
  return relative(root, absolute).replaceAll("\\", "/");
}
function resultFor(
  kind: PlanningArtifactKind,
  result: AgentIssuePiResult,
): { path: string; commit: string } | AgentIssueBlockedResult {
  if (result.status === "blocked") return result;
  if (kind === "spec" && result.status === "spec-created" && result.commit)
    return { path: result.specPath, commit: result.commit };
  if (kind === "plan" && result.status === "plan-created" && result.commit)
    return { path: result.planPath, commit: result.commit };
  throw new PlanningPhaseArtifactError("unexpected-agent-result");
}
export async function runPlanningPhaseArtifacts(input: {
  issue: IssueSummary;
  phase: PlannedPhase;
  current: WorkspaceReadyPlanningPhase;
  repoRoot: string;
  specsDir: string;
  plansDir: string;
  artifactDate: Date;
  agent: PlanningArtifactAgent;
  git: Pick<PlanningPublicationOperations, "verifyArtifactCommit">;
  checkpoint: PlanningArtifactCheckpoint;
  projectPolicy: PatchmillProjectPolicy;
  skills: PatchmillSkillsConfig;
  triageLabels: PromptTriageLabels;
}): Promise<
  | { kind: "workspace-ready"; phase: WorkspaceReadyPlanningPhase }
  | { kind: "blocked"; result: AgentIssueBlockedResult }
> {
  let current = input.current;
  const missing = input.phase.artifactKinds.filter(
    (kind) => !current.artifacts.some((artifact) => artifact.kind === kind),
  );
  for (const kind of missing) {
    const expectedPath =
      kind === "spec"
        ? buildSpecPath(
            input.specsDir,
            input.issue.number,
            input.issue.title,
            input.artifactDate,
          )
        : buildPlanPath(
            input.plansDir,
            input.issue.number,
            input.issue.title,
            input.artifactDate,
          );
    const expectedPathInWorkspace = configuredPathRelativeToRepo(
      input.repoRoot,
      expectedPath,
    );
    const specPath =
      current.artifacts.find((artifact) => artifact.kind === "spec")?.path ??
      mergedBaseSpecPath(current);
    const prompt =
      kind === "spec"
        ? buildSpecCreationPrompt({
            issue: input.issue,
            specPath: expectedPathInWorkspace,
            projectPolicy: input.projectPolicy,
            skills: input.skills,
            triageLabels: input.triageLabels,
            reviewContext: reviewContext(input.phase, kind, current),
          })
        : buildPlanCreationPrompt({
            issue: input.issue,
            ...(specPath === undefined ? {} : { specPath }),
            planPath: expectedPathInWorkspace,
            projectPolicy: input.projectPolicy,
            skills: input.skills,
            triageLabels: input.triageLabels,
            reviewContext: reviewContext(input.phase, kind, current),
          });
    const result = resultFor(
      kind,
      await input.agent.run({
        kind,
        cwd: current.workspace.identity.worktreePath,
        prompt,
      }),
    );
    if ("status" in result) return { kind: "blocked", result };
    const path = containedPath(
      input.repoRoot,
      kind === "spec" ? input.specsDir : input.plansDir,
      result.path,
    );
    await input.git.verifyArtifactCommit({
      workspacePath: current.workspace.identity.worktreePath,
      previousHeadOid: current.workspace.headOid,
      headOid: result.commit,
      artifactPath: path,
    });
    const artifacts = [
      ...current.artifacts.filter(
        (artifact) => artifact.source === "remote-base",
      ),
      ...current.artifacts
        .filter((artifact) => artifact.source === "workspace")
        .map((artifact) => ({ ...artifact, commitOid: result.commit })),
      { kind, path, source: "workspace" as const, commitOid: result.commit },
    ].sort(
      (left, right) =>
        input.phase.artifactKinds.indexOf(left.kind) -
        input.phase.artifactKinds.indexOf(right.kind),
    );
    current = {
      ...current,
      workspace: { ...current.workspace, headOid: result.commit },
      artifacts,
    };
    await input.checkpoint(current);
  }
  return { kind: "workspace-ready", phase: current };
}
