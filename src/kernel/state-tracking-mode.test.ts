import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { FakeHost, writeFakeHostState } from "../../test-support/fake-host.ts";
import { parseConfig, type PatchmillConfig } from "../config/config.ts";
import { LabelWorkflowState } from "./label-workflow.ts";
import { LocalWorkflowState } from "./local-workflow.ts";
import {
  stateTrackingMode,
  type WorkflowStateInput,
} from "./state-tracking-mode.ts";
import { WORKFLOW_STATUS_TITLES } from "./workflow-state.ts";
import { localWorkSource } from "./runner/local-work-source.ts";

async function input(
  t: TestContext,
  config: PatchmillConfig,
): Promise<WorkflowStateInput> {
  const repoRoot = await fs.mkdtemp(join(tmpdir(), "patchmill-mode-"));
  t.after(() => fs.rm(repoRoot, { recursive: true, force: true }));
  const stateFile = join(repoRoot, "host.json");
  writeFakeHostState(stateFile, { issues: [] });
  return {
    config,
    host: new FakeHost(stateFile),
    repoRoot,
    now: () => new Date(2026, 10, 21),
    warn: () => {},
  };
}

test("labels mode answers from configured labels", async (t) => {
  const config = parseConfig({ labels: { ready: "queue" } });
  const mode = stateTrackingMode(config);
  assert.equal(mode.name, "labels");
  assert.ok(
    mode.createWorkflowState(await input(t, config)) instanceof
      LabelWorkflowState,
  );
  assert.deepEqual(mode.statusTitles(config), config.labels);
  assert.equal(mode.statusTitles(config).ready, "queue");
  assert.deepEqual(mode.labelsSetup, { allowed: true });
  assert.equal(mode.doctorWorkflowCheck, "labels");
  assert.deepEqual(mode.ignoredStatePaths, []);
});

test("local state mode answers from local state", async (t) => {
  const config = parseConfig({ workflow: { stateTracking: "local" } });
  const mode = stateTrackingMode(config);
  assert.equal(mode.name, "local");
  const workflowInput = await input(t, config);
  assert.ok(
    mode.createWorkflowState(workflowInput) instanceof LocalWorkflowState,
  );
  await assert.rejects(
    fs.readdir(join(workflowInput.repoRoot, ".patchmill/state")),
    { code: "ENOENT" },
  );
  assert.deepEqual(mode.statusTitles(config), WORKFLOW_STATUS_TITLES);
  assert.deepEqual(mode.labelsSetup, {
    allowed: false,
    reason: "Local state mode does not use labels.",
  });
  assert.equal(mode.doctorWorkflowCheck, "state");
  assert.deepEqual(mode.ignoredStatePaths, [".patchmill/state/"]);
});

test("labels and local modes allow run with the local work source", () => {
  for (const stateTracking of ["labels", "local"] as const) {
    const mode = stateTrackingMode(
      parseConfig({ workflow: { stateTracking } }),
    );
    assert.equal(mode.run.allowed, true);
    if (mode.run.allowed)
      assert.equal(mode.run.createWorkSource, localWorkSource);
  }
});
