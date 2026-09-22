import {
  isPlanningArtifactPath,
  isPlanningBranch,
  isPlanningSingleLine,
  planningOid,
} from "./planning-git-validation.ts";
import { PlanningWorkspaceRepositoryGit } from "./planning-workspace-inspection.ts";
import {
  PlanningWorkspaceCommandError,
  PlanningWorkspaceConflictError,
  PlanningWorkspaceResponseError,
  type PlanningHeadAdoptionBlockedEvidence,
  type PlanningHeadAdoptionInput,
  type PlanningHeadAdoptionResult,
} from "./planning-workspaces.ts";

type RemoteHead =
  | Readonly<{ state: "missing" }>
  | Readonly<{ state: "present"; headOid: string }>;

/** Proves a revised planning branch safe without changing durable state or remote refs. */
export class PlanningHeadAdoptionGit {
  private readonly repository: PlanningWorkspaceRepositoryGit;

  constructor(input: { repository: PlanningWorkspaceRepositoryGit }) {
    this.repository = input.repository;
  }

  private evidence(
    input: PlanningHeadAdoptionInput,
    failure: PlanningHeadAdoptionBlockedEvidence["failure"],
    observed: Partial<
      Pick<
        PlanningHeadAdoptionBlockedEvidence,
        "hostHeadOid" | "fetchedHeadOid" | "remoteHeadOid"
      >
    > = {},
    unexpectedPaths: readonly string[] = [],
  ): PlanningHeadAdoptionResult {
    return {
      kind: "blocked",
      evidence: {
        failure,
        recordedHeadOid: input.workspace.headOid,
        ...observed,
        artifactPaths: input.artifactPaths,
        unexpectedPaths,
        cleanupState: input.workspace.cleanup.state,
      },
    };
  }

  private validate(input: PlanningHeadAdoptionInput): void {
    if (
      input.runId !== input.workspace.runId ||
      input.phase !== input.workspace.phase
    )
      throw new PlanningWorkspaceConflictError(
        "invalid-saved-identity",
        input.workspace.identity,
      );
    const cleanup = input.workspace.cleanup;
    if (
      cleanup.state !== "ready" &&
      cleanup.state !== "cleanup-pending" &&
      cleanup.state !== "worktree-removed" &&
      cleanup.state !== "removed"
    )
      throw new PlanningWorkspaceResponseError(
        "head-adoption-proof",
        "invalid-cleanup",
      );
    if (
      (cleanup.state === "worktree-removed" || cleanup.state === "removed") &&
      (!planningOid.test(cleanup.pushedHeadOid) ||
        cleanup.pushedHeadOid !== input.workspace.headOid)
    )
      throw new PlanningWorkspaceConflictError(
        "head-oid-mismatch",
        input.workspace.identity,
      );
    if (!Number.isSafeInteger(input.issueNumber) || input.issueNumber < 1)
      throw new PlanningWorkspaceResponseError(
        "head-adoption-proof",
        "invalid-issue",
      );
    if (
      !planningOid.test(input.workspace.headOid) ||
      !planningOid.test(input.hostHeadOid)
    )
      throw new PlanningWorkspaceResponseError(
        "head-adoption-proof",
        "invalid-object-id",
      );
    if (
      !isPlanningSingleLine(input.runId) ||
      !isPlanningBranch(input.workspace.identity.branch) ||
      !isPlanningSingleLine(input.workspace.remote)
    )
      throw new PlanningWorkspaceResponseError(
        "head-adoption-proof",
        "invalid-identity",
      );
    if (
      input.artifactPaths.length === 0 ||
      input.artifactPaths.some((path) => !isPlanningArtifactPath(path))
    )
      throw new PlanningWorkspaceResponseError(
        "head-adoption-proof",
        "invalid-artifact-path",
      );
  }

