import assert from "node:assert/strict";
import test from "node:test";
import { reconcilePlanningPhase } from "./planning-phase-reconciler.ts";

const oid = "a".repeat(40);
const state = {
  version: 1 as const,
  workflowVersion: "planning-pr-v1" as const,
  runId: "123e4567-e89b-42d3-a456-426614174000",
  issueNumber: 188,
  issueTitle: "Example",
  gates: { specRequired: true, planRequired: false },
  revision: 0,
  createdAt: "2026-09-08T12:00:00.000Z",
  updatedAt: "2026-09-08T12:00:00.000Z",
  phases: [
    {
      kind: "spec" as const,
      status: "complete" as const,
      base: {
        remote: "origin",
        baseBranch: "main",
        baseOid: oid,
        artifactCandidates: { spec: ["docs/specs/example.md"], plan: [] },
      },
      artifacts: [
        {
          kind: "spec" as const,
          path: "docs/specs/example.md",
          source: "remote-base" as const,
          commitOid: oid,
        },
      ],
      completion: { kind: "remote-base" as const },
    },
    { kind: "implementation" as const, status: "pending" as const },
  ],
};
test("returns remote-base completion without host or Git effects", async () => {
  const result = await reconcilePlanningPhase({
    state,
    phaseIndex: 0,
    lock: {} as never,
    stateStore: {} as never,
    host: {} as never,
    remoteBase: {} as never,
    git: {} as never,
    workspaces: {} as never,
  });
  assert.equal(result.outcome.kind, "satisfied-by-base");
});
