import assert from "node:assert/strict";
import test from "node:test";
import { IssueRunLeaseConflictError } from "./recovery-lease.ts";
import { failureForPipelineError } from "./pipeline-error-diagnostics.ts";

test("maps Issue run lease conflicts to an actionable active-run failure", () => {
  const failure = failureForPipelineError(
    new IssueRunLeaseConflictError(
      "/repo/.patchmill/locks/issue-242.lock",
      "lease",
      242,
    ),
  );
  assert.equal(failure.reason, "active-run");
  if (failure.reason === "active-run") {
    assert.equal(
      failure.diagnosticContext.leasePath,
      "/repo/.patchmill/locks/issue-242.lock",
    );
    assert.equal(failure.diagnosticContext.resource, "lease");
  }
});
