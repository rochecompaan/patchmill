import assert from "node:assert/strict";
import test from "node:test";
import { issue } from "../../../../test-support/run-once/issue-fixtures.ts";
import {
  assertPlanningStateReplacement,
  validatePlanningState,
} from "../../../workflow/planning-state.ts";
import type { PlanningStateV1 } from "../../../workflow/planning-state-types.ts";
import {
  runPlanningImplementation,
  type PlanningImplementationInput,
} from "./planning-implementation.ts";
import { reconcileSavedPlanningImplementation } from "./planning-implementation-receipt.ts";
import { invalidateImplementationChecks } from "./planning-implementation-revalidation.ts";

const oid = (character: string) => character.repeat(40);
const repository = {
  provider: "github-gh" as const,
  host: "github.com",
  owner: "acme",
  repository: "patchmill",
};
const url = "https://github.com/acme/patchmill/pull/189";
function initial(status: "branch-pushed" | "pull-request-open") {
  return validatePlanningState({
    version: 1,
    workflowVersion: "planning-pr-v1",
    runId: "123e4567-e89b-42d3-a456-426614174000",
    issueNumber: 189,
    issueTitle: "Implementation",
    gates: { specRequired: false, planRequired: false },
    revision: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    phases: [
      {
        kind: "implementation",
        status,
        base: {
          remote: "origin",
          baseBranch: "main",
          baseOid: oid("a"),
          artifactCandidates: { spec: [], plan: [] },
        },
        workspace: {
          runId: "123e4567-e89b-42d3-a456-426614174000",
          phase: "implementation",
          identity: {
            branch: "agent/189",
            worktreePath: "/repo/.worktrees/189",
          },
          remote: "origin",
          baseBranch: "main",
          baseOid: oid("a"),
          headOid: oid("b"),
          cleanup: { state: "ready" },
        },
        artifacts: [
          {
            kind: "spec",
            path: "docs/specs/issue-189-spec.md",
            source: "workspace",
            commitOid: oid("b"),
          },
          {
            kind: "plan",
            path: "docs/plans/issue-189-plan.md",
            source: "workspace",
            commitOid: oid("b"),
          },
        ],
        publication: {
          targetRepository: repository,
          headRepository: repository,
          baseBranch: "main",
          headBranch: "agent/189",
          headOid: oid("b"),
        },
        implementation: {
          status: "pr-created",
          prUrl: url,
          branch: "agent/189",
          commits: [oid("b")],
          validation: ["old checks"],
          visualEvidence: [],
        },
        ...(status === "pull-request-open"
          ? {
              pullRequest: {
                reference: { targetRepository: repository, number: 189 },
                url,
              },
              finish: {
                costPublicationCompleted: true,
                visualEvidenceValidated: true,
                handoffCommentPosted: true,
                cleanupHookCompleted: true,
              },
            }
          : {}),
      },
    ],
  });
}
function fixture(state: PlanningStateV1, remoteHead = oid("c")) {
  let current = state;
  let agents = 0;
  const pull = {
    number: 189,
    url,
    targetRepository: repository,
    headRepository: repository,
    baseBranch: "main",
    headBranch: "agent/189",
    headSha: remoteHead,
    body: "Closes #189\n<!-- patchmill:planning-pr-v1 issue=189 phase=implementation -->",
    status: "open" as const,
  };
  const input: PlanningImplementationInput = {
    state,
    phaseIndex: 0,
    lock: {} as never,
    workspaceCreated: false,
    stateStore: {
      replace: async ({ next }) => {
        const checked = validatePlanningState(next);
        assertPlanningStateReplacement(current, checked);
        current = checked;
        return checked;
      },
    },
    host: {
      id: "github-gh",
      resolveTargetRepositoryIdentity: async () => repository,
      resolveRemoteRepositoryIdentity: async () => repository,
      findPullRequests: async () => [pull],
      getPullRequest: async () => pull,
      createPullRequest: async () =>
        assert.fail("must not replace the existing PR"),
      readPullRequestBody: async () => pull.body,
      updatePullRequestBody: async () => {},
    },
    workspaces: {
      inspect: async () => ({
        state: "ready",
        identity: { branch: "agent/189", worktreePath: "/repo/.worktrees/189" },
        headOid: oid("c"),
        clean: true,
      }),
    },
    git: {
      inspectRemoteHead: async () => ({ state: "present", headOid: oid("c") }),
      assertAncestor: async () => {},
    },
    configuredGit: {
      remote: "origin",
      baseBranch: "main",
      allowDirectLand: false,
    },
    runAgent: async (request) => {
      agents++;
      assert.equal(request.existingPullRequest?.url, url);
      pull.headSha = oid("c");
      return {
        status: "pr-created",
        prUrl: url,
        branch: "agent/189",
        commits: [oid("c")],
        validation: ["fresh checks"],
      };
    },
  };
  return { input, agents: () => agents, current: () => current, pull };
}

