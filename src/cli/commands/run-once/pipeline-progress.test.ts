import test from "node:test";
import assert from "node:assert/strict";
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

test("withLogPath enriches results", () => {
  assert.equal(
    withLogPath({ status: "no-issue" }, { logPath: "run.jsonl" }).logPath,
    "run.jsonl",
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
