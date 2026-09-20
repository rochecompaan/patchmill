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
    const actions = definition.actions({} as never);
    assert.ok(actions.length, reason);
    assert.ok(
      actions.every((action) => action.description.trim()),
      reason,
    );
    assert.ok(definition.safety.length, reason);
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

test("manual inspection and non-lease recovery diagnostics do not advertise commands", () => {
  for (const reason of [
    "issue-lock-unverifiable",
    "issue-lock-malformed",
  ] as const) {
    assert.equal(
      diagnosticFor(reason, {
        issueNumber: 242,
        lockPath: "/repo/.patchmill/planning-pr-v1/locks/issue-242.lock",
        fingerprint: "a".repeat(64),
      }).actions[0]?.command,
      undefined,
    );
  }
  assert.equal(
    diagnosticFor("active-run", {
      issueNumber: 242,
      resource: "lease-guard",
      leasePath: "/repo/.patchmill/locks/issue-242.lock",
      guidance: [],
    }).actions[0]?.command,
    "patchmill run lease repair --issue 242",
  );
  assert.equal(
    diagnosticFor("active-run", {
      issueNumber: 242,
      resource: "repair-lock",
      leasePath: "/repo/.patchmill/locks/issue-242.repair",
      guidance: [],
    }).actions[0]?.command,
    undefined,
  );
  assert.equal(
    diagnosticFor("active-run", {
      issueNumber: 242,
      resource: "lease",
      leasePath: "/repo/.patchmill/locks/issue-242.lock",
      guidance: [],
    }).actions[0]?.command,
    "patchmill run lease repair --issue 242",
  );
});

test("agent workspace blockers add preservation guidance without changing agent policy", () => {
  const ordinary = diagnosticFor("agent-blocked", {
    issueNumber: 242,
    reportedReason: "Need API choice",
    questions: ["Which API?"],
  });
  const unsafeWorkspace = diagnosticFor("agent-blocked", {
    issueNumber: 242,
    phase: "implementation",
    worktreePath: ".worktrees/issue-242-implementation",
    workspaceRecoveryReason: "dirty",
    reportedReason: "Need API choice",
    questions: ["Which API?"],
  });
  assert.equal(ordinary.actions.length, 1);
  assert.match(
    unsafeWorkspace.actions[1]?.description ?? "",
    /Inspect and preserve the implementation workspace/u,
  );
  assert.match(
    unsafeWorkspace.safety.join(" "),
    /Do not clean, reset, or delete/u,
  );
});

test("environment workspace blockers add preservation guidance", () => {
  const diagnostic = diagnosticFor("development-environment-not-ready", {
    issueNumber: 242,
    phase: "implementation",
    worktreePath: ".worktrees/issue-242-implementation",
    workspaceRecoveryReason: "dirty",
    reportedReason: "Database unavailable",
    evidence: ["Database service is unavailable."],
    reportedRemediation: ["Start the development database."],
  });
  assert.match(
    diagnostic.actions[1]?.description ?? "",
    /Inspect and preserve the implementation workspace/u,
  );
  assert.match(diagnostic.safety.join(" "), /Do not clean, reset, or delete/u);
});

test("ignored workspace diagnostics require the normal retry label", () => {
  const diagnostic = diagnosticFor("ignored-worktree-content", {
    issueNumber: 242,
    ignoredPaths: [".agent/evidence.json"],
  });
  assert.match(
    diagnostic.actions[0]?.description ?? "",
    /apply the normal retry label when required/u,
  );
});

test("unexpected-error action mentions a JSONL log only when retained", () => {
  assert.doesNotMatch(
    diagnosticFor("unexpected-error", { error: "host unavailable" }).actions[0]
      ?.description ?? "",
    /JSONL log/u,
  );
  assert.match(
    diagnosticFor("unexpected-error", {
      error: "host unavailable",
      logPath: "/tmp/run.jsonl",
    }).actions[0]?.description ?? "",
    /JSONL log/u,
  );
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
