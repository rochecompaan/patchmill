import { isAbsolute, resolve } from "node:path";
import type { CommandResult, CommandRunner } from "../process/command.ts";
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
}>;
export type PlanningWorkspaceVerificationInput = Readonly<{
  workspacePath: string;
  baseOid: string;
  headOid: string;
  artifactPaths: readonly string[];
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
export type PlanningRegularFilesInput = Readonly<{
  commitOid: string;
  paths: readonly string[];
}>;
export interface PlanningPublicationOperations {
  verifyArtifactCommit(input: PlanningArtifactCommitInput): Promise<void>;
  verifyWorkspace(input: PlanningWorkspaceVerificationInput): Promise<void>;
  inspectRemoteHead(
    input: PlanningRemoteBranchInput,
  ): Promise<PlanningRemoteHead>;
  ensureRemoteHead(
    input: PlanningExactPushInput,
  ): Promise<Readonly<{ pushed: boolean; headOid: string }>>;
  assertAncestor(input: PlanningAncestryInput): Promise<void>;
  assertRegularFiles(input: PlanningRegularFilesInput): Promise<void>;
}
export type PlanningPublicationGitOperation =
  | "head"
  | "ancestry"
  | "tree"
  | "diff"
  | "status"
  | "remote-head"
  | "push";
export class PlanningPublicationGitError extends Error {
  readonly operation: PlanningPublicationGitOperation;
  readonly reason: string;
  readonly exitCode?: number;
  constructor(
    operation: PlanningPublicationGitOperation,
    reason: string,
    result?: CommandResult,
  ) {
    super(`Planning publication Git failed: ${operation}/${reason}`);
    this.name = "PlanningPublicationGitError";
    this.operation = operation;
    this.reason = reason;
    if (result !== undefined) {
      this.exitCode = result.code;
      Object.defineProperty(this, "diagnostics", {
        enumerable: false,
        value: Object.freeze({ ...result }),
      });
    }
  }
  declare readonly diagnostics: Readonly<CommandResult>;
}
function input(value: string, predicate: (value: string) => boolean): void {
  if (!predicate(value))
    throw new PlanningPublicationGitError("head", "invalid-input");
}
function nulRecords(
  value: string,
  operation: PlanningPublicationGitOperation,
): readonly string[] {
  if (value !== "" && !value.endsWith("\0"))
    throw new PlanningPublicationGitError(operation, "malformed-response");
  return value.split("\0").filter(Boolean);
}
function treeRecord(record: string, path: string): void {
  const parsed =
    /^(100644|100755) blob ([0-9a-f]{40}|[0-9a-f]{64})\t([^\0\r\n]+)$/u.exec(
      record,
    );
  if (parsed === null || parsed[3] !== path)
    throw new PlanningPublicationGitError("tree", "non-regular-file");
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
  private validateOid(value: string): void {
    input(value, (item) => planningOid.test(item));
  }
  async assertAncestor(inputValue: PlanningAncestryInput): Promise<void> {
    this.validateOid(inputValue.ancestorOid);
    this.validateOid(inputValue.descendantOid);
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
  async assertRegularFiles(
    inputValue: PlanningRegularFilesInput,
  ): Promise<void> {
    this.validateOid(inputValue.commitOid);
    if (inputValue.paths.length === 0)
      throw new PlanningPublicationGitError("tree", "invalid-input");
    for (const path of inputValue.paths) {
      input(path, isPlanningArtifactPath);
      const result = await this.run(
        "tree",
        ["ls-tree", "-z", inputValue.commitOid, "--", path],
        this.repoRoot,
      );
      const records = nulRecords(result.stdout, "tree");
      if (records.length !== 1)
        throw new PlanningPublicationGitError("tree", "non-regular-file");
      treeRecord(records[0]!, path);
    }
  }
  private async assertClean(workspacePath: string): Promise<void> {
    const result = await this.run(
      "status",
      [
        "-C",
        workspacePath,
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--ignored=matching",
      ],
      this.repoRoot,
    );
    if (result.stdout !== "")
      throw new PlanningPublicationGitError("status", "dirty-workspace");
  }
  async verifyArtifactCommit(
    inputValue: PlanningArtifactCommitInput,
  ): Promise<void> {
    const workspacePath = this.workspace(inputValue.workspacePath);
    this.validateOid(inputValue.previousHeadOid);
    this.validateOid(inputValue.headOid);
    input(inputValue.artifactPath, isPlanningArtifactPath);
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
    const tree = await this.run(
      "tree",
      [
        "-C",
        workspacePath,
        "ls-tree",
        "-z",
        inputValue.headOid,
        "--",
        inputValue.artifactPath,
      ],
      this.repoRoot,
    );
    const records = nulRecords(tree.stdout, "tree");
    if (records.length !== 1)
      throw new PlanningPublicationGitError("tree", "non-regular-file");
    treeRecord(records[0]!, inputValue.artifactPath);
    const diff = await this.run(
      "diff",
      [
        "-C",
        workspacePath,
        "diff",
        "--name-only",
        "-z",
        inputValue.previousHeadOid,
        inputValue.headOid,
        "--",
      ],
      this.repoRoot,
    );
    const changed = nulRecords(diff.stdout, "diff");
    if (changed.length !== 1 || changed[0] !== inputValue.artifactPath)
      throw new PlanningPublicationGitError("diff", "unexpected-changes");
    await this.assertClean(workspacePath);
  }
  async verifyWorkspace(
    inputValue: PlanningWorkspaceVerificationInput,
  ): Promise<void> {
    const workspacePath = this.workspace(inputValue.workspacePath);
    this.validateOid(inputValue.baseOid);
    this.validateOid(inputValue.headOid);
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
    await this.assertRegularFiles({
      commitOid: inputValue.headOid,
      paths: inputValue.artifactPaths,
    });
    await this.assertClean(workspacePath);
  }
  async inspectRemoteHead(
    inputValue: PlanningRemoteBranchInput,
  ): Promise<PlanningRemoteHead> {
    input(inputValue.remote, isPlanningSingleLine);
    input(inputValue.branch, isPlanningBranch);
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
    this.validateOid(inputValue.headOid);
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
