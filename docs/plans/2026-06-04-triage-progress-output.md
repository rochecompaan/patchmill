# Triage Progress Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print triage progress as each selected issue is completed instead of
waiting until the full triage run finishes.

**Architecture:** Add progress events to the triage pipeline, attach a CLI
reporter in `main.ts`, and change execute mode to triage one issue at a time so
observed changes can be reported immediately. Dry-run keeps the existing batch
preview call but emits each preview through the same formatter.

**Tech Stack:** TypeScript, Node.js test runner, Patchmill CLI command modules.

---

## File map

- Modify: `src/cli/commands/triage/types.ts`
  - Add optional issue URLs.
  - Add triage progress event and handler types.
  - Add `onProgress` to `TriageConfig`.
- Modify: `src/cli/commands/triage/reporting.ts`
  - Preserve optional URL values in preview and observed log entries.
- Modify: `src/cli/commands/triage/main.ts`
  - Replace post-run compact issue output with a progress reporter.
  - Export formatting helpers for focused tests.
- Modify: `src/cli/commands/triage/pipeline.ts`
  - Emit selection and per-issue progress events.
  - Change execute mode to a sequential per-issue loop.
  - Preserve completed entries in failure logs.
- Modify: `src/host/github-gh.ts`
  - Request and parse issue URLs when available.
- Modify: `src/cli/commands/triage/forgejo.ts`
  - Parse `url`/`html_url` fields when `tea` returns them.
- Modify: `src/cli/commands/triage/reporting.test.ts`
  - Assert URLs are carried into log entries.
- Modify: `src/cli/commands/triage/pipeline.test.ts`
  - Assert progress event order, progress formatting, and failure logs.

## Task 1: Add progress and URL types

**Files:**

- Modify: `src/cli/commands/triage/types.ts`

- [ ] **Step 1: Add the type definitions**

In `src/cli/commands/triage/types.ts`, add `url?: string` to `IssueSummary` and
`TriageLogIssueEntry`, then add progress event types before `TriageConfig`.

```ts
export type TriageProgressEvent =
  | { type: "selected"; total: number }
  | {
      type: "issue";
      issue: TriageLogIssueEntry;
      completed: number;
      total: number;
    };

export type TriageProgressHandler = (event: TriageProgressEvent) => void;
```

Update `TriageConfig` with the handler:

```ts
export type TriageConfig = {
  repoRoot: string;
  dryRun: boolean;
  execute: boolean;
  triageThinking: string;
  showHelp?: boolean;
  host: PatchmillHostConfig;
  teaLogin?: string;
  issueNumber?: number;
  limit?: number;
  all?: boolean;
  logDir: string;
  projectPolicy?: PatchmillProjectPolicy;
  triagePolicy?: PatchmillTriagePolicy;
  skills: PatchmillSkillsConfig;
  onProgress?: TriageProgressHandler;
};
```

- [ ] **Step 2: Run the focused type check through tests**

Run: `node --test src/cli/commands/triage/reporting.test.ts`

Expected: PASS. This task only adds optional types and should not change runtime
behavior.

## Task 2: Preserve issue URLs in reporting entries

**Files:**

- Modify: `src/cli/commands/triage/reporting.ts`
- Modify: `src/cli/commands/triage/reporting.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/cli/commands/triage/reporting.test.ts`, update the local `issue` helper
so tests can pass a URL.

```ts
function issue(
  number: number,
  labels: string[],
  comments: unknown[] = [],
  state = "open",
  url?: string,
): IssueSummary {
  return {
    number,
    title: `Issue ${number}`,
    body: "",
    labels,
    state,
    comments,
    ...(url ? { url } : {}),
  };
}
```

Add this test below the existing preview conversion test.

```ts
test("createPreviewEntries includes issue URL when available", () => {
  const previews: TriagePreview[] = [
    {
      issueNumber: 1,
      currentLabels: ["bug"],
      proposedLabels: ["agent-ready", "bug"],
      canonicalBucket: "agent-ready",
      rationale: "Clear enough.",
      wouldComment: null,
      wouldClose: false,
      questions: [],
    },
  ];

  const entries = createPreviewEntries(
    [issue(1, ["bug"], [], "open", "https://example.test/issues/1")],
    previews,
  );

  assert.equal(entries[0]?.url, "https://example.test/issues/1");
});
```

Add this test below the observed changes test.

