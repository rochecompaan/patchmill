# Correlate Per-Child Subagent Progress and Preserve Pipeline Accounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correlate bounded, authoritative progress for every direct and
`workflowScript` child while preserving one parent tool-accounting unit per Pi
tool call and allowing child progress to refresh implementation todos before a
workflow terminates.

**Architecture:** Keep the existing pure-core/thin-adapter boundary. Expand
`src/pi/subagent-progress.ts` into the versioned allowlist parser, add a focused
stateful correlation module for direct and workflow identities, and leave the Pi
extension responsible only for lifecycle registration and `appendEntry()`.
Revalidate persisted custom entries in the exact parent-session streamer, then
route the resulting `subagent-progress` observations through existing pipeline
progress and implementation-task paths without counting them as tool calls.

**Tech Stack:** TypeScript 6 ESM, Node.js 24 and `node:test`, Pi lifecycle
extensions from `@earendil-works/pi-coding-agent` 0.84.2, `pi-subagents` 0.57.0
`workflowChildren` v1 summaries, npm packed-artifact checks, and Nix package and
flake verification.

**Spec:**
`docs/specs/2026-08-26-issue-125-correlate-per-child-subagent-progress-and-preserve-pipeline-accounting-design.md`

## Global Constraints

- Consume only the released `pi-subagents` 0.57.0 contract already pinned by
  issue #195. Do not implement workflow correlation against an older installed
  package or change dependency/lock files in this issue.
- If local `node_modules` does not resolve the root 0.57.0 pin, run
  `devenv shell -- npm ci` before implementation verification; do not weaken the
  exact-pin checks.
- Direct identity is
  `(originating toolCallId, Details.runId, SingleResult.index)`. A structured
  async single may use its documented `details.asyncId` as the pending run
  identity, always with child index `0`.
- Workflow identity is `(parentToolCallId, workflowRunId, childId)` from
  `WorkflowChildSummaryV1`. Never use flattened result position, workflow result
  `SingleResult.index`, agent, task, or launch order as workflow identity.
- Inspect workflow summaries only at `details.workflowChildren` and
  `details.completions[*].workflowChildren`; inspect direct completion only at
  `details.completions[*]`. Do not recursively search result objects or read
  undocumented artifacts, receipts, transcripts, or status files.
- Missing agent, model, and thinking metadata stays absent. Do not resolve or
  infer it from tool arguments, agent files, parent settings, model strings, or
  workflow source.
- Persist only the versioned `PersistedSubagentProgress` union under Pi custom
  type `patchmill-subagent-progress`. Do not emit `custom_message` entries.
- Persisted and observed projections must not contain task text, prompts, child
  output, messages, credentials, tool arguments, artifact/transcript paths, full
  result objects, or unrestricted metadata.
- Append each changed authoritative tuple without replacing earlier entries;
  suppress exact duplicate tuple keys per originating parent and child.
- Keep dynamic workflow inventory open until `inventoryComplete` or a v1
  terminal workflow state (`completed`, `failed`, or `stopped`) closes it. Emit
  no unresolved fallback while inventory is open.
- On closure, append exactly one `unresolved: true` fallback for each
  inventoried child that never had canonical agent metadata. Process final
  authoritative rows before fallbacks, then append one deterministic
  workflow-only `inventoryClosed: true` closure seal; do not release state until
  every required append succeeds.
- Preserve one accounting unit for each ordinary parent Pi `toolCallId`.
  `subagent-progress` observations never increment `toolCalls`; later status and
  wait calls remain independent ordinary parent tool units.
- Enforce the approved limits: 256 active originating parents; 1,024 children
  per parent; 4,096 active children; 1,024 rows per result or summary; 32
  transitions per child; 16,384 active tuple keys; and 65,536 matching custom
  entries per session.
