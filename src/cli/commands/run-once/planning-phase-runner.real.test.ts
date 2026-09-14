import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CommandRunner } from "../../../command/types.ts";
import { PlanningPublicationGit } from "../../../git/planning-publication-git.ts";
import { PlanningWorkspaceGit } from "../../../git/planning-workspace-git.ts";
import { runPlanningPhase } from "./planning-phase-runner.ts";

const runId = "123e4567-e89b-42d3-a456-426614174000";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

const runner: CommandRunner = {
  run: async (command, args, options) => {
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

test(
  "adopts a clean descendant while preserving ignored workspace content",
  { timeout: 30_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "planning-runner-"));
    const remote = join(root, "remote.git");
    const seed = join(root, "seed");
    const repo = join(root, "repo");
    const worktreeRoot = join(root, "worktrees");

    try {
      execFileSync("git", ["init", "--bare", "--initial-branch=main", remote]);
      execFileSync("git", ["init", "-b", "main", seed]);
      git(seed, "config", "user.name", "Patchmill Test");
      git(seed, "config", "user.email", "patchmill@example.test");
      await writeFile(join(seed, "tracked.txt"), "base\n");
      await writeFile(join(seed, ".gitignore"), "ignored.txt\n");
      git(seed, "add", ".");
      git(seed, "commit", "-m", "base");
      git(seed, "remote", "add", "origin", remote);
      git(seed, "push", "-u", "origin", "main");
      execFileSync("git", ["clone", remote, repo]);
      git(repo, "config", "user.name", "Patchmill Test");
      git(repo, "config", "user.email", "patchmill@example.test");
      await mkdir(worktreeRoot);

      const base = {
        remote: "origin",
        baseBranch: "main",
        baseOid: git(repo, "rev-parse", "HEAD"),
        artifactCandidates: { spec: [], plan: [] },
      };
      const identity = {
        branch: "planning/implementation",
        worktreePath: "../worktrees/implementation",
      };
      const workspaces = new PlanningWorkspaceGit({
        runner,
        repoRoot: repo,
        worktreeRoot,
      });
      const prepared = await workspaces.prepare({
        runId,
        phase: "implementation",
        identity,
        base,
      });
      const worktreePath = join(worktreeRoot, "implementation");
      await writeFile(join(worktreePath, "tracked.txt"), "descendant\n");
      git(worktreePath, "add", "tracked.txt");
      git(worktreePath, "commit", "-m", "implementation progress");
      const descendantOid = git(worktreePath, "rev-parse", "HEAD");
      await writeFile(join(worktreePath, "ignored.txt"), "ignored state\n");
      assert.equal(
        git(worktreePath, "status", "--porcelain=v1", "--untracked-files=all"),
        "",
      );

      const initialState = {
        version: 1,
        workflowVersion: "planning-pr-v1",
        runId,
        issueNumber: 240,
        issueTitle: "Planning workspace retry treats ignored files as dirty",
        gates: { specRequired: false, planRequired: false },
        phases: [
          {
            kind: "implementation",
            status: "workspace-ready",
            base,
            workspace: prepared.workspace,
            artifacts: [],
          },
        ],
        revision: 0,
        createdAt: "2026-09-14T00:00:00.000Z",
        updatedAt: "2026-09-14T00:00:00.000Z",
      };
      const checkpointHeads: string[] = [];
      let implementationHead: string | undefined;
      const result = await runPlanningPhase({
        state: initialState,
        phaseIndex: 0,
        phase: {
          kind: "implementation",
          artifactKinds: [],
          pullRequestRequired: true,
        },
        issue: { number: 240, title: initialState.issueTitle, state: "open" },
        lock: {},
        config: {
          repoRoot: repo,
          remote: "origin",
          baseBranch: "main",
          specsDir: "docs/specs",
          plansDir: "docs/plans",
          projectPolicy: {},
          skills: {},
          triageLabels: { ready: "agent-ready", needsInfo: "needs-info" },
          workspaceIdentity: () => identity,
        },
        stateStore: {
          replace: async ({ next }: { next: typeof initialState }) => {
            checkpointHeads.push(next.phases[0]?.workspace.headOid ?? "");
            return next;
          },
        },
        host: {},
        remoteBase: { fetch: async () => base },
        publicationGit: new PlanningPublicationGit({ runner, repoRoot: repo }),
        workspaces,
        artifactAgent: {},
        implementation: { implementation: {}, finish: () => ({}) },
        operations: {
          runArtifacts: async ({ current }: { current: unknown }) => ({
            kind: "workspace-ready",
            phase: current,
          }),
          runImplementation: async ({
            state,
          }: {
            state: typeof initialState;
          }) => {
            implementationHead = state.phases[0]?.workspace.headOid;
            return { kind: "validated", state };
          },
          finishImplementation: async ({
            state,
          }: {
            state: typeof initialState;
          }) => ({ state, result: { status: "pr-created" } }),
        },
      } as never);

      assert.equal(result.kind, "complete");
      assert.equal(checkpointHeads[0], descendantOid);
      assert.equal(implementationHead, descendantOid);
      assert.equal(
        await readFile(join(worktreePath, "ignored.txt"), "utf8"),
        "ignored state\n",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
