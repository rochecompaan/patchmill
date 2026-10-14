import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandRunner } from "../../src/command/types.ts";
import { PlanningWorkspaceGit } from "../../src/git/planning-workspace-git.ts";
import { PlanningPublicationGit } from "../../src/git/planning-publication-git.ts";
import type { PullRequestSummary } from "../../src/host/pull-requests.ts";
import { DEFAULT_PATCHMILL_POLICY } from "../../src/policy/defaults.ts";
import { DEFAULT_PATCHMILL_SKILLS } from "../../src/workflow/skills.ts";
import {
  assertPlanningStateReplacement,
  validatePlanningState,
} from "../../src/workflow/planning-state.ts";
import type { PlanningPhaseRunnerInput } from "../../src/cli/commands/run-once/planning-phase-runner-shared.ts";
import { publishedImplementationState } from "./planning-implementation-state-fixture.ts";

export const resumeGit = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

export async function implementationResumeFixture(
  status: "branch-pushed" | "pull-request-open" = "pull-request-open",
) {
  const root = await mkdtemp(join(tmpdir(), "implementation-resume-"));
  const repo = join(root, "repo");
  const remote = join(root, "remote.git");
  const worktreeRoot = join(root, "worktrees");
  const path = join(worktreeRoot, "189");
  execFileSync("git", ["init", "--bare", "--initial-branch=main", remote], {
    stdio: "ignore",
  });
  execFileSync("git", ["init", "-b", "main", repo], { stdio: "ignore" });
  resumeGit(repo, "config", "user.name", "Patchmill Test");
  resumeGit(repo, "config", "user.email", "patchmill@example.test");
  await mkdir(join(repo, "docs/specs"), { recursive: true });
  await mkdir(join(repo, "docs/plans"), { recursive: true });
  await writeFile(join(repo, "docs/specs/issue-189.md"), "# Spec\n");
  await writeFile(join(repo, "docs/plans/issue-189.md"), "# Plan\n");
  await writeFile(join(repo, "tracked.txt"), "base\n");
  await writeFile(join(repo, ".gitignore"), "ignored.txt\n");
  resumeGit(repo, "add", ".");
  resumeGit(repo, "commit", "-m", "base");
  resumeGit(repo, "remote", "add", "origin", remote);
  resumeGit(repo, "push", "origin", "main");
  const fixture = publishedImplementationState();
  const phase = fixture.phases[0];
  const base = {
    ...phase.base,
    baseOid: resumeGit(repo, "rev-parse", "HEAD"),
    artifactCandidates: {
      spec: ["docs/specs/issue-189.md"],
      plan: ["docs/plans/issue-189.md"],
    },
  };
  const identity = { ...phase.workspace.identity, worktreePath: path };
  const calls: string[][] = [];
  const runner: CommandRunner = {
    run: async (command, args, options) => {
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
  const prepared = await workspaces.prepare({
    runId: fixture.runId,
    phase: "implementation",
    identity,
    base,
  });
  await writeFile(join(path, "tracked.txt"), "checked A\n");
  resumeGit(path, "add", ".");
  resumeGit(path, "commit", "-m", "checked implementation");
  resumeGit(path, "push", "origin", identity.branch);
  const checkedHead = resumeGit(path, "rev-parse", "HEAD");
  const { pullRequest, finish: _finish, ...published } = phase;
  let current = validatePlanningState({
    ...fixture,
    phases: [
      {
        ...published,
        status,
        base,
        artifacts: [
          {
            kind: "spec",
            path: "docs/specs/issue-189.md",
            source: "remote-base",
            commitOid: base.baseOid,
          },
          {
            kind: "plan",
            path: "docs/plans/issue-189.md",
            source: "remote-base",
            commitOid: base.baseOid,
          },
        ],
        workspace: { ...prepared.workspace, headOid: checkedHead },
        publication: { ...phase.publication, headOid: checkedHead },
        implementation: {
          ...phase.implementation,
          checkedHeadOid: checkedHead,
          commits: [checkedHead],
        },
        ...(status === "pull-request-open" ? { pullRequest, finish: {} } : {}),
      },
    ],
  });
  let pull: PullRequestSummary = {
    ...phase.publication,
    number: 17,
    url: pullRequest.url,
    headSha: checkedHead,
    body: "Closes #189\n<!-- patchmill:planning-pr-v1 issue=189 phase=implementation -->",
    status: "open",
  };
  let agents = 0;
  let preparations = 0;
  const input: PlanningPhaseRunnerInput = {
    state: current,
    phaseIndex: 0,
    phase: {
      kind: "implementation",
      artifactKinds: ["spec", "plan"],
      pullRequestRequired: true,
    },
    issue: { number: 189, title: fixture.issueTitle, state: "open" },
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
      replace: async ({ next }) => {
        const parsed = validatePlanningState(next);
        assertPlanningStateReplacement(current, parsed);
        current = parsed;
        return parsed;
      },
    },
    host: {
      id: "github-gh",
      resolveTargetRepositoryIdentity: async () =>
        phase.publication.targetRepository,
      resolveRemoteRepositoryIdentity: async () =>
        phase.publication.headRepository,
      getPullRequest: async () => pull,
      findPullRequests: async () => [pull],
      createPullRequest: async () =>
        assert.fail("the saved PR must not be replaced"),
      readPullRequestBody: async () => pull.body ?? "",
      updatePullRequestBody: async () => {},
    },
    remoteBase: { fetch: async () => base },
    publicationGit: new PlanningPublicationGit({ runner, repoRoot: repo }),
    workspaces,
    artifactAgent: { run: async () => assert.fail("artifacts already exist") },
    implementation: {
      implementation: {
        configuredGit: {
          remote: "origin",
          baseBranch: "main",
          allowDirectLand: false,
        },
        runAgent: async (request) => {
          agents++;
          assert.ok(
            preparations > 0,
            "canonical preparation must precede the agent",
          );
          assert.equal(request.existingPullRequest?.url, pull.url);
          assert.equal(request.existingPullRequest?.reference.number, 17);
          assert.equal(
            resumeGit(path, "branch", "--show-current"),
            identity.branch,
          );
          const head = resumeGit(path, "rev-parse", "HEAD");
          resumeGit(path, "push", "origin", identity.branch);
          pull = { ...pull, headSha: head };
          return {
            status: "pr-created",
            prUrl: pull.url,
            branch: identity.branch,
            commits: [head],
            validation: ["fresh checks"],
            reviewSummary: "fresh review",
          };
        },
      },
      finish: () => ({ effects: {} as never }),
    },
    operations: {
      runArtifacts: async ({ current: ready }) => {
        preparations++;
        return { kind: "workspace-ready", phase: ready };
      },
      finishImplementation: async ({ state: durable }) => {
        const result = durable.phases[0];
        assert.equal(result?.status, "pull-request-open");
        return {
          kind: "implementation-published",
          state: durable,
          result: {
            status: "pr-created",
            prUrl: pull.url,
            branch: identity.branch,
            commits: [],
            validation: [],
          },
        };
      },
    },
  };
  return {
    input,
    root,
    repo,
    remote,
    path,
    identity,
    base,
    checkedHead,
    calls,
    workspaces,
    runner,
    current: () => current,
    agents: () => agents,
    preparations: () => preparations,
    pull: () => pull,
    setPull: (value: PullRequestSummary) => {
      pull = value;
    },
    async advance(cwd = path) {
      await writeFile(join(cwd, "tracked.txt"), "human revision B\n");
      resumeGit(cwd, "add", ".");
      resumeGit(cwd, "commit", "-m", "human change");
      const head = resumeGit(cwd, "rev-parse", "HEAD");
      resumeGit(cwd, "push", "origin", identity.branch);
      pull = { ...pull, headSha: head };
      return head;
    },
    async remove(survivingBranch = false) {
      resumeGit(repo, "worktree", "remove", path);
      if (!survivingBranch) resumeGit(repo, "branch", "-D", identity.branch);
      const saved = current.phases[0];
      if (
        saved?.kind !== "implementation" ||
        saved.status !== "pull-request-open"
      )
        assert.fail();
      current = validatePlanningState({
        ...current,
        phases: [
          {
            ...saved,
            finish: {
              costPublicationCompleted: true,
              visualEvidenceValidated: true,
              handoffCommentPosted: true,
              cleanupHookCompleted: true,
            },
            workspace: {
              ...saved.workspace,
              cleanup: {
                state: survivingBranch ? "worktree-removed" : "removed",
                pushedHeadOid: checkedHead,
              },
            },
          },
        ],
      });
      input.state = current;
    },
    async close() {
      await rm(root, { recursive: true, force: true });
    },
  };
}
