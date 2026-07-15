import test from "node:test";
import assert from "node:assert/strict";
import { runOneIssue } from "./pipeline.ts";
import { makeConfig } from "../../../../test-support/run-once/pipeline-fixtures.ts";
import { createMockRunner } from "../../../../test-support/run-once/mock-runner.ts";
import {
  issue,
  issueListPayload,
} from "../../../../test-support/run-once/issue-fixtures.ts";

const NOW = new Date("2026-05-09T12:00:00.000Z");

test("runOneIssue facade returns no-issue when no eligible issue exists", async () => {
  const config = await makeConfig();
  const runner = createMockRunner((call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout:
          page === "1" ? issueListPayload([issue(2, ["needs-info"])]) : "[]",
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.deepEqual(result, { status: "no-issue" });
});
