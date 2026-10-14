import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { runPlanningPhaseArtifacts } from "./planning-phase-artifacts.ts";
import { join } from "node:path";
import test from "node:test";
import {
  planningArtifactRecoveryFixture,
  recoveryGit,
} from "../../../../test-support/run-once/planning-artifact-recovery-fixture.ts";
import { refreshPlanningArtifactEvidence } from "./planning-companion-evidence.ts";
import { runPlanningPhase } from "./planning-phase-runner.ts";
import { verifyPlanningMergedArtifacts } from "./planning-merge-recovery.ts";
import { PlanningPublicationGitError } from "../../../git/planning-publication-git.ts";

for (const kind of ["plan", "implementation"] as const) {
  test(`hydrates old spec companions before ${kind} and retains creation OID`, async (t) => {
    const f = await planningArtifactRecoveryFixture(kind, true);
    t.after(f.dispose);
    await f.commit();
    await runPlanningPhase(f.input);
    const last = f.boundaries.at(-1)?.phases[0];
    assert.ok(last && "artifacts" in last);
    assert.deepEqual(last.artifacts[0]?.companionPaths, [
      "docs/mockups/example.html",
    ]);
    assert.equal(last.artifacts[0]?.commitOid, f.savedHeadOid);
    assert.equal(f.artifactAgentCalls(), 0);
  });
}

for (const kind of ["plan", "implementation"] as const) {
  test(`creation records spec companions and keeps ${kind} plan creation document-only`, async (t) => {
    const f = await planningArtifactRecoveryFixture(kind, true);
    t.after(f.dispose);
    const saved = f.input.state.phases[0];
    assert.ok(saved?.status === "workspace-ready");
    const checkpoints: (typeof saved)[] = [];
    const calls: string[] = [];
    const result = await runPlanningPhaseArtifacts({
      issue: f.input.issue,
      phase: f.input.phase,
      current: {
        ...saved,
        artifacts: [],
        workspace: { ...saved.workspace, headOid: f.base.baseOid },
      },
      repoRoot: f.repo,
      specsDir: "docs/specs",
      plansDir: "docs/plans",
      artifactDate: new Date("2026-10-13"),
      agent: {
        async run({ kind }) {
          calls.push(kind);
          return kind === "spec"
            ? {
                status: "spec-created",
                specPath: f.specPath,
                commit: f.savedHeadOid,
              }
            : {
                status: "plan-created",
                planPath: "docs/plans/2026-10-11-issue-307-original.md",
                commit: await f.commit(),
              };
        },
      },
      git: f.input.publicationGit,
      checkpoint: async (next) => {
        checkpoints.push(next);
      },
      projectPolicy: f.input.config.projectPolicy,
      skills: f.input.config.skills,
      triageLabels: f.input.config.triageLabels,
    });
    assert.equal(result.kind, "workspace-ready");
    assert.deepEqual(calls, ["spec", "plan"]);
    assert.deepEqual(checkpoints[0]?.artifacts[0]?.companionPaths, [
      "docs/mockups/example.html",
    ]);
    assert.equal(checkpoints[1]?.artifacts[1]?.companionPaths, undefined);
  });

  test(`missing immutable companion blocks ${kind} before any agent or checkpoint`, async (t) => {
    const f = await planningArtifactRecoveryFixture(kind, true);
    t.after(f.dispose);
    await rm(join(f.workspace, "docs/mockups/example.html"));
    recoveryGit(f.workspace, "add", "docs/mockups/example.html");
    recoveryGit(f.workspace, "commit", "-m", "remove required companion");
    const saved = f.input.state.phases[0];
    assert.ok(saved?.status === "workspace-ready");
    const head = recoveryGit(f.workspace, "rev-parse", "HEAD");
    const state = {
      ...f.input.state,
      phases: [
        {
          ...saved,
          workspace: { ...saved.workspace, headOid: head },
          artifacts: saved.artifacts.map((artifact) => ({
            ...artifact,
            commitOid: head,
          })),
        },
        ...f.input.state.phases.slice(1),
      ],
    };
    await assert.rejects(
      runPlanningPhase({ ...f.input, state }),
      /non-regular-file/u,
    );
    assert.equal(f.artifactAgentCalls(), 0);
    assert.equal(f.checkpointStates.length, 0);
  });
}

test("refresh rejects stale present evidence but accepts old specs without declarations", async (t) => {
  const f = await planningArtifactRecoveryFixture();
  t.after(f.dispose);
  const phase = f.input.state.phases[0];
  assert.ok(phase && "artifacts" in phase);
  assert.deepEqual(
    (
      await refreshPlanningArtifactEvidence({
        artifacts: phase.artifacts,
        git: f.input.publicationGit,
      })
    )[0]?.companionPaths,
    undefined,
  );
  await assert.rejects(
    refreshPlanningArtifactEvidence({
      artifacts: [
        { ...phase.artifacts[0]!, companionPaths: ["docs/mockups/stale.html"] },
      ],
      git: f.input.publicationGit,
    }),
    /companion-evidence-mismatch/u,
  );
});

test("fetched-base merge proof refreshes declarations and blocks missing companion", async (t) => {
  const f = await planningArtifactRecoveryFixture("implementation", true);
  t.after(f.dispose);
  const phase = f.input.state.phases[0];
  assert.ok(phase && "artifacts" in phase);
  const base = {
    ...f.base,
    baseOid: f.savedHeadOid,
    artifactCandidates: { spec: [f.specPath], plan: [] },
  };
  const result = await verifyPlanningMergedArtifacts({
    mergeOid: f.savedHeadOid,
    artifacts: phase.artifacts,
    base,
    git: f.input.publicationGit,
  });
  assert.equal(result.kind, "verified");
  if (result.kind === "verified")
    assert.deepEqual(result.artifacts[0]?.companionPaths, [
      "docs/mockups/example.html",
    ]);
  await rm(join(f.workspace, "docs/mockups/example.html"));
  recoveryGit(f.workspace, "add", "docs/mockups/example.html");
  recoveryGit(f.workspace, "commit", "-m", "missing companion");
  const broken = {
    ...base,
    baseOid: recoveryGit(f.workspace, "rev-parse", "HEAD"),
  };
  const blocked = await verifyPlanningMergedArtifacts({
    mergeOid: broken.baseOid,
    artifacts: phase.artifacts,
    base: broken,
    git: f.input.publicationGit,
  });
  assert.equal(blocked.kind, "blocked");
  await assert.rejects(
    verifyPlanningMergedArtifacts({
      mergeOid: f.savedHeadOid,
      artifacts: phase.artifacts,
      base,
      git: {
        ...f.input.publicationGit,
        assertAncestor: async () => {
          throw new PlanningPublicationGitError("ancestry", "command-failed");
        },
        inspectArtifactEvidence: async () => assert.fail("must not fallback"),
      },
    }),
    /command-failed/u,
  );
});
