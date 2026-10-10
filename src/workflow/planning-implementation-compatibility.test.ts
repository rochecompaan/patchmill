import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  acquirePlanningIssueLock,
  releasePlanningIssueLock,
} from "./planning-issue-lock.ts";
import { PlanningStateStore } from "./planning-state-store.ts";
import { validatePlanningState } from "./planning-state.ts";

const oid = (value: string) => value.repeat(40);
const repository = {
  provider: "github-gh",
  host: "github.com",
  owner: "test",
  repository: "repo",
};
function oldState(verified = false) {
  const runId = "123e4567-e89b-42d3-a456-426614174000";
  return validatePlanningState({
    version: 1,
    workflowVersion: "planning-pr-v1",
    runId,
    issueNumber: 226,
    issueTitle: "Old completion",
    gates: { specRequired: false, planRequired: false },
    revision: 10,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    phases: [
      {
        kind: "implementation",
        status: "complete",
        base: {
          remote: "origin",
          baseBranch: "main",
          baseOid: oid("a"),
          artifactCandidates: { spec: [], plan: [] },
        },
        workspace: {
          runId,
          phase: "implementation",
          identity: {
            branch: "agent/issue-226",
            worktreePath: ".worktrees/issue-226",
          },
          remote: "origin",
          baseBranch: "main",
          baseOid: oid("a"),
          headOid: oid("b"),
          cleanup: { state: "removed", pushedHeadOid: oid("b") },
        },
        artifacts: ["spec", "plan"].map((kind) => ({
          kind,
          path: `docs/${kind}s/issue-226-${kind}.md`,
          commitOid: oid("b"),
          source: "workspace",
        })),
        publication: {
          targetRepository: repository,
          headRepository: repository,
          baseBranch: "main",
          headBranch: "agent/issue-226",
          headOid: oid("b"),
        },
        pullRequest: {
          reference: { targetRepository: repository, number: 17 },
          url: "https://github.com/test/repo/pull/17",
        },
        implementation: {
          status: "pr-created",
          prUrl: "https://github.com/test/repo/pull/17",
          branch: "agent/issue-226",
          commits: [oid("b")],
          validation: ["npm test passed"],
          visualEvidence: [],
        },
        finish: {
          costPublicationCompleted: true,
          visualEvidenceValidated: true,
          handoffCommentPosted: true,
          cleanupHookCompleted: true,
          doneLabelEnsured: true,
          doneLabelApplied: true,
        },
        completion: { kind: "implementation-pull-request" },
        ...(verified
          ? { merge: { mergeOid: oid("c"), mergedBaseOid: oid("d") } }
          : {}),
      },
    ],
  });
}

test("compatibility recovery archives exact old completion and clears only premature done receipts", async () => {
  const root = await mkdtemp(join(tmpdir(), "planning-compatibility-"));
  const old = oldState();
  const lock = await acquirePlanningIssueLock(root, {
    issueNumber: 226,
    runId: old.runId,
  });
  const store = new PlanningStateStore(root);
  try {
    await store.initialize({ state: old, lock });
    const raw = `${JSON.stringify(old, null, 4)}\n`;
    await writeFile(store.path(226), raw);
    const state = await store.reopenUnverifiedImplementation({
      issueNumber: 226,
      expectedRunId: old.runId,
      expectedRevision: 10,
      lock,
    });
    assert.equal(state.revision, 11);
    assert.equal(state.runId, old.runId);
    const phase = state.phases[0];
    assert.equal(phase?.status, "pull-request-open");
    if (
      !phase ||
      phase.kind !== "implementation" ||
      phase.status !== "pull-request-open"
    )
      assert.fail("owned PR was not reopened");
    assert.deepEqual(phase.publication, old.phases[0]!.publication);
    assert.deepEqual(phase.workspace, old.phases[0]!.workspace);
    assert.deepEqual(phase.finish, {
      costPublicationCompleted: true,
      visualEvidenceValidated: true,
      handoffCommentPosted: true,
      cleanupHookCompleted: true,
    });
    const archive = join(root, "planning-pr-v1", "archive");
    const paths = await readdir(archive);
    assert.equal(paths.length, 1);
    assert.equal(await readFile(join(archive, paths[0]), "utf8"), raw);
  } finally {
    await releasePlanningIssueLock(lock);
    await rm(root, { recursive: true, force: true });
  }
});

test("compatibility recovery never reopens verified completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "planning-verified-"));
  const state = oldState(true);
  const lock = await acquirePlanningIssueLock(root, {
    issueNumber: 226,
    runId: state.runId,
  });
  const store = new PlanningStateStore(root);
  try {
    await store.initialize({ state, lock });
    const before = await readFile(store.path(226), "utf8");
    await assert.rejects(
      store.reopenUnverifiedImplementation({
        issueNumber: 226,
        expectedRunId: state.runId,
        expectedRevision: 10,
        lock,
      }),
      /not-unverified-implementation/u,
    );
    assert.equal(await readFile(store.path(226), "utf8"), before);
  } finally {
    await releasePlanningIssueLock(lock);
    await rm(root, { recursive: true, force: true });
  }
});
