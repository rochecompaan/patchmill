import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { planningIssueLockPath } from "../../../workflow/planning-issue-lock.ts";
import { planningStatePath } from "../../../workflow/planning-state-store.ts";
import { makeConfig } from "../../../../test-support/run-once/pipeline-fixtures.ts";
import {
  issue,
  issueListPayload,
} from "../../../../test-support/run-once/issue-fixtures.ts";
import { createMockRunner } from "../../../../test-support/run-once/mock-runner.ts";
import { runOneIssue } from "./pipeline.ts";
import { exitCodeForRunOnceResult } from "./result-output.ts";
import { summarizeResult } from "./result-summary.ts";

test("facade dispatches fresh planning selection to the planning lock boundary", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(189, ["agent-ready"], "Fresh planning selection");
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
      acquiredAt: "2026-01-01T00:00:00.000Z",
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
  try {
    const result = await runOneIssue(runner, config);
    assert.equal(result.status, "stopped");
    if (result.status === "stopped")
      assert.equal(result.reason, "issue-locked");
    assert.equal(
      runner.calls.some((call) => call.args.includes("edit")),
      false,
    );
  } finally {
    await rm(config.repoRoot, { recursive: true, force: true });
  }
});

test("facade returns a blocked result for advisory malformed planning state", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(189, ["agent-ready"], "Malformed planning state");
  const statePath = planningStatePath(config.runStateDir, selected.number);
  await mkdir(join(config.runStateDir, "planning-pr-v1", "issues"), {
    recursive: true,
  });
  await writeFile(statePath, "{not-json", "utf8");
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
  try {
    const result = await runOneIssue(runner, config);
    assert.equal(result.status, "blocked");
    if (result.status === "blocked") {
      assert.match(result.reason, /planning-state-invalid/);
      assert.match(result.reason, /invalid-json/);
      assert.match(result.reason, /issue-189\.json/);
    }
    const summary = summarizeResult(result);
    assert.equal(summary.status, "blocked");
    assert.equal(exitCodeForRunOnceResult(summary), 1);
    assert.equal(
      runner.calls.some((call) => call.args.includes("edit")),
      false,
    );
  } finally {
    await rm(config.repoRoot, { recursive: true, force: true });
  }
});