- Enforce non-negative safe direct indexes; bounded nonblank direct identifiers
  under the existing 1,024 UTF-16-code-unit direct ceiling; direct agent/model/
  thinking ceilings of 256/512/128 UTF-16 code units; workflow identifiers,
  agents, and models at 256 UTF-8 bytes; workflow thinking at 32 UTF-8 bytes;
  and child IDs matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`.
- Never truncate accepted values. Oversized containers and state ceilings throw
  `PATCHMILL_SUBAGENT_PROGRESS_LIMIT_EXCEEDED` before mutation. Invalid required
  identity or unsupported versions fail closed; invalid optional metadata is
  omitted without exposing its rejected value.
- `appendEntry()` must happen before the tuple enters in-memory deduplication.
  Append failure preserves the original cause under
  `PATCHMILL_SUBAGENT_PROGRESS_APPEND_FAILED` and leaves the tuple retryable.
- Matching custom entries from the active session all count toward the session
  ceiling, including malformed or legacy entries. Only valid v1 entries restore
  correlation and deduplication state.
- The exact parent session allocated by `runPiPrompt()` remains the only
  observed file. Sibling, nested, stale, and child session files remain
  invisible.
- Apply Patchmill's Testing Value Gate: add automated tests for runtime
  correlation, validation, async state, fallback behavior, exact-session
  ownership, accounting, and todo refresh. Do not add tests that only restate a
  version string, lockfile text, Nix source text, or package metadata; verify
  those directly with the existing dependency contract, loader, pack, and Nix
  commands.
- Keep modules focused. `subagent-progress.ts` owns pure projection parsing;
  `subagent-progress-correlation.ts` owns mutable state; the extension remains a
  small Pi adapter.

---

## File Structure

- `src/pi/subagent-progress.ts` owns safe types, limits, direct/workflow
  parsers, lifecycle normalization, persisted-entry parsing, and collision-safe
  tuple keys. It retains no raw input.
- `src/pi/subagent-progress-correlation.ts` is the new stateful core. It owns
  active direct/workflow inventory, run-to-parent mappings, session-wide tuple
  deduplication, transition counts, closed-workflow fingerprints, append order,
  fallback generation, and session restoration.
- `src/pi/extensions/run-once-subagent-progress.ts` remains the adapter that
  forwards `session_start`, `tool_execution_update`, and `tool_execution_end`
  events for `subagent` and `subagent_wait` to the correlator.
- `src/cli/commands/run-once/pi-session-stream.ts` owns persisted custom-entry
  revalidation and exact-session defensive deduplication before emitting
  `subagent-progress` observations.
- `src/cli/commands/run-once/pipeline-progress.ts` continues to count only
  ordinary `tool-call` observations; focused tests lock this accounting rule.
- `src/cli/commands/run-once/pipeline-implementation.ts` refreshes issue todo
  progress for both `tool-call` and `subagent-progress` observations.
- `scripts/verify-pi-subagents-child-metadata.mjs` verifies the current
  structured single and `workflowScript` metadata surfaces instead of removed
  legacy task/count/chain payloads.
- Existing compiled-profile, installed-extension, packed-artifact, and Nix
  checks exercise the observer's new relative import without changing profile
  ordering or loading the observer in triage.

---

### Task 1: Define the Versioned Safe Progress Contract and Parsers

**Files:**

- Modify: `src/pi/subagent-progress.ts:1-110`
- Modify: `src/pi/subagent-progress.test.ts:1-261`

**Interfaces:**

- Consumes: unknown lifecycle result values and unknown persisted custom-entry
  data.
- Produces: `ChildLifecycleState`, `PersistedSubagentProgress`,
  `DirectSingleSnapshot`, `DirectCompletionSnapshot`, `WorkflowChildSummaryV1`,
  `parseDirectSingleSnapshot()`, `parseDirectCompletionSnapshots()`,
  `parseWorkflowChildSummaries()`, `parsePersistedSubagentProgress()`,
  `subagentProgressKey()`, and the existing stable custom type, limit, and error
  constants.
- Privacy contract: every parser constructs a new allowlisted object and never
  returns or retains an input row or result object.

- [ ] **Step 1: Replace the old unversioned normalizer tests with failing v1
      parser tests**

  Start `src/pi/subagent-progress.test.ts` with fixtures for the two persisted
  variants and the documented upstream slots:

  ```ts
  import assert from "node:assert/strict";
  import { test } from "node:test";
  import {
    parseDirectCompletionSnapshots,
    parseDirectSingleSnapshot,
    parsePersistedSubagentProgress,
    parseWorkflowChildSummaries,
    SUBAGENT_PROGRESS_LIMIT_ERROR,
    SUBAGENT_PROGRESS_LIMITS,
    subagentProgressKey,
    type PersistedSubagentProgress,
  } from "./subagent-progress.ts";

  test("parses direct children by run id and upstream index", () => {
    assert.deepEqual(
      parseDirectSingleSnapshot({
        details: {
          mode: "single",
          runId: "run-direct",
          results: [
            {
              index: 7,
              agent: "worker",
              model: "provider/model",
              thinking: "high",
              exitCode: 0,
              task: "SECRET_TASK",
              output: "SECRET_OUTPUT",
            },
          ],
        },
      }),
      {
        runId: "run-direct",
        children: [
          {
            childIndex: 7,
            state: "completed",
            agent: "worker",
            model: "provider/model",
            thinking: "high",
          },
        ],
        pendingAsyncSingle: false,
      },
    );
  });

  test("uses the documented async single identity without inferring metadata", () => {
    assert.deepEqual(
      parseDirectSingleSnapshot({
        details: {
          mode: "single",
          asyncId: "run-async",
          results: [],
        },
      }),
      {
        runId: "run-async",
        children: [],
        pendingAsyncSingle: true,
      },
    );
  });

  test("parses only documented workflow summary slots", () => {
    const summary = {
      version: 1,
      parentToolCallId: "call-launch",
      workflowRunId: "workflow-1",
      inventoryComplete: false,
      workflowState: "running",
      children: [
        {
          childId: "compile",
          agent: "worker",
          model: "provider/model",
          thinking: "high",
          state: "running",
          task: "SECRET_TASK",
        },
      ],
    };
    assert.deepEqual(
      parseWorkflowChildSummaries({
        details: {
          mode: "workflow",
          workflowChildren: summary,
          results: [{ index: 0, task: "SECRET_FLATTENED_RESULT" }],
        },
        hidden: { workflowChildren: { ...summary, workflowRunId: "wrong" } },
      }),
      [
        {
          version: 1,
          parentToolCallId: "call-launch",
          workflowRunId: "workflow-1",
          inventoryComplete: false,
          workflowState: "running",
          children: [
            {
              childId: "compile",
              agent: "worker",
              model: "provider/model",
              thinking: "high",
              state: "running",
            },
          ],
        },
      ],
    );
  });
  ```

  Add table-driven assertions for these meaningful regressions:
  - direct lifecycle precedence: `detached`, `stopped`, `interrupted`, explicit
    acceptance rejection, exit code `0`, and nonzero exit code normalize to
    `detached`, `stopped`, `paused`, `rejected`, `completed`, and `failed`;
  - array position never substitutes for a missing direct `index`;
  - a nonempty direct result requires `details.runId`, while an empty async
    launch requires `details.asyncId`;
  - direct completion reads only `details.completions`, requires a valid
    completion `runId`, and exposes one optional child projection only when the
    completion has exactly one child row;
  - workflow summaries are accepted from `details.workflowChildren` and
    `details.completions[*].workflowChildren`, not nested or flattened rows;
  - unsupported versions, invalid required identifiers/states, duplicate child
    IDs, non-array children, and over-1,024-row summaries invalidate the whole
    summary before returning any child;
  - malformed optional metadata disappears while valid identity and lifecycle
    remain;
  - direct UTF-16, workflow UTF-8 byte, direct-index, and workflow child-ID
    boundaries accept exact maxima and reject one-unit excesses without
    truncation;
  - `parsePersistedSubagentProgress()` accepts each v1 discriminant, rejects the
    old unversioned five-field shape, rebuilds an allowlisted projection from a
    secret-bearing object, and accepts only `unresolved: true` when that field
    is present; and
  - `subagentProgressKey()` differs by kind, parent, run/workflow identity,
    child identity, lifecycle, optional metadata, and unresolved marker.

- [ ] **Step 2: Run the focused parser test and verify the red state**

  Run:

  ```sh
  node --test src/pi/subagent-progress.test.ts
  ```

  Expected: FAIL because the new v1 parser exports and discriminated union do
  not exist and the old normalizer still accepts only agent-bearing flattened
  result rows.

- [ ] **Step 3: Implement the pure v1 contract and bounded parsers**

  Replace the old `SubagentProgress` type and `parseSubagentProgressResults()`
  with this public shape:

  ```ts
  export type ChildLifecycleState =
    | "pending"
    | "running"
    | "completed"
    | "failed"
    | "paused"
    | "stopped"
    | "rejected"
    | "detached";

  export type PersistedSubagentProgress =
    | {
        version: 1;
        kind: "direct";
        toolCallId: string;
        runId: string;
        childIndex: number;
        state?: ChildLifecycleState;
        agent?: string;
        model?: string;
        thinking?: string;
        unresolved?: true;
      }
    | {
        version: 1;
        kind: "workflow";
        toolCallId: string;
        workflowRunId: string;
        childId: string;
        state: ChildLifecycleState;
        agent?: string;
        model?: string;
        thinking?: string;
        unresolved?: true;
        inventoryClosed?: true;
      };

  export type DirectSingleSnapshot = {
    runId: string;
    children: Array<{
      childIndex: number;
      state?: ChildLifecycleState;
      agent?: string;
      model?: string;
      thinking?: string;
    }>;
    pendingAsyncSingle: boolean;
  };

  export type DirectCompletionSnapshot = {
    runId: string;
    state?: ChildLifecycleState;
    child?: {
      agent?: string;
      model?: string;
      thinking?: string;
    };
  };

  export type WorkflowChildSummaryV1 = {
    version: 1;
    parentToolCallId: string;
    workflowRunId: string;
    inventoryComplete: boolean;
    workflowState:
      | "queued"
      | "running"
      | "completed"
      | "failed"
      | "paused"
      | "stopped";
    children: Array<{
      childId: string;
      state: ChildLifecycleState;
      agent?: string;
      model?: string;
      thinking?: string;
    }>;
  };
  ```

  Extend `SUBAGENT_PROGRESS_LIMITS` with named direct/workflow limits from the
  Global Constraints. Use `TextEncoder().encode(value).byteLength` for workflow
  byte ceilings and `value.length` for direct UTF-16 ceilings. Validate strings
  with trimming only to reject blank values; preserve accepted strings verbatim.

  Implement lifecycle normalization with explicit field precedence only. Do not
  inspect error text:

  ```ts
  function directLifecycleState(row: Record<string, unknown>) {
    if (row.detached === true) return "detached" as const;
    if (row.stopped === true) return "stopped" as const;
    if (row.interrupted === true) return "paused" as const;
    if (isRecord(row.acceptance) && row.acceptance.status === "rejected") {
      return "rejected" as const;
    }
    if (typeof row.exitCode === "number") {
      return row.exitCode === 0 ? "completed" : "failed";
    }
    return undefined;
  }
  ```

  Make every parser first validate its whole bounded container, then allocate
  safe rows. `parseWorkflowChildSummaries()` must read exactly two locations:
  the top-level details summary and each completion's summary. Do not recurse.
  `parsePersistedSubagentProgress()` must create a fresh direct or workflow
  object field by field so unknown properties cannot cross the boundary.

- [ ] **Step 4: Run parser tests and focused lint**

  Run:

  ```sh
  node --test src/pi/subagent-progress.test.ts
  npx eslint src/pi/subagent-progress.ts src/pi/subagent-progress.test.ts --max-warnings=0
  ```

  Expected: all parser, privacy, lifecycle, slot, key, and boundary tests PASS;
  ESLint exits 0.

- [ ] **Step 5: Commit the independently testable parser contract**

  ```sh
  git add src/pi/subagent-progress.ts src/pi/subagent-progress.test.ts
  git commit -m "feat(pi): define versioned child progress contract"
  ```

---

### Task 2: Correlate Direct Foreground and Async Single Children

**Files:**

- Create: `src/pi/subagent-progress-correlation.ts`
- Create: `src/pi/subagent-progress-correlation.test.ts`

**Interfaces:**

- Consumes: the Task 1 parser functions, lifecycle events, existing parent
  session entries, and one synchronous append callback.
- Produces:
  `createSubagentProgressCorrelator(options): SubagentProgressCorrelator`, with
  `restore(entries)` and `observe(event)` methods.
- Direct state contract: foreground children use `(runId, index)` under the
  current launch tool call; async single launch retains `(asyncId, 0)` until a
  matching documented completion arrives.

- [ ] **Step 1: Write failing direct-correlation tests around the public
      correlator**

  Create `src/pi/subagent-progress-correlation.test.ts` with this harness:

  ```ts
  import assert from "node:assert/strict";
  import { test } from "node:test";
  import {
    createSubagentProgressCorrelator,
    SUBAGENT_PROGRESS_APPEND_ERROR,
  } from "./subagent-progress-correlation.ts";
  import type { PersistedSubagentProgress } from "./subagent-progress.ts";

  function harness() {
    const entries: PersistedSubagentProgress[] = [];
    let appendError: Error | undefined;
    const correlator = createSubagentProgressCorrelator({
      append(progress) {
        if (appendError) {
          const error = appendError;
          appendError = undefined;
          throw error;
        }
        entries.push(progress);
      },
    });
    return {
      correlator,
      entries,
      failNextAppend(error: Error) {
        appendError = error;
      },
    };
  }

  test("correlates a direct result by run id and non-positional index", () => {
    const state = harness();
    state.correlator.observe({
      phase: "end",
      toolName: "subagent",
      toolCallId: "call-launch",
      result: {
        details: {
          mode: "single",
          runId: "run-direct",
          results: [{ index: 9, agent: "worker", exitCode: 0 }],
        },
      },
    });
    assert.deepEqual(state.entries, [
      {
        version: 1,
        kind: "direct",
        toolCallId: "call-launch",
        runId: "run-direct",
        childIndex: 9,
        state: "completed",
        agent: "worker",
      },
    ]);
  });

  test("retains one async single identity until completion", () => {
    const state = harness();
    state.correlator.observe({
      phase: "end",
      toolName: "subagent",
      toolCallId: "call-launch",
      result: {
        details: {
          mode: "single",
          asyncId: "run-async",
          results: [],
        },
      },
    });
    state.correlator.observe({
      phase: "end",
      toolName: "subagent_wait",
      toolCallId: "call-wait",
      result: {
        details: {
          mode: "management",
          results: [],
          completions: [
            {
              runId: "run-async",
              state: "complete",
              results: [{ agent: "reviewer", model: "provider/model" }],
            },
          ],
        },
      },
    });
    assert.deepEqual(
      state.entries.map((entry) => entry.toolCallId),
      ["call-launch", "call-launch"],
    );
    assert.deepEqual(
      state.entries.map((entry) => entry.childIndex),
      [0, 0],
    );
    assert.equal(state.entries[0]?.state, "pending");
    assert.equal(state.entries[1]?.state, "completed");
    assert.equal(state.entries[1]?.agent, "reviewer");
  });
  ```

  Add focused tests for exact duplicate suppression, changed lifecycle/metadata
  appends, no agent inference, foreground terminal fallback for an indexed child
  without agent metadata, async completion fallback exactly once, unknown run
  completion rejection, completion arrays with zero or multiple children, and
  direct children from different run IDs that share index `0`.

  Add append-failure coverage that verifies the thrown error has message
  `PATCHMILL_SUBAGENT_PROGRESS_APPEND_FAILED`, retains the original `cause`, and
  persists the same tuple on a later update. Add session restoration fixtures
  containing valid v1 direct entries plus malformed matching custom entries;
  valid tuples and run-to-parent mappings restore, while every matching custom
  entry consumes session capacity.

- [ ] **Step 2: Run the new correlator test and verify the red state**

  Run:

  ```sh
  node --test src/pi/subagent-progress-correlation.test.ts
  ```

  Expected: FAIL with `ERR_MODULE_NOT_FOUND` for the new correlation module.

- [ ] **Step 3: Implement direct correlation, deduplication, restoration, and
      append ordering**

  Create the narrow public API:

  ```ts
  export const SUBAGENT_PROGRESS_APPEND_ERROR =
    "PATCHMILL_SUBAGENT_PROGRESS_APPEND_FAILED";

  export type SubagentProgressCorrelationEvent = {
    phase: "update" | "end";
    toolName: string;
    toolCallId: string;
    result: unknown;
  };

  export type SubagentProgressCorrelator = {
    restore(entries: readonly unknown[]): void;
    observe(event: SubagentProgressCorrelationEvent): void;
  };

  export function createSubagentProgressCorrelator(options: {
    append(progress: PersistedSubagentProgress): void;
  }): SubagentProgressCorrelator;
  ```

  Keep separate bounded structures for:
  - active parent/child state and active transition keys, released at terminal
    completion;
  - session-wide valid tuple keys, retained for deduplication across terminal
    release and reload;
  - direct run-to-origin mappings; and
  - the count of all matching custom entries in the active parent session.

  For a foreground direct snapshot, preflight all new parents, children,
  transitions, active keys, and session entries before the first append. Append
  each safe tuple, then record it. On an `end` event, generate fallback only for
  indexed children lacking any canonical agent tuple, then release active state
  after all appends succeed.

  For an empty async single snapshot, append this pending identity without
  adding metadata:

  ```ts
  {
    version: 1,
    kind: "direct",
    toolCallId: event.toolCallId,
    runId: snapshot.runId,
    childIndex: 0,
    state: "pending",
  }
  ```

  A direct completion may enrich only a retained async `(runId, 0)` child. Use
  the retained launch tool-call ID, never the wait event's tool-call ID. If its
  single child projection has no valid agent, append one unresolved tuple with
  the last lifecycle state and omit model/thinking. Release only after the
  completion tuple and any fallback persist.

  In `restore()`, clear volatile in-memory state, count every session entry
  whose `type` and `customType` match, parse only valid v1 `data`, and restore
  keys, agent-seen flags, unresolved markers, and run-to-parent identity. Do not
  log or stringify invalid raw data.

- [ ] **Step 4: Add and pass every direct state-limit boundary**

  Extend the test with exact-boundary and one-over cases for active parents,
  children per parent, active children, transitions per child, active keys, and
  matching session entries. Assert the stable limit error and unchanged append
  count for every one-over case.

  Run:

  ```sh
  node --test src/pi/subagent-progress-correlation.test.ts
  npx eslint \
    src/pi/subagent-progress-correlation.ts \
    src/pi/subagent-progress-correlation.test.ts \
    --max-warnings=0
  ```

  Expected: all direct foreground, async, fallback, restoration, append-failure,
  and limit tests PASS; ESLint exits 0.

- [ ] **Step 5: Commit direct correlation as an independently reviewable unit**

  ```sh
  git add \
    src/pi/subagent-progress-correlation.ts \
    src/pi/subagent-progress-correlation.test.ts
  git commit -m "feat(pi): correlate direct subagent children"
  ```

---

### Task 3: Correlate Workflow Children Through Stable Workflow IDs

**Files:**

- Modify: `src/pi/subagent-progress-correlation.ts`
- Modify: `src/pi/subagent-progress-correlation.test.ts`

**Interfaces:**

- Consumes: Task 1 `WorkflowChildSummaryV1` projections from foreground
  progress/results, async status, and completion replay.
- Produces: independent workflow child state keyed by
  `(parentToolCallId, workflowRunId, childId)`, open-inventory retention,
  compact closed-inventory fingerprints, and one unresolved fallback per closed
  child without authoritative agent metadata.

- [ ] **Step 1: Add failing workflow identity and dynamic-inventory tests**

  Add a test whose flattened result rows both have index `0` but whose summary
  child IDs remain independent:

  ```ts
  test("keeps colliding workflow result indexes independently visible", () => {
    const state = harness();
    state.correlator.observe({
      phase: "update",
      toolName: "subagent",
      toolCallId: "call-launch",
      result: {
        details: {
          mode: "workflow",
          results: [
            { index: 0, agent: "worker", task: "SECRET_A" },
            { index: 0, agent: "reviewer", task: "SECRET_B" },
          ],
          workflowChildren: {
            version: 1,
            parentToolCallId: "call-launch",
            workflowRunId: "workflow-1",
            inventoryComplete: false,
            workflowState: "running",
            children: [
              { childId: "build", agent: "worker", state: "running" },
              { childId: "review", agent: "reviewer", state: "running" },
            ],
          },
        },
      },
    });
    assert.deepEqual(
      state.entries.map((entry) =>
        entry.kind === "workflow" ? entry.childId : "direct",
      ),
      ["build", "review"],
    );
    assert.equal(JSON.stringify(state.entries).includes("SECRET_"), false);
  });
  ```

  Add a sequential dynamic summary sequence:
  1. open inventory with child `first` pending and no agent;
  2. open inventory with `first` running plus newly discovered `second` pending;
  3. another exact duplicate open summary;
  4. closed inventory with `first` completed without agent and `second` failed
     with canonical agent; and
  5. repeated terminal replay through `details.completions[*].workflowChildren`.

  Assert no unresolved tuple appears in steps 1-3, closure emits exactly one
  fallback for `first`, `second` remains independently failed, and replay emits
  nothing.

  Add table-driven lifecycle tests for pending, running, completed, failed,
  paused, detached, stopped, and rejected children. Add changed metadata tests
  that append new tuples without replacing pending/running history.

- [ ] **Step 2: Run the workflow tests and verify the red state**

  Run:

  ```sh
  node --test --test-name-pattern="workflow|inventory|colliding" \
    src/pi/subagent-progress-correlation.test.ts
  ```

  Expected: FAIL because `observe()` does not yet process workflow summaries.

- [ ] **Step 3: Extend the correlator with atomic summary validation and open
      inventory**

  For each parsed summary:
  - use `summary.parentToolCallId`, not the current status/wait event ID, as the
    originating parent;
  - preflight parent/run consistency, complete child set, child uniqueness,
    limits, transitions, and append count before mutation;
  - key children by stable `childId` and ignore `details.results` entirely;
  - append every new safe metadata/lifecycle tuple and remember whether the
    child has ever had a canonical agent; and
  - keep the parent active while `inventoryComplete === false` and the workflow
    state is `queued`, `running`, or `paused`.

  Close inventory when `inventoryComplete` is true or workflow state is
  `completed`, `failed`, or `stopped`. Process final rows first, then append one
  fallback for each child whose `agentSeen` flag is false:

  ```ts
  {
    version: 1,
    kind: "workflow",
    toolCallId: summary.parentToolCallId,
    workflowRunId: summary.workflowRunId,
    childId: child.childId,
    state: child.lastState,
    unresolved: true,
  }
  ```

  Omit model and thinking from fallbacks; omit agent when none was resolved.
  After all final rows and fallbacks append, append a single
  `inventoryClosed: true` seal on the lexicographically first child ID; this
  workflow-only marker is part of the tuple key. Retain a compact closed
  fingerprint of child IDs plus session-wide tuple keys after releasing active
  counters. A later summary for the same closed workflow may repeat or enrich
  the same child set, but an added, removed, or renamed child invalidates that
  whole summary without mutation or logging raw values.

- [ ] **Step 4: Cover restoration, closure retries, contradictions, and workflow
      limits**

  Add tests that:
  - restore workflow parent/run/child identity, tuple keys, agent-seen flags,
    and unresolved markers from valid v1 entries; use the workflow-only
    `inventoryClosed: true` seal rather than unresolved fallbacks to reconstruct
    closed fingerprints;
  - restore malformed matching custom entries only into the session entry count;
  - retry an interrupted fallback batch after append failure without duplicating
    fallbacks that already persisted and without releasing inventory early;
  - ignore unsupported summary versions and parent/run drift atomically;
  - reject closed-inventory child-set drift without reopening it;
  - enforce 1,024 children per workflow parent and the shared active parent,
    child, key, transition, and session ceilings; and
  - accept summaries representing `runs.run`, `runs.all`, sequential control,
    dynamic control, foreground, async, failed, stopped, and rejected cases.

  Run:

  ```sh
  node --test src/pi/subagent-progress-correlation.test.ts
  npx eslint \
    src/pi/subagent-progress-correlation.ts \
    src/pi/subagent-progress-correlation.test.ts \
    --max-warnings=0
  ```

  Expected: all direct and workflow correlation tests PASS; ESLint exits 0.

- [ ] **Step 5: Commit stable workflow-child correlation**

  ```sh
  git add \
    src/pi/subagent-progress-correlation.ts \
    src/pi/subagent-progress-correlation.test.ts
  git commit -m "feat(pi): correlate workflow children by stable id"
  ```

---

### Task 4: Keep the Pi Lifecycle Extension as a Thin Correlation Adapter

**Files:**

- Modify: `src/pi/extensions/run-once-subagent-progress.ts:1-121`
- Modify: `src/pi/extensions/run-once-subagent-progress.test.ts:1-441`
- Modify: `src/pi/extensions/run-once-subagent-progress.runner.test.ts:1-98`

**Interfaces:**

- Consumes: `createSubagentProgressCorrelator()`, `ExtensionAPI.on()`,
  `ExtensionAPI.appendEntry()`, and `ctx.sessionManager.getEntries()`.
- Produces: one production extension factory with the existing three lifecycle
  handlers. It observes only `subagent` and `subagent_wait` and appends Pi
  `custom` entries using the v1 persisted union.

- [ ] **Step 1: Rewrite adapter tests to fail against the old in-extension state
      machine**

  Keep the existing narrow handler harness, but assert the adapter forwards both
  tool names and restores session entries:

  ```ts
  test("forwards subagent updates and wait completions to one correlator", async () => {
    const harness = createHarness();
    await harness.emit("session_start", { reason: "reload" });
    await harness.emit("tool_execution_update", {
      toolName: "subagent",
      toolCallId: "call-launch",
      partialResult: {
        details: {
          mode: "workflow",
          results: [],
          workflowChildren: workflowSummary({
            inventoryComplete: false,
            state: "running",
          }),
        },
      },
    });
    await harness.emit("tool_execution_end", {
      toolName: "subagent_wait",
      toolCallId: "call-wait",
      result: {
        details: {
          mode: "management",
          results: [],
          completions: [
            {
              runId: "workflow-1",
              workflowChildren: workflowSummary({
                inventoryComplete: true,
                state: "completed",
              }),
            },
          ],
        },
      },
      isError: false,
    });
    assert.ok(
      harness.entries.every(
        (entry) =>
          entry.customType === "patchmill-subagent-progress" &&
          (entry.data as { version?: number }).version === 1,
      ),
    );
  });
  ```

  Preserve tests proving unrelated tool names and malformed events are ignored,
  terminal events are parsed even when `isError` is true, append errors retain
  their cause and retry later, and the adapter registers exactly
  `session_start`, `tool_execution_update`, and `tool_execution_end`.

  Remove old tests that directly assert private parent-map behavior now owned by
  `subagent-progress-correlation.test.ts`; retain adapter boundary behavior
  only.

- [ ] **Step 2: Run adapter tests and verify the red state**

  Run:

  ```sh
  node --test src/pi/extensions/run-once-subagent-progress.test.ts
  ```

  Expected: FAIL because the current extension parses only flattened
  `details.results`, ignores `subagent_wait`, emits an unversioned shape, and
  resets rather than restores deduplication state.

- [ ] **Step 3: Replace extension-owned maps with the correlation facade**

  Reduce the production factory to this responsibility:

  ```ts
  export default function runOnceSubagentProgressExtension(
    pi: Pick<ExtensionAPI, "on" | "appendEntry">,
  ): void {
    const correlator = createSubagentProgressCorrelator({
      append(progress) {
        pi.appendEntry(SUBAGENT_PROGRESS_CUSTOM_TYPE, progress);
      },
    });

    pi.on("session_start", (_event, ctx) => {
      correlator.restore(ctx.sessionManager.getEntries());
    });
    pi.on("tool_execution_update", (event) => {
      if (event.toolName !== "subagent" && event.toolName !== "subagent_wait")
        return;
      correlator.observe({
        phase: "update",
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        result: event.partialResult,
      });
    });
    pi.on("tool_execution_end", (event) => {
      if (event.toolName !== "subagent" && event.toolName !== "subagent_wait")
        return;
      correlator.observe({
        phase: "end",
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        result: event.result,
      });
    });
  }
  ```

  Do not inspect `event.args`, infer launch cardinality from arbitrary
  arguments, branch on `event.isError`, log event/result data, or register a
  test-only extension entry point.

- [ ] **Step 4: Update the real Pi runner test for v1 append/retry behavior**

  Change `run-once-subagent-progress.runner.test.ts` so the first update append
  fails, Pi reports `PATCHMILL_SUBAGENT_PROGRESS_APPEND_FAILED`, and an
  equivalent terminal event persists this exact retry:

  ```ts
  {
    customType: "patchmill-subagent-progress",
    data: {
      version: 1,
      kind: "direct",
      toolCallId: "call-1",
      runId: "run-1",
      childIndex: 0,
      state: "completed",
      agent: "worker",
    },
  }
  ```

  Keep loading the default export through `discoverAndLoadExtensions()` and
  emitting through `ExtensionRunner`; do not replace this with direct handler
  invocation.

- [ ] **Step 5: Run adapter, correlator, runner, and focused lint checks**

  Run:

  ```sh
  node --test \
    src/pi/subagent-progress.test.ts \
    src/pi/subagent-progress-correlation.test.ts \
    src/pi/extensions/run-once-subagent-progress.test.ts \
    src/pi/extensions/run-once-subagent-progress.runner.test.ts
  npx eslint \
    src/pi/subagent-progress.ts \
    src/pi/subagent-progress-correlation.ts \
    src/pi/extensions/run-once-subagent-progress.ts \
    src/pi/extensions/run-once-subagent-progress.test.ts \
    src/pi/extensions/run-once-subagent-progress.runner.test.ts \
    --max-warnings=0
  ```

  Expected: all focused tests PASS and ESLint exits 0.

- [ ] **Step 6: Commit the thin lifecycle adapter**

  ```sh
  git add \
    src/pi/extensions/run-once-subagent-progress.ts \
    src/pi/extensions/run-once-subagent-progress.test.ts \
    src/pi/extensions/run-once-subagent-progress.runner.test.ts
  git commit -m "refactor(pi): delegate child progress correlation"
  ```

---

### Task 5: Stream Bounded Progress from the Exact Parent Session

**Files:**

- Modify: `src/cli/commands/run-once/pi-session-stream.ts:13-20,154-201,326-408`
- Modify:
  `src/cli/commands/run-once/pi.test.ts:325-475,835-900,1083-1120,1350-1440`

**Interfaces:**

- Consumes: Pi session entries whose `type` is exactly `custom` and whose
  `customType` is exactly `patchmill-subagent-progress`.
- Produces: `PiSessionObservation` variant
  `{ type: "subagent-progress"; progress: PersistedSubagentProgress }`, with
  exact-session tuple deduplication and matching-entry limits.
- Ownership contract: production `runPiPrompt()` continues to observe only its
  preallocated exact parent JSONL path.

- [ ] **Step 1: Add failing pure custom-entry parser and data-boundary tests**

  Extend `sessionEntryToObservations()` tests in `pi.test.ts`:

  ```ts
  test("sessionEntryToObservations emits only bounded v1 child progress", () => {
    assert.deepEqual(
      sessionEntryToObservations({
        type: "custom",
        customType: "patchmill-subagent-progress",
        data: {
          version: 1,
          kind: "workflow",
          toolCallId: "call-launch",
          workflowRunId: "workflow-1",
          childId: "review",
          state: "running",
          agent: "reviewer",
          task: "SECRET_TASK",
          output: "SECRET_OUTPUT",
          credentials: "SECRET_CREDENTIAL",
          transcriptPath: "/secret/session.jsonl",
        },
      }),
      [
        {
          type: "subagent-progress",
          progress: {
            version: 1,
            kind: "workflow",
            toolCallId: "call-launch",
            workflowRunId: "workflow-1",
            childId: "review",
            state: "running",
            agent: "reviewer",
          },
        },
      ],
    );
  });
  ```

  Add cases for valid direct progress, unresolved fallbacks, wrong custom type,
  `custom_message`, unsupported versions, malformed required identity, overlong
  fields, invalid lifecycle, and secret-bearing optional metadata. Assert no
  discarded secret appears in serialized observations.

- [ ] **Step 2: Run the pure parser tests and verify the red state**

  Run:

  ```sh
  node --test --test-name-pattern="sessionEntryToObservations" \
    src/cli/commands/run-once/pi.test.ts
  ```

  Expected: FAIL because custom progress entries currently produce no
  observation.

- [ ] **Step 3: Add the observation variant and exact-stream defensive state**

  Import `parsePersistedSubagentProgress()`, `subagentProgressKey()`, and the
  persisted type from `src/pi/subagent-progress.ts`. Extend the union:

  ```ts
  export type PiSessionObservation =
    | { type: "assistant-usage"; outputTokens: number }
    | {
        type: "tool-call";
        toolName?: string;
        toolCallId?: string;
        arguments?: JsonObject;
      }
    | {
        type: "subagent-progress";
        progress: PersistedSubagentProgress;
      }
    | { type: "text"; text: string };
  ```

  In `sessionEntryToObservations()`, recognize only exact matching custom
  entries, parse `entry.data` into a fresh allowlisted object, and return no
  observation for invalid input.

  In `createExactPiSessionObservationStreamer()`, retain these sets/counters per
  exact session:
  - existing `observedToolCallIds`, unchanged;
  - `observedSubagentProgressKeys` for valid persisted tuple keys; and
  - `matchingSubagentProgressEntries`, incremented for every exact matching
    custom entry before validation.

  Skip an exact duplicate tuple and skip any matching entry after the 65,536
  session ceiling. Do not add custom progress parsing to raw text rendering or
  the directory-discovery legacy streamer.

- [ ] **Step 4: Add a production `runPiPrompt()` pending-process ownership
      test**

  Add a test that starts a mock Pi process, captures its exact `--session` path,
  writes one parent custom progress entry while the process remains unresolved,
  and waits until `onObservation` receives it before allowing Pi to return. In
  the same invocation directory, write matching entries to a sibling and a
  nested JSONL. Assert only the parent child ID is observed:

  ```ts
  assert.deepEqual(
    observations
      .filter((entry) => entry.type === "subagent-progress")
      .map((entry) =>
        entry.progress.kind === "workflow" ? entry.progress.childId : "direct",
      ),
    ["parent-child"],
  );
  assert.equal(processResolvedBeforeProgress, false);
  ```

  Append an exact duplicate parent entry and a changed lifecycle entry. Assert
  the duplicate is suppressed and the changed tuple is delivered in order. This
  test must use the production `runPiPrompt()` facade and exact session
  allocation, not a helper-only fixture.

- [ ] **Step 5: Run exact-session and production wiring tests**

  Run:

  ```sh
  node --test src/cli/commands/run-once/pi.test.ts
  npx eslint \
    src/cli/commands/run-once/pi-session-stream.ts \
    src/cli/commands/run-once/pi.test.ts \
    --max-warnings=0
  ```

  Expected: parser, duplicate, changed-transition, matching-entry-limit,
  pre-terminal delivery, and sibling/nested isolation tests PASS; ESLint
  exits 0.

- [ ] **Step 6: Commit exact-session child observations**

  ```sh
  git add \
    src/cli/commands/run-once/pi-session-stream.ts \
    src/cli/commands/run-once/pi.test.ts
  git commit -m "feat(run-once): stream bounded child progress"
  ```

---

### Task 6: Preserve Tool Accounting and Refresh Implementation Todos on Child Progress

**Files:**

- Modify: `src/cli/commands/run-once/pipeline-implementation.ts:338-345`
- Modify: `src/cli/commands/run-once/pipeline-progress.test.ts:1-86`
- Modify:
  `src/cli/commands/run-once/pipeline-progress-scenarios.test.ts:290-525`
- Modify: `test-support/run-once/mock-runner.ts:190-225`

**Interfaces:**

- Consumes: `subagent-progress` observations delivered by Task 5.
- Produces: implementation todo refresh on both ordinary tool calls and child
  progress; unchanged `createStepAccounting()` behavior in which only ordinary
  tool calls increment `toolCalls`.

- [ ] **Step 1: Write a failing unit accounting test**

  Add to `pipeline-progress.test.ts`:

  ```ts
  test("child transitions never increment parent tool-call accounting", async () => {
    const { events, progress: reporter } = collectProgressEvents();
    const accounting = createStepAccounting({
      progress: reporter,
      issueNumber: 125,
    });
    await accounting.start("implement task 1/1 correlation");
    await accounting.observe("pi-implementation", {
      type: "tool-call",
      toolName: "subagent",
      toolCallId: "call-launch",
    });
    for (const state of ["pending", "running", "completed"] as const) {
      await accounting.observe("pi-implementation", {
        type: "subagent-progress",
        progress: {
          version: 1,
          kind: "workflow",
          toolCallId: "call-launch",
          workflowRunId: "workflow-1",
          childId: "worker",
          state,
          agent: "worker",
        },
      });
    }
    await accounting.complete();
    const completed = events.find(
      (event) => event.step?.type === "step-complete",
    );
    assert.equal(completed?.step?.toolCalls, 1);
  });
  ```

  This test passes the Testing Value Gate because it protects parent-level
  accounting against a realistic multi-transition regression rather than
  restating a conditional.

- [ ] **Step 2: Add a failing implementation scenario for early todo refresh**

  Add a test-support helper that appends an exact custom progress entry:

  ```ts
  export function subagentProgressEntry(data: unknown): unknown {
    return {
      type: "custom",
      customType: "patchmill-subagent-progress",
      data,
    };
  }
  ```

  Extend the existing streamed implementation-progress scenario or add one
  adjacent to it with two planned tasks. While mocked Pi is still pending:
  1. append ordinary launch tool call `call-launch`;
  2. close task 1 and mark task 2 in progress;
  3. append workflow child `build` running and `review` pending entries sharing
     `call-launch`;
  4. wait for task 2's `step-start` before resolving Pi;
  5. append changed completed/failed child tuples;
  6. append ordinary status tool call `call-status` and ordinary wait tool call
     `call-wait`, including duplicate tool-result rows for those same IDs; and
  7. close task 2, append the terminal child tuple, then return the normal
     `pr-created` result.

  Assert:

  ```ts
  assert.equal(taskTwoStartedBeforePiReturned, true);
  assert.deepEqual(observedChildIds, ["build", "review", "build", "review"]);
  assert.equal(taskOneCompletion?.step?.toolCalls, 1);
  assert.equal(taskTwoCompletion?.step?.toolCalls, 2);
  ```

  The two task-2 units are the real status and wait calls. Child count,
  transition count, and duplicate tool-result observations contribute zero.

- [ ] **Step 3: Run the pipeline tests and verify the red state**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/pipeline-progress.test.ts \
    src/cli/commands/run-once/pipeline-progress-scenarios.test.ts
  ```

  Expected: the accounting unit test may already pass because the existing
  branch counts only `tool-call`, but the integration scenario FAILS because
  `pipeline-implementation.ts` refreshes todos only for ordinary tool calls.
  Keeping the passing accounting test is intentional regression coverage; do not
  force an artificial red state by changing correct production code.

