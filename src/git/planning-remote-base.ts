import { resolve } from "node:path";
import {
  parsePlanningArtifactCandidates,
  planningArtifactDirectory,
} from "./planning-artifact-tree.ts";
import type { CommandRunner } from "../command/types.ts";
import type { RepositoryIdentity } from "../host/pull-requests.ts";
import { resolveImplementationPrTargetRemote } from "../workflow/implementation-pr-target-remote.ts";
import type { RepositoryMutationContext } from "./repository-mutation.ts";
import { withRepositoryMutationRunner } from "./repository-mutation-runner.ts";
import {
  isPlanningBranch,
  isPlanningSingleLine,
  planningOid,
} from "./planning-git-validation.ts";
import {
  PlanningWorkspaceCommandError,
  PlanningWorkspaceResponseError,
} from "./planning-workspaces.ts";
import type { PlanningRemoteBaseSnapshot } from "./planning-workspaces.ts";
function check(
  result: { code: number },
  operation: "fetch" | "ref-resolution" | "tree-inspection",
): void {
  if (result.code !== 0)
    throw new PlanningWorkspaceCommandError(
      operation,
      result as { code: number; stdout: string; stderr: string },
    );
}
export class PlanningRemoteBaseGit {
  readonly runner: CommandRunner;
  readonly repoRoot: string;
  readonly specsDir: string;
  readonly plansDir: string;
  private readonly mutation: RepositoryMutationContext | undefined;
  constructor(input: {
    runner: CommandRunner;
    repoRoot: string;
    specsDir: string;
    plansDir: string;
    mutation?: RepositoryMutationContext;
  }) {
    this.mutation = input.mutation;
    this.runner = input.runner;
    this.repoRoot = resolve(input.repoRoot);
    this.specsDir = planningArtifactDirectory(this.repoRoot, input.specsDir);
    this.plansDir = planningArtifactDirectory(this.repoRoot, input.plansDir);
  }
  async fetch(input: {
    issueNumber: number;
    remote: string;
    baseBranch: string;
    targetRepository?: RepositoryIdentity;
  }): Promise<PlanningRemoteBaseSnapshot> {
    if (this.mutation)
      return withRepositoryMutationRunner(
        this.runner,
        this.mutation,
        (runner) =>
          new PlanningRemoteBaseGit({
            runner,
            repoRoot: this.repoRoot,
            specsDir: this.specsDir,
            plansDir: this.plansDir,
          }).fetch(input),
      );
    if (
      !Number.isSafeInteger(input.issueNumber) ||
      input.issueNumber < 1 ||
      !isPlanningSingleLine(input.remote) ||
      !isPlanningBranch(input.baseBranch)
    )
      throw new RangeError("Invalid planning remote-base input");
    const target = input.targetRepository
      ? await resolveImplementationPrTargetRemote(
          this.runner,
          this.repoRoot,
          input.targetRepository,
        )
      : undefined;
    const remote = target?.remote ?? input.remote;
    const ref = `refs/remotes/${remote}/${input.baseBranch}`;
    let result = await this.runner.run(
      "git",
      [
        "fetch",
        "--no-tags",
        "--",
        target?.remote ?? input.remote,
        `+refs/heads/${input.baseBranch}:${ref}`,
      ],
      { cwd: this.repoRoot },
    );
    check(result, "fetch");
    result = await this.runner.run(
      "git",
      ["rev-parse", "--verify", `${ref}^{commit}`],
      { cwd: this.repoRoot },
    );
    check(result, "ref-resolution");
    const baseOid = result.stdout.trim();
    if (!planningOid.test(baseOid))
      throw new PlanningWorkspaceResponseError(
        "ref-resolution",
        "invalid-object-id",
      );
    result = await this.runner.run(
      "git",
      [
        "ls-tree",
        "-r",
        "-z",
        "--full-tree",
        baseOid,
        "--",
        this.specsDir,
        this.plansDir,
      ],
      { cwd: this.repoRoot },
    );
    check(result, "tree-inspection");
    const artifactCandidates = parsePlanningArtifactCandidates({
      stdout: result.stdout,
      issueNumber: input.issueNumber,
      specsDir: this.specsDir,
      plansDir: this.plansDir,
    });
    return Object.freeze({
      remote,
      baseBranch: input.baseBranch,
      baseOid,
      artifactCandidates,
    });
  }
}
