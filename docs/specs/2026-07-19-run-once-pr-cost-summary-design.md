# Run-once PR cost summary design

## Context

Patchmill preserves durable Pi session JSONL for each selected-issue `run-once`
execution under a path such as:

```text
.patchmill/runs/issue-104/run-2026-07-19T15-14-56-391Z-pi-sessions/
  pi-plan/
  pi-development-environment/
  pi-implementation/
```

Each assistant message records its provider, model, token usage, and Pi's
calculated cost. A typical usage object includes:

- `input` — uncached input tokens;
- `cacheRead` — tokens read from the provider cache;
- `cacheWrite` — tokens written to the provider cache;
- `output` — output tokens; and
- `cost.total` — Pi's estimated USD cost for that response.

Patchmill currently observes output tokens for console progress, but it does not
calculate a complete run cost or add cost information to the pull request.

The implementation Pi session creates or updates the pull request before it
returns its final `pr-created` JSON. The complete implementation cost is
therefore unavailable when the agent first writes the PR body. Patchmill must
calculate the report after the Pi invocation exits and then update the existing
PR body.

A recursive sum of every assistant message in every JSONL file would be wrong.
Child and subagent sessions can copy parent session history into their own JSONL
files while preserving session-entry IDs. Patchmill must deduplicate those
copied entries before summing tokens or cost.

## Decision

For every successful `pr-created` run, Patchmill should calculate a report from
the current run's durable Pi session tree and insert an idempotent, generated
section into the existing PR body.

The report should:

- include all Pi stages present in the current `run-once` execution;
- include parent and child/subagent sessions;
- deduplicate copied session history;
- group usage by stage and model;
- show prompt tokens, output tokens, and estimated USD cost;
- add a stage subtotal when a stage used multiple models;
- show a total for the complete current run;
- support GitHub through `gh` and Forgejo/Gitea through `tea`; and
- treat reporting failures as warnings that do not invalidate a successful PR
  handoff.

The report describes the current `run-once` execution that produced the
`pr-created` result. It is not cumulative across earlier approval runs, failed
runs, or other attempts for the same issue.

## Goals

- Give reviewers a concise view of the model usage required to produce the PR.
- Use Pi's recorded historical cost rather than current model pricing.
- Include subagent usage without double-counting copied parent history.
- Preserve the existing PR body outside Patchmill's generated section.
- Make retries and resumed finish stages idempotent.
- Keep cost parsing, Markdown rendering, host I/O, and pipeline orchestration in
  separate, focused units.
- Avoid exposing prompts, tool arguments, session paths, or other session
  content in the PR.

## Non-goals

- Do not calculate an operator's exact invoice or subscription charge.
- Do not recompute historical cost from token counts and current pricing.
- Do not aggregate costs across multiple `run-once` executions for an issue.
- Do not add a cost report to direct-landed changes that have no PR.
- Do not post a fallback issue comment when the PR body cannot be updated.
- Do not add configuration for currencies, custom price tables, report layout,
  or opt-in/opt-out behavior in the initial implementation.
- Do not expose cache-token columns separately; cache reads and writes are part
  of the prompt-token total.
- Do not wait indefinitely for detached subagents after Pi has returned a
  successful final result.

## Terminology and calculations

### Prompt tokens

The report's **Prompt tokens** value is:

```text
usage.input + usage.cacheRead + usage.cacheWrite
```

This keeps the PR table compact while accounting for all tokens used to build a
provider request. The note below the table should state this definition.

### Output tokens

The report's **Output tokens** value is Pi's recorded `usage.output`. Reasoning
usage is not displayed as a separate column.

### Estimated cost

The report's **Estimated cost (USD)** value is Pi's recorded `usage.cost.total`.
It reflects Pi's configured model pricing and may differ from subscription
charges, negotiated rates, credits, or the operator's final invoice.

Patchmill should sum costs at full JavaScript numeric precision and round only
when rendering. Displayed costs use four decimal places.

## Components and responsibilities

### Run-cost aggregation

