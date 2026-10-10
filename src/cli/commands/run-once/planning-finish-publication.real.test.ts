import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CommandRunner } from "../../../command/types.ts";
import { PlanningPublicationGit } from "../../../git/planning-publication-git.ts";
import { PlanningWorkspaceGit } from "../../../git/planning-workspace-git.ts";
import { PlanningWorkspaceConflictError } from "../../../git/planning-workspaces.ts";
import {
  assertPlanningStateReplacement,
  parsePlanningState,
  serializePlanningState,
  validatePlanningState,
  type PlanningStateV1,
} from "../../../workflow/planning-state.ts";
import { runPlanningImplementationPhase } from "./planning-phase-runner-implementation.ts";

const runId = "123e4567-e89b-42d3-a456-426614174000";
const branch = "agent/262";
const ignoredBytes = "TOKEN=unique-ignored\n";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function fixture(cleanup: "ready" | "legacy") {
  const root = await mkdtemp(join(tmpdir(), "planning-finish-publication-"));
  const repo = join(root, "repo");
  const remote = join(root, "remote.git");
  const worktreeRoot = join(root, "worktrees");
  const path = join(worktreeRoot, "implementation");
  const events: string[] = [];
  const calls: string[][] = [];
  git(root, "init", "--bare", "--initial-branch=main", remote);
  git(root, "init", "-b", "main", repo);
  git(repo, "config", "user.name", "Patchmill Test");
  git(repo, "config", "user.email", "patchmill@example.test");
  await writeFile(join(repo, ".gitignore"), ".env\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "base");
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "origin", "main");
  const baseOid = git(repo, "rev-parse", "HEAD");
  const runner: CommandRunner = {
    async run(command, args, options) {
      calls.push([...args]);
      if (args[0] === "ls-remote") events.push("remote");
      if (args[0] === "worktree" && args[1] === "remove")
        events.push("worktree");
      try {
        return {
          code: 0,
          stdout: execFileSync(command, args, {
            cwd: options?.cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
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
  const workspaces = new PlanningWorkspaceGit({
    runner,
    repoRoot: repo,
    worktreeRoot,
  });
  const publicationGit = new PlanningPublicationGit({ runner, repoRoot: repo });
  const base = {
    remote: "origin",
    baseBranch: "main",
    baseOid,
    artifactCandidates: { spec: [], plan: [] },
  };
  const prepared = await workspaces.prepare({
    runId,
    phase: "implementation",
    identity: { branch, worktreePath: "../worktrees/implementation" },
    base,
  });
  for (const kind of ["spec", "plan"] as const) {
    await mkdir(join(path, "docs", `${kind}s`), { recursive: true });
    await writeFile(
      join(path, "docs", `${kind}s`, "issue-262.md"),
      `${kind}\n`,
    );
  }
  git(path, "add", ".");
  git(path, "commit", "-m", "artifacts");
  const headOid = git(path, "rev-parse", "HEAD");
  git(path, "push", "origin", branch);
  await writeFile(join(path, ".env"), ignoredBytes);
  const repository = {
    provider: "github-gh" as const,
    host: "github.com",
    owner: "acme",
    repository: "patchmill",
  };
  const prUrl = "https://github.com/acme/patchmill/pull/263";
  let current = parsePlanningState(
    serializePlanningState(
      validatePlanningState({
        version: 1,
        workflowVersion: "planning-pr-v1",
        runId,
        issueNumber: 262,
        issueTitle: "Cleanup",
        gates: { specRequired: false, planRequired: false },
        revision: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        phases: [
          {
            kind: "implementation",
            status: "pull-request-open",
            base,
            workspace: {
              ...prepared.workspace,
              headOid,
              cleanup:
                cleanup === "ready"
                  ? { state: "ready" }
                  : {
                      state: "cleanup-pending",
                      reason: "ignored-worktree-content",
                      ignoredPaths: [".env"],
                    },
            },
            artifacts: (["spec", "plan"] as const).map((kind) => ({
              kind,
              path: `docs/${kind}s/issue-262.md`,
              source: "workspace",
              commitOid: headOid,
            })),
            publication: {
              targetRepository: repository,
              headRepository: repository,
              baseBranch: "main",
              headBranch: branch,
              headOid,
            },
            pullRequest: {
              reference: { targetRepository: repository, number: 263 },
              url: prUrl,
            },
            implementation: {
              status: "pr-created",
              prUrl,
              branch,
              commits: [headOid],
              validation: ["npm test"],
              visualEvidence: [],
            },
            finish: {
              costPublicationCompleted: true,
              visualEvidenceValidated: true,
              handoffCommentPosted: true,
              cleanupHookCompleted: true,
            },
          },
        ],
      }),
    ),
  );
  let failCheckpoint: string | undefined;
  events.length = 0;
  calls.length = 0;
  return {
    root,
    repo,
    remote,
    path,
    baseOid,
    headOid,
    events,
    calls,
    state: () => current,
    failNextCheckpoint(cleanupState: string) {
      failCheckpoint = cleanupState;
    },
    run() {
      return runPlanningImplementationPhase({
        state: current,
        phaseIndex: 0,
        phase: {
          kind: "implementation",
          artifactKinds: [],
          pullRequestRequired: true,
        },
        issue: {} as never,
        lock: {} as never,
        config: {} as never,
        stateStore: {
          replace: async ({ next }: { next: PlanningStateV1 }) => {
            const valid = validatePlanningState(next);
            assertPlanningStateReplacement(current, valid);
            const nextCleanup = valid.phases[0]!.workspace!.cleanup.state;
            if (nextCleanup === failCheckpoint) {
              failCheckpoint = undefined;
              throw new Error("checkpoint failed");
            }
            current = valid;
            events.push(`checkpoint:${nextCleanup}`);
            return valid;
          },
        },
        host: {} as never,
        remoteBase: {} as never,
        artifactAgent: {} as never,
        workspaces,
        publicationGit,
        implementation: {
          implementation: {} as never,
          finish: () => ({
            effects: {
              publishCost: async () => {
                events.push("cost");
              },
              validateVisualEvidence: async () => {
                events.push("visual");
              },
              postHandoff: async () => {
                events.push("handoff");
              },
              cleanupHook: async () => {
                events.push("hook");
              },
              ensureDoneLabel: async () => {
                events.push("ensureDoneLabel");
              },
              applyDoneLabels: async () => {
                events.push("applyDoneLabels");
              },
            },
          }),
        },
      });
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

for (const cleanup of ["ready", "legacy"] as const) {
  for (const remoteState of ["changed", "missing"] as const) {
    test(`${cleanup} implementation retry preserves ignored bytes when remote is ${remoteState}`, async () => {
      const setup = await fixture(cleanup);
      try {
        if (remoteState === "changed")
          git(
            setup.remote,
            "update-ref",
            `refs/heads/${branch}`,
            setup.baseOid,
            setup.headOid,
          );
        else
          git(
            setup.remote,
            "update-ref",
            "-d",
            `refs/heads/${branch}`,
            setup.headOid,
          );
        const saved = setup.state();
        assert.equal(
          git(setup.path, "status", "--porcelain=v1", "--untracked-files=all"),
          "",
        );
        await assert.rejects(
          setup.run(),
          (error: unknown) =>
            error instanceof PlanningWorkspaceConflictError &&
            error.reason === "remote-head-mismatch",
        );
        assert.equal(
          await readFile(join(setup.path, ".env"), "utf8"),
          ignoredBytes,
        );
        assert.equal(
          git(setup.repo, "rev-parse", `refs/heads/${branch}`),
          setup.headOid,
        );
        assert.deepEqual(setup.state(), saved);
        assert.deepEqual(setup.events, ["remote"]);
        assert.equal(
          setup.calls.some(
            (args) => args[0] === "worktree" && args[1] === "remove",
          ),
          false,
        );
        assert.equal(
          setup.calls.some(
            (args) => args[0] === "update-ref" && args.includes("-d"),
          ),
          false,
        );
      } finally {
        await setup.cleanup();
      }
    });
  }
  test(`${cleanup} implementation retry checks publication before removal without replaying effects`, async () => {
    const setup = await fixture(cleanup);
    try {
      const result = await setup.run();
      assert.equal(result.kind, "complete");
      await assert.rejects(access(setup.path), { code: "ENOENT" });
      assert.deepEqual(setup.events, [
        "remote",
        "worktree",
        "checkpoint:worktree-removed",
        "remote",
        "checkpoint:removed",
        "ensureDoneLabel",
        "checkpoint:removed",
        "applyDoneLabels",
        "checkpoint:removed",
        "checkpoint:removed",
      ]);
    } finally {
      await setup.cleanup();
    }
  });
}

for (const failedCheckpoint of ["worktree-removed", "removed"] as const) {
  test(`implementation retry recovers a failed ${failedCheckpoint} checkpoint without replay`, async () => {
    const setup = await fixture("legacy");
    try {
      setup.failNextCheckpoint(failedCheckpoint);
      await assert.rejects(setup.run(), /checkpoint failed/);
      await assert.rejects(access(setup.path), { code: "ENOENT" });
      const result = await setup.run();
      assert.equal(result.kind, "complete");
      assert.equal(
        setup.calls.filter(
          (args) => args[0] === "worktree" && args[1] === "remove",
        ).length,
        1,
      );
      assert.equal(
        setup.events.some((event) =>
          ["cost", "visual", "handoff", "hook"].includes(event),
        ),
        false,
      );
      assert.equal(
        setup.events.filter((event) => event === "applyDoneLabels").length,
        1,
      );
    } finally {
      await setup.cleanup();
    }
  });
}
