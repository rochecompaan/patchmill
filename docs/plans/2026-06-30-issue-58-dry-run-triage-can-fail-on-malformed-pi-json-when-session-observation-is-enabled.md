# Dry-Run Triage Malformed Pi JSON Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `patchmill triage --dry-run --issue <number>` recover from a
complete preview JSON document followed by trailing Pi runner garbage while
preserving useful errors for genuinely invalid stdout.

**Architecture:** Keep the fix localized in
`src/cli/commands/triage/dry-run-agent.ts`: strict parse direct/fenced JSON
first, then run a narrow brace-depth extraction for a complete top-level object
whose parsed value has a `previews` array. Reuse the existing
`validateTriagePreviewDocument()` path for schema validation, and add bounded
printable stdout snippets only to invalid-JSON parse failures.

**Tech Stack:** Node.js 22 ESM, TypeScript, `node:test`, `node:assert/strict`,
existing Patchmill triage command runner tests.

---

## File Structure

- Modify `src/cli/commands/triage/dry-run-agent.ts`
  - Keep `runTriageDryRunAgent()` read-only and session-observation behavior
    unchanged.
  - Add private helpers near `parseTriagePreviewJson()` for fenced-body
    extraction, complete JSON object candidate scanning, parse-failure position
    extraction, and bounded printable snippets.
  - Update `parseTriagePreviewJson(stdout)` to strict-parse first, recover only
    a complete document with top-level `previews`, then throw the existing
    invalid-JSON prefix with snippet context when recovery fails.
- Modify `src/cli/commands/triage/dry-run-agent.test.ts`
  - Add parser regression tests for trailing `}` recovery and invalid-output
    snippets.
  - Add a runner test proving `runTriageDryRunAgent()` still enables
    `--session-dir` and successfully parses stdout with the extra trailing
    brace.