Add a focused run-once module with one narrow public operation conceptually
shaped as:

```ts
summarizeRunCost(piSessionPath: string): Promise<RunCostReport>
```

The module owns recursive JSONL discovery, stable snapshot validation, session
entry parsing, deduplication, stage/model aggregation, and report validation. It
does not know about Markdown or issue-host commands.

A report should have a domain shape equivalent to:

```ts
type RunCostModelUsage = {
  model: string;
  promptTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};

type RunCostStageUsage = {
  stage: string;
  models: RunCostModelUsage[];
  promptTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};

type RunCostReport = {
  stages: RunCostStageUsage[];
  promptTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};
```

The implementation may use stricter branded or readonly types, but it should
keep one validated representation shared by run state and rendering.

### PR cost-section rendering

Add a separate pure module that:

- renders a validated `RunCostReport` as Markdown;
- inserts the generated block when no markers exist; and
- replaces the existing generated block when exactly one valid marker pair
  exists.

This module should not perform filesystem or host I/O.

### Pull-request host capability

Add a narrow pull-request-body capability at the host boundary, conceptually:

```ts
type PullRequestBodyHost = {
  readPullRequestBody(prUrl: string): Promise<string>;
  updatePullRequestBody(prUrl: string, body: string): Promise<void>;
};
```

The run-once host used by the pipeline should provide both the existing issue
operations and this capability. Repository setup providers do not need it.

### Pipeline orchestration

The pipeline should decide when to calculate, persist, and publish the report.
It should not parse JSONL or construct host-specific commands directly.

## Session discovery and deduplication

### File manifest

Before parsing, recursively discover every `.jsonl` file under the current
`piSessionPath`. For each file, record:

- its path relative to the run session root;
- the stage represented by the first relative path component;
- file size and modification time; and
- the session start timestamp from the file's first valid `session` entry.

If a valid session-entry timestamp is unavailable, use the ISO timestamp prefix
in the JSONL filename. If that is also unavailable, use the manifest
modification time. Break remaining ties by relative path so attribution is
deterministic.

After parsing, rebuild the manifest. A new, removed, resized, or modified file
means the session tree changed while being read. In that case the report is not
safe to publish.

A successful `pr-created` result is expected only after required subagents have
finished. Snapshot validation protects against concurrent writes during
aggregation, but Patchmill should not add an unbounded wait for detached
workers.

### Relevant entries

Only entries satisfying all of the following contribute usage:

- the JSONL entry has `type: "message"`;
- `entry.message.role` is `"assistant"`;
- the entry has a non-empty stable string `id`;
- `message.usage.input`, `cacheRead`, `cacheWrite`, and `output` are finite,
  non-negative numbers;
- `message.usage.cost.total` is a finite, non-negative number; and
- the message model is a usable string, or can be represented as
  `Unknown model`.

A valid recorded zero is meaningful and must remain zero. A session tree with no
assistant usage produces no report rather than a fabricated `$0.0000` report.
Any assistant entry that lacks the required ID or accounting fields invalidates
the complete report instead of being silently omitted. Non-assistant entries do
not require usage fields and are ignored for accounting.

### Global deduplication

Deduplicate across the entire current run, not only within individual files or
stages.

Use the stable session-entry `id` as the key. When an ID occurs in multiple
files:

1. Compare the accounting fields that affect the report, including model, token
   counts, and total cost.
2. If the copies conflict, reject the report as internally inconsistent.
3. If they match, count the entry once.
4. Attribute it to the earliest session file containing that ID, using the
   session start ordering from the manifest.

Attributing the earliest copy preserves the stage where the response originated
when a later child session copies parent history.

### Aggregation and ordering

Aggregate each unique response first by stage and then by model. Sum stage and
run totals from the same unique response records rather than summing already
rounded display rows.

Known stages should appear in workflow order:

1. artifact extraction;
2. planning;
3. development environment; and
4. implementation.

