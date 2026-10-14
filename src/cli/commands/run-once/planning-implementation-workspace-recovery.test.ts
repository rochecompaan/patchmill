import assert from "node:assert/strict";
import test from "node:test";
import { PlanningPublicationGitError } from "../../../git/planning-publication-git.ts";
import { validatePlanningState } from "../../../workflow/planning-state.ts";
import { recoverPostAgentWorkspace } from "./planning-implementation-workspace-recovery.ts";

const oid = (character: string) => character.repeat(40);
const state = validatePlanningState({
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
      status: "workspace-ready",
      base: {
        remote: "origin",
        baseBranch: "main",
        baseOid: oid("a"),
        artifactCandidates: { spec: [], plan: [] },
      },
      workspace: {
        runId: "123e4567-e89b-42d3-a456-426614174000",
        phase: "implementation",
        identity: { branch: "agent/189", worktreePath: ".worktrees/189" },
        remote: "origin",
        baseBranch: "main",
        baseOid: oid("a"),
        headOid: oid("c"),
        cleanup: { state: "ready" },
      },
      artifacts: [],
    },
  ],
});

test("clean rewritten implementation progress is reusable when it still contains the base", async () => {
  const phase = state.phases[0];
  if (phase?.kind !== "implementation" || phase.status !== "workspace-ready")
    assert.fail("invalid fixture");
  const proofs: unknown[] = [];
  const result = await recoverPostAgentWorkspace({
    state,
    phaseIndex: 0,
    phase,
    workspaces: {
      inspect: async () => ({
        state: "ready",
        identity: phase.workspace.identity,
        headOid: oid("b"),
        clean: true,
      }),
    },
    git: {
      assertAncestor: async (proof) => {
        proofs.push(proof);
        if (proof.ancestorOid === oid("c"))
          throw new PlanningPublicationGitError("ancestry", "not-ancestor");
      },
    },
    checkpoint: async (nextPhase) =>
      validatePlanningState({
        ...state,
        revision: 1,
        phases: [nextPhase],
      }),
  });
  assert.equal(result.kind, "safe");
  assert.deepEqual(proofs, [
    { ancestorOid: oid("a"), descendantOid: oid("b") },
  ]);
  assert.equal(result.state.phases[0]?.workspace?.headOid, oid("b"));
});
