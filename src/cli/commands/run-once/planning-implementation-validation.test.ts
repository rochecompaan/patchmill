import assert from "node:assert/strict";
import test from "node:test";
import { validatePlanningImplementation } from "./planning-implementation-validation.ts";

const oid = (value: string) => value.repeat(40);
const repository = {
  provider: "github-gh" as const,
  host: "github.com",
  owner: "acme",
  repository: "patchmill",
};
const phase = {
  kind: "implementation" as const,
  status: "branch-pushed" as const,
  base: {
    remote: "origin",
    baseBranch: "main",
    baseOid: oid("a"),
    artifactCandidates: { spec: [], plan: [] },
  },
  workspace: {
    runId: "123e4567-e89b-42d3-a456-426614174000",
    phase: "implementation" as const,
    identity: {
      branch: "planning/implementation",
      worktreePath: ".worktrees/implementation",
    },
    remote: "origin",
    baseBranch: "main",
    baseOid: oid("a"),
    headOid: oid("b"),
    cleanup: { state: "ready" as const },
  },
  artifacts: [],
  publication: {
    targetRepository: repository,
    headRepository: repository,
    baseBranch: "main",
    headBranch: "planning/implementation",
    headOid: oid("b"),
  },
  implementation: {
    status: "pr-created" as const,
    prUrl: "https://github.com/acme/patchmill/pull/189",
    branch: "planning/implementation",
    commits: [oid("b")],
    validation: ["npm test"],
    visualEvidence: [],
  },
};
const state = { issueNumber: 189, phases: [phase] } as never;
function input(status: "open" | "merged" = "open") {
  return {
    state,
    phase,
    workspaces: {
      inspect: async () => ({
        state: "ready" as const,
        identity: phase.workspace.identity,
        headOid: oid("b"),
        clean: true,
      }),
    },
    git: {
      inspectRemoteHead: async () => ({
        state: "present" as const,
        headOid: oid("b"),
      }),
      assertAncestor: async () => {},
    },
    host: {
      id: "github-gh" as const,
      resolveTargetRepositoryIdentity: async () => repository,
      resolveRemoteRepositoryIdentity: async () => repository,
      getPullRequest: async () => ({
        number: 189,
        url: phase.implementation.prUrl,
        targetRepository: repository,
        baseBranch: "main",
        headRepository: repository,
        headBranch: "planning/implementation",
        headSha: oid("b"),
        body: "Closes #189\n\n<!-- patchmill:planning-pr-v1 issue=189 phase=implementation -->",
        ...(status === "open"
          ? { status: "open" as const }
          : { status: "merged" as const, mergeCommit: oid("c") }),
      }),
    },
  };
}

test("validates an exact open implementation pull request before finish", async () => {
  const result = await validatePlanningImplementation(input());
  assert.equal(result.pullRequest.url, phase.implementation.prUrl);
});

test("rejects a trailing-slash agent URL that differs from host readback", async () => {
  const validation = input();
  validation.phase = {
    ...phase,
    implementation: {
      ...phase.implementation,
      prUrl: `${phase.implementation.prUrl}/`,
    },
  };
  await assert.rejects(validatePlanningImplementation(validation), /url/);
});

test("rejects normalized-but-not-persistable host implementation URLs", async () => {
  for (const url of [
    "https://github.com/Acme/Patchmill/pull/189",
    "https://github.com:443/acme/patchmill/pull/189",
  ]) {
    const validation = input();
    validation.host.getPullRequest = async () => ({
      number: 189,
      url,
      targetRepository: repository,
      baseBranch: "main",
      headRepository: repository,
      headBranch: "planning/implementation",
      headSha: oid("b"),
      body: "Closes #189\n\n<!-- patchmill:planning-pr-v1 issue=189 phase=implementation -->",
      status: "open" as const,
    });
    await assert.rejects(validatePlanningImplementation(validation), /url/);
  }
});

test("rejects an implementation marker nested in an HTML comment", async () => {
  const validation = input();
  validation.host.getPullRequest = async () => ({
    number: 189,
    url: phase.implementation.prUrl,
    targetRepository: repository,
    baseBranch: "main",
    headRepository: repository,
    headBranch: "planning/implementation",
    headSha: oid("b"),
    body: "Closes #189\n\n<!--\n<!-- patchmill:planning-pr-v1 issue=189 phase=implementation -->",
    status: "open" as const,
  });
  await assert.rejects(
    validatePlanningImplementation(validation),
    /ownership-marker/,
  );
});

test("rejects an implementation pull request that is not open", async () => {
  await assert.rejects(
    validatePlanningImplementation(input("merged")),
    /status/,
  );
});

test("proves workspace artifact commits from completed planning phases reach final head", async () => {
  const calls: Array<{ ancestorOid: string; descendantOid: string }> = [];
  const validation = input();
  validation.state = {
    issueNumber: 189,
    phases: [
      {
        kind: "spec",
        status: "complete",
        artifacts: [
          {
            kind: "spec",
            path: "docs/specs/issue-189.md",
            source: "workspace",
            commitOid: oid("c"),
          },
        ],
      },
      phase,
    ],
  } as never;
  validation.git.assertAncestor = async (call) => {
    calls.push(call);
  };
  await validatePlanningImplementation(validation);
  assert.deepEqual(calls, [
    { ancestorOid: oid("a"), descendantOid: oid("b") },
    { ancestorOid: oid("a"), descendantOid: oid("b") },
    { ancestorOid: oid("b"), descendantOid: oid("b") },
    { ancestorOid: oid("a"), descendantOid: oid("c") },
    { ancestorOid: oid("c"), descendantOid: oid("b") },
  ]);
});
