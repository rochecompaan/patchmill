import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { planningIssueLockPath } from "../../../workflow/planning-issue-lock.ts";
import { collectProgressEvents } from "../../../../test-support/run-once/assertions.ts";
import {
  issue,
  issueListPayload,
} from "../../../../test-support/run-once/issue-fixtures.ts";
import { createMockRunner } from "../../../../test-support/run-once/mock-runner.ts";
import { makeConfig } from "../../../../test-support/run-once/pipeline-fixtures.ts";
import { runOneIssue } from "./pipeline.ts";

const NOW = new Date("2099-01-01T00:00:00.000Z");

test("planning facade announces an attempt before an active lock stops it", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    planOnly: true,
  });
  const selected = issue(245, ["agent-ready"], "Planning progress");
  const lockPath = planningIssueLockPath(config.runStateDir, selected.number);
  await mkdir(join(config.runStateDir, "planning-pr-v1", "locks"), {
    recursive: true,
  });
  await writeFile(
    lockPath,
    `${JSON.stringify({
      version: 1,
      issueNumber: selected.number,
      runId: "123e4567-e89b-42d3-a456-426614174000",
      ownershipId: "223e4567-e89b-42d3-a456-426614174000",
      pid: process.pid,
      hostname: hostname(),
      acquiredAt: NOW.toISOString(),
    })}\n`,
    "utf8",
  );
  const runner = createMockRunner((call) => {
    if (call.command === "tea" && call.args[0] === "issues") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });
  const { events, progress } = collectProgressEvents();

  try {
    const result = await runOneIssue(runner, config, { now: NOW, progress });

    assert.equal(result.status, "stopped");
    if (result.status === "stopped")
      assert.equal(result.reason, "issue-locked");
    assert.equal(
      runner.calls.some((call) => call.args.includes("edit")),
      false,
    );
    assert.deepEqual(
      events.filter((event) => event.step?.type === "run-start"),
      [
        {
          time: NOW.toISOString(),
          level: "info",
          stage: "run",
          message: "issue #245 · Planning progress",
          issueNumber: 245,
          step: {
            type: "run-start",
            issueNumber: 245,
            title: "Planning progress",
          },
        },
      ],
    );
  } finally {
    await rm(config.repoRoot, { recursive: true, force: true });
  }
});