- [ ] **Step 4: Refresh implementation progress for both observation types**

  Change the implementation observer condition only:

  ```ts
  if (
    observation?.type === "tool-call" ||
    observation?.type === "subagent-progress"
  ) {
    await refreshImplementationTask({ startFinalWhenComplete: true });
  }
  await observePi("pi-implementation")(observation);
  ```

  Do not increment accounting here and do not derive a synthetic parent tool
  call from `progress.toolCallId`. Planning and development-environment stages
  continue to pass the new observation through `observePi()` for debug recording
  only.

- [ ] **Step 5: Run focused implementation and run-once pipeline tests**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/pipeline-progress.test.ts \
    src/cli/commands/run-once/pipeline-progress-scenarios.test.ts \
    src/cli/commands/run-once/pipeline-implementation.test.ts \
    src/cli/commands/run-once/pipeline-implementation-scenarios.test.ts
  npx eslint \
    src/cli/commands/run-once/pipeline-implementation.ts \
    src/cli/commands/run-once/pipeline-progress.test.ts \
    src/cli/commands/run-once/pipeline-progress-scenarios.test.ts \
    test-support/run-once/mock-runner.ts \
    --max-warnings=0
  ```

  Expected: early task switch, independent child debug observations, one launch
  accounting unit, and one status/wait unit each all PASS; ESLint exits 0.

- [ ] **Step 6: Commit accounting and todo-refresh behavior**

  ```sh
  git add \
    src/cli/commands/run-once/pipeline-implementation.ts \
    src/cli/commands/run-once/pipeline-progress.test.ts \
    src/cli/commands/run-once/pipeline-progress-scenarios.test.ts \
    test-support/run-once/mock-runner.ts
  git commit -m "feat(run-once): refresh todos on child progress"
  ```

---

### Task 7: Replace Legacy Live Metadata Fixtures with Current Execution Shapes

**Files:**

- Modify: `scripts/verify-pi-subagents-child-metadata.mjs:1-405`
- Modify: `scripts/verify-pi-subagents-child-metadata.test.mjs:1-379`

**Interfaces:**

- Consumes: raw Pi lifecycle JSON for structured direct calls and current
  `workflowScript` calls.
- Produces: independent live assertions for direct `(runId, index)` identity and
  workflow `workflowChildren` v1 parent/run/child identity, inventory closure,
  canonical metadata, and optional thinking absence.
- Credential contract: retain the existing
  `PATCHMILL_PI_SUBAGENTS_CONTRACT_MODEL`,
  `PATCHMILL_PI_SUBAGENTS_CONTRACT_THINKING`,
  `PATCHMILL_PI_SUBAGENTS_CONTRACT_NO_THINKING_MODEL`, and optional parent model
  environment variables.

- [ ] **Step 1: Replace unit fixtures with failing current-contract validators**

  Rename the old generic validator into explicit surfaces:

  ```js
  export function validateDirectShapeContract(options) {}
  export function validateWorkflowShapeContract(options) {}
  ```

  In `verify-pi-subagents-child-metadata.test.mjs`, construct raw update/end
  events that prove:
  - direct partial/final rows retain one `details.runId` and stable
    non-positional indexes;
  - async direct completion retains the original run ID;
  - workflow summaries retain version `1`, launch `parentToolCallId`, one
    `workflowRunId`, stable expected child IDs, canonical metadata, and closed
    inventory at terminal completion;
  - two workflow child result rows with index `0` do not affect validation by
    child ID;
  - open dynamic inventory can add a child before terminal closure;
  - malformed version, parent drift, run drift, duplicate/missing child IDs,
    missing closure, missing model, unexpected thinking, child failure, and
    failed tool results reject with a concise contract error; and
  - no validator searches arbitrary nested values.

  These are behavioral API-contract tests and pass the Testing Value Gate. Do
  not add a test that merely reads `package.json` and asserts `0.57.0`; the
  existing dependency-contract test already directly validates the pin and
  installed manifest.

- [ ] **Step 2: Run script unit tests and verify the red state**

  Run:

  ```sh
  node --test scripts/verify-pi-subagents-child-metadata.test.mjs
  ```

  Expected: FAIL because only the legacy direct/count/parallel/chain validator
  exists and it has no `workflowChildren` v1 validation.

- [ ] **Step 3: Implement direct and workflow event collectors without sharing
      Patchmill's production parser**

  Keep this script as an independent upstream contract check. Read only the
  documented raw fields and assert them directly rather than importing
  `src/pi/subagent-progress.ts`.

  Define the credentialed foreground workflow matrix with exact scripts:

  ```js
  const workflowCases = [
    {
      label: "workflow-runs-run",
      childIds: ["single"],
      workflowScript:
        'return await runs.run("single", {agent:"contract-thinking", task:"Return workflow single."});',
    },
    {
      label: "workflow-runs-all",
      childIds: ["parallel-a", "parallel-b"],
      workflowScript:
        'return await runs.all([{key:"parallel-a",agent:"contract-thinking",task:"Return parallel a."},{key:"parallel-b",agent:"contract-thinking",task:"Return parallel b."}]);',
    },
    {
      label: "workflow-sequential",
      childIds: ["first", "second"],
      workflowScript:
        'const first=await runs.run("first",{agent:"contract-thinking",task:"Return first."}); if(!first){return "missing first";} return await runs.run("second",{agent:"contract-thinking",task:"Return second."});',
    },
    {
      label: "workflow-dynamic",
      childIds: ["dynamic-a", "dynamic-b"],
      workflowScript:
        'const keys=["dynamic-a","dynamic-b"]; const values=[]; for(const key of keys){values.push(await runs.run(key,{agent:"contract-thinking",task:`Return ${key}.`}));} return values.length;',
    },
  ];
  ```

  Execute each with `async: false` so the foreground result must close
  inventory. Add one async workflow case using the `runs.all` script with
  `async: true`; its parent prompt must launch once, call `subagent_wait` with
  the returned workflow run ID, and stop only after terminal completion replay.
  Keep direct foreground, direct async completion, explicit-thinking, and
  no-thinking agent cases.

  Validate failed, stopped, rejected, paused, and detached lifecycle parsing in
  deterministic unit fixtures from Step 1; do not make the credentialed metadata
  smoke depend on timing a long-running child solely to manufacture each state.

- [ ] **Step 4: Run independent contract unit tests and the credentialed smoke
      when credentials are available**

  Always run:

  ```sh
  node --test scripts/verify-pi-subagents-child-metadata.test.mjs
  ```

  In the credentialed validation environment, run:

  ```sh
  node scripts/verify-pi-subagents-child-metadata.mjs
  ```

  Expected: unit fixtures PASS. The live command reports PASS for structured
  direct foreground/async, `runs.run`, `runs.all`, sequential, dynamic,
  foreground/async workflow, explicit-thinking, and no-thinking contracts.

- [ ] **Step 5: Lint and commit the current upstream contract matrix**

  Run:

  ```sh
  npx prettier --check \
    scripts/verify-pi-subagents-child-metadata.mjs \
    scripts/verify-pi-subagents-child-metadata.test.mjs
  ```

  Expected: Prettier exits 0.

  Commit:

  ```sh
  git add \
    scripts/verify-pi-subagents-child-metadata.mjs \
    scripts/verify-pi-subagents-child-metadata.test.mjs
  git commit -m "test(pi): verify current child metadata surfaces"
  ```

---

### Task 8: Preserve Compiled, Packed, and Nix-Installed Runtime Layout

**Files:**

- Modify: `src/pi/resource-profiles.compiled.test.ts:30-90`
- Modify: `nix/package.nix:78-83`
- Verify without source changes:
  `src/pi/extensions/run-once-subagent-progress.load.test.ts`
- Verify without source changes:
  `fixtures/run-once-installed-extension-load.mjs`
- Verify without source changes: `scripts/smoke-packed-artifact.mjs`
- Verify without source changes:
  `src/pi/pi-subagents-dependency-contract.test.ts`

**Interfaces:**

- Consumes: the observer's new relative import of
  `src/pi/subagent-progress-correlation.ts`.
- Produces: source, compiled, npm-packed, and Nix-installed layouts in which the
  observer and both focused support modules exist and load through Pi before the
  sentinel fixture.
- Testing Value Gate: adjust executable layout staging and direct installed-file
  assertions; do not create tests that parse static package or Nix text.

- [ ] **Step 1: Update compiled-layout staging and Nix installed-file checks**

  In `resource-profiles.compiled.test.ts`, stage the new source module beside
  the existing observer and parser before importing the compiled profile:

  ```ts
  const correlation = join(
    packageRoot,
    "src",
    "pi",
    "subagent-progress-correlation.ts",
  );
  await copyFile(
    join(sourceRoot, "src", "pi", "subagent-progress-correlation.ts"),
    correlation,
  );
  ```

  Keep the existing source observer load and missing/non-file guards. The real
  Pi loader assertion must load the observer with both relative imports present.

  In `nix/package.nix`, add the direct installed-layout assertion:

  ```sh
  test -f "$out/share/${pname}/src/pi/subagent-progress-correlation.ts"
  ```

  Keep profile order exactly `pi-subagents`, todos, Patchmill observer and keep
  triage's extension list unchanged.

- [ ] **Step 2: Run source and compiled extension-load checks**

  Run:

  ```sh
  node --test \
    src/pi/resource-profiles.test.ts \
    src/pi/resource-profiles.compiled.test.ts \
    src/pi/extensions/run-once-subagent-progress.load.test.ts \
    src/pi/extensions/run-once-subagent-progress.runner.test.ts
  ```

  Expected: all source/compiled paths exist, Pi loads the observer and its new
  import, all three lifecycle handlers register, and the sentinel runs last.

- [ ] **Step 3: Verify the installed upstream dependency contract directly**

  Run:

  ```sh
  node --test src/pi/pi-subagents-dependency-contract.test.ts
  ```

  Expected: the root exact pin, both lockfiles, installed manifest, declared
  upstream extension files, and offline Pi extension loading all agree on
  `pi-subagents` 0.57.0. If this resolves an older local installation, run
  `devenv shell -- npm ci` and rerun; do not change production pins.

- [ ] **Step 4: Commit runtime-layout support**

  Run:

  ```sh
  git add src/pi/resource-profiles.compiled.test.ts nix/package.nix
  git commit -m "test(pi): preserve progress observer runtime layout"
  ```

- [ ] **Step 5: Run the complete focused issue suite**

  Run:

  ```sh
  node --test \
    src/pi/subagent-progress.test.ts \
    src/pi/subagent-progress-correlation.test.ts \
    src/pi/extensions/run-once-subagent-progress.test.ts \
    src/pi/extensions/run-once-subagent-progress.runner.test.ts \
    src/cli/commands/run-once/pi.test.ts \
    src/cli/commands/run-once/pipeline-progress.test.ts \
    src/cli/commands/run-once/pipeline-progress-scenarios.test.ts \
    scripts/verify-pi-subagents-child-metadata.test.mjs
  ```

  Expected: all parsing, state-machine, extension, exact-session, production
  wiring, accounting, todo-refresh, and upstream-contract fixture tests PASS.

- [ ] **Step 6: Run repository, lint, packed-artifact, Nix build, and flake
      verification**

  Run exactly:

  ```sh
  npm test
  npm run lint
  node scripts/smoke-packed-artifact.mjs
  nix build .#patchmill --no-link --print-build-logs
  nix flake check --print-build-logs
  ```

  Expected:
  - the complete test and lint suites pass;
  - npm pack installs Patchmill and loads `pi-subagents`, todos, the observer,
    parser, and correlator before the sentinel;
  - the Nix package install check finds and loads the same files and upstream
    extension; and
  - the full flake check passes.

- [ ] **Step 7: Confirm dependency and local-operator files are absent from the
      implementation diff**

  Run:

  ```sh
  git diff -- package.json package-lock.json npm-shrinkwrap.json
  git status --short -- .pi/todos
  git diff --check
  ```

  Expected: the dependency-file diff and tracked todo status produce no output;
  `git diff --check` exits 0. `.pi/todos` remains ignored local operator state.
  If dependency files changed accidentally, restore them before final review;
  this issue consumes the existing 0.57.0 pin.

---

## Final Verification Commands

Run before requesting final implementation review:

```sh
node --test \
  src/pi/subagent-progress.test.ts \
  src/pi/subagent-progress-correlation.test.ts \
  src/pi/extensions/run-once-subagent-progress.test.ts \
  src/pi/extensions/run-once-subagent-progress.runner.test.ts \
  src/cli/commands/run-once/pi.test.ts \
  src/cli/commands/run-once/pipeline-progress.test.ts \
  src/cli/commands/run-once/pipeline-progress-scenarios.test.ts \
  scripts/verify-pi-subagents-child-metadata.test.mjs
