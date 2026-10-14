import { isAbsolute, resolve } from "node:path";
import {
  assertPlanningRegularFiles,
  readPlanningArtifactEvidence,
  type PlanningArtifactInspectionInput,
} from "./planning-companion-artifacts.ts";
import { planningArtifactPaths } from "../workflow/planning-companion-artifacts.ts";
import type { PlanningArtifactEvidence } from "../workflow/planning-state-types.ts";
import type { PlanningArtifactKind } from "../workflow/planning-pull-requests.ts";
import {
  PlanningPublicationGitError,
  type PlanningPublicationGitOperation,
} from "./planning-publication-git-errors.ts";
export {
  PlanningPublicationGitError,
  type PlanningPublicationGitOperation,
  type PlanningPublicationGitReason,
} from "./planning-publication-git-errors.ts";
import {
  parsePlanningArtifactCandidates,
  planningArtifactDirectory,
} from "./planning-artifact-tree.ts";
import {
  PlanningWorkspaceResponseError,
  type PlanningArtifactCandidates,
} from "./planning-workspaces.ts";
import type { CommandResult, CommandRunner } from "../command/types.ts";
import {
  isPlanningArtifactPath,
  isPlanningBranch,
  isPlanningSingleLine,
  planningOid,
} from "./planning-git-validation.ts";

export type PlanningRemoteHead =
  | Readonly<{ state: "missing" }>
  | Readonly<{ state: "present"; headOid: string }>;
export type PlanningArtifactCommitInput = Readonly<{
  workspacePath: string;
  previousHeadOid: string;
  headOid: string;
  artifactPath: string;
  artifactKind: PlanningArtifactKind;
}>;
export type PlanningWorkspaceVerificationInput = Readonly<{
  workspacePath: string;
  baseOid: string;
  headOid: string;
  artifacts: readonly PlanningArtifactEvidence[];
}>;
export type PlanningRemoteBranchInput = Readonly<{
  remote: string;
  branch: string;
}>;
export type PlanningExactPushInput = PlanningRemoteBranchInput &
  Readonly<{ headOid: string }>;