Absent stages are omitted. Unknown future stages follow known stages in lexical
order and are labelled by stripping a leading `pi-`, replacing hyphens and
underscores with spaces, and capitalizing the first word. Models are grouped by
the trimmed recorded `message.model` string and use deterministic lexical order
within a stage.

## PR Markdown contract

Use exact HTML markers:

```md
<!-- patchmill-run-cost:start -->
<!-- patchmill-run-cost:end -->
```

The generated section should have this shape:

```md
<!-- patchmill-run-cost:start -->

## Patchmill run cost

| Stage                       | Model         | Prompt tokens | Output tokens | Estimated cost (USD) |
| --------------------------- | ------------- | ------------: | ------------: | -------------------: |
| Planning                    | gpt-5.5       |       294,103 |         1,290 |              $0.4862 |
| Development environment     | gpt-5.5       |       181,450 |           940 |              $0.2147 |
| Implementation              | gpt-5.5       |       302,448 |         3,960 |              $0.5452 |
| Implementation              | gpt-5.6-terra |     1,282,348 |         9,539 |              $0.8364 |
| **Implementation subtotal** |               | **1,584,796** |    **13,499** |          **$1.3816** |
| **Total**                   |               | **2,060,349** |    **15,729** |          **$2.0825** |

_Prompt tokens include uncached input, cache reads, and cache writes. Cost is an
estimate based on Pi's recorded model pricing and includes parent and subagent
sessions._

<!-- patchmill-run-cost:end -->
```

Rendering rules:

- Render one row per stage/model pair.
- Render a stage subtotal only when that stage contains more than one model.
- Render exact integer token counts with comma thousands separators.
- Render USD with a dollar sign and exactly four decimal places.
- Escape model and fallback stage labels so they cannot break Markdown table
  cells or inject additional lines.
- Keep known stage labels human-readable.

### Marker safety

The updater should follow these rules:

- No markers: append the generated block with appropriate blank-line separation.
- Exactly one start marker followed by exactly one end marker: replace the
  inclusive generated region.
- A missing mate, reversed pair, or multiple occurrence of either marker: reject
  the update and warn.

All existing body content outside the generated block must remain byte-for-byte
unchanged. When appending, the original body remains an exact prefix of the new
body.

## Host-provider behavior

Before reading or editing, adapters should validate that the returned PR URL is
a supported PR URL for the configured repository. An unparseable or mismatched
URL is a nonfatal reporting error.

### GitHub

The GitHub adapter should:

- read the body using structured `gh pr view` JSON output;
- update it using `gh pr edit` with a temporary body file so multiline Markdown
  and body size do not depend on shell quoting; and
- remove the temporary file in success and failure paths.

The command should target the validated configured repository and PR number or
validated URL explicitly.

### Forgejo/Gitea

The Forgejo adapter should:

- extract the numeric pull index from the validated PR URL;
- read the PR through structured `tea api` JSON because the installed `tea`
  version does not expose a `pulls view` command;
- update the description using `tea pulls edit <index> --description <body>`
  with the configured repository context; and
- pass the body as one real multiline argument rather than literal `\\n` text.

Both adapters should parse structured output defensively and surface command,
shape, authentication, permission, and network errors to pipeline orchestration.

## Pipeline and run-state flow

For a current execution that returns `pr-created`:

1. The implementation Pi invocation and its session observation shutdown finish.
2. Patchmill attempts to calculate the report from the current execution's
   `piSessionPath`, converting an aggregation failure into a warning and an
   absent report.
3. Patchmill persists the implementation result and, when available, the
   validated report in run state.
4. When no report is available, Patchmill skips publication and continues the
   existing finish sequence.
5. Otherwise, Patchmill reads the latest PR body through the configured host
   provider.
6. Patchmill applies the pure marker upsert.
7. If the transformed body differs, Patchmill updates the PR.
8. Patchmill records a `prCostSummaryUpdated` checkpoint after either a
   successful update or confirmation that the existing generated block is
   already current.
9. Existing visual-evidence validation, issue handoff, label changes, and
   cleanup continue.

