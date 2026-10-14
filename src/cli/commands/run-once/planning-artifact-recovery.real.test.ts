import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  planningArtifactRecoveryFixture,
  recoveryGit as git,
} from "../../../../test-support/run-once/planning-artifact-recovery-fixture.ts";
import { runPlanningPhase } from "./planning-phase-runner.ts";
import { planningPhasePlan } from "../../../workflow/planning-pull-requests.ts";
import {
  assertPlanningStateReplacement,
  validatePlanningState,
} from "../../../workflow/planning-state.ts";

const originalPath = "docs/plans/2026-10-11-issue-307-original.md";

for (const kind of ["implementation", "plan"] as const) {
  test(`recovers the original committed plan before ${kind} without another plan agent`, async (t) => {
    const f = await planningArtifactRecoveryFixture(kind);
    t.after(f.dispose);
    const originalOid = await f.commit();
    const before = await f.preservation();
    assert.match(
      git(
        f.workspace,
        "--no-optional-locks",
        "status",
        "--porcelain=v1",
        "--ignored=matching",
      ),
      /!! \.pi\//u,
    );
    validatePlanningState(f.input.state);
    await runPlanningPhase({
      ...f.input,
      phase: planningPhasePlan(f.input.state.gates)[0]!,
    });
    assert.equal(f.artifactAgentCalls(), 0);
    assert.equal(f.checkpointStates.length, 1);
    const checkpoint = f.checkpointStates[0]!;
    const phase = checkpoint.phases[0];
    assert.equal(phase?.status, "workspace-ready");
    if (phase?.status !== "workspace-ready")
      assert.fail("missing recovery checkpoint");
    assert.deepEqual(phase.artifacts, [
      {
        kind: "spec",
        path: f.specPath,
        source: "workspace",
        commitOid: f.savedHeadOid,
      },
      {
        kind: "plan",
        path: originalPath,
        source: "workspace",
        commitOid: originalOid,
      },
    ]);
    assert.equal(phase.workspace.headOid, originalOid);
    assert.equal(phase.workspace.todoRoot, f.todoRoot);
    assert.deepEqual(f.boundaries, [checkpoint]);
    await f.assertPreserved(before);

    await runPlanningPhase({ ...f.input, state: checkpoint });
    assert.equal(f.checkpointStates.length, 1);
    assert.equal(f.artifactAgentCalls(), 0);
    assert.deepEqual(f.boundaries, [checkpoint, checkpoint]);
    await f.assertPreserved(before);
  });
}

for (const condition of [
  "zero candidates",
  "ambiguous candidates",
  "unrelated path",
  "ordinary dirty status",
  "non-descendant",
  "unsafe registration",
  "ownership mismatch",
  "symlink artifact",
  "multiple unrecorded kinds",
] as const) {
  test(`refuses unsafe unrecorded artifact recovery: ${condition}`, async (t) => {
    const f = await planningArtifactRecoveryFixture();
    t.after(f.dispose);
    if (condition === "zero candidates") {
      await f.commit("docs/plans/2026-10-11-issue-3070-other.md");
    } else {
      await f.commit();
    }
    if (condition === "ambiguous candidates")
      await f.commit("docs/plans/2026-10-12-issue-307-duplicate.md");
    if (condition === "unrelated path") {
      await writeFile(
        join(f.workspace, "tracked.txt"),
        "unrelated implementation\n",
      );
      git(f.workspace, "add", "tracked.txt");
      git(f.workspace, "commit", "-m", "unrelated implementation");
    }
    if (condition === "ordinary dirty status")
      await writeFile(
        join(f.workspace, "untracked.txt"),
        "preserve dirty state\n",
      );
    if (condition === "unsafe registration")
      git(f.repo, "worktree", "lock", f.workspace);
    if (condition === "symlink artifact") {
      git(f.workspace, "rm", originalPath);
      await mkdir(join(f.workspace, "docs/plans"), { recursive: true });
      await symlink("../../tracked.txt", join(f.workspace, originalPath));
      git(f.workspace, "add", originalPath);
      git(f.workspace, "commit", "-m", "unsafe symlink");
    }
    const saved = f.input.state.phases[0];
    if (saved?.status !== "workspace-ready")
      assert.fail("missing fixture workspace");
    let input = f.input;
    if (condition === "multiple unrecorded kinds")
      input = {
        ...input,
        state: {
          ...input.state,
          phases: [
            {
              ...saved,
              artifacts: [],
              workspace: { ...saved.workspace, headOid: f.base.baseOid },
            },
          ],
        },
      };
    if (condition === "ownership mismatch")
      input = {
        ...input,
        state: {
          ...input.state,
          phases: [
            {
              ...saved,
              workspace: {
                ...saved.workspace,
                runId: "123e4567-e89b-42d3-a456-426614174001",
              },
            },
          ],
        },
      };
    if (condition === "non-descendant") {
      git(f.repo, "checkout", "--orphan", "unrelated");
      git(f.repo, "commit", "-m", "unrelated root");
      input = {
        ...input,
        state: {
          ...input.state,
          phases: [
            {
              ...saved,
              workspace: {
                ...saved.workspace,
                headOid: git(f.repo, "rev-parse", "HEAD"),
              },
            },
          ],
        },
      };
    }
    const before = await f.preservation();
    if (condition === "ordinary dirty status") {
      const result = await runPlanningPhase(input);
      assert.equal(result.kind, "blocked");
    } else await assert.rejects(() => runPlanningPhase(input));
    assert.equal(f.artifactAgentCalls(), 0);
    assert.equal(f.checkpointStates.length, 0);
    assert.equal(f.boundaries.length, 0);
    await f.assertPreserved(before);
    assert.equal(
      await readFile(join(f.workspace, "tracked.txt"), "utf8"),
      condition === "unrelated path" ? "unrelated implementation\n" : "base\n",
    );
  });
}