```ts
test("createObservedChangeEntries includes after snapshot URL", () => {
  const entries = createObservedChangeEntries(
    [issue(1, ["needs-triage"], [], "open", "https://old.test/1")],
    [issue(1, ["agent-ready"], [], "open", "https://new.test/1")],
    stateMap,
  );

  assert.equal(entries[0]?.url, "https://new.test/1");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/cli/commands/triage/reporting.test.ts`

Expected: FAIL because reporting entries do not yet include `url`.

- [ ] **Step 3: Implement URL preservation**

In `createPreviewEntries`, include `url` when the source issue has one.

```ts
return {
  issueNumber: preview.issueNumber,
  title: issue.title,
  ...(issue.url ? { url: issue.url } : {}),
  previousLabels: issue.labels,
  finalLabels: preview.proposedLabels,
  primaryBucket: preview.canonicalBucket,
  rationale: preview.rationale,
  questions: preview.questions,
  comment: preview.wouldComment,
  wouldClose: preview.wouldClose,
  mutationStatus: "preview",
};
```

In `createObservedChangeEntries`, include the after URL, falling back to the
before URL.

```ts
return {
  issueNumber: before.number,
  title: after.title || before.title,
  ...(after.url || before.url ? { url: after.url ?? before.url } : {}),
  previousLabels: before.labels,
  finalLabels: after.labels,
  ...(primaryBucket ? { primaryBucket } : {}),
  questions,
  comment: newComments[0] ?? null,
  ...(newComments.length > 0 ? { addedComments: newComments } : {}),
  previousState: before.state,
  finalState: after.state,
  mutationStatus: "observed",
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/cli/commands/triage/reporting.test.ts`

Expected: PASS.

## Task 3: Add CLI progress formatting

**Files:**

- Modify: `src/cli/commands/triage/main.ts`
- Modify: `src/cli/commands/triage/pipeline.test.ts`

- [ ] **Step 1: Write the failing formatter test**

In `src/cli/commands/triage/pipeline.test.ts`, update the import.

```ts
import {
  createTriageProgressReporter,
  formatProgressIssueLines,
  formatResultLines,
  HELP_TEXT,
} from "./main.ts";
```

Add this test near the existing `formatResultLines` test.

```ts
test("formatProgressIssueLines matches the triage output demo layout", () => {
  const lines = formatProgressIssueLines(
    {
      issueNumber: 879,
      title: "OAuth callback fails in staging",
      url: "https://forgejo.example.com/acme/agibase/issues/879",
      previousLabels: [],
      finalLabels: ["agent-unsuitable"],
      primaryBucket: "agent-unsuitable",
      questions: [],
      comment: [
        "> _This was generated by AI during triage._",
        ">",
        "> This issue is not suitable for an agent because it needs a product decision",
        "> before implementation can begin.",
        "> Please reopen with concrete acceptance criteria if this should be revisited.",
        "> Hidden sixth line.",
      ].join("\n"),
      addedComments: ["comment was added"],
      previousState: "open",
      finalState: "closed",
      mutationStatus: "observed",
    },
    2,
    49,
  );

  assert.deepEqual(lines, [
    "──────────────────────────────────────────────────────────────────────────────",
    "#879 OAuth callback fails in staging",
    "  link: https://forgejo.example.com/acme/agibase/issues/879",
    "  labels: (none) -> agent-unsuitable",
    "  state: open -> closed",
    "  comment added:",
    "  > _This was generated by AI during triage._",
    "  >",
    "  > This issue is not suitable for an agent because it needs a product decision",
    "  > before implementation can begin.",
    "  > Please reopen with concrete acceptance criteria if this should be revisited.",
    "",
    "progress: 2/49 triaged",
    "",
  ]);
});
```

Add a reporter test to verify selected and final output order.