- No changes to `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, Pi
  dependencies, skill packs, or generated `.pi/todos` files.

## Validation Commands

Run these after the implementation tasks:

```sh
node --test src/cli/commands/triage/dry-run-agent.test.ts src/cli/commands/triage/pipeline.test.ts
npm test
```

No npm dependency metadata changes are planned, so AGENTS.md does not require a
Nix build. If an implementation unexpectedly changes `package.json`,
`package-lock.json`, or `npm-shrinkwrap.json`, also run the repository Nix build
before merge.

## Tasks

### Task 1: Add parser regression tests for recovery and snippets

**Files:**

- Modify: `src/cli/commands/triage/dry-run-agent.test.ts`
- Test: `src/cli/commands/triage/dry-run-agent.test.ts`

- [ ] **Step 1: Add a trailing-garbage parser test next to the existing
      direct/fenced JSON test**

Add this test after `parseTriagePreviewJson extracts direct and fenced JSON`:

```ts
test("parseTriagePreviewJson recovers preview document with trailing extra brace", () => {
  const stdout =
    '{"previews":[{"issueNumber":123,"currentLabels":["enhancement"],"proposedLabels":["enhancement","agent-ready"],"canonicalBucket":"agent-ready","blockedBy":[],"rationale":"Ready for implementation.","wouldComment":null,"wouldClose":false,"questions":[]}]}}';

  assert.deepEqual(parseTriagePreviewJson(stdout), {
    previews: [
      {
        issueNumber: 123,
        currentLabels: ["enhancement"],
        proposedLabels: ["enhancement", "agent-ready"],
        canonicalBucket: "agent-ready",
        blockedBy: [],
        rationale: "Ready for implementation.",
        wouldComment: null,
        wouldClose: false,
        questions: [],
      },
    ],
  });
});
```

- [ ] **Step 2: Add an invalid-output snippet test**

Add this test after the trailing-garbage parser test:

```ts
test("parseTriagePreviewJson reports a bounded stdout snippet when recovery fails", () => {
  const stdout = `${"x".repeat(90)}{"previews":[{"issueNumber":123,]${"y".repeat(90)}`;

  assert.throws(
    () => parseTriagePreviewJson(stdout),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^Pi triage dry-run returned invalid JSON:/);
      assert.match(error.message, /stdout near parse failure:/);
      assert.match(error.message, /"previews"/);
      assert.equal(error.message.includes("x".repeat(90)), false);
      assert.equal(error.message.includes("y".repeat(90)), false);
      return true;
    },
  );
});
```

- [ ] **Step 3: Run the targeted parser tests and verify they fail for the
      expected reason**

Run:

```sh
node --test src/cli/commands/triage/dry-run-agent.test.ts
```

Expected: the new trailing-garbage test fails with the existing
`Unexpected non-whitespace character after JSON` invalid-JSON error, and the new
snippet test fails because the current error has no `stdout near parse failure:`
context.

- [ ] **Step 4: Commit the failing tests**

```sh
git add src/cli/commands/triage/dry-run-agent.test.ts
git commit -m "test: cover dry-run triage malformed pi json"
```

### Task 2: Implement narrow preview JSON extraction and parse-failure snippets

**Files:**

- Modify: `src/cli/commands/triage/dry-run-agent.ts`
- Test: `src/cli/commands/triage/dry-run-agent.test.ts`

- [ ] **Step 1: Add helpers above `parseTriagePreviewJson()`**

Insert this code immediately before `export function parseTriagePreviewJson`:

````ts
const STDOUT_SNIPPET_RADIUS = 80;

function triagePreviewJsonBody(stdout: string): string {
  const trimmed = stdout.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

function hasTopLevelPreviews(
  value: unknown,
): value is RawTriagePreviewDocument {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as Record<string, unknown>).previews)
  );
}

function parseErrorPosition(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const match = error.message.match(/position (\d+)/);
  if (!match) return undefined;
  return Number.parseInt(match[1]!, 10);
}

function printableSnippet(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "�");
}

function stdoutSnippet(stdout: string, position?: number): string {
  const center =
    position === undefined || !Number.isFinite(position)
      ? Math.min(stdout.length, STDOUT_SNIPPET_RADIUS)
      : Math.max(0, Math.min(stdout.length, position));
  const start = Math.max(0, center - STDOUT_SNIPPET_RADIUS);
  const end = Math.min(stdout.length, center + STDOUT_SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < stdout.length ? "…" : "";
  return `${prefix}${printableSnippet(stdout.slice(start, end))}${suffix}`;
}

function recoverPreviewJsonDocument(
  body: string,
): RawTriagePreviewDocument | undefined {
  let inString = false;
  let escaped = false;
  let depth = 0;
  let start = -1;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]!;

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char !== "}") continue;
    if (depth === 0) continue;

    depth -= 1;
    if (depth !== 0 || start < 0) continue;

    try {
      const parsed = JSON.parse(body.slice(start, index + 1)) as unknown;
      if (hasTopLevelPreviews(parsed)) return parsed;
    } catch {
      // Keep scanning for the next complete top-level object candidate.
    }
    start = -1;
  }

  return undefined;
}
````

- [ ] **Step 2: Replace `parseTriagePreviewJson()` with strict-first recovery**

Replace the existing function with:

```ts
export function parseTriagePreviewJson(
  stdout: string,
): RawTriagePreviewDocument {
  const json = triagePreviewJsonBody(stdout);

  try {
    return JSON.parse(json) as RawTriagePreviewDocument;
  } catch (error) {
    const recovered = recoverPreviewJsonDocument(json);
    if (recovered) return recovered;

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Pi triage dry-run returned invalid JSON: ${message}; stdout near parse failure: ${stdoutSnippet(
        json,
        parseErrorPosition(error),
      )}`,
      { cause: error },
    );
  }
}
```

- [ ] **Step 3: Run the parser test file and verify Task 1 tests pass**

Run:

```sh
node --test src/cli/commands/triage/dry-run-agent.test.ts
```

Expected: all tests in `dry-run-agent.test.ts` pass, including direct JSON,
fenced JSON, trailing extra `}`, invalid snippet, and existing validation tests.

- [ ] **Step 4: Commit the implementation**

```sh
git add src/cli/commands/triage/dry-run-agent.ts src/cli/commands/triage/dry-run-agent.test.ts
git commit -m "fix: recover dry-run triage preview json"
```

### Task 3: Prove session-observed dry-run triage parses the recovered preview

**Files:**

- Modify: `src/cli/commands/triage/dry-run-agent.test.ts`
- Test: `src/cli/commands/triage/dry-run-agent.test.ts`

- [ ] **Step 1: Add a focused runner class that returns the observed malformed
      stdout**

Add this class after `RecordingRunner`:

```ts
class TrailingBraceRunner extends RecordingRunner {
  override async run(
    command: string,
    args: string[],
    options: CommandRunOptions = {},
  ) {
    await super.run(command, args, options);
    return {
      code: 0,
      stdout:
        '{"previews":[{"issueNumber":42,"currentLabels":["needs-triage","enhancement"],"proposedLabels":["ready-for-agent","enhancement"],"canonicalBucket":"agent-ready","blockedBy":[],"rationale":"Clear enough for an agent.","wouldComment":"## Agent Brief\\nImplement CSV export.","wouldClose":false,"questions":[]}]}}',
      stderr: "",
    };
  }
}
```

If TypeScript formatting wraps the method signature, keep the same behavior:
record the Pi call by delegating to `super.run()`, then return one preview JSON
document plus one extra trailing `}`.

- [ ] **Step 2: Add the session-observation regression test**

Add this test after
`runTriageDryRunAgent enables session observation for tool-call logging`:

```ts
test("runTriageDryRunAgent parses trailing garbage when session observation is enabled", async () => {
  const runner = new TrailingBraceRunner();

  const previews = await runTriageDryRunAgent(runner, "/repo", {
    issues,
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
    stateMap,
    onToolCall() {},
  });

  assert.equal(previews[0]?.issueNumber, 42);
  assert.equal(previews[0]?.canonicalBucket, "agent-ready");
  const call = runner.calls[0]!;
  const sessionDirIndex = call.args.indexOf("--session-dir");
  assert.notEqual(sessionDirIndex, -1);
  assert.equal(call.args.includes("--no-session"), false);
});
```

- [ ] **Step 3: Run dry-run agent tests**

Run:

```sh
node --test src/cli/commands/triage/dry-run-agent.test.ts
```

Expected: the new session-observation test passes and confirms `--session-dir`
is still used.

- [ ] **Step 4: Commit the session regression test**

```sh
git add src/cli/commands/triage/dry-run-agent.test.ts
git commit -m "test: cover observed dry-run triage preview recovery"
```

### Task 4: Run issue-level validation and prepare for merge

**Files:**

- Verify: `src/cli/commands/triage/dry-run-agent.ts`
- Verify: `src/cli/commands/triage/dry-run-agent.test.ts`
- Verify: repository test suite

- [ ] **Step 1: Run targeted triage parser and pipeline coverage**

Run:

```sh
node --test src/cli/commands/triage/dry-run-agent.test.ts src/cli/commands/triage/pipeline.test.ts
```

Expected: both test files pass. This covers the parser,
`runTriageDryRunAgent()`, and the existing pipeline assertion that dry-run
progress observation enables `--session-dir`.

- [ ] **Step 2: Run the full test suite**

Run:

```sh
npm test
```

Expected: the full Node test suite passes.

- [ ] **Step 3: Check dependency metadata was not changed**

Run:

```sh
git diff -- package.json package-lock.json npm-shrinkwrap.json
```

Expected: no diff. If any of these files changed, revert unintended dependency
changes or run the required Nix build before merge.

- [ ] **Step 4: Commit validation notes if any tracked docs or tests were
      adjusted during validation**

If validation required no further file edits, do not create an empty commit. If
validation exposed a small test-name or formatting fix, commit only that fix:

```sh
git add src/cli/commands/triage/dry-run-agent.ts src/cli/commands/triage/dry-run-agent.test.ts
git commit -m "test: validate dry-run triage json recovery"
```

## Self-Review

- Spec coverage: Task 1 covers the trailing `}` unit test and snippet assertion;
  Task 2 implements strict-first parsing, fenced JSON preservation, narrow
  complete-object recovery, and bounded printable snippets; Task 3 covers
  session observation remaining enabled while parsing recovered previews; Task 4
  covers required validation commands and AGENTS.md dependency/Nix guidance.
- Placeholder scan: the plan includes concrete code snippets, paths, commands,
  expected outcomes, and no TBD-style placeholders.
- Type consistency: helpers return `RawTriagePreviewDocument`, tests import
  existing `CommandRunOptions`, and all new tests call existing exported
  functions without introducing public APIs.
