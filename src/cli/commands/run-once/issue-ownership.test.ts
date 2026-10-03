import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  IssueRunLeaseConflictError,
  withIssueRunLease,
} from "./recovery-lease.ts";

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