  private async remote(input: PlanningHeadAdoptionInput): Promise<RemoteHead> {
    const result = await this.repository.runner.run(
      "git",
      [
        "ls-remote",
        "--exit-code",
        "--heads",
        "--",
        input.workspace.remote,
        `refs/heads/${input.workspace.identity.branch}`,
      ],
      { cwd: this.repository.repoRoot },
    );
    if (result.code === 2 && result.stdout === "") return { state: "missing" };
    if (result.code !== 0)
      throw new PlanningWorkspaceCommandError("remote-head-inspection", result);
    const records = result.stdout.trim().split("\n").filter(Boolean);
    const match =
      records.length === 1
        ? /^([0-9a-f]{40}|[0-9a-f]{64})\trefs\/heads\/(.+)$/u.exec(records[0]!)
        : null;
    if (match === null || match[2] !== input.workspace.identity.branch)
      throw new PlanningWorkspaceResponseError(
        "remote-head-inspection",
        "malformed-response",
      );
    return { state: "present", headOid: match[1]! };
  }

  private async proofCommand(args: string[]) {
    return this.repository.run(args, "head-adoption-proof");
  }

  private async isAncestor(
    ancestor: string,
    descendant: string,
  ): Promise<boolean> {
    const result = await this.repository.runner.run(
      "git",
      ["merge-base", "--is-ancestor", ancestor, descendant],
      { cwd: this.repository.repoRoot },
    );
    if (result.code === 1) return false;
    if (result.code !== 0)
      throw new PlanningWorkspaceCommandError("head-adoption-proof", result);
    return true;
  }

  private diffPaths(stdout: string): readonly string[] {
    if (stdout === "") return [];
    if (!stdout.endsWith("\0"))
      throw new PlanningWorkspaceResponseError(
        "head-adoption-proof",
        "malformed-diff",
      );
    const paths = stdout.slice(0, -1).split("\0");
    if (paths.some((path) => path === ""))
      throw new PlanningWorkspaceResponseError(
        "head-adoption-proof",
        "malformed-diff",
      );
    return paths;
  }

  private regularArtifact(stdout: string, path: string): boolean {
    if (stdout === "") return false;
    if (!stdout.endsWith("\0"))
      throw new PlanningWorkspaceResponseError(
        "head-adoption-proof",
        "malformed-tree",
      );
    const records = stdout.slice(0, -1).split("\0");
    const [record] = records;
    if (records.length !== 1 || record === undefined || record === "")
      throw new PlanningWorkspaceResponseError(
        "head-adoption-proof",
        "malformed-tree",
      );
    const match =
      /^([0-7]{6}) ([a-z-]+) ([0-9a-f]{40}|[0-9a-f]{64})\t(.+)$/u.exec(record);
    if (match === null || match[4] !== path)
      throw new PlanningWorkspaceResponseError(
        "head-adoption-proof",
        "malformed-tree",
      );
    return (
      (match[1] === "100644" || match[1] === "100755") && match[2] === "blob"
    );
  }

  private async reconcileLocal(
    input: PlanningHeadAdoptionInput,
    candidate: string,
  ): Promise<void> {
    const saved = input.workspace;
    if (saved.cleanup.state === "removed") return;
    const snapshot = await this.repository.inspect(saved.identity);
    if (saved.cleanup.state === "worktree-removed") {
      if (snapshot.state === "missing") return;
      if (snapshot.state !== "branch-only")
        throw new PlanningWorkspaceConflictError(
          "unsafe-registration",
          saved.identity,
        );
      if (
        !(await this.isAncestor(saved.headOid, snapshot.headOid)) ||
        !(await this.isAncestor(snapshot.headOid, candidate))
      )
        throw new PlanningWorkspaceConflictError(
          "head-oid-mismatch",
          saved.identity,
        );
      if (snapshot.headOid !== candidate) {
        await this.repository.run(
          [
            "update-ref",
            `refs/heads/${saved.identity.branch}`,
            candidate,
            snapshot.headOid,
          ],
          "head-adoption-fast-forward",
        );
        const updated = await this.repository.inspect(saved.identity);
        if (updated.state !== "branch-only" || updated.headOid !== candidate)
          throw new PlanningWorkspaceConflictError(
            "head-oid-mismatch",
            saved.identity,
          );
      }
      return;
    }
    if (snapshot.state !== "ready" || !snapshot.clean)
      throw new PlanningWorkspaceConflictError(
        snapshot.state === "ready" ? "dirty-worktree" : "missing-workspace",
        saved.identity,
      );
    if (
      !(await this.isAncestor(saved.headOid, snapshot.headOid)) ||
      !(await this.isAncestor(snapshot.headOid, candidate))
    )
      throw new PlanningWorkspaceConflictError(
        "head-oid-mismatch",
        saved.identity,
      );
    if (snapshot.headOid !== candidate) {
      await this.repository.run(
        [
          "-C",
          this.repository.path(saved.identity),
          "merge",
          "--ff-only",
          candidate,
        ],
        "head-adoption-fast-forward",
      );
      const updated = await this.repository.inspect(saved.identity);
      if (updated.state !== "ready" || !updated.clean)
        throw new PlanningWorkspaceConflictError(
          updated.state === "ready" ? "dirty-worktree" : "missing-workspace",
          saved.identity,
        );
      if (updated.headOid !== candidate)
        throw new PlanningWorkspaceConflictError(
          "head-oid-mismatch",
          saved.identity,
        );
    }
  }

