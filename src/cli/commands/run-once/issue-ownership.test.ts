import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runOneIssue } from "./pipeline.ts";
import { makeConfig } from "../../../../test-support/run-once/pipeline-fixtures.ts";
import { createMockRunner } from "../../../../test-support/run-once/mock-runner.ts";
import {
  issue,
  issueListPayload,
} from "../../../../test-support/run-once/issue-fixtures.ts";
import { summarizeResult } from "./result-summary.ts";
import { exitCodeForRunOnceResult } from "./result-output.ts";
import {
  IssueRunLeaseConflictError,
  acquireIssueRunLease,
  releaseIssueRunLease,
  withIssueRunLease,
} from "./recovery-lease.ts";

test("explicit facade reports live contention as a normal stop without issue effects", async () => {
  const config = await makeConfig({
    issueNumber: 226,
    dryRun: false,
    execute: true,
  });
  const lease = await acquireIssueRunLease(config.runStateDir, 226);
  const before = await import("node:fs/promises").then((fs) =>
    fs.readFile(lease.path, "utf8"),
  );
  const runner = createMockRunner((call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args.includes("all")
    )
      return {
        code: 0,
        stdout: issueListPayload([issue(226, ["in-progress"])]),
        stderr: "",
      };
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });
  try {
    const result = await runOneIssue(runner, config);
    assert.equal(result.status, "stopped");
    const summary = summarizeResult(result);
    assert.equal(exitCodeForRunOnceResult(summary), 0);
    assert.match(JSON.stringify(summary), /issue already in progress\./u);
    assert.doesNotMatch(JSON.stringify(summary), /lease repair/u);
    assert.equal(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(lease.path, "utf8"),
      ),
      before,
    );
    assert.equal(
      runner.calls.some(
        (call) =>
          call.command === "pi" ||
          call.args[0] === "comment" ||
          call.args.includes("--labels"),
      ),
      false,
    );
  } finally {
    await releaseIssueRunLease(lease);
  }
});

test("explicit facade refuses foreign ownership instead of calling it live contention", async () => {
  const config = await makeConfig({
    issueNumber: 226,
    dryRun: false,
    execute: true,
  });
  const lease = await acquireIssueRunLease(config.runStateDir, 226, {
    hostname: "foreign-host",
  });
  const runner = createMockRunner((call) => {
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });
  try {
    await assert.rejects(
      runOneIssue(runner, config),
      IssueRunLeaseConflictError,
    );
  } finally {
    await releaseIssueRunLease(lease);
  }
});

test("planning and legacy owners share one Issue lease", async () => {
  const runStateDir = await mkdtemp(join(tmpdir(), "issue-ownership-"));
  try {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const planning = withIssueRunLease(
      { runStateDir, issueNumber: 226, ownerToken: "planning" },
      async () => {
        entered();
        await held;
      },
    );
    await started;
    let legacyEffect = false;
    await assert.rejects(
      withIssueRunLease(
        { runStateDir, issueNumber: 226, ownerToken: "legacy" },
        async () => {
          legacyEffect = true;
        },
      ),
      IssueRunLeaseConflictError,
    );
    assert.equal(legacyEffect, false);
    release();
    await planning;
  } finally {
    await rm(runStateDir, { recursive: true, force: true });
  }
});
