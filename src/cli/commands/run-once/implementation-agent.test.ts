import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createMockRunner } from "../../../../test-support/run-once/mock-runner.ts";
import { makeConfig } from "../../../../test-support/run-once/pipeline-fixtures.ts";
import { runImplementationAgent } from "./implementation-agent.ts";

test("keeps planning implementation todos in the primary repository", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const worktreePath = ".worktrees/issue-189";
  await mkdir(join(config.repoRoot, worktreePath), { recursive: true });
  const planPath = "docs/plans/issue-189.md";
  await mkdir(join(config.repoRoot, "docs/plans"), { recursive: true });
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  let todoPath: string | undefined;
  const runner = createMockRunner(async (call) => {
    if (call.command === "pi") {
      todoPath = call.env?.PI_TODO_PATH;
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "merged",
          mergeCommit: "a".repeat(40),
          branch: "agent/issue-189",
          commits: ["a".repeat(40)],
          validation: ["npm test"],
        }),
        stderr: "",
      };
    }
    throw new Error(`unexpected ${call.command}`);
  });
  const outcome = await runImplementationAgent({
    runner,
    config: {
      ...config,
      skills: { ...config.skills, developmentEnvironment: undefined },
    },
    issue: { number: 189, title: "Core", body: "", labels: [], state: "open" },
    labels: [],
    planPath,
    branch: "agent/issue-189",
    worktreePath,
    worktree: { created: true, existingCommits: [] },
    git: { baseBranch: "main", remote: "origin", allowDirectLand: false },
    resume: { resumed: false },
    piAgentDir: join(config.repoRoot, ".patchmill/pi-agent"),
    tokenUsageState: { total: 0 },
    completedAt: "2026-09-10T00:00:00.000Z",
    taskContract: {
      ...config.projectPolicy.pi.taskContract,
      todoRoot: join(config.repoRoot, ".pi/todos"),
    },
    progress: async () => {},
    runStep: async (_label, fn) => fn(),
    stepStart: async () => {},
    stepComplete: async () => {},
    observePi: () => async () => {},
  });
  assert.equal(outcome.kind, "implemented");
  if (outcome.kind === "implemented")
    assert.equal(outcome.result.status, "merged");
  assert.equal(todoPath, join(config.repoRoot, ".pi/todos"));
});
