import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandRunner } from "../../src/command/types.ts";
import { PlanningPublicationGit } from "../../src/git/planning-publication-git.ts";
import { PlanningWorkspaceGit } from "../../src/git/planning-workspace-git.ts";
import { DEFAULT_PATCHMILL_POLICY } from "../../src/policy/defaults.ts";
import { DEFAULT_PATCHMILL_SKILLS } from "../../src/workflow/skills.ts";
import type { PlanningStateV1 } from "../../src/workflow/planning-state-types.ts";
import { planningPhasePlan } from "../../src/workflow/planning-pull-requests.ts";
import {
  assertPlanningStateReplacement,
  createPlanningState,
  validatePlanningState,
} from "../../src/workflow/planning-state.ts";
import type { PlanningPhaseRunnerInput } from "../../src/cli/commands/run-once/planning-phase-runner-shared.ts";

export const recoveryGit = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

export async function planningArtifactRecoveryFixture(
  kind: "plan" | "implementation" = "implementation",
) {
  const root = await mkdtemp(join(tmpdir(), "planning-artifact-recovery-"));
  const repo = join(root, "repo");
  const worktreeRoot = join(root, "worktrees");
  const workspace = join(worktreeRoot, kind);
  execFileSync("git", ["init", "-b", "main", repo]);
  recoveryGit(repo, "config", "user.name", "Patchmill Test");
  recoveryGit(repo, "config", "user.email", "patchmill@example.test");
  await writeFile(join(repo, "tracked.txt"), "base\n");
  await writeFile(join(repo, ".gitignore"), ".pi/\nignored-cache/\n");
  recoveryGit(repo, "add", ".");
  recoveryGit(repo, "commit", "-m", "base");
  const base = {
    remote: "origin",
    baseBranch: "main",
    baseOid: recoveryGit(repo, "rev-parse", "HEAD"),
    artifactCandidates: { spec: [], plan: [] },
  };
  const calls: string[][] = [];
  const runner: CommandRunner = {
    async run(command, args, options) {
      calls.push(args);
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
          status: number;
          stdout: string;
          stderr: string;
        };
        return {
          code: failure.status,
          stdout: failure.stdout,
          stderr: failure.stderr,
        };
      }
    },
  };
  const workspaces = new PlanningWorkspaceGit({
    runner,
    repoRoot: repo,
    worktreeRoot,
  });
  const identity = { branch: `planning/${kind}`, worktreePath: workspace };
  const runId = "123e4567-e89b-42d3-a456-426614174000";
  const prepared = await workspaces.prepare({
    runId,
    phase: kind,
    identity,
    base,
  });
  const specPath = "docs/specs/2026-10-10-issue-307-spec.md";
  await mkdir(join(workspace, "docs/specs"), { recursive: true });
  await writeFile(join(workspace, specPath), "# Recorded specification\n");
  recoveryGit(workspace, "add", specPath);
  recoveryGit(workspace, "commit", "-m", "recorded specification");
  const savedHeadOid = recoveryGit(workspace, "rev-parse", "HEAD");
  const todoRoot = join(workspace, ".pi/todos/issue-307");
  await mkdir(todoRoot, { recursive: true });
  await mkdir(join(workspace, "ignored-cache"));
  const sentinels = [
    join(todoRoot, "original.md"),
    join(workspace, "ignored-cache", "state.bin"),
  ];
  for (const path of sentinels)
    await writeFile(path, Buffer.from([0, 255, 7, 10]));
  const initial = createPlanningState({
    runId,
    issueNumber: 307,
    issueTitle: "Planning artifact verification rejects ignored todos",
    gates: { specRequired: false, planRequired: kind === "plan" },
    now: "2026-10-11T00:00:00.000Z",
  });
  const state = validatePlanningState({
    ...initial,
    phases: initial.phases.map((phase, index) =>
      index === 0
        ? {
            kind,
            status: "workspace-ready",
            base,
            workspace: {
              ...prepared.workspace,
              todoRoot,
              headOid: savedHeadOid,
            },
            artifacts: [
              {
                kind: "spec",
                path: specPath,
                source: "workspace",
                commitOid: savedHeadOid,
              },
            ],
          }
        : phase,
    ),
  });
  let durableState = state;
  const checkpointStates: PlanningStateV1[] = [];
  const boundaries: PlanningStateV1[] = [];
  let artifactAgentCalls = 0;
  const input: PlanningPhaseRunnerInput = {
    state,
    phaseIndex: 0,
    phase: planningPhasePlan(state.gates)[0]!,
    issue: {
      number: 307,
      title: state.issueTitle,
      state: "open",
      labels: [],
      body: "",
    },
    lock: {} as never,
    config: {
      repoRoot: repo,
      remote: "origin",
      baseBranch: "main",
      specsDir: "docs/specs",
      plansDir: "docs/plans",
      projectPolicy: DEFAULT_PATCHMILL_POLICY,
      skills: DEFAULT_PATCHMILL_SKILLS,
      triageLabels: { ready: "agent-ready", needsInfo: "needs-info" },
      workspaceIdentity: () => identity,
    },
    stateStore: {
      replace: async ({ expectedRevision, next }) => {
        assert.equal(expectedRevision, durableState.revision);
        assertPlanningStateReplacement(durableState, next);
        durableState = validatePlanningState(next);
        checkpointStates.push(durableState);
        return durableState;
      },
    },
    host: {} as never,
    remoteBase: { fetch: async () => base },
    publicationGit: new PlanningPublicationGit({ runner, repoRoot: repo }),
    workspaces,
    artifactAgent: {
      run: async () => {
        artifactAgentCalls++;
        throw new Error("unexpected artifact-agent rerun");
      },
    },
    implementation: {
      implementation: {} as never,
      finish: () => {
        throw new Error("unexpected finish cleanup");
      },
    },
    artifactDate: new Date("2026-10-12T00:00:00.000Z"),
    operations: {
      runImplementation: async ({ state: current }) => {
        boundaries.push(current);
        return {
          kind: "blocked",
          state: current,
          result: {
            status: "blocked",
            reason: "test implementation boundary",
            questions: [],
            commits: [],
            validation: [],
          } as never,
        };
      },
      publish: async ({ state: current }) => {
        boundaries.push(current);
        return { kind: "ambiguous", state: current, pullRequests: [] };
      },
    },
  };
  calls.length = 0;
  async function commit(path = "docs/plans/2026-10-11-issue-307-original.md") {
    await mkdir(join(workspace, "docs/plans"), { recursive: true });
    await writeFile(join(workspace, path), "# Original committed plan\n");
    recoveryGit(workspace, "add", path);
    recoveryGit(workspace, "commit", "-m", "original planning artifact");
    return recoveryGit(workspace, "rev-parse", "HEAD");
  }
  async function preservation() {
    const indexPath = recoveryGit(
      workspace,
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "index",
    );
    return {
      indexPath,
      index: await readFile(indexPath),
      sentinels: await Promise.all(sentinels.map((path) => readFile(path))),
      head: recoveryGit(workspace, "rev-parse", "HEAD"),
    };
  }
  async function assertPreserved(
    before: Awaited<ReturnType<typeof preservation>>,
  ) {
    assert.deepEqual(await readFile(before.indexPath), before.index);
    assert.deepEqual(
      await Promise.all(sentinels.map((path) => readFile(path))),
      before.sentinels,
    );
    assert.equal(recoveryGit(workspace, "rev-parse", "HEAD"), before.head);
    assert.ok(
      calls.every(
        (args) =>
          !args.some((arg) =>
            /^(add|commit|reset|clean|checkout|update-index|push|branch|remove)$/u.test(
              arg,
            ),
          ),
      ),
    );
  }
  return {
    root,
    repo,
    workspace,
    base,
    input,
    calls,
    checkpointStates,
    boundaries,
    todoRoot,
    specPath,
    savedHeadOid,
    commit,
    preservation,
    assertPreserved,
    artifactAgentCalls: () => artifactAgentCalls,
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}
