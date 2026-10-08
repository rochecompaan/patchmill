import assert from "node:assert/strict";
import test from "node:test";
import { runOneIssue } from "./pipeline.ts";
import { makeConfig } from "../../../../test-support/run-once/pipeline-fixtures.ts";
import { createMockRunner } from "../../../../test-support/run-once/mock-runner.ts";
import {
  issue,
  issueListPayload,
} from "../../../../test-support/run-once/issue-fixtures.ts";

test("explicit facade never lists unrelated open Issues", async () => {
  const config = await makeConfig({
    issueNumber: 17,
    dryRun: false,
    execute: true,
  });
  const requested = issue(17, ["needs-info"]);
  const runner = createMockRunner((call) => {
    if (call.command === "tea" && call.args[0] === "issues") {
      if (call.args[1] === "list" && call.args.includes("--state")) {
        const state = call.args[call.args.indexOf("--state") + 1];
        if (state === "all")
          return { code: 0, stdout: issueListPayload([requested]), stderr: "" };
        throw new Error("unrelated open Issues must not be listed");
      }
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });
  const result = await runOneIssue(runner, config);
  assert.deepEqual(result, { status: "no-issue" });
});
