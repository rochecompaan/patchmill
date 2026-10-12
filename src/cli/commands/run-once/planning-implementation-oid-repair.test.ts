import assert from "node:assert/strict";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { makeConfig } from "../../../../test-support/run-once/pipeline-fixtures.ts";
import {
  createMockRunner,
  promptPath,
} from "../../../../test-support/run-once/mock-runner.ts";
import { PlanningPublicationGitError } from "../../../git/planning-publication-git.ts";
import { validatePlanningState } from "../../../workflow/planning-state.ts";
import type { PlanningStateV1 } from "../../../workflow/planning-state-types.ts";
import { renderPlanningPullRequestMarker } from "../../../workflow/planning-pull-request-markers.ts";
import { createPlanningImplementationAdapter } from "./planning-implementation-adapter.ts";
import { runPlanningImplementation } from "./planning-implementation.ts";
import { createStepAccounting } from "./pipeline-progress.ts";

const repository = {
  provider: "github-gh" as const,
  host: "github.com",
  owner: "acme",
  repository: "patchmill",
};
const url = "https://github.com/acme/patchmill/pull/268";
const branch = "agent/issue-268-implementation";
async function fixture(t: test.TestContext, length = 40) {
  const config = await makeConfig({ dryRun: false, execute: true });
  config.skills = { ...config.skills, developmentEnvironment: undefined };
  t.after(() => rm(config.repoRoot, { recursive: true, force: true }));
  const worktreePath = join(config.repoRoot, ".worktrees/268");
  const todoRoot = join(config.repoRoot, ".pi/todos");
  await mkdir(worktreePath, { recursive: true });
  await mkdir(todoRoot, { recursive: true });
  await writeFile(
    join(todoRoot, "task.md"),
    JSON.stringify({
      id: "task",
      title: "issue-268-task-01-oid",
      status: "closed",
      tags: ["agent-issue", "issue-268"],
    }) + "\n\nclosed\n",
  );
  await writeFile(
    join(config.repoRoot, "docs/plans/oid.md"),
    "# Plan\n\n### Task 1: OID validation\n",
  );
  const baseOid = "a".repeat(length),
    headOid = "b".repeat(length);
  let state = validatePlanningState({
    version: 1,
    workflowVersion: "planning-pr-v1",
    runId: "123e4567-e89b-42d3-a456-426614174000",
    issueNumber: 268,
    issueTitle: "OID repair",
    gates: { specRequired: false, planRequired: false },
    revision: 0,
    createdAt: "2026-10-12T00:00:00.000Z",
    updatedAt: "2026-10-12T00:00:00.000Z",
    phases: [
      {
        kind: "implementation",
        status: "workspace-ready",
        base: {
          remote: "origin",
          baseBranch: "main",
          baseOid,
          artifactCandidates: { spec: [], plan: [] },
        },
        workspace: {
          runId: "123e4567-e89b-42d3-a456-426614174000",
          phase: "implementation",
          identity: { branch, worktreePath },
          remote: "origin",
          baseBranch: "main",
          baseOid,
          headOid: baseOid,
          todoRoot,
          cleanup: { state: "ready" },
        },
        artifacts: [
          {
            kind: "spec",
            path: "docs/specs/oid.md",
            source: "workspace",
            commitOid: headOid,
          },
          {
            kind: "plan",
            path: "docs/plans/oid.md",
            source: "workspace",
            commitOid: headOid,
          },
        ],
      },
    ],
  });
  const pull = {
    number: 268,
    url,
    targetRepository: repository,
    headRepository: repository,
    baseBranch: "main",
    headBranch: branch,
    headSha: headOid,
    body: `Closes #268\n${renderPlanningPullRequestMarker({ issueNumber: 268, phase: "implementation" })}`,
    status: "open" as const,
  };
  const sessions: string[] = [],
    prompts: string[] = [],
    events: string[] = [],
    checkpoints: PlanningStateV1[] = [];
  const ancestry: Array<{ ancestorOid: string; descendantOid: string }> = [];
  let publications = 0;
  let outputs: string[] = [];
  const report = (
    commits = [headOid],
    status: "pr-created" | "merged" = "pr-created",
    mergeCommit = headOid,
  ) =>
    JSON.stringify({
      status,
      prUrl: url,
      branch,
      commits,
      mergeCommit,
      validation: ["npm test passed"],
      reviewSummary: "reviewed",
      landingDecision: "PR required: policy",
    });
  const runner = createMockRunner(async (call) => {
    assert.equal(call.command, "pi");
    const session = call.args[call.args.indexOf("--session") + 1]!;
    sessions.push(session);
    prompts.push(await readFile(promptPath(call.args), "utf8"));
    const stdout = outputs.shift() ?? report();
    if (!publications) publications++;
    await appendFile(
      session,
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: stdout }],
        },
      }) + "\n",
    );
    events.push(`pi-return:${sessions.length}`);
    return { code: 0, stdout, stderr: "" };
  });
  const adapter = createPlanningImplementationAdapter({
    runner,
    config,
    issue: {
      number: 268,
      title: "OID repair",
      body: "",
      labels: [],
      state: "open",
    },
    labels: [],
    git: { remote: "origin", baseBranch: "main", allowDirectLand: false },
    piAgentDir: join(config.repoRoot, ".patchmill/pi-agent"),
    tokenUsageState: { total: 0 },
    stepAccounting: createStepAccounting({ issueNumber: 268 }),
  });
  const run = (workspaceCreated = true) =>
    runPlanningImplementation({
      ...adapter,
      state,
      phaseIndex: 0,
      lock: {} as never,
      workspaceCreated,
      stateStore: {
        replace: async ({ next }) => {
          state = validatePlanningState(next);
          checkpoints.push(state);
          events.push(`checkpoint:${state.phases[0]!.status}`);
          return state;
        },
      },
      workspaces: {
        inspect: async () => ({
          state: "ready",
          identity: { branch, worktreePath },
          headOid,
          clean: true,
        }),
      },
      git: {
        inspectRemoteHead: async () => ({ state: "present", headOid }),
        assertAncestor: async (operands) => {
          ancestry.push(operands);
          // Match the strict Git boundary without using the new runtime validator.
          if (
            ![operands.ancestorOid, operands.descendantOid].every((oid) =>
              /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(oid),
            )
          )
            throw new PlanningPublicationGitError("ancestry", "invalid-input");
          events.push(
            `ancestry:${operands.ancestorOid}:${operands.descendantOid}`,
          );
        },
      },
      host: {
        id: "github-gh",
        resolveTargetRepositoryIdentity: async () => repository,
        resolveRemoteRepositoryIdentity: async () => repository,
        findPullRequests: async () => (publications ? [pull] : []),
        getPullRequest: async () => {
          events.push("pr-readback");
          return pull;
        },
        createPullRequest: async () => assert.fail("agent already published"),
        readPullRequestBody: async () => pull.body,
        updatePullRequestBody: async () => assert.fail("no body replacement"),
      },
    });
  return {
    run,
    report,
    outputs: (values: string[]) => {
      outputs = values;
    },
    sessions,
    prompts,
    events,
    checkpoints,
    ancestry,
    publications: () => publications,
    state: () => state,
    baseOid,
    headOid,
  };
}