node --test src/pi/pi-subagents-dependency-contract.test.ts
npm test
npm run lint
node scripts/smoke-packed-artifact.mjs
nix build .#patchmill --no-link --print-build-logs
nix flake check --print-build-logs
git diff -- package.json package-lock.json npm-shrinkwrap.json
git diff --check
```

When the credentialed model environment is available, also run:

```sh
node scripts/verify-pi-subagents-child-metadata.mjs
```

Expected final results:

- Direct foreground and async single children correlate by originating parent,
  run ID, and upstream index.
- Workflow children with colliding flattened indexes remain independent by
  workflow run ID and stable child ID across foreground, async, sequential,
  parallel, dynamic, failed, stopped, and rejected lifecycle fixtures.
- Dynamic open inventory emits no fallback; closure emits exactly one fallback
  for each inventoried child that never received canonical agent metadata.
- Exact duplicate tuples are suppressed, changed tuples remain ordered and
  visible, append failures retry, and session reload restores safe state.
- Only the exact parent session emits bounded child progress, and forbidden
  source/result fields never cross the persisted or observation boundary.
- Implementation todos refresh before terminal Pi completion, while one launch,
  one status, and one wait call each remain one accounting unit regardless of
  child and transition counts.
- Source, compiled, npm-packed, and Nix-installed Pi extension loading pass
  against the existing exact `pi-subagents` 0.57.0 dependency.
- Dependency files remain unchanged.

## Self-Review Notes

- **Spec coverage:** Tasks 1-3 cover the versioned data contract, direct and
  workflow identity, dynamic inventory, lifecycle transitions, deduplication,
  restoration, fallback, limits, and failure behavior. Task 4 covers the Pi
  lifecycle adapter. Task 5 covers exact-session parsing, production wiring,
  ownership, deduplication, and data exclusion. Task 6 covers todo refresh and
  parent accounting. Task 7 covers current upstream execution shapes. Task 8
  covers compiled, packed, installed, dependency-contract, Nix, and full flake
  verification.
- **Testing Value Gate:** New tests protect runtime behavior, parser and API
  contracts, error handling, security-sensitive allowlists, async state, exact
  file ownership, and accounting. Static version/lock/Nix content is verified
  through existing direct contract, loader, package, and build commands rather
  than new text assertions.
- **Module boundaries:** The pure parser, mutable correlator, Pi adapter, exact
  session reader, and pipeline policy remain separate. The new state machine is
  not added to the already 582-line session streamer or 466-line implementation
  pipeline.
- **Type consistency:** `PersistedSubagentProgress`, `WorkflowChildSummaryV1`,
  `createSubagentProgressCorrelator()`, `SubagentProgressCorrelationEvent`, and
  the `subagent-progress` observation discriminant are named consistently across
  all tasks.
- **Placeholder scan:** Every task names exact files, interfaces, red/green
  commands, expected outcomes, implementation boundaries, and a Conventional
  Commit message. No implementation requirement is deferred to a later plan.
