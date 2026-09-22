import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CommandRunner } from "../../../command/types.ts";
import { PlanningPublicationGit } from "../../../git/planning-publication-git.ts";
import { PlanningRemoteBaseGit } from "../../../git/planning-remote-base.ts";
import { PlanningWorkspaceGit } from "../../../git/planning-workspace-git.ts";
import { renderPlanningPullRequestMarker } from "../../../workflow/planning-pull-request-markers.ts";
import { reconcilePlanningPhase } from "./planning-phase-reconciler.ts";

const runId = "123e4567-e89b-42d3-a456-426614174000";
const repository = {
  provider: "github-gh" as const,
  host: "github.com",
  owner: "acme",
  repository: "patchmill",
};
const identity = { branch: "planning/spec", worktreePath: "../worktrees/spec" };

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commandRunner(): CommandRunner {
  return {
    async run(command, args, options) {
      try {
        return {
          code: 0,
          stdout: execFileSync(command, args, {
            cwd: options?.cwd,
            encoding: "utf8",
            env: { ...process.env, ...options?.env },
          }),
          stderr: "",
        };
      } catch (error) {
        const failure = error as {
          status?: number;
          stdout?: string;
          stderr?: string;
        };
        return {
          code: failure.status ?? 1,
          stdout: failure.stdout ?? "",
          stderr: failure.stderr ?? "",
        };
      }
    },
  };
}

test("real Git re-adopts a revised planning PR while open and completes it from merged base evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "planning-adoption-run-once-"));
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  const repo = join(root, "repo");
  const human = join(root, "human");
  const worktreeRoot = join(root, "worktrees");
  try {
    execFileSync("git", ["init", "--bare", "--initial-branch=main", remote]);
    execFileSync("git", ["init", "-b", "main", seed]);
    git(seed, "config", "user.name", "Patchmill Test");
    git(seed, "config", "user.email", "patchmill@example.test");
    await mkdir(join(seed, "docs", "specs"), { recursive: true });
    await writeFile(join(seed, "docs", "specs", "example.md"), "original\n");
    git(seed, "add", ".");
    git(seed, "commit", "-m", "base");
    git(seed, "remote", "add", "origin", remote);
    git(seed, "push", "-u", "origin", "main");
    execFileSync("git", ["clone", remote, repo]);
    execFileSync("git", ["clone", remote, human]);
    git(human, "config", "user.name", "Human Test");
    git(human, "config", "user.email", "human@example.test");
    await mkdir(worktreeRoot);
    const runner = commandRunner();
    const workspaces = new PlanningWorkspaceGit({
      runner,
      repoRoot: repo,
      worktreeRoot,
    });
    const baseOid = git(repo, "rev-parse", "HEAD");
    const prepared = await workspaces.prepare({
      runId,
      phase: "spec",
      identity,
      base: {
        remote: "origin",
        baseBranch: "main",
        baseOid,
        artifactCandidates: { spec: [], plan: [] },
      },
    });
    const worktreePath = join(worktreeRoot, "spec");
    git(worktreePath, "push", "-u", "origin", identity.branch);
    git(human, "fetch", "origin", identity.branch);
    git(human, "checkout", "-b", identity.branch, `origin/${identity.branch}`);
    await writeFile(join(human, "docs", "specs", "example.md"), "revised\n");
    git(human, "add", "docs/specs/example.md");
    git(human, "commit", "-m", "revise planning artifact");
    git(human, "push", "origin", identity.branch);
    const revisedOid = git(human, "rev-parse", "HEAD");
    const reference = { targetRepository: repository, number: 188 };
    let host = {
      number: 188,
      url: "https://github.com/acme/patchmill/pull/188",
      targetRepository: repository,
      headRepository: repository,
      baseBranch: "main",
      headBranch: identity.branch,
      headSha: revisedOid,
      body: renderPlanningPullRequestMarker({
        issueNumber: 188,
        phase: "spec",
      }),
      status: "open" as const,
    };
    let state = {
      version: 1 as const,
      workflowVersion: "planning-pr-v1" as const,
      runId,
      issueNumber: 188,
      issueTitle: "Example",
      gates: { specRequired: true, planRequired: false },
      revision: 0,
      createdAt: "2026-09-22T00:00:00.000Z",
      updatedAt: "2026-09-22T00:00:00.000Z",
      phases: [
        {
          kind: "spec" as const,
          status: "pull-request-open" as const,
          base: prepared.base,
          workspace: prepared.workspace,
          artifacts: [
            {
              kind: "spec" as const,
              path: "docs/specs/example.md",
              source: "workspace" as const,
              commitOid: prepared.workspace.headOid,
            },
          ],
          publication: {
            targetRepository: repository,
            headRepository: repository,
            baseBranch: "main",
            headBranch: identity.branch,
            headOid: prepared.workspace.headOid,
          },
          pullRequest: { reference, url: host.url },
        },
        { kind: "implementation" as const, status: "pending" as const },
      ],
    };
    const publicationGit = new PlanningPublicationGit({
      runner,
      repoRoot: repo,
    });
    const remoteBase = new PlanningRemoteBaseGit({
      runner,
      repoRoot: repo,
      specsDir: "docs/specs",
      plansDir: "docs/plans",
    });
    const common = {
      phaseIndex: 0,
      lock: {} as never,
      stateStore: {
        async replace({ next }: { next: typeof state }) {
          return next;
        },
      },
      host: {
        async getPullRequest() {
          return host;
        },
        async findPullRequests() {
          return [host];
        },
      } as never,
      remoteBase,
      git: publicationGit,
      workspaces,
      now: () => new Date("2026-09-22T00:01:00.000Z"),
    };
    const open = await reconcilePlanningPhase({ state, ...common });
    assert.equal(open.outcome.kind, "review-pending");
    state = open.state as typeof state;
    const openPhase = state.phases[0]!;
    assert.equal(openPhase.publication!.headOid, revisedOid);
    assert.equal(openPhase.workspace!.headOid, revisedOid);
    assert.ok(
      openPhase.artifacts!.every(
        (artifact) => artifact.commitOid === revisedOid,
      ),
    );

    git(seed, "fetch", "origin", identity.branch);
    git(
      seed,
      "merge",
      "--no-ff",
      "-m",
      "merge revised planning artifact",
      `origin/${identity.branch}`,
    );
    git(seed, "push", "origin", "main");
    const mergeCommit = git(seed, "rev-parse", "HEAD");
    host = { ...host, status: "merged", mergeCommit };
    const merged = await reconcilePlanningPhase({ state, ...common });
    assert.equal(merged.outcome.kind, "merged");
    const completed = merged.state.phases[0]!;
    assert.equal(completed.status, "complete");
    assert.equal(completed.completion.mergedBaseOid, mergeCommit);
    assert.ok(
      completed.artifacts.every(
        (artifact) =>
          artifact.source === "remote-base" &&
          artifact.commitOid === mergeCommit,
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