Persisting the report before host publication supports recovery. If Patchmill
crashes after implementation, a resumed finish stage uses the saved report
instead of trying to calculate from the resumed invocation's different session
root. If Patchmill crashes after editing the PR but before recording the
checkpoint, marker replacement makes the retry idempotent.

Legacy run-state files may contain a saved `pr-created` result without a cost
report. Resume loading must accept those states. If the original session root is
not available from that state, Patchmill should warn and continue rather than
invent or recalculate a report from the new execution.

Direct-landed `merged` results and all non-PR outcomes skip aggregation and host
PR operations.

## Progress and failure behavior

Cost reporting is supplementary metadata. It must not convert a valid
`pr-created` implementation into a blocked or failed handoff.

On successful publication, emit a concise progress event indicating that the PR
cost summary was updated. The durable run log may include structured report
totals for diagnostics, but console output should remain concise.

For any of the following, emit a warning, leave the PR unchanged, do not record
the publication checkpoint, and continue normal handoff:

- missing or unreadable session root;
- malformed nonblank JSONL;
- missing or invalid relevant usage fields;
- missing stable IDs on relevant entries;
- conflicting copies of one entry ID;
- session files changing during aggregation;
- no assistant usage records;
- malformed or duplicated PR markers;
- malformed or mismatched PR URL;
- host body read or parse failure; or
- host body update, authentication, permission, or network failure.

No fallback issue comment should be posted. The validated report remains in run
state when calculation succeeded but host publication failed.

## Testing strategy

These tests prove production behavior and pass the project's Testing Value Gate.

### Run-cost aggregation tests

Use compact temporary JSONL trees to verify:

- one stage and one model;
- multiple stages in workflow order;
- multiple models within implementation;
- prompt-token calculation from input plus both cache fields;
- output-token and cost totals;
- global deduplication of parent history copied into child and grandchild files;
- attribution to the earliest session file;
- rejection of conflicting copies with the same ID;
- full-precision accumulation before rendering;
- valid zero usage and cost;
- unknown model and stage fallbacks;
- no usage records;
- malformed JSONL and invalid usage fields; and
- pre-read/post-read manifest changes.

### Markdown tests

Verify:

- stage/model rows and deterministic ordering;
- subtotals only for multi-model stages;
- total row, token formatting, and four-decimal USD formatting;
- Markdown escaping for model and stage labels;
- append behavior with exact original-body prefix preservation;
- replacement behavior with exact outside-body preservation;
- idempotent repeated upserts; and
- rejection of missing, reversed, or duplicate markers.

### Host adapter tests

Extend the existing command-runner tests to verify:

- GitHub structured body reads and body-file edits;
- GitHub temporary-file cleanup on success and failure;
- Forgejo structured API body reads and multiline description edits;
- explicit configured repository targeting;
- PR URL parsing and repository mismatch rejection; and
- malformed command output and nonzero command results.

### Pipeline and recovery tests

Verify:

- a `pr-created` result calculates and persists the report before publication;
- the body update occurs before the existing handoff completion sequence;
- successful publication records `prCostSummaryUpdated`;
- a crash/retry replaces rather than duplicates the section;
- a resumed finish stage uses the persisted report;
- legacy state without a report remains loadable;
- aggregation and host failures warn but preserve successful handoff;
- failed publication does not record the checkpoint or post a fallback comment;
  and
- merged and non-PR results do not read or edit PR bodies.

### Verification commands

Run focused tests first, then:

```sh
npm test
npm run lint
npm run format:check
npm run build
```

No dependency change is expected, so the dependency-triggered Nix build is not
required. Documentation text should be checked through the existing Markdown
lint/format commands rather than new tests that assert prose.

## Security and privacy

The generated section contains only aggregate model names, token counts, and
estimated cost. It must not include prompts, assistant text, tool calls, file
paths, repository-local session locations, provider credentials, or raw session
records.

Treat model and stage strings as untrusted Markdown input and escape them before
rendering. Validate PR URLs against the configured repository before allowing an
adapter to modify a remote PR.
