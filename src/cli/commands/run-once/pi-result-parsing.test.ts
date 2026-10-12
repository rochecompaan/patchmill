import test from "node:test";
import assert from "node:assert/strict";
import { parseDevelopmentEnvironmentResult, parsePiResult } from "./pi.ts";
import {
  ImplementationOidValidationError,
  IMPLEMENTATION_OID_FORMAT,
} from "./implementation-oid-validation.ts";

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
    `done\n{"status":"merged","branch":"agent/issue-42-add-once-runner-helpers","mergeCommit":"${"a".repeat(40)}","commits":["${"b".repeat(64)}"],"validation":["just issue-runner-test ok"],"reviewSummary":"reviewed","landingDecision":"direct squash-landed: simple localized bug fix"}`,
  );

  assert.deepEqual(result, {
    status: "merged",
    branch: "agent/issue-42-add-once-runner-helpers",
    mergeCommit: "a".repeat(40),
    commits: ["b".repeat(64)],
    validation: ["just issue-runner-test ok"],
    reviewSummary: "reviewed",
    landingDecision: "direct squash-landed: simple localized bug fix",
  });
});

test("parsePiResult extracts visual evidence from a pr-created result", () => {
  const result = parsePiResult(
    `done\n{"status":"pr-created","prUrl":"https://forgejo.example/pulls/42","branch":"agent/issue-42-dashboard","commits":["${"a".repeat(40)}"],"validation":["just playwright-test ok"],"visualEvidence":[{"screenshotPath":"docs/screenshots/dashboard.png","caption":"Dashboard after selecting last 8 weeks","referencePaths":["docs/visual-baselines/web/01-dashboard.png"]}]}`,
  );

  assert.deepEqual(result, {
    status: "pr-created",
    prUrl: "https://forgejo.example/pulls/42",
    branch: "agent/issue-42-dashboard",
    commits: ["a".repeat(40)],
    validation: ["just playwright-test ok"],
    reviewSummary: undefined,
    landingDecision: undefined,
    visualEvidence: [
      {
        screenshotPath: "docs/screenshots/dashboard.png",
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

const sha1 = "a".repeat(40);
const sha256 = "b".repeat(64);
function report(
  status: "pr-created" | "merged",
  fields: Record<string, unknown> = {},
) {
  return JSON.stringify({
    status,
    branch: "agent/268",
    prUrl: "https://github.com/acme/patchmill/pull/268",
    commits: [sha1],
    mergeCommit: sha1,
    ...fields,
  });
}
function rejectsOid(
  stdout: string,
  context: string,
  field: string,
  index?: number,
) {
  assert.throws(
    () => parsePiResult(stdout),
    (error: unknown) => {
      assert.ok(error instanceof ImplementationOidValidationError);
      assert.equal(error.context, context);
      assert.equal(error.field, field);
      assert.equal(error.index, index);
      assert.equal(error.requiredFormat, IMPLEMENTATION_OID_FORMAT);
      if (field === "commits" && index === undefined)
        assert.match(error.message, /non-empty array/);
      return true;
    },
  );
}
test("accepts full implementation OIDs for both statuses", () => {
  for (const status of ["pr-created", "merged"] as const) {
    for (const mergeCommit of [sha1, sha256]) {
      const result = parsePiResult(
        report(status, { commits: [sha1, sha256], mergeCommit }),
      );
      assert.deepEqual(result.commits, [sha1, sha256]);
      if (result.status === "merged")
        assert.equal(result.mergeCommit, mergeCommit);
    }
  }
});
test("rejects malformed implementation OIDs with field locations", () => {
  const invalid = [
    "a1b2c3d4",
    "HEAD",
    ...[39, 41, 63, 65].map((n) => "a".repeat(n)),
    "A".repeat(40),
    "g".repeat(40),
    ` ${sha1}`,
    `${sha1} `,
    `${sha1}\t`,
    `${sha1}\n`,
    "",
  ];
  for (const status of ["pr-created", "merged"] as const) {
    for (const oid of invalid)
      rejectsOid(report(status, { commits: [oid] }), status, "commits", 0);
  }
});
test("rejects the entire invalid commits array", () => {
  for (const status of ["pr-created", "merged"] as const) {
    for (const oid of [123, null, "abc123"])
      rejectsOid(
        report(status, { commits: [sha1, oid] }),
        status,
        "commits",
        1,
      );
  }
});
test("rejects missing empty and non-array implementation commits", () => {
  for (const status of ["pr-created", "merged"] as const) {
    for (const commits of [undefined, [], null, sha1, {}])
      rejectsOid(report(status, { commits }), status, "commits");
  }
});
test("rejects missing and malformed mergeCommit as an OID error", () => {
  for (const mergeCommit of [
    undefined,
    123,
    null,
    "abc123",
    "A".repeat(40),
    ` ${sha1}`,
  ])
    rejectsOid(report("merged", { mergeCommit }), "merged", "mergeCommit");
});
test("preserves planning and blocker parsing compatibility", () => {
  for (const status of ["spec-created", "plan-created"]) {
    const result = parsePiResult(
      JSON.stringify({
        status,
        specPath: "docs/specs/x.md",
        planPath: "docs/plans/x.md",
        commit: "abc123",
      }),
    );
    assert.equal("commit" in result && result.commit, "abc123");
  }
  assert.deepEqual(
    parsePiResult(
      JSON.stringify({
        status: "blocked",
        commits: ["abc123", 123],
        validation: ["ok", null],
      }),
    ),
    {
      status: "blocked",
      reason: "Unknown blocker",
      questions: [],
      commits: ["abc123"],
      validation: ["ok"],
    },
  );
  assert.throws(
    () => parsePiResult('{"status":"unknown"}'),
    /supported final JSON status/,
  );
});