```ts
test("createTriageProgressReporter prints header, issue progress, and footer", () => {
  const output: string[] = [];
  const reporter = createTriageProgressReporter({
    command: "patchmill triage --limit 1",
    writeLine: (line) => output.push(line),
  });

  reporter.onProgress({ type: "selected", total: 1 });
  reporter.onProgress({
    type: "issue",
    completed: 1,
    total: 1,
    issue: {
      issueNumber: 880,
      title: "Cache invalidation flakes in worker",
      url: "https://forgejo.example.com/acme/agibase/issues/880",
      previousLabels: [],
      finalLabels: ["agent-ready"],
      primaryBucket: "agent-ready",
      questions: [],
      comment: null,
      mutationStatus: "observed",
    },
  });
  reporter.finish({
    status: "applied",
    issueCount: 1,
    logPath: ".patchmill/triage-runs/triage.json",
    issues: [],
  });

  assert.deepEqual(output, [
    "> patchmill triage --limit 1",
    "",
    "issues: 1",
    "",
    "──────────────────────────────────────────────────────────────────────────────",
    "#880 Cache invalidation flakes in worker",
    "  link: https://forgejo.example.com/acme/agibase/issues/880",
    "  labels: (none) -> agent-ready",
    "",
    "progress: 1/1 triaged",
    "",
    "agent issue triage: applied",
    "log: .patchmill/triage-runs/triage.json",
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/cli/commands/triage/pipeline.test.ts`

Expected: FAIL because the formatter and reporter are not exported yet.

- [ ] **Step 3: Implement progress formatter and reporter**

In `src/cli/commands/triage/main.ts`, add these helpers above `main`.

```ts
const DIVIDER =
  "──────────────────────────────────────────────────────────────────────────────";

function commandText(args: string[]): string {
  return ["patchmill", "triage", ...args].join(" ").trim();
}

function truncateLines(lines: string[], maxLines: number): string[] {
  return lines.slice(0, maxLines);
}

export function formatProgressIssueLines(
  issue: TriageResult["issues"][number],
  completed: number,
  total: number,
): string[] {
  const lines = [DIVIDER, `#${issue.issueNumber} ${issue.title}`];

  if (issue.url) lines.push(`  link: ${issue.url}`);

  lines.push(
    `  labels: ${formatLabels(issue.previousLabels)} -> ${formatLabels(issue.finalLabels)}`,
  );

  if (
    issue.previousState &&
    issue.finalState &&
    issue.previousState !== issue.finalState
  ) {
    lines.push(`  state: ${issue.previousState} -> ${issue.finalState}`);
  }

  if (issue.comment) {
    lines.push(
      issue.mutationStatus === "observed" ? "  comment added:" : "  comment:",
    );
    lines.push(
      ...truncateLines(issue.comment.split(/\r?\n/u), 5).map(
        (line) => `  ${line}`,
      ),
    );
  }

  lines.push("", `progress: ${completed}/${total} triaged`, "");
  return lines;
}

export function createTriageProgressReporter(options: {
  command: string;
  writeLine: (line: string) => void;
}) {
  return {
    onProgress(event: import("./types.ts").TriageProgressEvent) {
      if (event.type === "selected") {
        options.writeLine(`> ${options.command}`);
        options.writeLine("");
        options.writeLine(`issues: ${event.total}`);
        options.writeLine("");
        return;
      }

      for (const line of formatProgressIssueLines(
        event.issue,
        event.completed,
        event.total,
      )) {
        options.writeLine(line);
      }
    },
    finish(result: TriageResult) {
      options.writeLine(`agent issue triage: ${result.status}`);
      options.writeLine(`log: ${result.logPath}`);
    },
  };
}
```

Update `main` to attach the reporter and stop printing compact post-run issue
lines.

```ts
const reporter = createTriageProgressReporter({
  command: commandText(args),
  writeLine: (line) => console.log(line),
});
const result = await runTriage(createCommandRunner(), {
  ...config,
  onProgress: reporter.onProgress,
});
reporter.finish(result);
return 0;
```

Keep `formatResultLines` exported for compatibility during this task. It can be
removed in a follow-up if no tests or callers use it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/cli/commands/triage/pipeline.test.ts`

Expected: PASS for formatter tests; pipeline progress tests are added later.

## Task 4: Emit dry-run progress events

**Files:**

- Modify: `src/cli/commands/triage/pipeline.ts`
- Modify: `src/cli/commands/triage/pipeline.test.ts`

- [ ] **Step 1: Write the failing dry-run progress test**

Add this test after the existing dry-run pipeline test.