test("repairs abbreviated OIDs before reported-commit ancestry", async (t) => {
  const f = await fixture(t);
  f.outputs([f.report(["a1b2c3d4"]), f.report()]);
  assert.equal((await f.run()).kind, "validated");
  assert.equal(f.sessions.length, 2);
  assert.equal(new Set(f.sessions).size, 1);
  assert.ok(
    f.ancestry.every(
      (p) => p.ancestorOid !== "a1b2c3d4" && p.descendantOid !== "a1b2c3d4",
    ),
  );
  const reportedProof = f.events.indexOf(`ancestry:${f.headOid}:${f.headOid}`);
  assert.ok(reportedProof > f.events.indexOf("pi-return:2"));
});
test("records full OIDs before normal PR validation", async (t) => {
  for (const length of [40, 64]) {
    const f = await fixture(t, length);
    assert.equal((await f.run()).kind, "validated");
    const pushed = f.checkpoints.find(
      (s) => s.phases[0]!.status === "branch-pushed",
    )!.phases[0]!;
    assert.ok(
      pushed.kind === "implementation" && pushed.status === "branch-pushed",
    );
    assert.deepEqual(pushed.implementation.commits, ["b".repeat(length)]);
    assert.ok(
      f.events.indexOf("checkpoint:branch-pushed") <
        f.events.indexOf("pr-readback"),
    );
    assert.ok(
      f.events.indexOf("pr-readback") <
        f.events.indexOf("checkpoint:pull-request-open"),
    );
    assert.equal(f.publications(), 1);
  }
});
test("preserves publication after exhausted OID repair", async (t) => {
  const f = await fixture(t);
  f.outputs(Array(3).fill(f.report(["a1b2c3d4"])));
  const result = await f.run();
  assert.equal(result.kind, "blocked");
  if (result.kind !== "blocked") assert.fail();
  assert.equal(
    result.result.publicFailure?.reason,
    "implementation-validation",
  );
  assert.equal(
    result.result.publicFailure?.diagnosticContext.validationReason,
    "invalid-oid",
  );
  assert.equal(f.sessions.length, 3);
  assert.equal(new Set(f.sessions).size, 1);
  assert.equal(result.state.phases[0]!.status, "workspace-ready");
  assert.equal(result.state.phases[0]!.workspace.headOid, f.headOid);
  assert.ok(
    f.checkpoints.every((s) => s.phases[0]!.status !== "branch-pushed"),
  );
  assert.deepEqual(f.ancestry, [
    { ancestorOid: f.baseOid, descendantOid: f.headOid },
  ]);
  assert.equal(f.publications(), 1);
});
test("reuses the same PR on supported retry", async (t) => {
  const f = await fixture(t);
  f.outputs(Array(3).fill(f.report(["short"])));
  assert.equal((await f.run()).kind, "blocked");
  f.outputs([f.report()]);
  assert.equal((await f.run(false)).kind, "validated");
  assert.ok(
    f.prompts[3]!.includes(`Resume the saved implementation PR: ${url}`),
  );
  assert.ok(f.prompts[3]!.includes(branch));
  assert.equal(f.publications(), 1);
  const phase = f.state().phases[0]!;
  assert.ok(
    phase.kind === "implementation" && phase.status === "pull-request-open",
  );
  assert.equal(phase.pullRequest.url, url);
});
test("keeps PR-only rejection for valid merged results", async (t) => {
  for (const malformed of [false, true]) {
    const f = await fixture(t);
    f.outputs(
      malformed
        ? [
            f.report([f.headOid], "merged", "short"),
            f.report([f.headOid], "merged"),
          ]
        : [f.report([f.headOid], "merged")],
    );
    await assert.rejects(
      f.run(),
      /PR-only publication cannot accept an agent-supplied merge/,
    );
    assert.equal(f.sessions.length, malformed ? 2 : 1);
    assert.ok(
      f.checkpoints.every((s) => s.phases[0]!.status === "workspace-ready"),
    );
    assert.equal(f.publications(), 1);
  }
});
