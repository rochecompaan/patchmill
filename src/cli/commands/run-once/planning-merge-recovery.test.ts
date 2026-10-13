import assert from "node:assert/strict";
import test from "node:test";
import { PlanningPublicationGitError } from "../../../git/planning-publication-git.ts";
import type { PlanningArtifactEvidence } from "../../../workflow/planning-state-types.ts";
import {
  verifyPlanningMergeRecoveryEvidence,
  verifyPlanningMergedArtifacts,
} from "./planning-merge-recovery.ts";

const baseOid = "a".repeat(40);
const mergeOid = "c".repeat(40);
const artifacts: readonly PlanningArtifactEvidence[] = [
  {
    kind: "spec",
    path: "docs/specs/issue-260.md",
    source: "workspace",
    commitOid: "b".repeat(40),
  },
  {
    kind: "plan",
    path: "docs/plans/issue-260.md",
    source: "workspace",
    commitOid: "b".repeat(40),
  },
];
const base = {
  remote: "origin",
  baseBranch: "main",
  baseOid,
  artifactCandidates: {
    spec: [artifacts[0]!.path],
    plan: [artifacts[1]!.path],
  },
};
const refreshed = artifacts.map((artifact) => ({
  ...artifact,
  commitOid: baseOid,
  source: "remote-base" as const,
}));

test("proves merge and fetched trees in order and returns authoritative evidence", async () => {
  const calls: string[] = [];
  const result = await verifyPlanningMergedArtifacts({
    mergeOid,
    artifacts,
    base,
    git: {
      async assertAncestor(value) {
        calls.push(`ancestor:${value.ancestorOid}:${value.descendantOid}`);
      },
      async inspectArtifactEvidence(value) {
        calls.push(`${value.commitOid}:${value.path}`);
        return value;
      },
    },
  });
  assert.deepEqual(calls, [
    `ancestor:${mergeOid}:${baseOid}`,
    `${mergeOid}:docs/specs/issue-260.md`,
    `${mergeOid}:docs/plans/issue-260.md`,
    `${baseOid}:docs/specs/issue-260.md`,
    `${baseOid}:docs/plans/issue-260.md`,
  ]);
  assert.deepEqual(result, {
    kind: "verified",
    evidenceSource: "merge-and-base",
    artifacts: refreshed,
  });
});

test("recovers only typed proof insufficiency", async () => {
  for (const failAt of ["ancestor", "merge", "base"]) {
    let failed = false;
    const result = await verifyPlanningMergedArtifacts({
      mergeOid,
      artifacts,
      base,
      git: {
        async assertAncestor() {
          if (failAt === "ancestor")
            throw new PlanningPublicationGitError("ancestry", "not-ancestor");
        },
        async inspectArtifactEvidence(value) {
          if (
            !failed &&
            ((failAt === "merge" && value.commitOid === mergeOid) ||
              (failAt === "base" && value.commitOid === baseOid))
          ) {
            failed = true;
            throw new PlanningPublicationGitError("tree", "non-regular-file");
          }
          return value;
        },
      },
    });
    assert.deepEqual(result, {
      kind: "verified",
      evidenceSource: "current-base",
      artifacts: refreshed,
    });
  }
});

test("blocks missing ambiguous or renamed candidates before tree inspection", async () => {
  for (const [spec, failure] of [
    [[], "missing"],
    [["docs/specs/a.md", "docs/specs/b.md"], "ambiguous"],
    [["docs/specs/renamed.md"], "path-mismatch"],
  ] as const) {
    const result = await verifyPlanningMergeRecoveryEvidence({
      artifacts,
      base: {
        ...base,
        artifactCandidates: { ...base.artifactCandidates, spec },
      },
      git: {
        async inspectArtifactEvidence() {
          assert.fail("must not inspect");
        },
      },
    });
    assert.equal(result.kind, "blocked");
    if (result.kind === "blocked") assert.equal(result.failure, failure);
  }
});

test("verifies current base in saved order and blocks only typed nonregular errors", async () => {
  const calls: string[] = [];
  const result = await verifyPlanningMergeRecoveryEvidence({
    artifacts,
    base,
    git: {
      async inspectArtifactEvidence(value) {
        calls.push(value.path);
        return value;
      },
    },
  });
  assert.deepEqual(calls, [
    "docs/specs/issue-260.md",
    "docs/plans/issue-260.md",
  ]);
  assert.deepEqual(result, { kind: "verified", artifacts: refreshed });
  const blocked = await verifyPlanningMergeRecoveryEvidence({
    artifacts,
    base,
    git: {
      async inspectArtifactEvidence() {
        throw new PlanningPublicationGitError("tree", "non-regular-file");
      },
    },
  });
  assert.equal(blocked.kind, "blocked");
  if (blocked.kind === "blocked")
    assert.equal(blocked.failure, "non-regular-file");
  for (const error of [
    new PlanningPublicationGitError("tree", "command-failed"),
    new PlanningPublicationGitError("tree", "invalid-input"),
    new PlanningPublicationGitError("tree", "malformed-response"),
    new PlanningPublicationGitError("tree", "invalid-companion"),
    new Error("permission denied"),
  ]) {
    let calls = 0;
    await assert.rejects(
      verifyPlanningMergedArtifacts({
        mergeOid,
        artifacts,
        base,
        git: {
          async assertAncestor() {},
          async inspectArtifactEvidence() {
            calls++;
            throw error;
          },
        },
      }),
      (received) => received === error,
    );
    assert.equal(calls, 1);
    await assert.rejects(
      verifyPlanningMergeRecoveryEvidence({
        artifacts,
        base,
        git: {
          async inspectArtifactEvidence() {
            throw error;
          },
        },
      }),
      (received) => received === error,
    );
  }
});
