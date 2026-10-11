import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";
import { createPlanningProviderScenario } from "../../../../test-support/run-once/planning-provider-scenario.ts";
import { planningStatePath } from "../../../workflow/planning-state-store.ts";
import { validatePlanningState } from "../../../workflow/planning-state.ts";
import { runOneIssue } from "./pipeline.ts";
import { selectRunOnceWorkflow } from "./planning-selection.ts";

for (const kind of ["spec", "plan", "implementation"] as const) {
  test(`legacy pending cleanup resumes without ready state: ${kind}`, async (t) => {
    const scenario = await createPlanningProviderScenario({
      provider: "github-gh",
      gates: { specRequired: kind === "spec", planRequired: kind === "plan" },
    });
    t.after(scenario.cleanup);
    const { runner, config, now } = scenario.invocation();
    let stopped = false;
    await assert.rejects(() =>
      runOneIssue(
        {
          supportsOwnedGit: true,
          run: async (command, args, options) => {
            if (
              command === "git" &&
              args[0] === "worktree" &&
              args[1] === "remove"
            ) {
              stopped = true;
              await options?.ownedGit?.onStopped(true);
              return { code: 1, stdout: "", stderr: "stop before cleanup" };
            }
            return runner.run(command, args, options);
          },
        },
        config,
        { now },
      ),
    );
    assert.equal(stopped, true);
    const state = await scenario.state();
    assert.ok(state);
    const next = validatePlanningState({
      ...state,
      phases: state.phases.map((phase) => {
        if (phase.kind !== kind || !("workspace" in phase)) return phase;
        return {
          ...phase,
          workspace: {
            ...phase.workspace,
            cleanup: {
              state: "cleanup-pending",
              reason: "ignored-worktree-content",
              ignoredPaths: [".pi/", "node_modules/"],
            },
          },
        };
      }),
    });
    await writeFile(
      planningStatePath(config.runStateDir, 190),
      `${JSON.stringify(next)}\n`,
    );
    assert.equal(
      scenario.issueSnapshot().labels.includes("agent-ready"),
      false,
    );
    const selection = await selectRunOnceWorkflow(
      [scenario.issueSnapshot()],
      config,
      { path: () => "state", read: async () => next },
    );
    assert.equal(selection.kind, "planning");
    const offset = scenario.stateHistory().length;
    const result = await scenario.run();
    assert.equal(
      result.status,
      kind === "implementation" ? "pr-created" : "review-pending",
      JSON.stringify(result),
    );
    const cleanupCheckpoints = scenario
      .stateHistory()
      .slice(offset)
      .flatMap((snapshot) =>
        snapshot.phases
          .filter((phase) => phase.kind === kind)
          .map((phase) => phase.ownership?.cleanupState),
      )
      .filter((state, index, states) => state !== states[index - 1]);
    assert.deepEqual(
      cleanupCheckpoints.filter(
        (state) => state === "worktree-removed" || state === "removed",
      ),
      ["worktree-removed", "removed"],
    );
    assert.equal(scenario.issueSnapshot().labels.includes("needs-info"), false);
    assert.equal(
      scenario
        .issueSnapshot()
        .comments?.filter((comment) =>
          comment.body.includes("Patchmill cleanup pending"),
        ).length,
      0,
    );
  });
}
