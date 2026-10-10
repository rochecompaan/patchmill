import assert from "node:assert/strict";
import test from "node:test";
import type { RunOnceHostProvider } from "../../../host/types.ts";
import type { IssueSummary, LabelChangePlan } from "../../../issue/types.ts";
import { validatePlanningState } from "../../../workflow/planning-state.ts";
import { reconcilePlanningCleanupPendingPublication } from "./planning-cleanup-pending-reconciliation.ts";

const repository = {
  provider: "github-gh",
  host: "github.com",
  owner: "acme",
  repository: "patchmill",
};
const headOid = "b".repeat(40);
const baseOid = "a".repeat(40);
const ignoredPaths = [".env", "build/output\nname.bin"];
const prUrl = "https://github.com/acme/patchmill/pull/263";
const labels = {
  ready: "ready-for-agent",
  inProgress: "agent-working",
  needsInfo: "operator-input",
};

function fixture(issueLabels = [labels.inProgress]) {
  const state = validatePlanningState({
    version: 1,
    workflowVersion: "planning-pr-v1",
    runId: "123e4567-e89b-42d3-a456-426614174000",
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
        base: {
          remote: "origin",
          baseBranch: "main",
          baseOid,
          artifactCandidates: { spec: [], plan: [] },
        },
        workspace: {
          runId: "123e4567-e89b-42d3-a456-426614174000",
          phase: "implementation",
          identity: { branch: "agent/262", worktreePath: ".worktrees/262" },
          remote: "origin",
          baseBranch: "main",
          baseOid,
          headOid,
          cleanup: {
            state: "cleanup-pending",
            reason: "ignored-worktree-content",
            ignoredPaths,
          },
        },
        artifacts: ["spec", "plan"].map((kind) => ({
          kind,
          path: `docs/${kind}s/issue-262.md`,
          source: "workspace",
          commitOid: headOid,
        })),
        publication: {
          targetRepository: repository,
          headRepository: repository,
          baseBranch: "main",
          headBranch: "agent/262",
          headOid,
        },
        pullRequest: {
          reference: { targetRepository: repository, number: 263 },
          url: prUrl,
        },
        implementation: {
          status: "pr-created",
          prUrl,
          branch: "agent/262",
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
  });
  const issue: IssueSummary = {
    number: 262,
    title: "Cleanup",
    body: "",
    state: "open",
    labels: [...issueLabels],
    comments: [],
  };
  const changes: LabelChangePlan[] = [];
  const comments: string[] = [];
  const writes: string[] = [];
  const host: Pick<
    RunOnceHostProvider,
    "viewIssue" | "applyLabels" | "commentIssue" | "listLabels" | "createLabel"
  > = {
    viewIssue: async () => issue,
    listLabels: async () => [
      { name: labels.needsInfo, color: "ffffff", description: "Input needed" },
    ],
    createLabel: async () => {
      writes.push("create-label");
    },
    commentIssue: async (_number, body) => {
      comments.push(body);
      writes.push("comment");
      issue.comments!.push({ body });
    },
    applyLabels: async (change) => {
      changes.push(change);
      writes.push("labels");
      issue.labels = change.newLabels;
    },
  };
  return {
    state,
    changes,
    comments,
    writes,
    issue,
    input: { state, issue, host, labels, config: {} as never },
  };
}

test("reconciles legacy pending publication with exact saved evidence", async () => {
  const run = fixture();
  const result = await reconcilePlanningCleanupPendingPublication(run.input);
  assert.deepEqual(result, {
    kind: "cleanup-pending",
    state: run.state,
    phase: "implementation",
    reason: "ignored-worktree-content",
    ignoredPaths: [".env", "build/output\nname.bin"],
    prUrl,
  });
  assert.equal(run.comments.length, 1);
  assert.match(run.comments[0]!, /^Patchmill cleanup pending\n/u);
  assert.equal(run.changes.length, 1);
  assert.deepEqual(run.issue.labels, [labels.needsInfo]);
  assert.deepEqual(run.writes, ["comment", "labels"]);
});

test("an eligible legacy pending retry does not republish ignored-content remediation", async () => {
  const run = fixture([labels.ready]);
  const result = await reconcilePlanningCleanupPendingPublication(run.input);
  assert.equal(result, undefined);
  assert.deepEqual(run.writes, []);
  assert.deepEqual(run.comments, []);
  assert.deepEqual(run.changes, []);
  assert.deepEqual(run.issue.labels, [labels.ready]);
});
