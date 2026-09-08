import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PlanningPublicationGit } from "../../../git/planning-publication-git.ts";
import { PlanningRemoteBaseGit } from "../../../git/planning-remote-base.ts";
import { renderPlanningPullRequestMarker } from "../../../workflow/planning-pull-request-markers.ts";
import { reconcilePlanningPhase } from "./planning-phase-reconciler.ts";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commandRunner(calls: string[][]) {
  return {
    async run(command: string, args: string[], options?: { cwd?: string }) {
      calls.push([command, ...args]);
      try {
        return {
          code: 0,
          stdout: execFileSync(command, args, {
            cwd: options?.cwd,
            encoding: "utf8",
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

test("reconciliation trusts the fetched reviewed squash base artifact rather than the planning workspace blob", async () => {
  const root = await mkdtemp(join(tmpdir(), "planning-reconcile-real-"));
  const remote = join(root, "remote.git");
  const repo = join(root, "repo");
  const workspace = join(root, "workspace");
  const commands: string[][] = [];
  const repository = {
    provider: "github-gh" as const,
    host: "github.com",
    owner: "acme",
    repository: "patchmill",
  };
  try {
    execFileSync("git", ["init", "--bare", "--initial-branch=main", remote]);
    execFileSync("git", ["init", "-b", "main", repo]);
    git(repo, "config", "user.name", "Patchmill Test");
    git(repo, "config", "user.email", "patchmill@example.test");
    await mkdir(join(repo, "docs/specs"), { recursive: true });
    await writeFile(join(repo, "docs/specs/issue-188.md"), "base\n");
    git(repo, "add", "docs/specs/issue-188.md");
    git(repo, "commit", "-m", "base artifact");
    const baseOid = git(repo, "rev-parse", "HEAD");
    git(repo, "remote", "add", "origin", remote);
    git(repo, "push", "origin", "main");
    git(repo, "worktree", "add", "-b", "planning/spec", workspace, "HEAD");
    await writeFile(join(workspace, "docs/specs/issue-188.md"), "planning A\n");
    git(workspace, "commit", "-am", "planning artifact A");
    const planningOid = git(workspace, "rev-parse", "HEAD");
    const runner = commandRunner(commands);
    const publication = new PlanningPublicationGit({ repoRoot: repo, runner });
    await publication.ensureRemoteHead({
      remote: "origin",
      branch: "planning/spec",
      headOid: planningOid,
    });

    git(repo, "merge", "--squash", "planning/spec");
    await writeFile(join(repo, "docs/specs/issue-188.md"), "reviewed B\n");
    git(repo, "add", "docs/specs/issue-188.md");
    git(repo, "commit", "-m", "reviewed squash merge");
    const reviewedBaseOid = git(repo, "rev-parse", "HEAD");
    git(repo, "push", "origin", "main");

    const initial = {
      version: 1 as const,
      workflowVersion: "planning-pr-v1" as const,
      runId: "123e4567-e89b-42d3-a456-426614174000",
      issueNumber: 188,
      issueTitle: "Example",
      gates: { specRequired: true, planRequired: false },
      revision: 2,
      createdAt: "2026-09-08T12:00:00.000Z",
      updatedAt: "2026-09-08T12:00:00.000Z",
      phases: [
        {
          kind: "spec" as const,
          status: "pull-request-open" as const,
          base: {
            remote: "origin",
            baseBranch: "main",
            baseOid,
            artifactCandidates: { spec: [], plan: [] },
          },
          workspace: {
            runId: "123e4567-e89b-42d3-a456-426614174000",
            phase: "spec" as const,
            identity: { branch: "planning/spec", worktreePath: workspace },
            remote: "origin",
            baseBranch: "main",
            baseOid,
            headOid: planningOid,
            cleanup: { state: "removed" as const, pushedHeadOid: planningOid },
          },
          artifacts: [
            {
              kind: "spec" as const,
              path: "docs/specs/issue-188.md",
              source: "workspace" as const,
              commitOid: planningOid,
            },
          ],
          publication: {
            targetRepository: repository,
            headRepository: repository,
            baseBranch: "main",
            headBranch: "planning/spec",
            headOid: planningOid,
          },
          pullRequest: {
            reference: { targetRepository: repository, number: 188 },
            url: "https://github.com/acme/patchmill/pull/188",
          },
        },
        { kind: "implementation" as const, status: "pending" as const },
      ],
    };
    const merged = {
      number: 188,
      url: "https://github.com/acme/patchmill/pull/188",
      status: "merged" as const,
      mergeCommit: reviewedBaseOid,
      targetRepository: repository,
      baseBranch: "main",
      headRepository: repository,
      headBranch: "planning/spec",
      headSha: planningOid,
      body: renderPlanningPullRequestMarker({
        issueNumber: 188,
        phase: "spec",
      }),
    };
    const result = await reconcilePlanningPhase({
      state: initial,
      phaseIndex: 0,
      lock: {} as never,
      stateStore: {
        async replace({ next }) {
          return next;
        },
      },
      host: {
        async getPullRequest() {
          return merged;
        },
      } as never,
      remoteBase: new PlanningRemoteBaseGit({
        runner,
        repoRoot: repo,
        specsDir: "docs/specs",
        plansDir: "docs/plans",
      }),
      git: publication,
      workspaces: {} as never,
    });

    assert.deepEqual(result.outcome, {
      kind: "merged",
      pullRequest: merged,
      baseOid: reviewedBaseOid,
    });
    const phase = result.state.phases[0]!;
    assert.equal(phase.status, "complete");
    assert.deepEqual(phase.artifacts, [
      {
        kind: "spec",
        path: "docs/specs/issue-188.md",
        source: "remote-base",
        commitOid: reviewedBaseOid,
      },
    ]);
    assert.deepEqual(phase.completion, {
      kind: "merged-pull-request",
      mergeOid: reviewedBaseOid,
      mergedBaseOid: reviewedBaseOid,
    });
    assert.equal(
      commands.some((command) => command.includes(planningOid)),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
