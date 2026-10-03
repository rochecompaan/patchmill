import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { createPlanningProviderScenario } from "../../../../test-support/run-once/planning-provider-scenario.ts";
import { formatTerminalResult } from "./terminal-result.ts";
import { summarizeResult } from "./result-summary.ts";

const artifacts = [
  { path: ".env", contents: "TOKEN=local-only\n" },
  { path: ".pi/todos/issue-262.md", contents: "# local task\n" },
  { path: "build/output.bin", contents: Uint8Array.from([0, 36, 243, 255]) },
  { path: "test-results/result.json", contents: "{}\n" },
  { path: ".unknown/operator.txt", contents: "local\n" },
] as const;

test("implementation cleanup removes ignored worktree content without a pending result", async () => {
  const scenario = await createPlanningProviderScenario({
    provider: "github-gh",
    gates: { specRequired: false, planRequired: false },
    ignoredImplementationArtifacts: artifacts,
  });
  try {
    const result = await scenario.run();
    assert.equal(result.status, "pr-created", JSON.stringify(result));
    assert.deepEqual(scenario.issueSnapshot().labels, ["agent-done"]);
    const state = await scenario.state();
    assert.equal(state?.phases.at(-1)?.status, "complete");
    assert.equal(
      scenario
        .stateHistory()
        .some((snapshot) =>
          snapshot.phases.some(
            (phase) => phase.ownership?.cleanupState === "cleanup-pending",
          ),
        ),
      false,
    );
    assert.equal(
      scenario
        .issueSnapshot()
        .comments?.some((comment) =>
          comment.body.includes("Patchmill cleanup pending"),
        ) ?? false,
      false,
    );
    assert.equal(
      scenario.effects().filter((effect) => effect.operation === "cleanup-hook")
        .length,
      1,
    );
    assert.equal(
      scenario
        .effects()
        .filter((effect) => effect.operation === "workspace-remove").length,
      1,
    );
    assert.equal(
      scenario
        .effects()
        .filter((effect) => effect.operation === "branch-remove").length,
      1,
    );
    const workspace = state?.phases.at(-1)?.workspace;
    assert.ok(workspace);
    await assert.rejects(
      access(
        resolve(
          scenario.invocation().config.repoRoot,
          workspace.identity.worktreePath,
        ),
      ),
      { code: "ENOENT" },
    );
    const branch = workspace.identity.branch;
    const localBranch = await scenario
      .invocation()
      .runner.run(
        "git",
        ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
        { cwd: scenario.invocation().config.repoRoot },
      );
    assert.equal(localBranch.code, 1);
    assert.equal(
      (await scenario.remoteRefs())[branch],
      workspace.cleanup.pushedHeadOid,
    );
    const summary = summarizeResult(result);
    assert.equal("ignoredPaths" in summary, false);
    const redirected = JSON.stringify(summary);
    assert.doesNotMatch(
      redirected,
      /ignoredPaths|remediation|ignored-worktree-content/,
    );
    const terminal = formatTerminalResult(summary, {
      width: 100,
      color: false,
    });
    assert.doesNotMatch(terminal, /Cleanup pending|ignored-worktree-content/);
  } finally {
    await scenario.cleanup();
  }
});