```ts
test("runTriage dry-run emits selected and issue progress events", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const events: string[] = [];
  const runner = createStaticCommandRunner([
    { code: 0, stdout: issueJson, stderr: "" },
    { code: 0, stdout: JSON.stringify([]), stderr: "" },
    noCommentsOutput,
    { code: 0, stdout: needsInfoPreviewJson, stderr: "" },
  ]);

  const result = await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: true,
    execute: false,
    logDir,
    host: DEFAULT_PATCHMILL_CONFIG.host,
    onProgress: (event) => {
      if (event.type === "selected") events.push(`selected:${event.total}`);
      if (event.type === "issue") {
        events.push(
          `issue:${event.completed}/${event.total}:#${event.issue.issueNumber}`,
        );
      }
    },
  });

  assert.equal(result.status, "dry-run");
  assert.deepEqual(events, ["selected:1", "issue:1/1:#1"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
`node --test src/cli/commands/triage/pipeline.test.ts --test-name-pattern 'dry-run emits selected'`

Expected: FAIL because `runTriage` does not emit progress events yet.

- [ ] **Step 3: Emit selected and dry-run issue events**

In `src/cli/commands/triage/pipeline.ts`, emit the selected event immediately
after `const issues = selectIssues(listedIssues, config);` and after the
single-issue not-found guard.

```ts
config.onProgress?.({ type: "selected", total: issues.length });
```

In the dry-run branch, after `const logIssues = createPreviewEntries(...)`, add:

```ts
logIssues.forEach((issue, index) => {
  config.onProgress?.({
    type: "issue",
    issue,
    completed: index + 1,
    total: logIssues.length,
  });
});
```

- [ ] **Step 4: Run focused tests**

Run:
`node --test src/cli/commands/triage/pipeline.test.ts --test-name-pattern 'dry-run emits selected'`

Expected: PASS.

## Task 5: Change execute mode to per-issue progress

**Files:**

- Modify: `src/cli/commands/triage/pipeline.ts`
- Modify: `src/cli/commands/triage/pipeline.test.ts`

- [ ] **Step 1: Write the failing execute progress test**

Add this test after the existing execute-mode test.

```ts
test("runTriage execute emits each issue after its own snapshot", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const events: string[] = [];
  const runner = {
    calls: [] as Array<{ command: string; args: string[]; cwd?: string }>,
    async run(command: string, args: string[], options = {}) {
      runner.calls.push({ command, args: [...args], cwd: options.cwd });

      if (command === "gh" && args.slice(0, 2).join(" ") === "issue list") {
        return {
          code: 0,
          stdout: JSON.stringify([
            {
              number: 1,
              title: "One",
              body: "Broken one",
              state: "OPEN",
              labels: [{ name: "bug" }],
              url: "https://example.test/issues/1",
            },
            {
              number: 2,
              title: "Two",
              body: "Broken two",
              state: "OPEN",
              labels: [{ name: "bug" }],
              url: "https://example.test/issues/2",
            },
          ]),
          stderr: "",
        };
      }

      if (command === "gh" && args.slice(0, 3).join(" ") === "issue view 1") {
        const piCalls = runner.calls.filter(
          (call) => call.command === "pi",
        ).length;
        return {
          code: 0,
          stdout: JSON.stringify({
            number: 1,
            title: "One",
            body: "Broken one",
            state: "OPEN",
            labels: [{ name: piCalls > 0 ? "agent-ready" : "bug" }],
            url: "https://example.test/issues/1",
            comments: [],
          }),
          stderr: "",
        };
      }

      if (command === "gh" && args.slice(0, 3).join(" ") === "issue view 2") {
        const piCalls = runner.calls.filter(
          (call) => call.command === "pi",
        ).length;
        return {
          code: 0,
          stdout: JSON.stringify({
            number: 2,
            title: "Two",
            body: "Broken two",
            state: "OPEN",
            labels: [{ name: piCalls > 1 ? "agent-ready" : "bug" }],
            url: "https://example.test/issues/2",
            comments: [],
          }),
          stderr: "",
        };
      }

      if (command === "pi") {
        return { code: 0, stdout: "triaged", stderr: "" };
      }

      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  };

  const result = await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: false,
    execute: true,
    logDir,
    host: { provider: "github-gh", login: "" },
    onProgress: (event) => {
      if (event.type === "selected") events.push(`selected:${event.total}`);
      if (event.type === "issue") {
        const piCalls = runner.calls.filter(
          (call) => call.command === "pi",
        ).length;
        events.push(
          `issue:${event.completed}/${event.total}:#${event.issue.issueNumber}:pi=${piCalls}`,
        );
      }
    },
  });

  assert.equal(result.status, "applied");
  assert.deepEqual(events, [
    "selected:2",
    "issue:1/2:#1:pi=1",
    "issue:2/2:#2:pi=2",
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
`node --test src/cli/commands/triage/pipeline.test.ts --test-name-pattern 'execute emits each issue'`

Expected: FAIL because execute mode still emits no per-issue progress and uses a
single Pi call.

- [ ] **Step 3: Add helpers for per-issue snapshots**

In `src/cli/commands/triage/pipeline.ts`, add these helpers near
`tryWriteFailureLog`.

```ts
function cloneIssue(issue: IssueSummary): IssueSummary {
  return {
    ...issue,
    labels: [...issue.labels],
    comments: Array.isArray(issue.comments)
      ? [...issue.comments]
      : issue.comments,
  };
}

async function snapshotIssue(
  host: ReturnType<typeof createIssueHostProvider>,
  issueNumber: number,
): Promise<IssueSummary> {
  const afterIssues = await host.listIssuesByNumbers([issueNumber]);
  await host.hydrateIssueComments(afterIssues);
  const after = afterIssues[0];
  if (!after)
    throw new Error(`Missing after snapshot for issue #${issueNumber}`);
  return after;
}
```

- [ ] **Step 4: Replace the execute branch with a per-issue loop**

Replace the execute-mode `beforeIssues` creation through `logIssues` creation
with this loop.

```ts
const beforeIssues = issues.map(cloneIssue);
const logIssues: TriageLogIssueEntry[] = [];

try {
  for (const [index, beforeIssue] of beforeIssues.entries()) {
    await runTriageExecuteAgent(runner, config.repoRoot, {
      issues: [beforeIssue],
      projectPolicy,
      stateMap: triagePolicy.stateMap,
      host: config.host,
      skills: config.skills,
      thinking:
        config.triageThinking ?? DEFAULT_PATCHMILL_CONFIG.pi.triageThinking,
    });

    const afterIssue = await snapshotIssue(host, beforeIssue.number);
    const [entry] = createObservedChangeEntries(
      [beforeIssue],
      [afterIssue],
      triagePolicy.stateMap,
    );
    if (!entry) {
      throw new Error(
        `No observed change entry for issue #${beforeIssue.number}`,
      );
    }

    logIssues.push(entry);
    config.onProgress?.({
      type: "issue",
      issue: entry,
      completed: index + 1,
      total: beforeIssues.length,
    });
  }
} catch (error) {
  await tryWriteFailureLog(config, createdAt, logIssues, error);
  throw error;
}
```

Keep the existing final log write and return, using the accumulated `logIssues`.
Remove the old all-issues `runTriageExecuteAgent` call and all-issues after
snapshot block.

- [ ] **Step 5: Run focused execute test**

Run:
`node --test src/cli/commands/triage/pipeline.test.ts --test-name-pattern 'execute emits each issue'`

Expected: PASS.

## Task 6: Preserve completed entries in failure logs

**Files:**

- Modify: `src/cli/commands/triage/pipeline.test.ts`

- [ ] **Step 1: Write the failure-log test**

Add this test near the existing failure-log tests.

```ts
test("runTriage execute failure log keeps completed issue entries", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  let piCalls = 0;
  const runner = {
    async run(command: string, args: string[]) {
      if (command === "gh" && args.slice(0, 2).join(" ") === "issue list") {
        return {
          code: 0,
          stdout: JSON.stringify([
            { number: 1, title: "One", body: "", state: "OPEN", labels: [] },
            { number: 2, title: "Two", body: "", state: "OPEN", labels: [] },
          ]),
          stderr: "",
        };
      }

      if (command === "gh" && args.slice(0, 3).join(" ") === "issue view 1") {
        return {
          code: 0,
          stdout: JSON.stringify({
            number: 1,
            title: "One",
            body: "",
            state: "OPEN",
            labels: [{ name: piCalls > 0 ? "agent-ready" : "bug" }],
            comments: [],
          }),
          stderr: "",
        };
      }

      if (command === "gh" && args.slice(0, 3).join(" ") === "issue view 2") {
        return {
          code: 0,
          stdout: JSON.stringify({
            number: 2,
            title: "Two",
            body: "",
            state: "OPEN",
            labels: [],
            comments: [],
          }),
          stderr: "",
        };
      }

      if (command === "pi") {
        piCalls += 1;
        return piCalls === 1
          ? { code: 0, stdout: "triaged", stderr: "" }
          : { code: 1, stdout: "", stderr: "second issue exploded" };
      }

      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  };

  await assert.rejects(
    () =>
      runTriage(runner, {
        repoRoot: "/repo",
        dryRun: false,
        execute: true,
        logDir,
        host: { provider: "github-gh", login: "" },
      }),
    /second issue exploded/,
  );

  const files = await readdir(logDir);
  const log = JSON.parse(await readFile(join(logDir, files[0]!), "utf8"));
  assert.equal(log.mode, "execute");
  assert.equal(log.issues.length, 1);
  assert.equal(log.issues[0].issueNumber, 1);
  assert.match(log.error, /second issue exploded/);
});
```

- [ ] **Step 2: Run focused failure test**

Run:
`node --test src/cli/commands/triage/pipeline.test.ts --test-name-pattern 'failure log keeps completed'`

Expected: PASS if Task 5 passed and uses `tryWriteFailureLog` with accumulated
entries.

## Task 7: Populate issue URLs from host providers

**Files:**

- Modify: `src/host/github-gh.ts`
- Modify: `src/cli/commands/triage/forgejo.ts`
- Modify: `src/host/github-gh.test.ts`
- Modify: `src/cli/commands/triage/forgejo.test.ts`

- [ ] **Step 1: Write GitHub URL parsing assertions**

In `src/host/github-gh.test.ts`, update existing issue JSON fixtures used by
list/view tests to include `url: "https://github.example/issues/12"`, then add
an assertion on the parsed issue.

```ts
assert.equal(issues[0]?.url, "https://github.example/issues/12");
```

- [ ] **Step 2: Write Forgejo URL parsing assertions**

In `src/cli/commands/triage/forgejo.test.ts`, update one issue-list fixture to
include `url: "https://forgejo.example/issues/1"` and assert:

```ts
assert.equal(issues[0]?.url, "https://forgejo.example/issues/1");
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
node --test src/host/github-gh.test.ts src/cli/commands/triage/forgejo.test.ts
```

Expected: FAIL because the parsed `IssueSummary` does not include URL yet.

- [ ] **Step 4: Request and parse GitHub URLs**

In `src/host/github-gh.ts`, change the JSON fields.

```ts
const ISSUE_LIST_JSON_FIELDS =
  "number,title,body,state,labels,author,updatedAt,url";
```

In `parseIssuePayload`, add:

```ts
if (typeof issue.url === "string") parsed.url = issue.url;
if (typeof issue.html_url === "string" && !parsed.url) {
  parsed.url = issue.html_url;
}
```

- [ ] **Step 5: Parse Forgejo URLs when present**

In `src/cli/commands/triage/forgejo.ts`, include `url` in the requested fields
if `tea` accepts it in this project version.

```ts
"index,title,body,state,labels,author,updated,comments,url",
```

In the issue parser, build the issue object as a `IssueSummary`, then add URL
fields when present.

```ts
const parsedIssue: IssueSummary = {
  number,
  title: issue.title,
  body: typeof issue.body === "string" ? issue.body : "",
  state: typeof issue.state === "string" ? issue.state : "open",
  labels: labelNames(issue.labels),
  author: authorName(issue.author),
  updated: typeof issue.updated === "string" ? issue.updated : undefined,
  comments: Array.isArray(issue.comments) ? issue.comments : undefined,
};

if (typeof issue.url === "string") parsedIssue.url = issue.url;
if (typeof issue.html_url === "string" && !parsedIssue.url) {
  parsedIssue.url = issue.html_url;
}

return parsedIssue;
```

If `tea` rejects `url` in `--fields` during manual verification, keep parsing
URL when present but revert the field-list change. The progress formatter
already omits missing links.

- [ ] **Step 6: Run host parser tests**

Run:

```bash
node --test src/host/github-gh.test.ts src/cli/commands/triage/forgejo.test.ts
```

Expected: PASS.

## Task 8: Final verification

**Files:**

- No code changes beyond previous tasks.

- [ ] **Step 1: Run focused triage tests**

Run: `npm run test:triage`

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Run formatting check**

Run: `npm run format:check`

Expected: PASS. If it fails only for changed files, run
`npm run format -- src/cli/commands/triage src/host/github-gh.ts docs/specs/2026-06-04-triage-progress-output-design.md docs/plans/2026-06-04-triage-progress-output.md`,
then rerun the check.

- [ ] **Step 4: Run lint**

Run: `npm run lint:ts`

Expected: PASS.

- [ ] **Step 5: Review working tree**

Run: `git status --short`

Expected: only intended source, test, spec, and plan files are modified.
