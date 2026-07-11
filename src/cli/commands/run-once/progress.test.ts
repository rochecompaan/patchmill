import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConsoleProgressReporter,
  JsonlProgressReporter,
  compositeProgressReporter,
  runLogPath,
} from "./progress.ts";

test("runLogPath creates issue-scoped log paths", () => {
  assert.equal(
    runLogPath("/repo/.patchmill/runs", "2026-05-10T03:12:40.000Z", 33),
    "/repo/.patchmill/runs/issue-33/run-2026-05-10T03-12-40-000Z.jsonl",
  );
});

test("console reporter writes concise messages without agent-issue prefix", () => {
  const lines: string[] = [];
  const reporter = new ConsoleProgressReporter((line) => lines.push(line));

  reporter.event({
    time: "2026-05-10T03:12:40.000Z",
    level: "info",
    stage: "select",
    message: "selected #33",
  });

  assert.deepEqual(lines, ["selected #33"]);
});

test("jsonl reporter writes one JSON object per event", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-issue-progress-"));
  const path = join(dir, "run.jsonl");
  const reporter = new JsonlProgressReporter(path);

  await reporter.event({
    time: "2026-05-10T03:12:40.000Z",
    level: "info",
    stage: "claim",
    message: "claimed issue",
    issueNumber: 33,
  });

  const lines = (await readFile(path, "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).stage, "claim");
});

test("jsonl reporter preserves step completion accounting fields", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-issue-progress-"));
  const path = join(dir, "run.jsonl");
  const reporter = new JsonlProgressReporter(path);

  await reporter.event({
    time: "2026-05-22T10:01:12.000Z",
    level: "info",
    stage: "pi-plan",
    message: "step completed",
    issueNumber: 19,
    step: {
      type: "step-complete",
      label: "create plan",
      taskOutputTokens: 4200,
      totalOutputTokens: 4200,
      toolCalls: 12,
      elapsedSeconds: 72,
    },
    taskOutputTokens: 4200,
    totalOutputTokens: 4200,
    toolCalls: 12,
    elapsedSeconds: 72,
  });

  const [line] = (await readFile(path, "utf8")).trim().split("\n");
  const parsed = JSON.parse(line);
  assert.equal(parsed.step.label, "create plan");
  assert.equal(parsed.taskOutputTokens, 4200);
  assert.equal(parsed.totalOutputTokens, 4200);
  assert.equal(parsed.toolCalls, 12);
  assert.equal(parsed.elapsedSeconds, 72);
});

test("jsonl reporter omits console-only messages", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-issue-progress-"));
  const path = join(dir, "run.jsonl");
  const reporter = new JsonlProgressReporter(path);

  await reporter.event({
    time: "2026-05-10T03:12:40.000Z",
    level: "info",
    stage: "artifact-extraction",
    message: "untrusted artifact author",
    consoleMessage:
      "⚠ found spec artifact from roche, but roche is not a trusted artifact author",
  });

  const [line] = (await readFile(path, "utf8")).trim().split("\n");
  const parsed = JSON.parse(line);
  assert.equal(parsed.consoleMessage, undefined);
  assert.equal(JSON.stringify(parsed).includes("roche"), false);
});

test("composite reporter sends events to all reporters", async () => {
  const seen: string[] = [];
  const reporter = compositeProgressReporter([
    {
      event: (event) => {
        seen.push(`a:${event.stage}`);
      },
    },
    {
      event: (event) => {
        seen.push(`b:${event.stage}`);
      },
    },
  ]);

  await reporter.event({
    time: "2026-05-10T03:12:40.000Z",
    level: "info",
    stage: "select",
    message: "selected",
  });

  assert.deepEqual(seen, ["a:select", "b:select"]);
});