test("refuses late HEAD movement before checkpointing a recovered plan", async (t) => {
  const f = await planningArtifactRecoveryFixture();
  t.after(f.dispose);
  await f.commit();
  const real = f.input.publicationGit.verifyArtifactCommit.bind(
    f.input.publicationGit,
  );
  let afterMovement: Awaited<ReturnType<typeof f.preservation>> | undefined;
  f.input.publicationGit.verifyArtifactCommit = async (input) => {
    await real(input);
    git(f.workspace, "commit", "--allow-empty", "-m", "late head movement");
    afterMovement = await f.preservation();
  };
  await assert.rejects(() => runPlanningPhase(f.input), /head-oid-mismatch/u);
  assert.ok(afterMovement);
  await f.assertPreserved(afterMovement);
  assert.equal(f.checkpointStates.length, 0);
  assert.equal(f.artifactAgentCalls(), 0);
  assert.equal(f.boundaries.length, 0);
});

test("refuses late HEAD movement before checkpointing implementation-only recovery", async (t) => {
  const f = await planningArtifactRecoveryFixture();
  t.after(f.dispose);
  await runPlanningPhase({
    ...f.input,
    artifactAgent: {
      run: async () => ({
        status: "plan-created",
        planPath: originalPath,
        commit: await f.commit(),
      }),
    },
  });
  const saved = f.checkpointStates[0]!;
  await writeFile(
    join(f.workspace, "tracked.txt"),
    "implementation progress\n",
  );
  git(f.workspace, "add", "tracked.txt");
  git(f.workspace, "commit", "-m", "implementation progress");
  const real = f.input.publicationGit.assertAncestor.bind(
    f.input.publicationGit,
  );
  let afterMovement: Awaited<ReturnType<typeof f.preservation>> | undefined;
  f.input.publicationGit.assertAncestor = async (input) => {
    await real(input);
    git(f.workspace, "commit", "--allow-empty", "-m", "late head movement");
    afterMovement = await f.preservation();
  };
  await assert.rejects(
    () => runPlanningPhase({ ...f.input, state: saved }),
    /head-oid-mismatch/u,
  );
  assert.ok(afterMovement);
  await f.assertPreserved(afterMovement);
  assert.equal(f.checkpointStates.length, 1);
  assert.equal(f.artifactAgentCalls(), 0);
  assert.equal(f.boundaries.length, 1);
});

test("propagates a recovery checkpoint failure before invoking any agent", async (t) => {
  const f = await planningArtifactRecoveryFixture();
  t.after(f.dispose);
  await f.commit();
  const before = await f.preservation();
  const failure = new Error("checkpoint unavailable");
  await assert.rejects(
    () =>
      runPlanningPhase({
        ...f.input,
        stateStore: {
          replace: async ({ next }) => {
            assertPlanningStateReplacement(f.input.state, next);
            const phase = next.phases[0];
            if (phase?.status !== "workspace-ready")
              assert.fail("missing recovery phase");
            assert.deepEqual(
              phase.artifacts.map((artifact) => artifact.path),
              [f.specPath, originalPath],
            );
            throw failure;
          },
        },
      }),
    (error) => error === failure,
  );
  await f.assertPreserved(before);
  assert.equal(f.artifactAgentCalls(), 0);
  assert.equal(f.boundaries.length, 0);
  assert.equal(f.input.state.revision, 0);
});

test("committed-tree recovery ignores an ignored uncommitted artifact lookalike", async (t) => {
  const f = await planningArtifactRecoveryFixture();
  t.after(f.dispose);
  const headOid = await f.commit();
  const ignoredPath = "docs/plans/2026-10-12-issue-307-ignored.md";
  await writeFile(join(f.repo, ".git/info/exclude"), `${ignoredPath}\n`);
  await writeFile(join(f.workspace, ignoredPath), "ignored lookalike\n");
  assert.deepEqual(
    await f.input.publicationGit.inspectArtifactCandidates({
      commitOid: headOid,
      issueNumber: 307,
      specsDir: "docs/specs",
      plansDir: "docs/plans",
    }),
    { spec: [f.specPath], plan: [originalPath] },
  );
  const before = await f.preservation();
  await runPlanningPhase(f.input);
  await f.assertPreserved(before);
  assert.equal(
    await readFile(join(f.workspace, ignoredPath), "utf8"),
    "ignored lookalike\n",
  );
  assert.equal(f.artifactAgentCalls(), 0);
});