  async adopt(
    input: PlanningHeadAdoptionInput,
  ): Promise<PlanningHeadAdoptionResult> {
    this.validate(input);
    const first = await this.remote(input);
    if (first.state === "missing")
      return this.evidence(input, "remote-missing", {
        hostHeadOid: input.hostHeadOid,
      });
    if (first.headOid !== input.hostHeadOid)
      return this.evidence(input, "head-disagreement", {
        hostHeadOid: input.hostHeadOid,
        remoteHeadOid: first.headOid,
      });
    const evidenceRef = `refs/patchmill/planning-head-adoption/${input.runId}/${input.phase}`;
    await this.repository.run(
      [
        "fetch",
        "--no-tags",
        "--force",
        "--",
        input.workspace.remote,
        `refs/heads/${input.workspace.identity.branch}:${evidenceRef}`,
      ],
      "head-adoption-fetch",
    );
    const fetched = await this.proofCommand([
      "rev-parse",
      "--verify",
      `${evidenceRef}^{commit}`,
    ]);
    const candidate = fetched.stdout.trim();
    if (!planningOid.test(candidate))
      throw new PlanningWorkspaceResponseError(
        "head-adoption-proof",
        "invalid-fetched-object-id",
      );
    const second = await this.remote(input);
    if (second.state === "missing")
      return this.evidence(input, "remote-missing", {
        hostHeadOid: input.hostHeadOid,
        fetchedHeadOid: candidate,
      });
    if (candidate !== input.hostHeadOid || second.headOid !== candidate)
      return this.evidence(input, "head-disagreement", {
        hostHeadOid: input.hostHeadOid,
        fetchedHeadOid: candidate,
        remoteHeadOid: second.headOid,
      });
    if (!(await this.isAncestor(input.workspace.headOid, candidate)))
      return this.evidence(input, "not-descendant", {
        hostHeadOid: input.hostHeadOid,
        fetchedHeadOid: candidate,
        remoteHeadOid: second.headOid,
      });
    const diff = await this.proofCommand([
      "diff",
      "--name-only",
      "--no-renames",
      "-z",
      input.workspace.headOid,
      candidate,
      "--",
    ]);
    const expected = new Set(input.artifactPaths);
    const unexpected = [
      ...new Set(
        this.diffPaths(diff.stdout).filter((path) => !expected.has(path)),
      ),
    ].sort();
    if (unexpected.length)
      return this.evidence(
        input,
        "unexpected-paths",
        {
          hostHeadOid: input.hostHeadOid,
          fetchedHeadOid: candidate,
          remoteHeadOid: second.headOid,
        },
        unexpected,
      );
    for (const path of input.artifactPaths) {
      const tree = await this.proofCommand([
        "ls-tree",
        "-z",
        candidate,
        "--",
        path,
      ]);
      if (!this.regularArtifact(tree.stdout, path))
        return this.evidence(input, "non-regular-artifact", {
          hostHeadOid: input.hostHeadOid,
          fetchedHeadOid: candidate,
          remoteHeadOid: second.headOid,
        });
    }
    await this.reconcileLocal(input, candidate);
    const final = await this.remote(input);
    if (final.state === "missing")
      return this.evidence(input, "remote-missing", {
        hostHeadOid: input.hostHeadOid,
        fetchedHeadOid: candidate,
      });
    if (final.headOid !== candidate)
      return this.evidence(input, "head-moved", {
        hostHeadOid: input.hostHeadOid,
        fetchedHeadOid: candidate,
        remoteHeadOid: final.headOid,
      });
    return { kind: "adopted", headOid: candidate };
  }
}
