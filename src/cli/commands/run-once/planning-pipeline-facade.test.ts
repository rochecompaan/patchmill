import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
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