test("discovers current-issue artifacts from the committed tree only", async (t) => {
  const f = await planningArtifactRecoveryFixture();
  t.after(f.dispose);
  const plansDir = "custom plans/nested";
  await mkdir(join(f.workspace, plansDir), { recursive: true });
  const original = `${plansDir}/2026-10-11-issue-307-original.md`;
  await f.commit(original);
  await f.commit(`${plansDir}/2026-10-11-issue-3070-other.md`);
  const headOid = git(f.workspace, "rev-parse", "HEAD");
  const ignored = `${plansDir}/2026-10-12-issue-307-lookalike.md`;
  await writeFile(join(f.repo, ".git/info/exclude"), `${ignored}\n`);
  await writeFile(
    join(f.workspace, ignored),
    "ignored uncommitted lookalike\n",
  );
  const before = await f.preservation();
  assert.deepEqual(
    await f.input.publicationGit.inspectArtifactCandidates({
      commitOid: headOid,
      issueNumber: 307,
      specsDir: "custom specs",
      plansDir: "custom plans",
    }),
    { spec: [], plan: [original] },
  );
  await f.assertPreserved(before);
});

test("recovers an original plan in a configured directory with spaces", async (t) => {
  const f = await planningArtifactRecoveryFixture();
  t.after(f.dispose);
  const plansDir = "custom plans";
  await mkdir(join(f.workspace, plansDir), { recursive: true });
  const original = `${plansDir}/2026-10-11-issue-307-original.md`;
  const originalOid = await f.commit(original);
  const before = await f.preservation();
  await runPlanningPhase({
    ...f.input,
    config: { ...f.input.config, plansDir },
  });
  const recovered = f.checkpointStates[0]?.phases[0];
  assert.ok(recovered && "artifacts" in recovered);
  assert.deepEqual(recovered.artifacts.at(-1), {
    kind: "plan",
    path: original,
    commitOid: originalOid,
    source: "workspace",
  });
  assert.equal(f.artifactAgentCalls(), 0);
  assert.deepEqual(f.boundaries, [f.checkpointStates[0]]);
  await f.assertPreserved(before);
});

test("recovery retains prior artifact evidence in assigned-kind order", async (t) => {
  const f = await planningArtifactRecoveryFixture();
  t.after(f.dispose);
  const spec = {
    kind: "spec" as const,
    path: f.specPath,
    source: "workspace" as const,
    commitOid: f.savedHeadOid,
  };
  const originalOid = await f.commit();
  const before = await f.preservation();
  await runPlanningPhase(f.input);
  const recovered = f.checkpointStates[0]?.phases[0];
  if (recovered?.status !== "workspace-ready")
    assert.fail("missing recovery checkpoint");
  assert.deepEqual(recovered.artifacts, [
    spec,
    {
      kind: "plan",
      path: originalPath,
      source: "workspace",
      commitOid: originalOid,
    },
  ]);
  assert.equal(f.artifactAgentCalls(), 0);
  await f.assertPreserved(before);
});

test("refuses late ordinary dirtiness before checkpointing a recovered plan", async (t) => {
  const f = await planningArtifactRecoveryFixture();
  t.after(f.dispose);
  await f.commit();
  const real = f.input.publicationGit.verifyArtifactCommit.bind(
    f.input.publicationGit,
  );
  const before = await f.preservation();
  f.input.publicationGit.verifyArtifactCommit = async (input) => {
    await real(input);
    await writeFile(
      join(f.workspace, "late-untracked.txt"),
      "late dirty state\n",
    );
  };
  const result = await runPlanningPhase(f.input);
  assert.equal(result.kind, "blocked");
  assert.equal(
    result.state.phases[0]?.workspace.headOid,
    f.input.state.phases[0]?.workspace.headOid,
  );
  await f.assertPreserved(before);
  assert.equal(
    await readFile(join(f.workspace, "late-untracked.txt"), "utf8"),
    "late dirty state\n",
  );
  assert.equal(f.checkpointStates.length, 0);
  assert.equal(f.artifactAgentCalls(), 0);
  assert.equal(f.boundaries.length, 0);
});

test("a fresh saved HEAD still generates its missing plan normally", async (t) => {
  const f = await planningArtifactRecoveryFixture();
  t.after(f.dispose);
  let agentCalls = 0;
  await runPlanningPhase({
    ...f.input,
    artifactAgent: {
      run: async () => {
        agentCalls++;
        const commit = await f.commit();
        return { status: "plan-created", planPath: originalPath, commit };
      },
    },
  });
  assert.equal(agentCalls, 1);
  assert.equal(f.checkpointStates.length, 1);
  assert.equal(f.boundaries.length, 1);
});
