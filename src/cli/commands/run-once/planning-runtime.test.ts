import assert from "node:assert/strict";
import test from "node:test";
import { makeConfig } from "../../../../test-support/run-once/pipeline-fixtures.ts";
import { createMockRunner } from "../../../../test-support/run-once/mock-runner.ts";
import { createPlanningRuntime } from "./planning-runtime.ts";

test("constructs a production planning coordinator callback without legacy state wiring", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const runtime = createPlanningRuntime({
    runner: createMockRunner(async () => ({ code: 0, stdout: "", stderr: "" })),
    config,
    issue: {
      number: 189,
      title: "Runtime",
      body: "",
      labels: [],
      state: "open",
    },
    labels: ["agent-ready"],
    readyLabel: "agent-ready",
    inProgressLabel: "agent-in-progress",
    doneLabel: "agent-done",
    needsInfoLabel: "needs-info",
    piAgentDir: ".patchmill/pi-agent",
    tokenUsageState: { total: 0 },
  });
  assert.equal(typeof runtime.coordinate, "function");
});
