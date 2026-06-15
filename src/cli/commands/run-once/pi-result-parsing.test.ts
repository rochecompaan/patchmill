import test from "node:test";
import assert from "node:assert/strict";
import { parseDevelopmentEnvironmentResult, parsePiResult } from "./pi.ts";

test("parsePiResult extracts a supported status from fenced JSON output", () => {
  const result = parsePiResult(`planning complete\n\n\`\`\`json
{"status":"plan-created","planPath":"docs/plans/plan.md","commit":"abc123"}
\`\`\``);

  assert.deepEqual(result, {
    status: "plan-created",
    planPath: "docs/plans/plan.md",
    commit: "abc123",
  });
});

test("parsePiResult parses spec-created result", () => {
  assert.deepEqual(
    parsePiResult(
      'spec done\n{"status":"spec-created","specPath":"docs/specs/spec.md","commit":"abc123"}',
    ),
    {
      status: "spec-created",
      specPath: "docs/specs/spec.md",
      commit: "abc123",
    },
  );
});

test("parsePiResult extracts a merged implementation result", () => {
  const result = parsePiResult(
    'done\n{"status":"merged","branch":"agent/issue-42-add-once-runner-helpers","mergeCommit":"abc123","commits":["def456"],"validation":["just issue-runner-test ok"],"reviewSummary":"reviewed","landingDecision":"direct squash-landed: simple localized bug fix"}',
  );

  assert.deepEqual(result, {
    status: "merged",
    branch: "agent/issue-42-add-once-runner-helpers",
    mergeCommit: "abc123",
    commits: ["def456"],
    validation: ["just issue-runner-test ok"],
    reviewSummary: "reviewed",
    landingDecision: "direct squash-landed: simple localized bug fix",
  });
});

test("parsePiResult extracts visual evidence from a pr-created result", () => {
  const result = parsePiResult(
    'done\n{"status":"pr-created","prUrl":"https://forgejo.example/pulls/42","branch":"agent/issue-42-dashboard","commits":["def456"],"validation":["just playwright-test ok"],"visualEvidence":[{"screenshotPath":".tmp/issue-42-dashboard.png","caption":"Dashboard after selecting last 8 weeks","referencePaths":["docs/visual-baselines/web/01-dashboard.png"]}]}',
  );

  assert.deepEqual(result, {
    status: "pr-created",
    prUrl: "https://forgejo.example/pulls/42",
    branch: "agent/issue-42-dashboard",
    commits: ["def456"],
    validation: ["just playwright-test ok"],
    reviewSummary: undefined,
    landingDecision: undefined,
    visualEvidence: [
      {
        screenshotPath: ".tmp/issue-42-dashboard.png",
        caption: "Dashboard after selecting last 8 weeks",
        referencePaths: ["docs/visual-baselines/web/01-dashboard.png"],
      },
    ],
  });
});

test("parsePiResult rejects malformed fenced JSON when no supported final object exists", () => {
  assert.throws(
    () =>
      parsePiResult(`\`\`\`json
{"status":"plan-created","planPath":"docs/plans/plan.md"
\`\`\``),
    /supported final JSON status|final JSON object/,
  );
});

test("parsePiResult rejects unsupported final JSON statuses", () => {
  assert.throws(
    () => parsePiResult('{"status":"unknown"}'),
    /supported final JSON status/,
  );
});

test("parseDevelopmentEnvironmentResult parses ready output", () => {
  assert.deepEqual(
    parseDevelopmentEnvironmentResult(
      'ready\n{"status":"ready","summary":"Tilt ready","evidence":["just tilt-ready passed"],"environment":{"namespace":"issue-84","tiltPort":"10384"}}',
    ),
    {
      status: "ready",
      summary: "Tilt ready",
      evidence: ["just tilt-ready passed"],
      environment: { namespace: "issue-84", tiltPort: "10384" },
    },
  );
});

test("parseDevelopmentEnvironmentResult parses not-ready output", () => {
  assert.deepEqual(
    parseDevelopmentEnvironmentResult(
      'blocked\n{"status":"not-ready","reason":"Kubernetes API unavailable","evidence":["localhost:8080 refused connection"],"remediation":["Run devenv shell -- just tilt-up","Re-run patchmill run-once"]}',
    ),
    {
      status: "not-ready",
      reason: "Kubernetes API unavailable",
      evidence: ["localhost:8080 refused connection"],
      remediation: [
        "Run devenv shell -- just tilt-up",
        "Re-run patchmill run-once",
      ],
    },
  );
});

test("parseDevelopmentEnvironmentResult rejects malformed ready output", () => {
  assert.throws(
    () => parseDevelopmentEnvironmentResult('{"status":"ready"}'),
    /development environment ready result/i,
  );
  assert.throws(
    () =>
      parseDevelopmentEnvironmentResult(
        '{"status":"ready","summary":"Tilt ready","evidence":"passed"}',
      ),
    /development environment ready result/i,
  );
  assert.throws(
    () =>
      parseDevelopmentEnvironmentResult(
        '{"status":"ready","summary":"Tilt ready","evidence":["passed",12]}',
      ),
    /development environment ready result/i,
  );
  assert.throws(
    () =>
      parseDevelopmentEnvironmentResult(
        '{"status":"ready","summary":"Tilt ready","evidence":["passed"],"environment":{"namespace":12}}',
      ),
    /development environment ready result/i,
  );
});

test("parseDevelopmentEnvironmentResult rejects malformed not-ready output", () => {
  assert.throws(
    () => parseDevelopmentEnvironmentResult('{"status":"not-ready"}'),
    /development environment not-ready result/i,
  );
  assert.throws(
    () =>
      parseDevelopmentEnvironmentResult(
        '{"status":"not-ready","reason":"API unavailable","evidence":["failed"],"remediation":"Run setup"}',
      ),
    /development environment not-ready result/i,
  );
});

test("parseDevelopmentEnvironmentResult rejects unsupported development environment statuses", () => {
  assert.throws(
    () => parseDevelopmentEnvironmentResult('{"status":"blocked"}'),
    /supported development environment JSON status/,
  );
});