export type PlanningAncestryInput = Readonly<{
  ancestorOid: string;
  descendantOid: string;
}>;
export type PlanningArtifactCandidatesInput = Readonly<{
  commitOid: string;
  issueNumber: number;
  specsDir: string;
  plansDir: string;
}>;
export type PlanningRegularFilesInput = Readonly<{
  commitOid: string;
  paths: readonly string[];
}>;
export interface PlanningPublicationOperations {
  inspectArtifactEvidence(
    input: PlanningArtifactInspectionInput,
  ): Promise<PlanningArtifactEvidence>;
  verifyArtifactCommit(
    input: PlanningArtifactCommitInput,
  ): Promise<PlanningArtifactEvidence>;
  verifyWorkspace(input: PlanningWorkspaceVerificationInput): Promise<void>;
  inspectRemoteHead(
    input: PlanningRemoteBranchInput,
  ): Promise<PlanningRemoteHead>;
  ensureRemoteHead(
    input: PlanningExactPushInput,
  ): Promise<Readonly<{ pushed: boolean; headOid: string }>>;
  assertAncestor(input: PlanningAncestryInput): Promise<void>;
  assertRegularFiles(input: PlanningRegularFilesInput): Promise<void>;
  inspectArtifactCandidates(
    input: PlanningArtifactCandidatesInput,
  ): Promise<PlanningArtifactCandidates>;
}
function input(
  operation: PlanningPublicationGitOperation,
  value: string,
  predicate: (value: string) => boolean,
): void {
  if (!predicate(value))
    throw new PlanningPublicationGitError(operation, "invalid-input");
}
function nulRecords(
  value: string,
  operation: PlanningPublicationGitOperation,
): readonly string[] {
  if (value !== "" && !value.endsWith("\0"))
    throw new PlanningPublicationGitError(operation, "malformed-response");
  return value.split("\0").filter(Boolean);
}
export class PlanningPublicationGit implements PlanningPublicationOperations {
  readonly runner: CommandRunner;
  readonly repoRoot: string;
  constructor(input: { runner: CommandRunner; repoRoot: string }) {
    this.runner = input.runner;
    this.repoRoot = resolve(input.repoRoot);
  }
  private workspace(path: string): string {
    if (!isAbsolute(path))
      throw new PlanningPublicationGitError("head", "invalid-workspace");
    return resolve(path);
  }
  private async run(
    operation: PlanningPublicationGitOperation,
    args: string[],
    cwd: string,
  ): Promise<CommandResult> {
    const result = await this.runner.run("git", args, { cwd });
    if (result.code !== 0)
      throw new PlanningPublicationGitError(
        operation,
        "command-failed",
        result,
      );
    return result;
  }
  private validateOid(
    operation: PlanningPublicationGitOperation,
    value: string,
  ): void {
    input(operation, value, (item) => planningOid.test(item));
  }
  async assertAncestor(inputValue: PlanningAncestryInput): Promise<void> {
    this.validateOid("ancestry", inputValue.ancestorOid);
    this.validateOid("ancestry", inputValue.descendantOid);
    const result = await this.runner.run(
      "git",
      [
        "merge-base",
        "--is-ancestor",
        inputValue.ancestorOid,
        inputValue.descendantOid,
      ],
      { cwd: this.repoRoot },
    );
    if (result.code === 1)
      throw new PlanningPublicationGitError("ancestry", "not-ancestor", result);
    if (result.code !== 0)
      throw new PlanningPublicationGitError(
        "ancestry",
        "command-failed",
        result,
      );
  }
  async inspectArtifactCandidates(
    inputValue: PlanningArtifactCandidatesInput,
  ): Promise<PlanningArtifactCandidates> {
    this.validateOid("tree", inputValue.commitOid);
    if (
      !Number.isSafeInteger(inputValue.issueNumber) ||
      inputValue.issueNumber < 1
    )
      throw new PlanningPublicationGitError("tree", "invalid-input");
    const specsDir = planningArtifactDirectory(
      this.repoRoot,
      inputValue.specsDir,
    );
    const plansDir = planningArtifactDirectory(
      this.repoRoot,
      inputValue.plansDir,
    );
    const result = await this.run(
      "tree",
      [
        "ls-tree",
        "-r",
        "-z",
        "--full-tree",
        inputValue.commitOid,
        "--",
        specsDir,
        plansDir,
      ],
      this.repoRoot,
    );
    try {
      return parsePlanningArtifactCandidates({
        stdout: result.stdout,
        issueNumber: inputValue.issueNumber,
        specsDir,
        plansDir,
      });
    } catch (error) {
      if (error instanceof PlanningWorkspaceResponseError)
        throw new PlanningPublicationGitError(
          "tree",
          "malformed-response",
          result,
        );
      throw error;
    }
  }
  async assertRegularFiles(
    inputValue: PlanningRegularFilesInput,
  ): Promise<void> {
    await assertPlanningRegularFiles({
      ...inputValue,
      runner: this.runner,
      repoRoot: this.repoRoot,
    });
  }
  private async assertClean(workspacePath: string): Promise<void> {
    const result = await this.run(
      "status",
      [
        "--no-optional-locks",
        "-C",
        workspacePath,
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ],
      this.repoRoot,
    );
    if (result.stdout !== "")
      throw new PlanningPublicationGitError("status", "dirty-workspace");
  }
  async inspectArtifactEvidence(
    inputValue: PlanningArtifactInspectionInput,
  ): Promise<PlanningArtifactEvidence> {
    return readPlanningArtifactEvidence({
      ...inputValue,
      runner: this.runner,
      repoRoot: this.repoRoot,
    });
  }
  async verifyArtifactCommit(
    inputValue: PlanningArtifactCommitInput,
  ): Promise<PlanningArtifactEvidence> {
    const workspacePath = this.workspace(inputValue.workspacePath);
    this.validateOid("head", inputValue.previousHeadOid);
    this.validateOid("head", inputValue.headOid);
    input("tree", inputValue.artifactPath, isPlanningArtifactPath);
    const head = await this.run(
      "head",
      ["-C", workspacePath, "rev-parse", "--verify", "HEAD^{commit}"],
      this.repoRoot,
    );
    if (head.stdout.trim() !== inputValue.headOid)
      throw new PlanningPublicationGitError("head", "head-mismatch");
    await this.assertAncestor({
      ancestorOid: inputValue.previousHeadOid,
      descendantOid: inputValue.headOid,
    });
    const artifact = await this.inspectArtifactEvidence({
      kind: inputValue.artifactKind,
      path: inputValue.artifactPath,
      commitOid: inputValue.headOid,
      source: "workspace",
    });
    const diff = await this.run(
      "diff",
      [
        "-C",
        workspacePath,
        "diff",
        "--name-only",
        "--no-renames",
        "-z",
        inputValue.previousHeadOid,
        inputValue.headOid,
        "--",
      ],
      this.repoRoot,
    );
    const changed = nulRecords(diff.stdout, "diff");
    const allowed = new Set(planningArtifactPaths([artifact]));
    if (
      !changed.includes(inputValue.artifactPath) ||
      changed.some((path) => !allowed.has(path))
    )
      throw new PlanningPublicationGitError("diff", "unexpected-changes");
    await this.assertClean(workspacePath);
    return artifact;
  }
  async verifyWorkspace(
    inputValue: PlanningWorkspaceVerificationInput,
  ): Promise<void> {
    const workspacePath = this.workspace(inputValue.workspacePath);
    this.validateOid("head", inputValue.baseOid);
    this.validateOid("head", inputValue.headOid);
    const head = await this.run(
      "head",
      ["-C", workspacePath, "rev-parse", "--verify", "HEAD^{commit}"],
      this.repoRoot,
    );
    if (head.stdout.trim() !== inputValue.headOid)
      throw new PlanningPublicationGitError("head", "head-mismatch");
    await this.assertAncestor({
      ancestorOid: inputValue.baseOid,
      descendantOid: inputValue.headOid,
    });
    if (inputValue.artifacts.length === 0)
      throw new PlanningPublicationGitError("tree", "invalid-input");
    const artifacts = await Promise.all(
      inputValue.artifacts.map((artifact) =>
        this.inspectArtifactEvidence({
          ...artifact,
          commitOid: inputValue.headOid,
        }),
      ),
    );
    const allowed = new Set(planningArtifactPaths(artifacts));
    const diff = await this.run(
      "diff",
      [
        "diff",
        "--name-only",
        "--no-renames",
        "-z",
        inputValue.baseOid,
        inputValue.headOid,
        "--",
      ],
      this.repoRoot,
    );
    if (nulRecords(diff.stdout, "diff").some((path) => !allowed.has(path)))
      throw new PlanningPublicationGitError("diff", "unexpected-changes");
    await this.assertClean(workspacePath);
  }
  async inspectRemoteHead(
    inputValue: PlanningRemoteBranchInput,
  ): Promise<PlanningRemoteHead> {
    input("remote-head", inputValue.remote, isPlanningSingleLine);
    input("remote-head", inputValue.branch, isPlanningBranch);
    const result = await this.runner.run(
      "git",
      [
        "ls-remote",
        "--exit-code",
        "--heads",
        "--",
        inputValue.remote,
        `refs/heads/${inputValue.branch}`,
      ],
      { cwd: this.repoRoot },
    );
    if (result.code === 2 && result.stdout === "") return { state: "missing" };
    if (result.code !== 0)
      throw new PlanningPublicationGitError(
        "remote-head",
        "command-failed",
        result,
      );
    const records = result.stdout.trim().split("\n").filter(Boolean);
    if (records.length !== 1)
      throw new PlanningPublicationGitError(
        "remote-head",
        "malformed-response",
      );
    const match = /^([0-9a-f]{40}|[0-9a-f]{64})\trefs\/heads\/(.+)$/u.exec(
      records[0]!,
    );
    if (match === null || match[2] !== inputValue.branch)
      throw new PlanningPublicationGitError(
        "remote-head",
        "malformed-response",
      );
    return { state: "present", headOid: match[1]! };
  }
  async ensureRemoteHead(
    inputValue: PlanningExactPushInput,
  ): Promise<Readonly<{ pushed: boolean; headOid: string }>> {
    this.validateOid("push", inputValue.headOid);
    const before = await this.inspectRemoteHead(inputValue);
    if (before.state === "present" && before.headOid !== inputValue.headOid)
      throw new PlanningPublicationGitError("remote-head", "conflicting-head");
    if (before.state === "present")
      return { pushed: false, headOid: inputValue.headOid };
    await this.run(
      "push",
      [
        "push",
        "--porcelain",
        "--no-force",
        "--",
        inputValue.remote,
        `${inputValue.headOid}:refs/heads/${inputValue.branch}`,
      ],
      this.repoRoot,
    );
    const after = await this.inspectRemoteHead(inputValue);
    if (after.state !== "present" || after.headOid !== inputValue.headOid)
      throw new PlanningPublicationGitError("remote-head", "conflicting-head");
    return { pushed: true, headOid: inputValue.headOid };
  }
}
