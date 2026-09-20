import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import {
  emitSelectionDiagnostics,
  mergeIssueLists,
  selectionDiagnostic,
  selectResumableIssue,
  stringArray,
  visualEvidenceArray,
} from "./pipeline-selection.ts";
import { issue } from "../../../../test-support/run-once/issue-fixtures.ts";
import { collectProgressEvents } from "../../../../test-support/run-once/assertions.ts";
import { makeConfig } from "../../../../test-support/run-once/pipeline-fixtures.ts";
import { writeRunState } from "./run-state.ts";

test("stringArray and visualEvidenceArray validate arrays", () => {
  assert.deepEqual(stringArray(["a"]), ["a"]);
  assert.equal(stringArray(["a", 1]), undefined);
  assert.deepEqual(visualEvidenceArray([{ screenshotPath: "docs/a.png" }]), [
    {
      screenshotPath: "docs/a.png",
      caption: undefined,
      referencePaths: undefined,
      url: undefined,
    },
  ]);
});

test("mergeIssueLists prefers primary entries", () => {
  assert.equal(
    mergeIssueLists(
      [issue(1, ["primary"])],
      [issue(1, ["secondary"]), issue(2, [])],
    )[0]?.labels[0],
    "primary",
  );
});

test("emitSelectionDiagnostics reports rejection reasons", async () => {
  const { events, progress } = collectProgressEvents();
  await emitSelectionDiagnostics(
    [{ issueNumber: 1, reason: "blocking-labels", issue: issue(1, []) }],
    { progress },
    "agent-ready",
  );
  assert.match(events[0]?.message ?? "", /blocking labels/);
});

test("selection diagnostics identify the configured ready label", () => {
  const diagnostic = selectionDiagnostic(
    {
      issueNumber: 1,
      title: "Issue 1",
      state: "open",
      labels: [],
      workflowState: "not-actionable",
      reason: "not-actionable",
    },
    "agent-ready",
  );
  assert.equal(
    diagnostic.details.find((entry) => entry.key === "readyLabel")?.value,
    "agent-ready",
  );
});

test("selectResumableIssue prefers a single resumable in-progress run", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  await mkdir(config.runStateDir, { recursive: true });
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 3,
      title: "Issue 3",
      status: "planning",
      checkpoints: { claimed: true },
    },
    new Date().toISOString(),
  );
  const selected = await selectResumableIssue(
    [issue(3, ["in-progress"])],
    config,
  );
  assert.equal(selected?.issue.number, 3);
  assert.equal(selected?.resumed, true);
});