function receiptInput(run: ReturnType<typeof fixture>) {
  return {
    runner: {
      run: async (command: string, args: string[]) => {
        if (command === "git" && args[0] === "rev-parse")
          return { code: 0, stdout: `${oid("c")}\n`, stderr: "" };
        if (command === "git") {
          assert.deepEqual(args.slice(0, 2), ["remote", "get-url"]);
          assert.equal(args.at(-1), "origin");
          return {
            code: 0,
            stdout: "https://github.com/acme/patchmill.git\n",
            stderr: "",
          };
        }
        assert.equal(command, "gh");
        if (args[0] === "api" && args[1] === "graphql")
          return {
            code: 0,
            stdout: JSON.stringify({
              data: {
                repository: {
                  nameWithOwner: "acme/patchmill",
                  pullRequest: { number: 189 },
                },
              },
            }),
            stderr: "",
          };
        if (args[0] === "repo")
          return {
            code: 0,
            stdout: JSON.stringify({
              nameWithOwner: "acme/patchmill",
              url: "https://github.com/acme/patchmill",
            }),
            stderr: "",
          };
        if (args[0] === "pr")
          return {
            code: 0,
            stdout: JSON.stringify({
              number: 189,
              url,
              state: "OPEN",
              mergeCommit: null,
              baseRefName: "main",
              headRefName: "agent/189",
              headRefOid: run.pull.headSha,
              headRepository: { nameWithOwner: "acme/patchmill" },
              body: run.pull.body,
            }),
            stderr: "",
          };
        assert.fail(`unexpected host call ${args.join(" ")}`);
      },
    },
    config: {
      repoRoot: "/repo",
      remote: "origin",
      specsDir: "docs/specs",
      plansDir: "docs/plans",
      host: { provider: "github-gh", login: "" },
    } as never,
    options: {},
    issue: issue(189, ["in-progress"], "Implementation"),
    state: run.input.state,
    lock: run.input.lock,
    stateStore: run.input.stateStore as never,
  };
}

test("an advanced saved planning implementation PR reruns verification instead of rejecting ownership", async () => {
  const run = fixture(initial("pull-request-open"));
  const result = await reconcileSavedPlanningImplementation(receiptInput(run));
  assert.equal(result.kind, "ready");
  if (result.kind !== "ready")
    assert.fail("owned implementation must be resumable");
  const phase = result.state.phases[0];
  assert.equal(phase?.status, "workspace-ready");
  assert.equal(
    "implementation" in phase!,
    false,
    "old checks must be invalidated",
  );
  const checked = await runPlanningImplementation({
    ...run.input,
    state: result.state,
  });
  assert.equal(checked.kind, "validated", JSON.stringify(checked));
  assert.equal(run.agents(), 1);
  const published = checked.state.phases[0];
  if (
    published?.kind !== "implementation" ||
    published.status !== "pull-request-open"
  )
    assert.fail("fresh handoff missing");
  assert.equal(published.pullRequest.url, url);
  assert.equal(published.publication.headOid, oid("c"));
  assert.deepEqual(published.implementation.validation, ["fresh checks"]);
  assert.deepEqual(published.finish, {});
});

test("local implementation progress invalidates checks even before it is pushed", async () => {
  const run = fixture(initial("pull-request-open"), oid("b"));
  const result = await reconcileSavedPlanningImplementation(receiptInput(run));
  assert.equal(result.kind, "ready");
  if (result.kind !== "ready")
    assert.fail("owned implementation must be resumable");
  assert.equal(result.state.phases[0]?.status, "workspace-ready");
  const checked = await runPlanningImplementation({
    ...run.input,
    state: result.state,
  });
  assert.equal(checked.kind, "validated", JSON.stringify(checked));
  assert.equal(run.agents(), 1);
});

test("invalidating checks cannot change ownership, artifact evidence, or merge proof", () => {
  const saved = initial("pull-request-open");
  const phase = saved.phases[0];
  if (phase?.kind !== "implementation" || phase.status !== "pull-request-open")
    assert.fail("invalid fixture");
  const ready = invalidateImplementationChecks(phase);
  for (const nextPhase of [
    {
      ...ready,
      workspace: {
        ...ready.workspace,
        identity: { ...ready.workspace.identity, branch: "another-issue" },
      },
    },
    {
      ...ready,
      artifacts: ready.artifacts.map((artifact) => ({
        ...artifact,
        commitOid: oid("c"),
      })),
    },
  ]) {
    const next = validatePlanningState({
      ...saved,
      revision: 1,
      phases: [nextPhase],
    });
    assert.throws(
      () => assertPlanningStateReplacement(saved, next),
      /immutable-evidence/,
    );
  }
  const merged = validatePlanningState({
    ...saved,
    phases: [
      { ...phase, merge: { mergeOid: oid("c"), mergedBaseOid: oid("d") } },
    ],
  });
  assert.throws(
    () =>
      assertPlanningStateReplacement(
        merged,
        validatePlanningState({ ...saved, revision: 1, phases: [ready] }),
      ),
    /immutable-evidence/,
  );
});

test("a moved branch-pushed implementation reenters verification on its existing PR", async () => {
  const run = fixture(initial("branch-pushed"));
  const result = await runPlanningImplementation(run.input);
  assert.equal(result.kind, "validated", JSON.stringify(result));
  assert.equal(run.agents(), 1);
  const phase = result.state.phases[0];
  if (phase?.kind !== "implementation" || phase.status !== "pull-request-open")
    assert.fail("fresh handoff missing");
  assert.equal(phase.pullRequest.url, url);
  assert.deepEqual(phase.implementation.validation, ["fresh checks"]);
});
