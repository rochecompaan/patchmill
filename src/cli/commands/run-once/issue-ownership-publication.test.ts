import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { makeConfig } from "../../../../test-support/run-once/pipeline-fixtures.ts";
import { createMockRunner } from "../../../../test-support/run-once/mock-runner.ts";
import { runOneIssue } from "./pipeline.ts";
import {
  acquireIssueRunLease,
  releaseIssueRunLease,
} from "./recovery-lease.ts";
import { summarizeResult } from "./result-summary.ts";
import { exitCodeForRunOnceResult } from "./result-output.ts";

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test(
  "public same-issue contention stays a normal stop during guard publication",
  { timeout: 10_000 },
  async (t) => {
    const config = await makeConfig({
      issueNumber: 226,
      dryRun: false,
      execute: true,
    });
    const lease = await acquireIssueRunLease(config.runStateDir, 226);
    const before = await fs.readFile(lease.path, "utf8");
    const guard = join(config.runStateDir, "locks", "issue-226.lease-guard");
    const paused = barrier(),
      resume = barrier();
    const nativeOpen = fs.open;
    let intercepted = false;
    t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      const handle = await nativeOpen(...args);
      if (String(args[0]).startsWith(guard) && !intercepted) {
        intercepted = true;
        paused.release();
        await resume.promise;
      }
      return handle;
    });
    syncBuiltinESMExports();
    const releasing = Promise.allSettled([releaseIssueRunLease(lease)]);
    try {
      await paused.promise;
      const runner = createMockRunner((call) => {
        throw new Error(`unexpected command: ${call.command}`);
      });
      const result = await runOneIssue(runner, config);
      assert.equal(result.status, "stopped");
      assert.equal(exitCodeForRunOnceResult(summarizeResult(result)), 0);
      assert.match(
        JSON.stringify(summarizeResult(result)),
        /issue already in progress\./u,
      );
      assert.doesNotMatch(
        JSON.stringify(summarizeResult(result)),
        /lease repair/u,
      );
      assert.equal(await fs.readFile(lease.path, "utf8"), before);
      assert.equal(
        runner.calls.some(
          (call) =>
            call.command === "pi" ||
            call.args.includes("--labels") ||
            call.args.includes("comment"),
        ),
        false,
      );
    } finally {
      resume.release();
      await releasing;
      t.mock.restoreAll();
      syncBuiltinESMExports();
      await fs.rm(config.repoRoot, { recursive: true, force: true });
    }
  },
);
