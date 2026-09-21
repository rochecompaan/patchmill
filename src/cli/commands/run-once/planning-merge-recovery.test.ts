import assert from "node:assert/strict";
import test from "node:test";
import { PlanningPublicationGitError } from "../../../git/planning-publication-git.ts";
import { verifyPlanningMergeRecoveryEvidence } from "./planning-merge-recovery.ts";

const rewrittenBaseOid = "a".repeat(40);
const specArtifact = {
  kind: "spec" as const,
  path: "docs/specs/issue-260.md",
  source: "workspace" as const,
  commitOid: "b".repeat(40),
};
const planArtifact = {
  kind: "plan" as const,
  path: "docs/plans/issue-260.md",
  source: "workspace" as const,
  commitOid: "b".repeat(40),
};
function snapshot(candidates: {
  spec: readonly string[];
  plan: readonly string[];
}) {
  return {
    remote: "origin",
    baseBranch: "main",
    baseOid: rewrittenBaseOid,
    artifactCandidates: candidates,
  };
}

test("blocks missing, ambiguous, and renamed current-base candidates", async () => {
  for (const [name, candidates, failure] of [
    ["missing", [], "missing"],
    [
      "ambiguous",
      ["docs/specs/issue-260.md", "docs/specs/issue-260-copy.md"],
      "ambiguous",
    ],
    ["mismatched", ["docs/specs/issue-260-renamed.md"], "path-mismatch"],
  ] as const) {
    const result = await verifyPlanningMergeRecoveryEvidence({
      artifacts: [specArtifact],
      base: snapshot({ spec: candidates, plan: [] }),
      git: { assertRegularFiles: async () => assert.fail("must not inspect") },
    });
    assert.deepEqual(
      result,
      {
        kind: "blocked",
        failure,
        artifactKinds: ["spec"],
        expectedPaths: [specArtifact.path],
        observedCandidates: candidates,
      },
      name,
    );
  }
});

test("verifies combined artifacts once at the pinned base in saved order", async () => {
  const calls: unknown[] = [];
  const result = await verifyPlanningMergeRecoveryEvidence({
    artifacts: [specArtifact, planArtifact],
    base: snapshot({ spec: [specArtifact.path], plan: [planArtifact.path] }),
    git: {
      async assertRegularFiles(value) {
        calls.push(value);
      },
    },
  });
  assert.deepEqual(calls, [
    {
      commitOid: rewrittenBaseOid,
      paths: [specArtifact.path, planArtifact.path],
    },
  ]);
  assert.deepEqual(result, { kind: "verified" });
});

test("blocks only typed non-regular file errors and preserves hard errors", async () => {
  const nonRegular = new PlanningPublicationGitError(
    "tree",
    "non-regular-file",
  );
  const blocked = await verifyPlanningMergeRecoveryEvidence({
    artifacts: [specArtifact, planArtifact],
    base: snapshot({ spec: [specArtifact.path], plan: [planArtifact.path] }),
    git: {
      assertRegularFiles: async () => {
        throw nonRegular;
      },
    },
  });
  assert.deepEqual(blocked, {
    kind: "blocked",
    failure: "non-regular-file",
    artifactKinds: ["spec", "plan"],
    expectedPaths: [specArtifact.path, planArtifact.path],
    observedCandidates: [specArtifact.path, planArtifact.path],
  });
  for (const error of [
    new PlanningPublicationGitError("tree", "command-failed"),
    new PlanningPublicationGitError("tree", "invalid-input"),
    new PlanningPublicationGitError("tree", "malformed-response"),
    new PlanningPublicationGitError("ancestry", "not-ancestor"),
    new Error("inspection failed"),
  ]) {
    await assert.rejects(
      verifyPlanningMergeRecoveryEvidence({
        artifacts: [specArtifact],
        base: snapshot({ spec: [specArtifact.path], plan: [] }),
        git: {
          assertRegularFiles: async () => {
            throw error;
          },
        },
      }),
      (received) => received === error,
    );
  }
});
