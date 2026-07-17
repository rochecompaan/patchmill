import test from "node:test";
import assert from "node:assert/strict";
import { runPiSessionPath } from "./progress.ts";
import {
  createStepAccounting,
  emitSimpleStep,
  progress,
  recordPiObservation,
  withLogPath,
} from "./pipeline-progress.ts";
import { collectProgressEvents } from "../../../../test-support/run-once/assertions.ts";

test("progress emits a timestamped event", async () => {
  const { events, progress: reporter } = collectProgressEvents();
  await progress(
    { progress: reporter, now: new Date("2026-01-01T00:00:00Z") },
    "info",
    "select",
    "hello",
  );
  assert.equal(events[0]?.time, "2026-01-01T00:00:00.000Z");
});

test("emitSimpleStep emits start and complete", async () => {
  const { events, progress: reporter } = collectProgressEvents();
  await emitSimpleStep({ progress: reporter }, 1, "done");
  assert.deepEqual(
    events.map((event) => event.step?.type),
    ["step-start", "step-complete"],
  );
});

test("runPiSessionPath stores session logs beside issue run logs", () => {
  assert.equal(
    runPiSessionPath(".patchmill/runs", "2026-07-16T09:00:00.000Z", 92),
    ".patchmill/runs/issue-92/run-2026-07-16T09-00-00-000Z-pi-sessions",
  );
});

test("withLogPath attaches log and Pi session paths to selected issue results", () => {
  assert.deepEqual(
    withLogPath(
      {
        status: "spec-created",
        issue: { number: 92, title: "Keep Pi session logs", labels: [] },
        specPath: "docs/specs/issue-92.md",
      },
      {
        logPath: ".patchmill/runs/issue-92/run.jsonl",
        piSessionPath: ".patchmill/runs/issue-92/run-x-pi-sessions",
      },
    ),
    {
      status: "spec-created",
      issue: { number: 92, title: "Keep Pi session logs", labels: [] },
      specPath: "docs/specs/issue-92.md",
      logPath: ".patchmill/runs/issue-92/run.jsonl",
      piSessionPath: ".patchmill/runs/issue-92/run-x-pi-sessions",
    },
  );
});

test("step accounting completes an active step when a new one starts", async () => {
  const { events, progress: reporter } = collectProgressEvents();
  const accounting = createStepAccounting({
    progress: reporter,
    issueNumber: 1,
  });
  await accounting.start("a");
  await accounting.start("b");
  assert.deepEqual(
    events.map((event) => event.step?.type),
    ["step-start", "step-complete", "step-start"],
  );
});

test("recordPiObservation emits debug observation data", async () => {
  const { events, progress: reporter } = collectProgressEvents();
  await recordPiObservation({
    progress: reporter,
    issueNumber: 1,
    stage: "pi",
    data: { ok: true },
  });
  assert.equal(events[0]?.message, "pi observation");
});
