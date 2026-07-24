# Run-once PR Cost Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calculate deduplicated per-stage and per-model Pi usage for the
current successful `run-once` execution and publish it as an idempotent cost
section in GitHub and Forgejo/Gitea PR bodies.

**Architecture:** Use a pure aggregation core to parse and deduplicate in-memory
Pi session files, a filesystem shell to take a stable snapshot of the durable
session tree, and a pure Markdown renderer to upsert the generated block. Add
narrow GitHub and Forgejo PR-body adapters, persist validated reports in run
state for recovery, and let the finish stage publish nonfatally before the
existing handoff sequence.

**Tech Stack:** TypeScript on Node.js, `node:test`, `node:assert/strict`, Pi
session JSONL, existing `CommandRunner`, `gh`, `tea`, Prettier, ESLint, and
Markdownlint.

## Global Constraints

- Follow `docs/specs/2026-07-19-run-once-pr-cost-summary-design.md` exactly.
- Report only the current `run-once` execution that produced `pr-created`; never
  accumulate earlier issue runs.
- Prompt tokens equal `usage.input + usage.cacheRead + usage.cacheWrite`.
- Output tokens equal `usage.output`.
- Estimated USD cost equals recorded `usage.cost.total`; never recalculate from
  current prices.
- Deduplicate copied parent history globally by stable session-entry ID and
  attribute it to the earliest session file.
- Group rows by stage and recorded model; add a stage subtotal only when a stage
  used multiple models.
- Include parent and child/subagent JSONL files under the current durable
  session root.
- Treat aggregation, marker, URL, host-read, and host-update failures as
  warnings; a valid PR handoff remains successful.
- Preserve all PR body bytes outside the generated marker block.
- Support both GitHub through `gh` and Forgejo/Gitea through `tea` in the
  initial implementation.
- Do not add dependencies, pricing configuration, a feature toggle, a fallback
  issue comment, or a direct-land report.
- Do not expose prompts, message content, tool calls, credentials, or session
  paths in the PR.
- Keep new production modules focused; prefer the pure-core/filesystem-shell
  split below rather than adding parsing or host commands to `pipeline.ts`.

---

## File structure

### New files

- `src/cli/commands/run-once/run-cost.ts` — report types, strict JSONL
  accounting parser, global entry-ID deduplication, stage/model aggregation, and
  persisted-report validation.
- `src/cli/commands/run-once/run-cost.test.ts` — pure parser, deduplication,
  grouping, validation, and failure tests.
- `src/cli/commands/run-once/run-cost-files.ts` — recursive durable-session
  discovery, session ordering, pre/post manifest stability, and
  filesystem-to-core orchestration.
- `src/cli/commands/run-once/run-cost-files.test.ts` — real temporary-tree and
  injected changing-manifest tests.
- `src/cli/commands/run-once/pr-cost-summary.ts` — pure Markdown rendering,
  escaping, marker validation, append, and replacement.
- `src/cli/commands/run-once/pr-cost-summary.test.ts` — table, subtotal,
  formatting, escaping, and idempotent body-preservation tests.
- `src/host/pull-request-reference.ts` — provider-specific PR-number extraction
  and canonical URL comparison.
- `src/host/pull-request-reference.test.ts` — GitHub/Forgejo URL acceptance and
  malformed URL rejection.
- `src/host/github-pr-body.ts` — structured GitHub PR-body reads and
  temporary-body-file edits.
- `src/host/github-pr-body.test.ts` — GitHub command, payload, URL validation,
  multiline body, and cleanup tests.
- `src/host/forgejo-pr-body.ts` — structured Forgejo API reads and multiline
  `tea pulls edit` updates.
- `src/host/forgejo-pr-body.test.ts` — Forgejo command context, payload, URL
  validation, and update tests.
- `src/cli/commands/run-once/pipeline-run-cost.ts` — fresh-versus-resumed report
  resolution and nonfatal aggregation warnings.
- `src/cli/commands/run-once/pipeline-run-cost.test.ts` — fresh, resumed,
  legacy, merged, and failure-path tests.
- `src/cli/commands/run-once/pr-cost-publication.ts` — host read, pure upsert,
  conditional host update, and updated/unchanged result.
- `src/cli/commands/run-once/pr-cost-publication.test.ts` — changed and
  already-current publication tests.

### Modified files

- `src/host/types.ts` — add `PullRequestBodyHostProvider` and
  `RunOnceHostProvider` capabilities.
- `src/host/github-gh.ts` — delegate PR-body methods to `github-pr-body.ts`.
- `src/host/github-gh.test.ts` — verify the concrete provider exposes the GitHub
  PR-body behavior.
- `src/host/forgejo-tea.ts` — delegate PR-body methods to `forgejo-pr-body.ts`.
- `src/host/forgejo-tea.test.ts` — verify the concrete provider exposes the
  Forgejo PR-body behavior.
- `src/host/factory.ts` — add `createRunOnceHostProvider()` without broadening
  all issue-host consumers.
- `src/host/factory.test.ts` — verify both configured providers satisfy the
  run-once capability.
- `src/cli/commands/run-once/types.ts` — persist `RunCostReport`, add
  `prCostSummaryUpdated`, and carry the optional report through run-state
  updates.
- `src/cli/commands/run-once/run-state.ts` — merge, clear, and serialize the
  implementation-associated report.
- `src/cli/commands/run-once/run-state.test.ts` — report persistence,
  preservation, clearing, and checkpoint tests.
- `src/cli/commands/run-once/pipeline-lifecycle.ts` — treat cost publication as
  a resume-only side effect.
- `src/cli/commands/run-once/pipeline-lifecycle.test.ts` — checkpoint filtering
  coverage.
- `src/cli/commands/run-once/progress.ts` — add the `warning` progress level.
- `src/cli/commands/run-once/pipeline.ts` — create the run-once host, resolve a
  fresh or persisted report, and pass it to finish.
- `src/cli/commands/run-once/pipeline-finish.ts` — persist the report, publish
  before visual-evidence handoff, checkpoint success, and warn nonfatally.
- `src/cli/commands/run-once/pipeline-finish-scenarios.test.ts` — publication,
  recovery, idempotency, warning, and merged-skip scenarios.
- `test-support/run-once/mock-runner.ts` — add a helper that writes priced Pi
  session entries for integration tests.

---

### Task 1: Build the pure run-cost aggregation core

**Files:**

- Create: `src/cli/commands/run-once/run-cost.ts`
- Create: `src/cli/commands/run-once/run-cost.test.ts`

**Interfaces:**

- Consumes: in-memory `RunCostSessionFile[]` values with `relativePath`,
  `startedAtMs`, and complete JSONL `content`.
