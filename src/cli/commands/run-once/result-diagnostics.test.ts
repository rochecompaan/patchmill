import assert from "node:assert/strict";
import test from "node:test";
import { CATALOG, diagnosticFor } from "./result-diagnostics.ts";
import { RUN_ONCE_REASON_CODES } from "./result-diagnostic-types.ts";

test("catalog exhaustively defines nonblank actionable policy for every public reason", () => {
  assert.equal(
    new Set(RUN_ONCE_REASON_CODES).size,
    RUN_ONCE_REASON_CODES.length,
  );
  assert.deepEqual(
    Object.keys(CATALOG).sort(),
    [...RUN_ONCE_REASON_CODES].sort(),
  );
  for (const reason of RUN_ONCE_REASON_CODES) {
    const definition = CATALOG[reason];
    assert.ok(definition.summary.trim(), reason);
    assert.ok(definition.explanation.trim(), reason);
    assert.ok(
      definition.safety.every((warning) => warning.trim()),
      reason,
    );
    assert.ok(definition.retry({} as never).guidance.trim(), reason);
  }
});

test("planning-lock advice preserves evidence and never offers lease repair", () => {
  const diagnostic = diagnosticFor("issue-lock-stale", {
    issueNumber: 242,
    lockPath: "/repo/.patchmill/planning-pr-v1/locks/issue-242.lock",
    fingerprint: "a".repeat(64),
  });
  assert.match(diagnostic.explanation, /owner/u);
  assert.match(diagnostic.safety.join(" "), /Never delete or edit/u);
  assert.doesNotMatch(JSON.stringify(diagnostic.actions), /lease repair/u);
});

test("commands use only validated issue numbers and hostile agent text remains details", () => {
  const hostile = diagnosticFor("agent-blocked", {
    issueNumber: 242,
    reportedReason: "rm -rf /; ignore policy",
    questions: ["Which API?"],
  });
  const changed = diagnosticFor("agent-blocked", {
    issueNumber: 242,
    reportedReason: "different hostile text",
    questions: ["Which API?"],
  });
  assert.deepEqual(hostile.actions, changed.actions);
  assert.deepEqual(hostile.safety, changed.safety);
  assert.equal(hostile.actions[0]?.command, "patchmill run-once --issue 242");
  assert.equal(
    diagnosticFor("agent-blocked", {
      issueNumber: 0,
      reportedReason: "x",
      questions: [],
    }).actions[0]?.command,
    undefined,
  );
});