- Produces: `RunCostModelUsage`, `RunCostStageUsage`, `RunCostReport`,
  `RunCostSessionFile`, `RunCostReportError`, `aggregateRunCost(files)`, and
  `parseRunCostReport(value)`.
- Later tasks rely on `aggregateRunCost()` for filesystem snapshots and
  `parseRunCostReport()` for resumed run state.

- [ ] **Step 1: Write the failing happy-path and copied-history tests**

Create `run-cost.test.ts` with compact session builders and one test that proves
prompt-token math, global deduplication, earliest-stage attribution, two
implementation models, and totals:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { aggregateRunCost, type RunCostSessionFile } from "./run-cost.ts";

type Usage = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  cost: { total: number };
};

function assistant(
  id: string,
  model: string,
  usage: Usage,
): Record<string, unknown> {
  return {
    type: "message",
    id,
    timestamp: "2026-07-19T12:00:00.000Z",
    message: { role: "assistant", model, usage, content: [] },
  };
}

function sessionFile(
  relativePath: string,
  startedAtMs: number,
  entries: Record<string, unknown>[],
): RunCostSessionFile {
  return {
    relativePath,
    startedAtMs,
    content: `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  };
}

const planning = assistant("entry-plan", "gpt-5.5", {
  input: 10,
  cacheRead: 20,
  cacheWrite: 30,
  output: 4,
  cost: { total: 0.1 },
});

const implementationGpt = assistant("entry-impl-gpt", "gpt-5.5", {
  input: 50,
  cacheRead: 50,
  cacheWrite: 50,
  output: 20,
  cost: { total: 0.3 },
});

const implementationTerra = assistant("entry-impl-terra", "gpt-5.6-terra", {
  input: 100,
  cacheRead: 200,
  cacheWrite: 0,
  output: 10,
  cost: { total: 0.4 },
});

test("aggregateRunCost deduplicates copied history and groups stage models", () => {
  const report = aggregateRunCost([
    sessionFile("pi-plan/invocation-a/parent.jsonl", 1, [planning]),
    sessionFile("pi-implementation/invocation-b/child.jsonl", 2, [
      planning,
      implementationGpt,
      implementationTerra,
    ]),
  ]);

  assert.deepEqual(report, {
    stages: [
      {
        stage: "pi-plan",
        models: [
          {
            model: "gpt-5.5",
            promptTokens: 60,
            outputTokens: 4,
            estimatedCostUsd: 0.1,
          },
        ],
        promptTokens: 60,
        outputTokens: 4,
        estimatedCostUsd: 0.1,
      },
      {
        stage: "pi-implementation",
        models: [
          {
            model: "gpt-5.5",
            promptTokens: 150,
            outputTokens: 20,
            estimatedCostUsd: 0.3,
          },
          {
            model: "gpt-5.6-terra",
            promptTokens: 300,
            outputTokens: 10,
            estimatedCostUsd: 0.4,
          },
        ],
        promptTokens: 450,
        outputTokens: 30,
        estimatedCostUsd: 0.7,
      },
    ],
    promptTokens: 510,
    outputTokens: 34,
    estimatedCostUsd: 0.8,
  });
});
```

- [ ] **Step 2: Run the focused test and verify the missing module failure**

Run:

```sh
node --test src/cli/commands/run-once/run-cost.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `./run-cost.ts`.

- [ ] **Step 3: Implement the report types and strict unique-entry reducer**

Create `run-cost.ts` with this exact public surface:

```ts
export type RunCostModelUsage = {
  model: string;
  promptTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};

export type RunCostStageUsage = {
  stage: string;
  models: RunCostModelUsage[];
  promptTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};

export type RunCostReport = {
  stages: RunCostStageUsage[];
  promptTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};

export type RunCostSessionFile = {
  relativePath: string;
  startedAtMs: number;
  content: string;
};

export class RunCostReportError extends Error {
  readonly name = "RunCostReportError";
}

export function aggregateRunCost(files: RunCostSessionFile[]): RunCostReport;
export function parseRunCostReport(value: unknown): RunCostReport | undefined;
```

Implement `aggregateRunCost()` with the following concrete flow:

```ts
const orderedFiles = [...files].sort(
  (left, right) =>
    left.startedAtMs - right.startedAtMs ||
    left.relativePath.localeCompare(right.relativePath),
);
const uniqueEntries = new Map<
  string,
  {
    fingerprint: string;
    stage: string;
    model: string;
    promptTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  }
>();

for (const file of orderedFiles) {
  const stage = file.relativePath.split(/[\\/]/u)[0] || "unknown";
  for (const [lineIndex, rawLine] of file.content.split(/\r?\n/u).entries()) {
    if (rawLine.trim().length === 0) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(rawLine);
    } catch (error) {
      throw new RunCostReportError(
        `Malformed Pi session JSON in ${file.relativePath}:${lineIndex + 1}`,
        { cause: error },
      );
    }
    const usage = assistantUsage(entry, file.relativePath, lineIndex + 1);
    if (!usage) continue;
    const existing = uniqueEntries.get(usage.id);
    if (existing && existing.fingerprint !== usage.fingerprint) {
      throw new RunCostReportError(`Conflicting Pi session entry ${usage.id}`);
    }
    if (!existing) uniqueEntries.set(usage.id, { ...usage, stage });
  }
}

if (uniqueEntries.size === 0) {
  throw new RunCostReportError("No assistant usage records found");
}
```

Define `assistantUsage()` in the same file so that it:

- returns `undefined` only for non-assistant entries;
- requires a non-empty string `entry.id` for assistant entries;
- maps a missing/blank model to `Unknown model`;
- requires finite non-negative `input`, `cacheRead`, `cacheWrite`, `output`, and
  `cost.total` values;
- computes `promptTokens` by adding all three prompt fields; and
- fingerprints `{ model, promptTokens, outputTokens, estimatedCostUsd }` with
  `JSON.stringify()`.

Reduce unique entries into nested `Map<string, Map<string, RunCostModelUsage>>`
values. Emit known stages in this order and append unknown stages lexically:

```ts
const STAGE_ORDER = [
  "pi-artifact-extraction",
  "pi-plan",
  "pi-development-environment",
  "pi-implementation",
] as const;
```

Sort models lexically, derive each stage total from model values, and derive the
report total from stage values without rounding.

Implement `parseRunCostReport()` as a strict, non-throwing validator for
persisted JSON. It returns `undefined` unless every stage/model/total field has
the exact object/array/string/finite-non-negative-number shape above. Recompute
each stage total from its model rows and the report total from its stage rows;
return `undefined` when any persisted total disagrees with those derived values.

- [ ] **Step 4: Run the focused test and verify the aggregation passes**

Run:

```sh
node --test src/cli/commands/run-once/run-cost.test.ts
```

Expected: PASS with 0 failures.

- [ ] **Step 5: Add failure and persisted-report validation tests**

Add tests with exact assertions for:

```ts
test("aggregateRunCost rejects conflicting copies of one entry id", () => {
  const changed = assistant("entry-plan", "gpt-5.5", {
    input: 10,
    cacheRead: 20,
    cacheWrite: 30,
    output: 4,
    cost: { total: 9.9 },
  });
  assert.throws(
    () =>
      aggregateRunCost([
        sessionFile("pi-plan/a.jsonl", 1, [planning]),
        sessionFile("pi-implementation/b.jsonl", 2, [changed]),
      ]),
    /Conflicting Pi session entry entry-plan/u,
  );
});

test("aggregateRunCost rejects malformed and incomplete assistant usage", () => {
  assert.throws(
    () =>
      aggregateRunCost([
        {
          relativePath: "pi-plan/a.jsonl",
          startedAtMs: 1,
          content: "{not-json}\n",
        },
      ]),
    /Malformed Pi session JSON/u,
  );
  assert.throws(
    () =>
      aggregateRunCost([
        sessionFile("pi-plan/a.jsonl", 1, [
          { type: "message", id: "bad", message: { role: "assistant" } },
        ]),
      ]),
    /usage/u,
  );
});

test("parseRunCostReport accepts valid zero cost and rejects malformed state", () => {
  const zeroReport = {
    stages: [
      {
        stage: "pi-plan",
        models: [
          {
            model: "local-model",
            promptTokens: 0,
            outputTokens: 0,
            estimatedCostUsd: 0,
          },
        ],
        promptTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
      },
    ],
    promptTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
  };
  assert.deepEqual(parseRunCostReport(zeroReport), zeroReport);
  assert.equal(
    parseRunCostReport({ ...zeroReport, promptTokens: -1 }),
    undefined,
  );
});
```

Also cover missing IDs, `NaN`/negative usage, unknown model fallback, unknown
stage ordering, and model lexical ordering.

- [ ] **Step 6: Run the focused tests and type-aware project checks**

Run:

```sh
node --test src/cli/commands/run-once/run-cost.test.ts
npm run lint:ts
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit the pure aggregation core**

```sh
git add src/cli/commands/run-once/run-cost.ts src/cli/commands/run-once/run-cost.test.ts
git commit -m "feat(run-once): aggregate Pi session cost"
```

---

### Task 2: Add the stable durable-session filesystem shell

**Files:**

- Create: `src/cli/commands/run-once/run-cost-files.ts`
- Create: `src/cli/commands/run-once/run-cost-files.test.ts`

**Interfaces:**

- Consumes: `aggregateRunCost()` and `RunCostSessionFile` from Task 1.
- Produces: `RunCostIo`, `nodeRunCostIo`, and
  `summarizeRunCost(piSessionPath, io?)`.
- Task 7 calls `summarizeRunCost()` only for a fresh `pr-created`
  implementation.

- [ ] **Step 1: Write failing real-tree and changing-manifest tests**

Create `run-cost-files.test.ts`. Use a real temporary tree for normal discovery
and an injected `RunCostIo` for deterministic concurrent-change simulation:

```ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { summarizeRunCost, type RunCostIo } from "./run-cost-files.ts";

async function withTempRoot(
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "patchmill-run-cost-test-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("summarizeRunCost recursively reads every stable JSONL file", async () => {
  await withTempRoot(async (root) => {
    const dir = join(root, "pi-implementation", "invocation-a", "--repo--");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "2026-07-19T12-00-00-000Z_session.jsonl"),
      [
        JSON.stringify({
          type: "session",
          id: "session-a",
          timestamp: "2026-07-19T12:00:00.000Z",
        }),
        JSON.stringify({
          type: "message",
          id: "entry-a",
          message: {
            role: "assistant",
            model: "gpt-5.5",
            usage: {
              input: 10,
              cacheRead: 20,
              cacheWrite: 30,
              output: 4,
              cost: { total: 0.1 },
            },
          },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const report = await summarizeRunCost(root);
    assert.equal(report.promptTokens, 60);
    assert.equal(report.outputTokens, 4);
    assert.equal(report.estimatedCostUsd, 0.1);
  });
});

test("summarizeRunCost rejects a session tree that changes after reading", async () => {
  let listing = 0;
  const io: RunCostIo = {
    async listJsonlFiles() {
      listing += 1;
      return listing === 1
        ? ["/root/a.jsonl"]
        : ["/root/a.jsonl", "/root/b.jsonl"];
    },
    async stat() {
      return { size: 1, mtimeMs: 1 };
    },
    async readFile() {
      return "";
    },
  };
  await assert.rejects(
    () => summarizeRunCost("/root", io),
    /Pi session files changed while calculating run cost/u,
  );
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

```sh
node --test src/cli/commands/run-once/run-cost-files.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `run-cost-files.ts`.

- [ ] **Step 3: Implement recursive discovery, ordering, and manifest
      comparison**

Create this public I/O boundary:

```ts
export type RunCostFileInfo = { size: number; mtimeMs: number };

export type RunCostIo = {
  listJsonlFiles(root: string): Promise<string[]>;
  stat(path: string): Promise<RunCostFileInfo>;
  readFile(path: string): Promise<string>;
};

export const nodeRunCostIo: RunCostIo;

export async function summarizeRunCost(
  piSessionPath: string,
  io: RunCostIo = nodeRunCostIo,
): Promise<RunCostReport>;
```

Implement `nodeRunCostIo.listJsonlFiles()` with recursive
`readdir(..., { withFileTypes: true })`, include only regular `.jsonl` files,
and sort absolute paths lexically.

In `summarizeRunCost()`:

1. List paths and stat each path into a pre-read manifest keyed by absolute
   path.
2. Read every file.
3. Derive `startedAtMs` from the first valid `type: "session"` timestamp.
   Otherwise parse the safe filename prefix before `_` by converting
   `YYYY-MM-DDTHH-MM-SS-mmmZ` back to `YYYY-MM-DDTHH:MM:SS.mmmZ`; otherwise use
   the pre-read `mtimeMs`.
4. Convert each path to a normalized relative path with
   `relative(piSessionPath, path)`.
5. List and stat again.
6. Compare path, size, and `mtimeMs` exactly; throw
   `RunCostReportError("Pi session files changed while calculating run cost")`
   on any difference.
7. Call `aggregateRunCost()` with the captured contents.

Do not retry or wait for detached writers.

- [ ] **Step 4: Run filesystem and aggregation tests**

```sh
node --test \
  src/cli/commands/run-once/run-cost.test.ts \
  src/cli/commands/run-once/run-cost-files.test.ts
```

Expected: PASS with 0 failures.

- [ ] **Step 5: Add fallback-order and unreadable-root cases**

Add tests proving:

- the session-entry timestamp wins over filename and `mtimeMs`;
- filename timestamp wins when the session entry lacks a usable timestamp;
- `mtimeMs` is the final deterministic fallback;
- equal timestamps break ties by relative path through Task 1 ordering; and
- an unreadable/missing root rejects with the filesystem error for Task 7 to
  convert into a warning.

Run:

```sh
node --test src/cli/commands/run-once/run-cost-files.test.ts
```

Expected: PASS with 0 failures.

- [ ] **Step 6: Commit the filesystem shell**

```sh
git add \
  src/cli/commands/run-once/run-cost-files.ts \
  src/cli/commands/run-once/run-cost-files.test.ts
git commit -m "feat(run-once): read durable session cost"
```

---

### Task 3: Render and safely upsert the generated PR section

**Files:**

- Create: `src/cli/commands/run-once/pr-cost-summary.ts`
- Create: `src/cli/commands/run-once/pr-cost-summary.test.ts`

**Interfaces:**

- Consumes: validated `RunCostReport` from Task 1.
- Produces: `renderRunCostSection(report)` and
  `upsertRunCostSection(body, report)`.
- Task 7 uses only `upsertRunCostSection()` through the publication helper.

- [ ] **Step 1: Write the failing table and idempotent-upsert tests**

Create a report fixture with one planning model and two implementation models,
then assert the complete rendered block:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { RunCostReport } from "./run-cost.ts";
import {
  renderRunCostSection,
  upsertRunCostSection,
} from "./pr-cost-summary.ts";

const report: RunCostReport = {
  stages: [
    {
      stage: "pi-plan",
      models: [
        {
          model: "gpt-5.5",
          promptTokens: 294103,
          outputTokens: 1290,
          estimatedCostUsd: 0.486239,
        },
      ],
      promptTokens: 294103,
      outputTokens: 1290,
      estimatedCostUsd: 0.486239,
    },
    {
      stage: "pi-implementation",
      models: [
        {
          model: "gpt-5.5",
          promptTokens: 302448,
          outputTokens: 3960,
          estimatedCostUsd: 0.5452,
        },
        {
          model: "gpt-5.6-terra",
          promptTokens: 1282348,
          outputTokens: 9539,
          estimatedCostUsd: 0.8364,
        },
      ],
      promptTokens: 1584796,
      outputTokens: 13499,
      estimatedCostUsd: 1.3816,
    },
  ],
  promptTokens: 1878899,
  outputTokens: 14789,
  estimatedCostUsd: 1.867839,
};

test("renderRunCostSection renders model rows, subtotal, total, and note", () => {
  const markdown = renderRunCostSection(report);
  assert.match(markdown, /<!-- patchmill-run-cost:start -->/u);
  assert.match(
    markdown,
    /\| Planning \| gpt-5\.5 \| 294,103 \| 1,290 \| \$0\.4862 \|/u,
  );
  assert.match(
    markdown,
    /\| \*\*Implementation subtotal\*\* \|  \| \*\*1,584,796\*\* \| \*\*13,499\*\* \| \*\*\$1\.3816\*\* \|/u,
  );
  assert.match(markdown, /\*\*\$1\.8678\*\*/u);
  assert.match(markdown, /Prompt tokens include uncached input/u);
  assert.match(markdown, /<!-- patchmill-run-cost:end -->/u);
});

test("upsertRunCostSection appends once and then replaces idempotently", () => {
  const original = "Summary\n\n- Existing body.\n\nCloses #104\n";
  const appended = upsertRunCostSection(original, report);
  assert.equal(appended.startsWith(original), true);
  assert.equal(upsertRunCostSection(appended, report), appended);
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

```sh
node --test src/cli/commands/run-once/pr-cost-summary.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `pr-cost-summary.ts`.

- [ ] **Step 3: Implement deterministic rendering and marker validation**

Use these exact markers and exports:

```ts
const START_MARKER = "<!-- patchmill-run-cost:start -->";
const END_MARKER = "<!-- patchmill-run-cost:end -->";

export class PrCostSummaryError extends Error {
  readonly name = "PrCostSummaryError";
}

export function renderRunCostSection(report: RunCostReport): string;
export function upsertRunCostSection(
  body: string,
  report: RunCostReport,
): string;
```

Implement these private helpers:

```ts
const TOKEN_FORMAT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
  useGrouping: true,
});

function escapeCell(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replace(/[\r\n]+/gu, " ")
    .trim();
}

function stageLabel(stage: string): string {
  const known: Record<string, string> = {
    "pi-artifact-extraction": "Artifact extraction",
    "pi-plan": "Planning",
    "pi-development-environment": "Development environment",
    "pi-implementation": "Implementation",
  };
  const fallback = stage.replace(/^pi-/u, "").replace(/[-_]+/gu, " ").trim();
  const label = known[stage] ?? (fallback || "Unknown stage");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function tokens(value: number): string {
  return TOKEN_FORMAT.format(value);
}

function usd(value: number): string {
  return `$${value.toFixed(4)}`;
}
```

Render one row for every stage/model pair, a bold stage subtotal only when
`models.length > 1`, and one bold final total. End with the exact explanatory
note from the design.

For upsert:

- count occurrences of each marker;
- append when both counts are zero, preserving the original body as an exact
  prefix;
- replace from the start marker through the end marker when each count is one
  and ordered correctly; and
- throw `PrCostSummaryError("Malformed Patchmill run-cost markers")` for every
  other shape.

- [ ] **Step 4: Add body-protection and escaping cases**

Add tests that assert:

```ts
assert.throws(
  () => upsertRunCostSection("body\n<!-- patchmill-run-cost:start -->", report),
  /Malformed Patchmill run-cost markers/u,
);
assert.throws(
  () =>
    upsertRunCostSection(
      "<!-- patchmill-run-cost:end -->\n<!-- patchmill-run-cost:start -->",
      report,
    ),
  /Malformed Patchmill run-cost markers/u,
);
```

Also verify duplicate markers reject, replacement preserves the exact prefix and
suffix, a model named `bad|model\nrow` cannot add a table row, unknown stages
use the specified fallback, single-model stages have no subtotal, and valid zero
cost renders `$0.0000`.

- [ ] **Step 5: Run renderer tests and formatting**

```sh
node --test src/cli/commands/run-once/pr-cost-summary.test.ts
npx prettier --check \
  src/cli/commands/run-once/pr-cost-summary.ts \
  src/cli/commands/run-once/pr-cost-summary.test.ts
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit the pure PR-body transformation**

```sh
git add \
  src/cli/commands/run-once/pr-cost-summary.ts \
  src/cli/commands/run-once/pr-cost-summary.test.ts
git commit -m "feat(run-once): render PR cost summary"
```

---

### Task 4: Add GitHub PR-body read and update support

**Files:**

- Create: `src/host/pull-request-reference.ts`
- Create: `src/host/pull-request-reference.test.ts`
- Create: `src/host/github-pr-body.ts`
- Create: `src/host/github-pr-body.test.ts`
- Modify: `src/host/github-gh.ts`
- Modify: `src/host/github-gh.test.ts`

**Interfaces:**

- Produces: `pullRequestNumber(prUrl, pathSegment)`,
  `sameCanonicalUrl(left, right)`, `readGitHubPullRequestBody(options, prUrl)`,
  and `updateGitHubPullRequestBody(options, prUrl, body)`.
- Task 5 reuses the URL helper for Forgejo.
- Task 5 adds the formal host capability after both concrete adapters exist.

- [ ] **Step 1: Write failing PR-reference tests**

Create `pull-request-reference.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  pullRequestNumber,
  sameCanonicalUrl,
} from "./pull-request-reference.ts";

test("pullRequestNumber accepts provider-specific PR paths", () => {
  assert.equal(
    pullRequestNumber("https://github.com/acme/repo/pull/42", "pull"),
    42,
  );
  assert.equal(
    pullRequestNumber("https://git.example/acme/repo/pulls/43", "pulls"),
    43,
  );
});

test("pullRequestNumber rejects malformed and mismatched paths", () => {
  assert.throws(
    () => pullRequestNumber("not-a-url", "pull"),
    /Invalid pull request URL/u,
  );
  assert.throws(
    () => pullRequestNumber("https://github.com/acme/repo/pulls/42", "pull"),
    /Invalid pull request URL/u,
  );
});

test("sameCanonicalUrl ignores only a trailing slash", () => {
  assert.equal(
    sameCanonicalUrl(
      "https://github.com/acme/repo/pull/42",
      "https://github.com/acme/repo/pull/42/",
    ),
    true,
  );
  assert.equal(
    sameCanonicalUrl(
      "https://github.com/acme/repo/pull/42",
      "https://github.com/other/repo/pull/42",
    ),
    false,
  );
});
```

- [ ] **Step 2: Implement strict PR-number extraction and canonical comparison**

`pullRequestNumber()` must parse with `new URL()`, reject
credentials/query/hash, require at least
`owner/repo/<segment>/<positive integer>`, and reject trailing path components.
`sameCanonicalUrl()` should compare protocol, lower-cased host, normalized
pathname without a trailing slash, empty search, and empty hash.

Run:

```sh
node --test src/host/pull-request-reference.test.ts
```

Expected: PASS with 0 failures.

- [ ] **Step 3: Write failing GitHub adapter tests**

Create a recorded `CommandRunner` and test these exact behaviors:

```ts
const read = await readGitHubPullRequestBody(
  { runner, repoRoot: "/repo" },
  "https://github.com/acme/repo/pull/42",
);
assert.equal(read, "Summary\n");
assert.deepEqual(calls[0], {
  command: "gh",
  args: ["pr", "view", "42", "--json", "body,url"],
  cwd: "/repo",
  env: { GH_REPO: undefined },
});
```

The runner response for that call is:

```ts
{
  code: 0,
  stdout: JSON.stringify({
    body: "Summary\n",
    url: "https://github.com/acme/repo/pull/42",
  }),
  stderr: "",
}
```

For update, inspect the path following `--body-file` inside the fake runner,
assert its contents equal the exact multiline body, return success, then assert
the temporary directory no longer exists after the function resolves.

Add rejection tests for nonzero `gh`, invalid JSON, non-string `body`/`url`, and
a returned URL for another repository.

- [ ] **Step 4: Implement the focused GitHub adapter**

Create this options type and exports in `github-pr-body.ts`:

```ts
import type { CommandRunner } from "../cli/commands/triage/types.ts";

export type GitHubPrBodyOptions = {
  runner: CommandRunner;
  repoRoot: string;
};

export async function readGitHubPullRequestBody(
  options: GitHubPrBodyOptions,
  prUrl: string,
): Promise<string>;

export async function updateGitHubPullRequestBody(
  options: GitHubPrBodyOptions,
  prUrl: string,
  body: string,
): Promise<void>;
```

Read with:

```ts
const number = pullRequestNumber(prUrl, "pull");
const result = await options.runner.run(
  "gh",
  ["pr", "view", String(number), "--json", "body,url"],
  { cwd: options.repoRoot, env: { GH_REPO: undefined } },
);
```

Parse `{ body, url }`, require both strings, and require
`sameCanonicalUrl(prUrl, url)`. Include command output in nonzero-result errors.

Update by creating `mkdtemp(join(tmpdir(), "patchmill-pr-body-"))`, writing
`body.md`, and running:

```ts
await options.runner.run(
  "gh",
  ["pr", "edit", String(number), "--body-file", bodyPath],
  { cwd: options.repoRoot, env: { GH_REPO: undefined } },
);
```

Delete the entire temporary directory in `finally` with
`rm(..., { recursive: true, force: true })` on success and failure.

- [ ] **Step 5: Delegate from the concrete GitHub provider**

Add these methods to `GitHubGhHostProvider`:

```ts
readPullRequestBody(prUrl: string): Promise<string> {
  return readGitHubPullRequestBody(this.options, prUrl);
}

updatePullRequestBody(prUrl: string, body: string): Promise<void> {
  return updateGitHubPullRequestBody(this.options, prUrl, body);
}
```

Extend `github-gh.test.ts` with one provider-level read and update assertion so
future refactors cannot drop the delegation.

- [ ] **Step 6: Run GitHub host tests**

```sh
node --test \
  src/host/pull-request-reference.test.ts \
  src/host/github-pr-body.test.ts \
  src/host/github-gh.test.ts
```

Expected: PASS with 0 failures.

- [ ] **Step 7: Commit GitHub PR-body support**

```sh
git add \
  src/host/pull-request-reference.ts \
  src/host/pull-request-reference.test.ts \
  src/host/github-pr-body.ts \
  src/host/github-pr-body.test.ts \
  src/host/github-gh.ts \
  src/host/github-gh.test.ts
git commit -m "feat(host): update GitHub PR bodies"
```

---

### Task 5: Add Forgejo PR-body support and the run-once host capability

**Files:**

- Create: `src/host/forgejo-pr-body.ts`
- Create: `src/host/forgejo-pr-body.test.ts`
- Modify: `src/host/types.ts`
- Modify: `src/host/github-gh.ts`
- Modify: `src/host/forgejo-tea.ts`
- Modify: `src/host/forgejo-tea.test.ts`
- Modify: `src/host/factory.ts`
- Modify: `src/host/factory.test.ts`

**Interfaces:**

- Consumes: URL helpers from Task 4 and `withTeaContext()` from
  `src/host/forgejo-tea-context.ts`.
- Produces: `readForgejoPullRequestBody()`, `updateForgejoPullRequestBody()`,
  `PullRequestBodyHostProvider`, `RunOnceHostProvider`, and
  `createRunOnceHostProvider()`.
- Task 7 switches only run-once to the new factory; triage and labels retain
  `IssueHostProvider`.

- [ ] **Step 1: Write failing Forgejo adapter tests**

Create tests using a `repoRoot` fixture whose origin is
`git@git.example:acme/repo.git` so `withTeaContext()` emits `--repo acme/repo`.

The read assertion should require this semantic command, including the
configured login:

```ts
[
  "api",
  "/repos/{owner}/{repo}/pulls/42",
  "--repo",
  "acme/repo",
  "--login",
  "robot",
];
```

Return:

```ts
{
  code: 0,
  stdout: JSON.stringify({
    body: "Summary\n",
    html_url: "https://git.example/acme/repo/pulls/42",
  }),
  stderr: "",
}
```

Assert update uses `tea pulls edit 42 --description <actual multiline body>`
with the same repo/login context. Add errors for invalid JSON, malformed
body/`html_url`, mismatched URL, and nonzero commands.

- [ ] **Step 2: Implement the Forgejo adapter**

Create this public surface:

```ts
export type ForgejoPrBodyOptions = {
  runner: CommandRunner;
  repoRoot: string;
  login?: string;
};

export async function readForgejoPullRequestBody(
  options: ForgejoPrBodyOptions,
  prUrl: string,
): Promise<string>;

export async function updateForgejoPullRequestBody(
  options: ForgejoPrBodyOptions,
  prUrl: string,
  body: string,
): Promise<void>;
```

Use `pullRequestNumber(prUrl, "pulls")`. Build both command arrays with
`withTeaContext(args, options.repoRoot, options.login)` and run them with
`cwd: options.repoRoot`.

Read through:

```ts
["api", `/repos/{owner}/{repo}/pulls/${number}`];
```

Update through:

```ts
["pulls", "edit", String(number), "--description", body];
```

Parse structured read output, require string `body` and `html_url`, and validate
`html_url` with `sameCanonicalUrl()` before returning the body.

- [ ] **Step 3: Delegate from `ForgejoTeaHostProvider`**

Add:

```ts
readPullRequestBody(prUrl: string): Promise<string> {
  return readForgejoPullRequestBody(this.options, prUrl);
}

updatePullRequestBody(prUrl: string, body: string): Promise<void> {
  return updateForgejoPullRequestBody(this.options, prUrl, body);
}
```

Add provider-level delegation coverage in `forgejo-tea.test.ts`.

- [ ] **Step 4: Add the narrow run-once host capability**

In `src/host/types.ts`, add:

```ts
export type PullRequestBodyHostProvider = {
  readPullRequestBody(prUrl: string): Promise<string>;
  updatePullRequestBody(prUrl: string, body: string): Promise<void>;
};

export type RunOnceHostProvider = IssueHostProvider &
  PullRequestBodyHostProvider;
```

Update both concrete class `implements` clauses to include
`PullRequestBodyHostProvider`.

In `factory.ts`, leave `createIssueHostProvider()` unchanged and add:

```ts
export function createRunOnceHostProvider(options: {
  runner: CommandRunner;
  repoRoot: string;
  host: PatchmillHostConfig;
}): RunOnceHostProvider {
  return createHostProvider(options);
}
```

Extend `factory.test.ts` for both provider IDs and assert both PR-body methods
are functions.

- [ ] **Step 5: Run all host tests and build**

```sh
node --test \
  src/host/pull-request-reference.test.ts \
  src/host/github-pr-body.test.ts \
  src/host/forgejo-pr-body.test.ts \
  src/host/github-gh.test.ts \
  src/host/forgejo-tea.test.ts \
  src/host/factory.test.ts
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit cross-host run-once PR capability**

```sh
git add \
  src/host/forgejo-pr-body.ts \
  src/host/forgejo-pr-body.test.ts \
  src/host/types.ts \
  src/host/github-gh.ts \
  src/host/forgejo-tea.ts \
  src/host/forgejo-tea.test.ts \
  src/host/factory.ts \
  src/host/factory.test.ts
git commit -m "feat(host): update Forgejo PR bodies"
```

---

### Task 6: Persist the report and publication checkpoint in run state

**Files:**

- Modify: `src/cli/commands/run-once/types.ts`
- Modify: `src/cli/commands/run-once/run-state.ts`
- Modify: `src/cli/commands/run-once/run-state.test.ts`
- Modify: `src/cli/commands/run-once/pipeline-lifecycle.ts`
- Modify: `src/cli/commands/run-once/pipeline-lifecycle.test.ts`

**Interfaces:**

- Consumes: `RunCostReport` from Task 1.
- Produces: optional `runCostReport` fields on state/update and the
  `prCostSummaryUpdated` checkpoint.
- Task 7 reads `existingState.runCostReport`, passes the report to finish, and
  records the checkpoint.

- [ ] **Step 1: Write failing run-state report and checkpoint tests**

Add a shared valid report fixture and verify a `pr-created` update persists it:

```ts
const runCostReport: RunCostReport = {
  stages: [
    {
      stage: "pi-implementation",
      models: [
        {
          model: "gpt-5.5",
          promptTokens: 60,
          outputTokens: 4,
          estimatedCostUsd: 0.1,
        },
      ],
      promptTokens: 60,
      outputTokens: 4,
      estimatedCostUsd: 0.1,
    },
  ],
  promptTokens: 60,
  outputTokens: 4,
  estimatedCostUsd: 0.1,
};
```

Write state with `implementationStatus: "pr-created"`, `runCostReport`, and
`checkpoints: { implementationCompleted: true }`; read it back and deep-equal
the report.

Then write `checkpoints: { prCostSummaryUpdated: true }` and assert both the
top-level report and merged checkpoint remain.

Add a new implementation update without `runCostReport` and assert stale report
data is cleared. Add a `merged` implementation update and assert both `prUrl`
and `runCostReport` are absent.

- [ ] **Step 2: Run focused state tests and verify the type/behavior failure**

```sh
node --test \
  src/cli/commands/run-once/run-state.test.ts \
  src/cli/commands/run-once/pipeline-lifecycle.test.ts
```

Expected: FAIL because the report field/checkpoint is not represented or
persisted.

- [ ] **Step 3: Extend types and merge semantics**

Import `RunCostReport` as a type in `types.ts`. Add `"prCostSummaryUpdated"` to
`AgentIssueRunCheckpoint` and `runCostReport?: RunCostReport` to both
`AgentIssueRunState` and `AgentIssueRunStateUpdate`.

In `mergeRunState()`:

- include `"runCostReport"` in `hasImplementationUpdate`;
- select the new report from the update when implementation fields change;
- preserve the existing report for unrelated checkpoint/label updates;
- clear it for `implementationStatus: "merged"` or a fresh implementation update
  that omits the report; and
- delete `next.runCostReport` when undefined.

The core assignment should be:

```ts
const runCostReport =
  update.implementationStatus === "merged"
    ? undefined
    : hasImplementationUpdate
      ? update.runCostReport
      : existingImplementation?.runCostReport;
```

Add `runCostReport` to the `next` object and cleanup section.

- [ ] **Step 4: Mark publication as a resume-only side effect**

Add `"prCostSummaryUpdated"` to `RESUME_ONLY_SIDE_EFFECT_CHECKPOINTS` in
`pipeline-lifecycle.ts`.

Extend `pipeline-lifecycle.test.ts` to assert:

- resumable state retains `prCostSummaryUpdated`; and
- non-resumable checkpoint filtering removes it with the other side-effect
  checkpoints.

- [ ] **Step 5: Run focused tests, lint, and build**

```sh
node --test \
  src/cli/commands/run-once/run-state.test.ts \
  src/cli/commands/run-once/pipeline-lifecycle.test.ts
npm run lint:ts
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit resumable cost state**

```sh
git add \
  src/cli/commands/run-once/types.ts \
  src/cli/commands/run-once/run-state.ts \
  src/cli/commands/run-once/run-state.test.ts \
  src/cli/commands/run-once/pipeline-lifecycle.ts \
  src/cli/commands/run-once/pipeline-lifecycle.test.ts
git commit -m "feat(run-once): persist run cost reports"
```

---

### Task 7: Resolve, publish, checkpoint, and recover the PR cost summary

**Files:**

- Create: `src/cli/commands/run-once/pipeline-run-cost.ts`
- Create: `src/cli/commands/run-once/pipeline-run-cost.test.ts`
- Create: `src/cli/commands/run-once/pr-cost-publication.ts`
- Create: `src/cli/commands/run-once/pr-cost-publication.test.ts`
- Modify: `src/cli/commands/run-once/progress.ts`
- Modify: `src/cli/commands/run-once/pipeline.ts`
- Modify: `src/cli/commands/run-once/pipeline-finish.ts`
- Modify: `src/cli/commands/run-once/pipeline-finish-scenarios.test.ts`
- Modify: `test-support/run-once/mock-runner.ts`

**Interfaces:**

- Consumes: `summarizeRunCost()`, `parseRunCostReport()`,
  `upsertRunCostSection()`, `RunOnceHostProvider`, and persisted state from
  Tasks 1–6.
- Produces: `resolvePipelineRunCost()`, `publishPrRunCost()`, warning progress,
  finish-stage persistence/publication, and the final integration behavior.

- [ ] **Step 1: Write failing fresh/resumed report resolution tests**

Create `pipeline-run-cost.test.ts` with an injected calculator and warning
collector. Use this interface:

```ts
export type ResolvePipelineRunCostOptions = {
  implementationKind: "implemented" | "already-implemented";
  implementationStatus: "pr-created" | "merged";
  piSessionPath?: string;
  persistedReport?: unknown;
  calculate?: (piSessionPath: string) => Promise<RunCostReport>;
  warn(message: string, error?: unknown): void | Promise<void>;
};

export async function resolvePipelineRunCost(
  options: ResolvePipelineRunCostOptions,
): Promise<RunCostReport | undefined>;
```

Tests must assert:

- fresh `pr-created` calls `calculate(piSessionPath)` and returns its report;
- resumed `pr-created` returns `parseRunCostReport(persistedReport)` without
  calculating;
- resumed legacy state with no report warns and returns `undefined`;
- malformed persisted state warns and returns `undefined`;
- fresh calculation rejection warns and returns `undefined`; and
- `merged` returns `undefined` without calculating or warning.

- [ ] **Step 2: Implement nonfatal report resolution**

Use `summarizeRunCost` as the default calculator. Use fixed, testable warning
messages:

```ts
"Patchmill could not calculate the PR run-cost summary";
"Patchmill cannot publish a run-cost summary from legacy or invalid saved state";
```

Require `piSessionPath` for a fresh PR result; treat absence as the calculate
warning. Never calculate from the current session path for `already-implemented`
state.

Run:

```sh
node --test src/cli/commands/run-once/pipeline-run-cost.test.ts
```

Expected: PASS with 0 failures.

- [ ] **Step 3: Write failing publication tests**

Create `pr-cost-publication.test.ts` around this interface:

```ts
export async function publishPrRunCost(options: {
  host: PullRequestBodyHostProvider;
  prUrl: string;
  report: RunCostReport;
}): Promise<"updated" | "unchanged">;
```

Use a fake host to prove:

- changed body calls `updatePullRequestBody()` once with the original content
  plus the generated section and returns `updated`;
- already-current body does not call update and returns `unchanged`; and
- marker errors and host errors reject for the finish stage to catch.

- [ ] **Step 4: Implement the focused publication helper**

Implementation:

```ts
export async function publishPrRunCost({
  host,
  prUrl,
  report,
}: {
  host: PullRequestBodyHostProvider;
  prUrl: string;
  report: RunCostReport;
}): Promise<"updated" | "unchanged"> {
  const currentBody = await host.readPullRequestBody(prUrl);
  const nextBody = upsertRunCostSection(currentBody, report);
  if (nextBody === currentBody) return "unchanged";
  await host.updatePullRequestBody(prUrl, nextBody);
  return "updated";
}
```

Run:

```sh
node --test src/cli/commands/run-once/pr-cost-publication.test.ts
```

Expected: PASS with 0 failures.

- [ ] **Step 5: Add priced-session support to the run-once mock runner**

Add a new helper without changing the existing `writePiSessionMessage()`
contract:

```ts
export async function writePiPricedSessionMessage(
  call: Call,
  input: {
    id: string;
    model: string;
    input: number;
    cacheRead: number;
    cacheWrite: number;
    output: number;
    estimatedCostUsd: number;
  },
): Promise<void>;
```

It should locate `--session-dir`, write beneath `--repo--`, include a valid
session timestamp, and write one assistant entry with the complete usage object
and `cost.total`. Accept an optional array overload only if an integration test
needs multiple models in the same file; do not weaken existing helper types.

- [ ] **Step 6: Write failing finish-stage publication and recovery scenarios**

In `pipeline-finish-scenarios.test.ts`, add scenarios next to the existing
complete `pr-created` coverage:

1. **Fresh report publication** — provide a valid `RunCostReport`; have the
   configured host read `Summary\n\nCloses #45\n`; assert the update contains
   the marker block, state contains `runCostReport`, and state checkpoint
   `prCostSummaryUpdated` is true.
2. **Already-current retry** — return a body containing the exact generated
   block; assert no edit command occurs but the checkpoint becomes true.
3. **Host update failure** — return nonzero from the edit; assert the final
   result remains `pr-created`, a progress event has `level: "warning"`, the
   report remains in state, and `prCostSummaryUpdated` is absent.
4. **Malformed markers** — return one unmatched marker; assert the same nonfatal
   warning behavior and unchanged body.
5. **Merged result** — assert no PR-body read or update occurs and no report is
   persisted.
6. **Resumed implementation** — seed `implementationCompleted` and
   `runCostReport`; assert no Pi call or fresh calculation is needed and
   publication uses the saved report.

Use exact event message text:

```ts
"Patchmill could not update the PR run-cost summary";
```

- [ ] **Step 7: Wire the run-once host and report resolution in `pipeline.ts`**

Replace only the run-once factory call:

```ts
const host = createRunOnceHostProvider({
  runner,
  repoRoot: config.repoRoot,
  host: config.host,
});
```

After `runPipelineImplementationStage()` returns a successful result, resolve
the report before calling finish:

```ts
const runCostReport = await resolvePipelineRunCost({
  implementationKind: implementationStage.kind,
  implementationStatus: implementationStage.result.status,
  piSessionPath: runOptions.piSessionPath,
  persistedReport: existingState?.runCostReport,
  warn: (message, error) =>
    progress(runOptions, "warning", "run-cost", message, {
      issueNumber: issue.number,
      data: error instanceof Error ? error.message : String(error ?? ""),
      consoleMessage: `Warning: ${message}`,
    }),
});
```

Pass `runCostReport` into `runPipelineFinishStage()`.

- [ ] **Step 8: Persist and publish in `pipeline-finish.ts`**

Change the finish-stage host type to `RunOnceHostProvider` and add
`runCostReport?: RunCostReport` to `PipelineFinishStageOptions`.

Include `runCostReport` in the first implementation-completed state write and in
the later visual-evidence state rewrite so the latter cannot clear it.

Immediately after the first state write and before visual-evidence validation,
add:

```ts
if (
  implemented.status === "pr-created" &&
  options.runCostReport &&
  !checkpoints.prCostSummaryUpdated
) {
  try {
    const publication = await publishPrRunCost({
      host,
      prUrl: implemented.prUrl,
      report: options.runCostReport,
    });
    await writeRunState(
      config.runStateDir,
      {
        issueNumber: issue.number,
        status: "implementing",
        checkpoints: { prCostSummaryUpdated: true },
      },
      timestamp,
    );
    checkpoints.prCostSummaryUpdated = true;
    await emitProgress(
      runOptions,
      "info",
      "run-cost",
      `PR run-cost summary ${publication}`,
      {
        issueNumber: issue.number,
        data: options.runCostReport,
      },
    );
  } catch (error) {
    await emitProgress(
      runOptions,
      "warning",
      "run-cost",
      "Patchmill could not update the PR run-cost summary",
      {
        issueNumber: issue.number,
        data: error instanceof Error ? error.message : String(error),
        consoleMessage:
          "Warning: Patchmill could not update the PR run-cost summary",
      },
    );
  }
}
```

Add `"warning"` to `AgentIssueProgressEvent["level"]` in `progress.ts`. Do not
map it to an error or blocker.

- [ ] **Step 9: Run focused run-once integration tests**

```sh
node --test \
  src/cli/commands/run-once/run-cost.test.ts \
  src/cli/commands/run-once/run-cost-files.test.ts \
  src/cli/commands/run-once/pr-cost-summary.test.ts \
  src/cli/commands/run-once/pipeline-run-cost.test.ts \
  src/cli/commands/run-once/pr-cost-publication.test.ts \
  src/cli/commands/run-once/run-state.test.ts \
  src/cli/commands/run-once/pipeline-lifecycle.test.ts \
  src/cli/commands/run-once/pipeline-finish-scenarios.test.ts
```

Expected: PASS with 0 failures.

- [ ] **Step 10: Run the full project verification required by the spec**

```sh
npm test
npm run lint
npm run format:check
npm run build
```

Expected: every command exits 0. If `package.json`, `package-lock.json`, or
`npm-shrinkwrap.json` changed unexpectedly, stop, revert that dependency drift,
and rerun verification. No Nix build is required when those files remain
unchanged.

- [ ] **Step 11: Review the final diff against privacy and scope constraints**

Run:

```sh
git diff --check
git status --short
git diff --stat
git diff -- \
  src/cli/commands/run-once \
  src/host \
  test-support/run-once/mock-runner.ts
```

Confirm from the diff that:

- only aggregate model names, token totals, and estimated cost reach the PR;
- PR body content outside markers is preserved;
- no prompt/session content is emitted;
- direct-land paths skip publication;
- all reporting exceptions are caught before handoff completion; and
- no dependency or lock file changed.

- [ ] **Step 12: Commit the integrated pipeline behavior**

```sh
git add \
  src/cli/commands/run-once/pipeline-run-cost.ts \
  src/cli/commands/run-once/pipeline-run-cost.test.ts \
  src/cli/commands/run-once/pr-cost-publication.ts \
  src/cli/commands/run-once/pr-cost-publication.test.ts \
  src/cli/commands/run-once/progress.ts \
  src/cli/commands/run-once/pipeline.ts \
  src/cli/commands/run-once/pipeline-finish.ts \
  src/cli/commands/run-once/pipeline-finish-scenarios.test.ts \
  test-support/run-once/mock-runner.ts
git commit -m "feat(run-once): publish PR cost summaries"
```

---

## Final acceptance checklist

- [ ] The report uses only the current successful run's durable Pi session root.
- [ ] Copied parent entries count once globally by stable entry ID.
- [ ] Earliest session attribution preserves the originating stage.
- [ ] Prompt/output token and recorded-cost calculations match the approved
      formulas.
- [ ] Multi-model stages render model rows plus one subtotal.
- [ ] The generated block is marker-delimited, escaped, deterministic, and
      idempotent.
- [ ] GitHub and Forgejo adapters validate the current repository PR before
      editing.
- [ ] The report and publication checkpoint survive finish-stage recovery.
- [ ] Legacy state without a report remains resumable and emits only a warning.
- [ ] Aggregation and host failures leave `pr-created` successful.
- [ ] Direct-land and non-PR results perform no PR-body operations.
- [ ] Focused tests, full tests, lint, format check, and build all exit 0.
- [ ] No dependency or lock file changed.
