# Persist Safe Subagent Runtime Metadata from Pi Lifecycle Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a bounded, authoritative projection of `pi-subagents` child identity and reported runtime metadata in the active parent Pi session for every non-triage run-once profile.

**Architecture:** A pure module validates and bounds unknown `result.details.results` values without retaining unrestricted input. The default Pi extension factory observes partial and terminal lifecycle events, appends unseen custom entries, and applies explicit parent, child, key, transition, and session-entry back-pressure. Source and installed-layout checks load the production entry point through Pi's loader and runner before proving full profile startup with a packaged sentinel fixture.

**Tech Stack:** TypeScript 6, Node.js 24 and `node:test`, `@earendil-works/pi-coding-agent` 0.83.0, `pi-subagents` 0.39.0, npm package smokes, and Nix install checks.

## Global Constraints

- Patchmill relies on the `pi-subagents` 0.39.0 contract adopted by issue #122:
- Patchmill must not infer missing values from parent or agent configuration.
- The upstream `runId` is therefore unnecessary for this bridge and is not allowed in the persisted projection.
- Accepted strings remain verbatim after validation. Patchmill will not remove a provider prefix, split a model suffix, constrain thinking to a local enum, truncate a reported identifier, or backfill a missing value.
- A valid row with only `index` and `agent` produces an identity-only entry:
- The projection never reads or copies task, output, prompt, credential, usage, cost, path, error, message, full-result, event-argument, or other incidental properties.
- This structural guarantee does not inspect the meaning of an otherwise valid allowlisted identifier supplied by trusted `pi-subagents`.
- The key is based on the upstream child index, never the row's array position.
- Before allocating or appending state, the observer enforces these ceilings:
  - 256 active parent tool calls;
  - 1,024 child indexes for one parent tool call;
  - 4,096 active child states across all parents;
  - 16,384 active serialized tuple keys;
  - 32 persisted transitions for one `(toolCallId, childIndex)`; and
  - 65,536 `patchmill-subagent-progress` entries in one Pi session.
- Any state or session-entry ceiling breach throws the stable `PATCHMILL_SUBAGENT_PROGRESS_LIMIT_EXCEEDED` identifier before persistence or state mutation.
- The observer calls `pi.appendEntry()` before recording the key or incrementing any counter.
- The append call is the only local translation boundary: if it throws, the observer rethrows an error whose stable message is `PATCHMILL_SUBAGENT_PROGRESS_APPEND_FAILED` and retains the original error as its `cause`.
- `tool_execution_end` is parsed even when the tool reports an error because the result may still contain valid authoritative child metadata.
- Parent state is released only after terminal processing succeeds.
- On `session_start`, the observer clears active deduplication state and counts existing custom entries with `customType === "patchmill-subagent-progress"` from `ctx.sessionManager.getEntries()`.
- The shared run-once extension order will be:
  1. resolved `pi-subagents` package root;
  2. `extensions/todos.ts`; and
  3. `src/pi/extensions/run-once-subagent-progress.ts`.
- The following profiles use that list:
  - `run-once-planning`;
  - `run-once-development-environment`; and
  - `run-once-implementation`.
- The `triage` profile retains an empty extension list.
- Create `fixtures/run-once-extension-load-sentinel.ts`. It is a test fixture, not an auto-discovered extension.
- Its factory will require the `PATCHMILL_RUN_ONCE_EXTENSION_SENTINEL` environment variable and write the exact UTF-8 payload `patchmill-run-once-extensions-loaded\n`, including the final line feed, to that path.
- The fixture will not register a command, append a session entry, alter production behavior, or expose a production test flag.
- The fixture will be included in both distribution paths without changing their file lists because npm already includes `fixtures` and the Nix install already copies that directory.
- A single-quoted shell heredoc will carry the JavaScript verification program without shell rewriting its imports, string literals, or RPC JSON.
- No new test will merely restate Nix source text or package metadata. The Nix build itself is the direct installed-layout verification.

---

### Task 1: Pure Safe Subagent Progress Normalizer

**Files:**

- Create: `src/pi/subagent-progress.ts`
- Create: `src/pi/subagent-progress.test.ts`

**Interfaces:**

- Consumes: unknown Pi tool result values, plus the parent `toolCallId: string`.
- Produces: `SUBAGENT_PROGRESS_CUSTOM_TYPE`, `SUBAGENT_PROGRESS_LIMIT_ERROR`, `SUBAGENT_PROGRESS_LIMITS`, `SubagentProgress`, `parseSubagentProgressResults(result: unknown, toolCallId: string): SubagentProgress[]`, and `subagentProgressKey(progress: SubagentProgress): string`.
- Privacy boundary: the returned value contains only `toolCallId`, `childIndex`, `agent`, optional `model`, and optional `thinking`; trusted allowlisted values are bounded but not semantically classified.

- [ ] **Step 1: Write the failing normalizer and privacy tests**

Create `src/pi/subagent-progress.test.ts` with explicit coverage for valid rows,
identity-only rows, malformed containers, malformed siblings, optional fields,
verbatim strings, upstream indexes, discarded source fields, exact identifier
boundaries, batch limits, and key collisions:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseSubagentProgressResults,
  SUBAGENT_PROGRESS_LIMIT_ERROR,
  SUBAGENT_PROGRESS_LIMITS,
  subagentProgressKey,
  type SubagentProgress,
} from "./subagent-progress.ts";

function resultWithRows(rows: unknown[]): unknown {
  return { details: { results: rows } };
}

function isLimitError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === SUBAGENT_PROGRESS_LIMIT_ERROR
  );
}

test("projects valid rows in upstream order and preserves upstream indexes", () => {
  assert.deepEqual(
    parseSubagentProgressResults(
      resultWithRows([
        { index: 7, agent: "worker", model: "openai/gpt-5", thinking: "high" },
        { index: 2, agent: "reviewer", model: "anthropic/claude:beta" },
        { index: 12, agent: "scout", thinking: "future-level" },
      ]),
      "call-parent",
    ),
    [
      {
        toolCallId: "call-parent",
        childIndex: 7,
        agent: "worker",
        model: "openai/gpt-5",
        thinking: "high",
      },
      {
        toolCallId: "call-parent",
        childIndex: 2,
        agent: "reviewer",
        model: "anthropic/claude:beta",
      },
      {
        toolCallId: "call-parent",
        childIndex: 12,
        agent: "scout",
        thinking: "future-level",
      },
    ],
  );
});

test("keeps identity-only rows and preserves accepted strings verbatim", () => {
  assert.deepEqual(
    parseSubagentProgressResults(
      resultWithRows([
        { index: 3, agent: " worker ", model: " provider/model:suffix ", thinking: " future-level " },
        { index: 9, agent: "scout" },
      ]),
      " call-with-spaces ",
    ),
    [
      {
        toolCallId: " call-with-spaces ",
        childIndex: 3,
        agent: " worker ",
        model: " provider/model:suffix ",
        thinking: " future-level ",
      },
      { toolCallId: " call-with-spaces ", childIndex: 9, agent: "scout" },
    ],
  );
});

test("fails closed for malformed containers and blank parent tool call IDs", () => {
  const malformed: unknown[] = [
    undefined,
    null,
    [],
    {},
    { details: null },
    { details: [] },
    { details: {} },
    { details: { results: null } },
    { details: { results: {} } },
  ];
  for (const value of malformed) {
    assert.deepEqual(parseSubagentProgressResults(value, "call-1"), []);
  }
  assert.deepEqual(
    parseSubagentProgressResults(resultWithRows([{ index: 0, agent: "worker" }]), ""),
    [],
  );
  assert.deepEqual(
    parseSubagentProgressResults(resultWithRows([{ index: 0, agent: "worker" }]), "   "),
    [],
  );
  assert.deepEqual(
    parseSubagentProgressResults(
      resultWithRows([{ index: 0, agent: "worker" }]),
      undefined as unknown as string,
    ),
    [],
  );
});

test("skips malformed rows without suppressing valid siblings", () => {
  assert.deepEqual(
    parseSubagentProgressResults(
      resultWithRows([
        null,
        [],
        { agent: "missing-index" },
        { index: -1, agent: "negative" },
        { index: 1.5, agent: "fraction" },
        { index: Number.MAX_SAFE_INTEGER + 1, agent: "unsafe" },
        { index: 4 },
        { index: 5, agent: "" },
        { index: 6, agent: "   " },
        { index: 11, agent: "valid", model: 42, thinking: { level: "high" } },
      ]),
      "call-1",
    ),
    [{ toolCallId: "call-1", childIndex: 11, agent: "valid" }],
  );
});

test("never substitutes array position for upstream identity", () => {
  assert.deepEqual(
    parseSubagentProgressResults(
      resultWithRows([{ agent: "missing-index" }, { index: 42, agent: "worker" }]),
      "call-1",
    ),
    [{ toolCallId: "call-1", childIndex: 42, agent: "worker" }],
  );
});

test("serialized projections do not copy discarded row properties", () => {
  const serialized = JSON.stringify(
    parseSubagentProgressResults(
      resultWithRows([
        {
          index: 1,
          agent: "worker",
          model: "reported-model",
          thinking: "reported-thinking",
          task: "SECRET_TASK",
          output: "SECRET_OUTPUT",
          prompt: "SECRET_PROMPT",
          credentials: "SECRET_CREDENTIAL",
          path: "/secret/session.jsonl",
          usage: { cost: "SECRET_COST" },
          error: "SECRET_ERROR",
          args: { token: "SECRET_TOKEN" },
        },
      ]),
      "call-safe",
    ),
  );
  assert.equal(serialized, JSON.stringify([{ toolCallId: "call-safe", childIndex: 1, agent: "worker", model: "reported-model", thinking: "reported-thinking" }]));
  for (const forbidden of [
    "SECRET_TASK",
    "SECRET_OUTPUT",
    "SECRET_PROMPT",
    "SECRET_CREDENTIAL",
    "/secret/session.jsonl",
    "SECRET_COST",
    "SECRET_ERROR",
    "SECRET_TOKEN",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("enforces identifier and result-row ceilings without truncation", () => {
  const limits = SUBAGENT_PROGRESS_LIMITS;
  const acceptedToolCallId = "t".repeat(limits.maxToolCallIdCodeUnits);
  const acceptedAgent = "a".repeat(limits.maxAgentCodeUnits);
  assert.deepEqual(
    parseSubagentProgressResults(
      resultWithRows([
        {
          index: 0,
          agent: acceptedAgent,
          model: "m".repeat(limits.maxModelCodeUnits),
          thinking: "h".repeat(limits.maxThinkingCodeUnits),
        },
      ]),
      acceptedToolCallId,
    ),
    [
      {
        toolCallId: acceptedToolCallId,
        childIndex: 0,
        agent: acceptedAgent,
        model: "m".repeat(limits.maxModelCodeUnits),
        thinking: "h".repeat(limits.maxThinkingCodeUnits),
      },
    ],
  );

  assert.deepEqual(
    parseSubagentProgressResults(
      resultWithRows([
        {
          index: 0,
          agent: `${acceptedAgent}x`,
        },
        {
          index: 1,
          agent: "worker",
          model: "m".repeat(limits.maxModelCodeUnits + 1),
          thinking: "h".repeat(limits.maxThinkingCodeUnits + 1),
        },
      ]),
      acceptedToolCallId,
    ),
    [{ toolCallId: acceptedToolCallId, childIndex: 1, agent: "worker" }],
  );
  assert.deepEqual(
    parseSubagentProgressResults(
      resultWithRows([{ index: 0, agent: "worker" }]),
      `${acceptedToolCallId}x`,
    ),
    [],
  );

  assert.equal(
    parseSubagentProgressResults(
      resultWithRows(
        Array.from({ length: limits.maxResultRows }, (_, index) => ({
          index,
          agent: "worker",
        })),
      ),
      "call-max-rows",
    ).length,
    limits.maxResultRows,
  );
  assert.throws(
    () =>
      parseSubagentProgressResults(
        resultWithRows(
          Array.from({ length: limits.maxResultRows + 1 }, (_, index) => ({
            index,
            agent: "worker",
          })),
        ),
        "call-too-many-rows",
      ),
    isLimitError,
  );
});

test("serializes fixed-position collision-safe keys with absent optionals", () => {
  const identity: SubagentProgress = {
    toolCallId: "call|1",
    childIndex: 3,
    agent: "worker,reviewer",
  };
  assert.equal(
    subagentProgressKey(identity),
    '["call|1",3,"worker,reviewer",null,null]',
  );
  assert.notEqual(
    subagentProgressKey(identity),
    subagentProgressKey({ ...identity, model: "" }),
  );
  assert.notEqual(
    subagentProgressKey({ ...identity, model: "model", thinking: "high" }),
    subagentProgressKey({ ...identity, model: "model:high" }),
  );
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

```sh
node --test src/pi/subagent-progress.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/pi/subagent-progress.ts`.

- [ ] **Step 3: Implement the pure allowlist normalizer**

Create `src/pi/subagent-progress.ts` with no Pi imports or retained raw values:

```ts
export const SUBAGENT_PROGRESS_CUSTOM_TYPE = "patchmill-subagent-progress";
export const SUBAGENT_PROGRESS_LIMIT_ERROR =
  "PATCHMILL_SUBAGENT_PROGRESS_LIMIT_EXCEEDED";
export const SUBAGENT_PROGRESS_LIMITS = {
  maxToolCallIdCodeUnits: 1024,
  maxAgentCodeUnits: 256,
  maxModelCodeUnits: 512,
  maxThinkingCodeUnits: 128,
  maxResultRows: 1024,
  maxActiveParents: 256,
  maxChildrenPerParent: 1024,
  maxActiveChildren: 4096,
  maxActiveKeys: 16384,
  maxTransitionsPerChild: 32,
  maxEntriesPerSession: 65536,
} as const;

export type SubagentProgress = {
  toolCallId: string;
  childIndex: number;
  agent: string;
  model?: string;
  thinking?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedNonblankString(
  value: unknown,
  maxCodeUnits: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxCodeUnits &&
    value.trim().length > 0
  );
}

export function parseSubagentProgressResults(
  result: unknown,
  toolCallId: string,
): SubagentProgress[] {
  if (
    !isBoundedNonblankString(
      toolCallId,
      SUBAGENT_PROGRESS_LIMITS.maxToolCallIdCodeUnits,
    ) ||
    !isRecord(result)
  ) {
    return [];
  }
  const details = result.details;
  if (!isRecord(details) || !Array.isArray(details.results)) return [];
  if (details.results.length > SUBAGENT_PROGRESS_LIMITS.maxResultRows) {
    throw new Error(SUBAGENT_PROGRESS_LIMIT_ERROR);
  }

  const projections: SubagentProgress[] = [];
  for (const row of details.results) {
    if (!isRecord(row)) continue;
    if (
      typeof row.index !== "number" ||
      !Number.isSafeInteger(row.index) ||
      row.index < 0 ||
      !isBoundedNonblankString(
        row.agent,
        SUBAGENT_PROGRESS_LIMITS.maxAgentCodeUnits,
      )
    ) {
      continue;
    }

    const projection: SubagentProgress = {
      toolCallId,
      childIndex: row.index,
      agent: row.agent,
    };
    if (
      isBoundedNonblankString(
        row.model,
        SUBAGENT_PROGRESS_LIMITS.maxModelCodeUnits,
      )
    ) {
      projection.model = row.model;
    }
    if (
      isBoundedNonblankString(
        row.thinking,
        SUBAGENT_PROGRESS_LIMITS.maxThinkingCodeUnits,
      )
    ) {
      projection.thinking = row.thinking;
    }
    projections.push(projection);
  }
  return projections;
}

export function subagentProgressKey(progress: SubagentProgress): string {
  return JSON.stringify([
    progress.toolCallId,
    progress.childIndex,
    progress.agent,
    progress.model ?? null,
    progress.thinking ?? null,
  ]);
}
```

Do not read any row property other than `index`, `agent`, `model`, and
`thinking`. Use trimming only to validate nonblank strings; return accepted
strings unchanged and never truncate overlong values. A batch above 1,024 rows
throws the stable limit identifier before inspecting any row.

- [ ] **Step 4: Run the normalizer tests and lint the focused files**

Run:

```sh
node --test src/pi/subagent-progress.test.ts
npx eslint src/pi/subagent-progress.ts src/pi/subagent-progress.test.ts --max-warnings=0
```

Expected: all normalizer tests PASS and ESLint exits 0.

- [ ] **Step 5: Commit the independently testable normalizer**

```sh
git add src/pi/subagent-progress.ts src/pi/subagent-progress.test.ts
git commit -m "feat(pi): normalize safe subagent progress metadata"
```

### Task 2: Thin Pi Lifecycle Observer

**Files:**

- Create: `src/pi/extensions/run-once-subagent-progress.ts`
- Create: `src/pi/extensions/run-once-subagent-progress.test.ts`
- Create: `src/pi/extensions/run-once-subagent-progress.runner.test.ts`

**Interfaces:**

- Consumes: `Pick<ExtensionAPI, "on" | "appendEntry">`, `ctx.sessionManager.getEntries()`, and the Task 1 normalizer exports.
- Produces: the default Pi extension factory and stable `SUBAGENT_PROGRESS_APPEND_ERROR` identifier; there is no test-only registration entry point.
- Event contract: `session_start`, `tool_execution_update.partialResult`, and `tool_execution_end.result`; only `toolName === "subagent"` is observed.

- [ ] **Step 1: Write the failing observer tests with a narrow Pi harness**

Create `src/pi/extensions/run-once-subagent-progress.test.ts`. The harness must
record handlers and appended entries without creating a real Pi session:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  SUBAGENT_PROGRESS_CUSTOM_TYPE,
  SUBAGENT_PROGRESS_LIMIT_ERROR,
  SUBAGENT_PROGRESS_LIMITS,
} from "../subagent-progress.ts";
import runOnceSubagentProgressExtension, {
  SUBAGENT_PROGRESS_APPEND_ERROR,
} from "./run-once-subagent-progress.ts";

type ObserverPi = Pick<ExtensionAPI, "on" | "appendEntry">;
type ObserverHandler = (event: unknown, context: unknown) => unknown;

type AppendedEntry = { customType: string; data: unknown };

function isLimitError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === SUBAGENT_PROGRESS_LIMIT_ERROR
  );
}

function subagentResult(rows: unknown[]): unknown {
  return { details: { results: rows } };
}

function createHarness() {
  const handlers = new Map<string, ObserverHandler>();
  const entries: AppendedEntry[] = [];
  const existingSessionEntries: unknown[] = [];
  let nextAppendError: Error | undefined;
  const pi = {
    on(event: string, handler: ObserverHandler) {
      handlers.set(event, handler);
    },
    appendEntry(customType: string, data?: unknown) {
      if (nextAppendError) {
        const error = nextAppendError;
        nextAppendError = undefined;
        throw error;
      }
      entries.push({ customType, data });
    },
  } as unknown as ObserverPi;

  runOnceSubagentProgressExtension(pi as ExtensionAPI);
  return {
    entries,
    existingSessionEntries,
    handlers,
    failNextAppend(error: Error) {
      nextAppendError = error;
    },
    async emit(name: string, event: unknown) {
      const handler = handlers.get(name);
      assert.ok(handler, `missing ${name} handler`);
      await handler(event, {
        sessionManager: { getEntries: () => existingSessionEntries },
      });
    },
  };
}

test("registers only the required lifecycle handlers", () => {
  const harness = createHarness();
  assert.deepEqual([...harness.handlers.keys()], [
    "session_start",
    "tool_execution_update",
    "tool_execution_end",
  ]);
});

test("persists the first valid partial projection immediately", async () => {
  const harness = createHarness();
  await harness.emit("tool_execution_update", {
    toolName: "subagent",
    toolCallId: "call-1",
    partialResult: subagentResult([
      { index: 4, agent: "worker", model: "provider/model", thinking: "high" },
    ]),
  });
  assert.deepEqual(harness.entries, [
    {
      customType: "patchmill-subagent-progress",
      data: {
        toolCallId: "call-1",
        childIndex: 4,
        agent: "worker",
        model: "provider/model",
        thinking: "high",
      },
    },
  ]);
});

test("uses terminal results as fallback and accepts failed terminal events", async () => {
  const harness = createHarness();
  await harness.emit("tool_execution_end", {
    toolName: "subagent",
    toolCallId: "call-terminal",
    result: subagentResult([{ index: 1, agent: "reviewer" }]),
    isError: true,
  });
  assert.deepEqual(harness.entries, [
    {
      customType: "patchmill-subagent-progress",
      data: { toolCallId: "call-terminal", childIndex: 1, agent: "reviewer" },
    },
  ]);
});

test("suppresses exact repeats and appends changed authoritative tuples", async () => {
  const harness = createHarness();
  const partial = {
    toolName: "subagent",
    toolCallId: "call-1",
    partialResult: subagentResult([{ index: 0, agent: "worker", model: "model-a" }]),
  };
  await harness.emit("tool_execution_update", partial);
  await harness.emit("tool_execution_update", partial);
  await harness.emit("tool_execution_end", {
    toolName: "subagent",
    toolCallId: "call-1",
    result: subagentResult([{ index: 0, agent: "worker", model: "model-a" }]),
    isError: false,
  });
  await harness.emit("tool_execution_end", {
    toolName: "subagent",
    toolCallId: "call-1",
    result: subagentResult([
      { index: 0, agent: "worker", model: "model-a", thinking: "high" },
    ]),
    isError: false,
  });
  assert.deepEqual(
    harness.entries.map((entry) => entry.data),
    [
      { toolCallId: "call-1", childIndex: 0, agent: "worker", model: "model-a" },
      {
        toolCallId: "call-1",
        childIndex: 0,
        agent: "worker",
        model: "model-a",
        thinking: "high",
      },
    ],
  );
});

test("isolates sibling indexes and concurrent parent tool calls", async () => {
  const harness = createHarness();
  for (const toolCallId of ["call-a", "call-b"]) {
    await harness.emit("tool_execution_update", {
      toolName: "subagent",
      toolCallId,
      partialResult: subagentResult([
        { index: 0, agent: "worker" },
        { index: 1, agent: "reviewer" },
      ]),
    });
  }
  assert.equal(harness.entries.length, 4);
  assert.deepEqual(
    harness.entries.map((entry) => entry.data),
    [
      { toolCallId: "call-a", childIndex: 0, agent: "worker" },
      { toolCallId: "call-a", childIndex: 1, agent: "reviewer" },
      { toolCallId: "call-b", childIndex: 0, agent: "worker" },
      { toolCallId: "call-b", childIndex: 1, agent: "reviewer" },
    ],
  );
});

test("clears deduplication on session start", async () => {
  const harness = createHarness();
  const event = {
    toolName: "subagent",
    toolCallId: "call-1",
    partialResult: subagentResult([{ index: 0, agent: "worker" }]),
  };
  await harness.emit("tool_execution_update", event);
  await harness.emit("session_start", { type: "session_start", reason: "reload" });
  await harness.emit("tool_execution_update", event);
  assert.equal(harness.entries.length, 2);
});

test("ignores unrelated and malformed lifecycle events", async () => {
  const harness = createHarness();
  await harness.emit("tool_execution_update", {
    toolName: "bash",
    toolCallId: "call-1",
    partialResult: subagentResult([{ index: 0, agent: "worker" }]),
  });
  await harness.emit("tool_execution_update", {
    toolName: "subagent",
    toolCallId: " ",
    partialResult: { details: { results: "not-an-array" } },
  });
  await harness.emit("tool_execution_end", {
    toolName: "subagent",
    toolCallId: "call-2",
    result: null,
    isError: false,
  });
  assert.deepEqual(harness.entries, []);
});

test("rethrows append failure with a stable message and original cause", async () => {
  const harness = createHarness();
  const cause = new Error("unstable storage detail");
  harness.failNextAppend(cause);
  await assert.rejects(
    harness.emit("tool_execution_update", {
      toolName: "subagent",
      toolCallId: "call-cause",
      partialResult: subagentResult([{ index: 0, agent: "worker" }]),
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === SUBAGENT_PROGRESS_APPEND_ERROR &&
      error.cause === cause,
  );
  assert.deepEqual(harness.entries, []);
});

test("caps metadata transitions for one child", async () => {
  const harness = createHarness();
  for (
    let transition = 0;
    transition < SUBAGENT_PROGRESS_LIMITS.maxTransitionsPerChild;
    transition += 1
  ) {
    await harness.emit("tool_execution_update", {
      toolName: "subagent",
      toolCallId: "call-churn",
      partialResult: subagentResult([
        { index: 0, agent: "worker", model: `model-${transition}` },
      ]),
    });
  }
  await assert.rejects(
    harness.emit("tool_execution_update", {
      toolName: "subagent",
      toolCallId: "call-churn",
      partialResult: subagentResult([
        { index: 0, agent: "worker", model: "one-transition-too-many" },
      ]),
    }),
    isLimitError,
  );
});

test("bounds parent and child state and releases it after terminal success", async () => {
  const harness = createHarness();
  for (
    let parent = 0;
    parent < SUBAGENT_PROGRESS_LIMITS.maxActiveParents;
    parent += 1
  ) {
    await harness.emit("tool_execution_update", {
      toolName: "subagent",
      toolCallId: `call-${parent}`,
      partialResult: subagentResult([{ index: 0, agent: "worker" }]),
    });
  }
  await assert.rejects(
    harness.emit("tool_execution_update", {
      toolName: "subagent",
      toolCallId: "call-over-parent-limit",
      partialResult: subagentResult([{ index: 0, agent: "worker" }]),
    }),
    isLimitError,
  );
  await harness.emit("tool_execution_end", {
    toolName: "subagent",
    toolCallId: "call-0",
    result: subagentResult([{ index: 0, agent: "worker" }]),
    isError: false,
  });
  await harness.emit("tool_execution_update", {
    toolName: "subagent",
    toolCallId: "call-after-release",
    partialResult: subagentResult([{ index: 0, agent: "worker" }]),
  });

  const perParent = createHarness();
  await perParent.emit("tool_execution_update", {
    toolName: "subagent",
    toolCallId: "call-many-children",
    partialResult: subagentResult(
      Array.from(
        { length: SUBAGENT_PROGRESS_LIMITS.maxChildrenPerParent },
        (_, index) => ({ index, agent: "worker" }),
      ),
    ),
  });
  await assert.rejects(
    perParent.emit("tool_execution_update", {
      toolName: "subagent",
      toolCallId: "call-many-children",
      partialResult: subagentResult([
        {
          index: SUBAGENT_PROGRESS_LIMITS.maxChildrenPerParent,
          agent: "worker",
        },
      ]),
    }),
    isLimitError,
  );
});

test("bounds active child and serialized-key state", async () => {
  const children = createHarness();
  const fullParentRows = Array.from(
    { length: SUBAGENT_PROGRESS_LIMITS.maxChildrenPerParent },
    (_, index) => ({ index, agent: "worker" }),
  );
  const parentCount =
    SUBAGENT_PROGRESS_LIMITS.maxActiveChildren /
    SUBAGENT_PROGRESS_LIMITS.maxChildrenPerParent;
  for (let parent = 0; parent < parentCount; parent += 1) {
    await children.emit("tool_execution_update", {
      toolName: "subagent",
      toolCallId: `active-${parent}`,
      partialResult: subagentResult(fullParentRows),
    });
  }
  await assert.rejects(
    children.emit("tool_execution_update", {
      toolName: "subagent",
      toolCallId: "active-over-limit",
      partialResult: subagentResult([{ index: 0, agent: "worker" }]),
    }),
    isLimitError,
  );

  const keys = createHarness();
  const transitions =
    SUBAGENT_PROGRESS_LIMITS.maxActiveKeys /
    SUBAGENT_PROGRESS_LIMITS.maxChildrenPerParent;
  for (let transition = 0; transition < transitions; transition += 1) {
    await keys.emit("tool_execution_update", {
      toolName: "subagent",
      toolCallId: "key-cap",
      partialResult: subagentResult(
        fullParentRows.map((row) => ({
          ...row,
          model: `model-${transition}`,
        })),
      ),
    });
  }
  await assert.rejects(
    keys.emit("tool_execution_update", {
      toolName: "subagent",
      toolCallId: "key-cap",
      partialResult: subagentResult([
        { index: 0, agent: "worker", model: "key-over-limit" },
      ]),
    }),
    isLimitError,
  );
});

test("restores and increments the persisted-entry count at its boundary", async () => {
  const harness = createHarness();
  for (
    let entry = 1;
    entry < SUBAGENT_PROGRESS_LIMITS.maxEntriesPerSession;
    entry += 1
  ) {
    harness.existingSessionEntries.push({
      type: "custom",
      customType: SUBAGENT_PROGRESS_CUSTOM_TYPE,
    });
  }
  await harness.emit("session_start", {
    type: "session_start",
    reason: "reload",
  });
  await harness.emit("tool_execution_update", {
    toolName: "subagent",
    toolCallId: "call-after-reload",
    partialResult: subagentResult([
      { index: 0, agent: "worker", model: "first" },
    ]),
  });
  assert.equal(harness.entries.length, 1);
  await assert.rejects(
    harness.emit("tool_execution_update", {
      toolName: "subagent",
      toolCallId: "call-after-reload",
      partialResult: subagentResult([
        { index: 0, agent: "worker", model: "second" },
      ]),
    }),
    isLimitError,
  );
  assert.equal(harness.entries.length, 1);
});
```

- [ ] **Step 2: Run the observer test and verify the red state**

Run:

```sh
node --test src/pi/extensions/run-once-subagent-progress.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for
`src/pi/extensions/run-once-subagent-progress.ts`.

- [ ] **Step 3: Implement the lifecycle adapter and append-before-dedup rule**

Create `src/pi/extensions/run-once-subagent-progress.ts`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  parseSubagentProgressResults,
  SUBAGENT_PROGRESS_CUSTOM_TYPE,
  SUBAGENT_PROGRESS_LIMIT_ERROR,
  SUBAGENT_PROGRESS_LIMITS,
  subagentProgressKey,
  type SubagentProgress,
} from "../subagent-progress.ts";

export const SUBAGENT_PROGRESS_APPEND_ERROR =
  "PATCHMILL_SUBAGENT_PROGRESS_APPEND_FAILED";

type SubagentProgressPi = Pick<ExtensionAPI, "on" | "appendEntry">;
type ChildState = { keys: Set<string> };
type ParentState = Map<number, ChildState>;

type ObservedToolEvent = {
  toolCallId: string;
  toolName: string;
};

function limitExceeded(): never {
  throw new Error(SUBAGENT_PROGRESS_LIMIT_ERROR);
}

export default function runOnceSubagentProgressExtension(
  pi: SubagentProgressPi,
): void {
  const parents = new Map<string, ParentState>();
  let activeChildren = 0;
  let activeKeys = 0;
  let sessionEntries = 0;

  function appendProgress(progress: SubagentProgress): void {
    let parent = parents.get(progress.toolCallId);
    const needsParent = parent === undefined;
    if (needsParent && parents.size >= SUBAGENT_PROGRESS_LIMITS.maxActiveParents) {
      limitExceeded();
    }
    parent ??= new Map<number, ChildState>();

    let child = parent.get(progress.childIndex);
    const needsChild = child === undefined;
    if (
      needsChild &&
      (parent.size >= SUBAGENT_PROGRESS_LIMITS.maxChildrenPerParent ||
        activeChildren >= SUBAGENT_PROGRESS_LIMITS.maxActiveChildren)
    ) {
      limitExceeded();
    }
    child ??= { keys: new Set<string>() };

    const key = subagentProgressKey(progress);
    if (child.keys.has(key)) return;
    if (
      child.keys.size >= SUBAGENT_PROGRESS_LIMITS.maxTransitionsPerChild ||
      activeKeys >= SUBAGENT_PROGRESS_LIMITS.maxActiveKeys ||
      sessionEntries >= SUBAGENT_PROGRESS_LIMITS.maxEntriesPerSession
    ) {
      limitExceeded();
    }

    try {
      pi.appendEntry(SUBAGENT_PROGRESS_CUSTOM_TYPE, progress);
    } catch (cause) {
      throw new Error(SUBAGENT_PROGRESS_APPEND_ERROR, { cause });
    }

    if (needsParent) parents.set(progress.toolCallId, parent);
    if (needsChild) {
      parent.set(progress.childIndex, child);
      activeChildren += 1;
    }
    child.keys.add(key);
    activeKeys += 1;
    sessionEntries += 1;
  }

  function appendResult(event: ObservedToolEvent, result: unknown): void {
    for (const progress of parseSubagentProgressResults(
      result,
      event.toolCallId,
    )) {
      appendProgress(progress);
    }
  }

  function releaseParent(toolCallId: string): void {
    const parent = parents.get(toolCallId);
    if (!parent) return;
    for (const child of parent.values()) activeKeys -= child.keys.size;
    activeChildren -= parent.size;
    parents.delete(toolCallId);
  }

  pi.on("session_start", (_event, ctx) => {
    parents.clear();
    activeChildren = 0;
    activeKeys = 0;
    sessionEntries = ctx.sessionManager
      .getEntries()
      .filter(
        (entry) =>
          entry.type === "custom" &&
          entry.customType === SUBAGENT_PROGRESS_CUSTOM_TYPE,
      ).length;
  });
  pi.on("tool_execution_update", (event) => {
    if (event.toolName !== "subagent") return;
    appendResult(event, event.partialResult);
  });
  pi.on("tool_execution_end", (event) => {
    if (event.toolName !== "subagent") return;
    appendResult(event, event.result);
    releaseParent(event.toolCallId);
  });
}
```

Do not branch on `event.isError`, inspect `event.args`, or log an event/result
value. The `appendEntry()` catch is the one explicit boundary translation: it
retains the original failure as `cause`, rethrows a stable identifier, and does
not recover locally. Every limit error is thrown directly before persistence or
retained-state mutation.

- [ ] **Step 4: Test the default export through Pi's real loader and runner**

Create `src/pi/extensions/run-once-subagent-progress.runner.test.ts` so append
failures follow Pi 0.83's production error path rather than a direct handler
rejection:

```ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  discoverAndLoadExtensions,
  ExtensionRunner,
} from "@earendil-works/pi-coding-agent";
import { findPackageRoot } from "../../package-root.ts";
import {
  SUBAGENT_PROGRESS_APPEND_ERROR,
} from "./run-once-subagent-progress.ts";

const rootDir = findPackageRoot(dirname(fileURLToPath(import.meta.url)));

test("Pi reports append failure and a terminal event retries the tuple", async () => {
  const homeDir = mkdtempSync(join(tmpdir(), "patchmill-progress-runner-"));
  try {
    const observerPath = join(
      rootDir,
      "src",
      "pi",
      "extensions",
      "run-once-subagent-progress.ts",
    );
    const loaded = await discoverAndLoadExtensions(
      [observerPath],
      rootDir,
      join(homeDir, "agent"),
    );
    assert.deepEqual(loaded.errors, []);

    const appended: Array<{ customType: string; data: unknown }> = [];
    let failNextAppend = true;
    loaded.runtime.appendEntry = (customType, data) => {
      if (failNextAppend) {
        failNextAppend = false;
        throw new Error("unstable storage detail");
      }
      appended.push({ customType, data });
    };

    const runner = new ExtensionRunner(
      loaded.extensions,
      loaded.runtime,
      rootDir,
      { getEntries: () => [] } as never,
      {} as never,
    );
    const errors: Array<{
      extensionPath: string;
      event: string;
      error: string;
    }> = [];
    runner.onError((error) => errors.push(error));
    for (const eventName of [
      "session_start",
      "tool_execution_update",
      "tool_execution_end",
    ]) {
      assert.equal(runner.hasHandlers(eventName), true);
    }

    await runner.emit({ type: "session_start", reason: "startup" });
    await runner.emit({
      type: "tool_execution_update",
      toolName: "subagent",
      toolCallId: "call-1",
      args: {},
      partialResult: { details: { results: [{ index: 0, agent: "worker" }] } },
    });
    assert.equal(appended.length, 0);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.event, "tool_execution_update");
    assert.equal(errors[0]?.error, SUBAGENT_PROGRESS_APPEND_ERROR);
    assert.match(
      errors[0]?.extensionPath ?? "",
      /run-once-subagent-progress\.ts$/u,
    );

    await runner.emit({
      type: "tool_execution_end",
      toolName: "subagent",
      toolCallId: "call-1",
      result: { details: { results: [{ index: 0, agent: "worker" }] } },
      isError: false,
    });
    assert.deepEqual(appended, [
      {
        customType: "patchmill-subagent-progress",
        data: { toolCallId: "call-1", childIndex: 0, agent: "worker" },
      },
    ]);
    assert.equal(errors.length, 1);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});
```

The observer catches only `appendEntry()` to replace an unstable storage
message with a stable public identifier while preserving the original error as
`cause`. `ExtensionRunner.emit()` resolves after notifying `onError`; the test
must not expect a rejection from Pi's host boundary.

- [ ] **Step 5: Run normalizer, observer, runner, and focused lint checks**

Run:

```sh
node --test \
  src/pi/subagent-progress.test.ts \
  src/pi/extensions/run-once-subagent-progress.test.ts \
  src/pi/extensions/run-once-subagent-progress.runner.test.ts
npx eslint \
  src/pi/subagent-progress.ts \
  src/pi/subagent-progress.test.ts \
  src/pi/extensions/run-once-subagent-progress.ts \
  src/pi/extensions/run-once-subagent-progress.test.ts \
  src/pi/extensions/run-once-subagent-progress.runner.test.ts \
  --max-warnings=0
```

Expected: all tests PASS and ESLint exits 0. The runner test must observe the
stable append error once, then persist the equivalent terminal tuple.

- [ ] **Step 6: Commit the independently testable observer**

```sh
git add \
  src/pi/extensions/run-once-subagent-progress.ts \
  src/pi/extensions/run-once-subagent-progress.test.ts \
  src/pi/extensions/run-once-subagent-progress.runner.test.ts
git commit -m "feat(pi): observe bounded subagent progress events"
```

### Task 3: Run-Once Profile Wiring and Source/Compiled Load Proof

**Files:**

- Create: `fixtures/run-once-extension-load-sentinel.ts`
- Create: `src/pi/extensions/run-once-subagent-progress.load.test.ts`
- Modify: `src/pi/resource-profiles.ts:16-48`
- Modify: `src/pi/resource-profiles.test.ts:31-38,51-75,107-136`
- Modify: `src/pi/resource-profiles.compiled.test.ts:28-137`
- Modify: `src/cli/commands/run-once/pi.test.ts:82-87,104-201`

**Interfaces:**

- Consumes: the default observer factory from Task 2, `findPackageRoot()`, `requireRegularFile()`, `profileExtensionArgs()`, and `resolveBundledPiCommand()`.
- Produces: a third ordered run-once extension path and `fixtures/run-once-extension-load-sentinel.ts` using `PATCHMILL_RUN_ONCE_EXTENSION_SENTINEL`.
- Load contract: real Pi offline RPC startup receives every profile extension first and the sentinel fixture last.

- [ ] **Step 1: Add the sentinel fixture and write failing profile/load expectations**

Create `fixtures/run-once-extension-load-sentinel.ts`:

```ts
import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SENTINEL_PAYLOAD = "patchmill-run-once-extensions-loaded\n";

export default function runOnceExtensionLoadSentinel(_pi: ExtensionAPI): void {
  const sentinelPath = process.env.PATCHMILL_RUN_ONCE_EXTENSION_SENTINEL;
  if (!sentinelPath) {
    throw new Error("PATCHMILL_RUN_ONCE_EXTENSION_SENTINEL is required");
  }
  writeFileSync(sentinelPath, SENTINEL_PAYLOAD, "utf8");
}
```

Update `assertRunOnceExtensionOrder()` in
`src/pi/resource-profiles.test.ts` to require three paths and the observer in
position 2:

```ts
function assertRunOnceExtensionOrder(extensionPaths: string[]): void {
  assert.equal(extensionPaths.length, 3);
  assert.equal(extensionPaths[0], resolvePiSubagentsPackageRoot());
  assert.equal(
    extensionPaths[1]?.replaceAll("\\", "/").endsWith("/extensions/todos.ts"),
    true,
  );
  assert.equal(
    extensionPaths[2]
      ?.replaceAll("\\", "/")
      .endsWith("/src/pi/extensions/run-once-subagent-progress.ts"),
    true,
  );
}
```

Make the doctor-profile test call this helper for each of its first three
profiles, preserve the exact empty triage assertion, and update
`profileExtensionArgs()` to expect six ordered `-e` arguments.

Update `runOnceExtensionArgs` in
`src/cli/commands/run-once/pi.test.ts` to include:

```ts
"-e",
"/repo/src/pi/extensions/run-once-subagent-progress.ts",
```

Change the affected argument assertions to expect:

```ts
assert.deepEqual(args.slice(0, 7), [
  "-e",
  args[1],
  "-e",
  args[3],
  "-e",
  args[5],
  "-p",
]);
assert.match(args[1] ?? "", /node_modules\/pi-subagents$/u);
assert.match(args[3] ?? "", /extensions\/todos\.ts$/u);
assert.match(
  args[5] ?? "",
  /src\/pi\/extensions\/run-once-subagent-progress\.ts$/u,
);
assert.equal(args[7]?.startsWith("@"), true);
```

For the two-skill case, use `args.slice(0, 11)`, place the two `--skill` pairs
after all six extension arguments, and assert that `args[11]` is the prompt
file argument.

Create `src/pi/extensions/run-once-subagent-progress.load.test.ts` as the real
source-layout load proof:

```ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  piCommandArgs,
  resolveBundledPiCommand,
} from "../../cli/pi-cli.ts";
import { findPackageRoot } from "../../package-root.ts";
import type { PatchmillSkillsConfig } from "../../workflow/skills.ts";
import {
  profileExtensionArgs,
  runOncePlanningPiProfile,
} from "../resource-profiles.ts";

const rootDir = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
const skills: PatchmillSkillsConfig = {
  triage: "triage",
  planning: "planning",
  implementation: "implementation",
  developmentEnvironment: "development-environment",
  toolchain: "toolchain",
  review: "review",
  visualEvidence: "visual-evidence",
  landing: "landing",
};

test("Pi loads the source run-once extensions before the sentinel", () => {
  const homeDir = mkdtempSync(join(tmpdir(), "patchmill-run-once-load-"));
  const sentinelPath = join(homeDir, "loaded.txt");
  try {
    const profile = runOncePlanningPiProfile(skills, rootDir);
    assert.equal(profile.additionalExtensionPaths.length, 3);
    const command = resolveBundledPiCommand();
    const result = spawnSync(
      command.command,
      piCommandArgs(command, [
        "--mode",
        "rpc",
        "--no-session",
        "--offline",
        "-ne",
        ...profileExtensionArgs(profile),
        "-e",
        join(rootDir, "fixtures", "run-once-extension-load-sentinel.ts"),
      ]),
      {
        cwd: rootDir,
        encoding: "utf8",
        input: '{"type":"get_commands"}\n',
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          HOME: homeDir,
          XDG_CONFIG_HOME: join(homeDir, "config"),
          PATCHMILL_RUN_ONCE_EXTENSION_SENTINEL: sentinelPath,
        },
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(
      readFileSync(sentinelPath, "utf8"),
      "patchmill-run-once-extensions-loaded\n",
    );
    assert.doesNotMatch(
      `${result.stdout}\n${result.stderr}`,
      /Failed to load extension|Cannot find module|ERR_MODULE_NOT_FOUND/iu,
    );
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the focused tests and verify the red state**

Run:

```sh
node --test \
  src/pi/resource-profiles.test.ts \
  src/pi/extensions/run-once-subagent-progress.load.test.ts \
  src/cli/commands/run-once/pi.test.ts
```

Expected: FAIL because the profile still returns two extension paths; the load
test must stop at the explicit three-path assertion before accepting the
sentinel.

- [ ] **Step 3: Resolve and validate the observer in every run-once profile**

In `src/pi/resource-profiles.ts`, resolve the new observer from the Patchmill
package root with the existing regular-file guard:

```ts
const PATCHMILL_SUBAGENT_PROGRESS_EXTENSION = requireRegularFile(
  join(
    PATCHMILL_PACKAGE_ROOT,
    "src",
    "pi",
    "extensions",
    "run-once-subagent-progress.ts",
  ),
);

function runOnceExtensionPaths(): string[] {
  return [
    PI_SUBAGENTS_PACKAGE_ROOT,
    PATCHMILL_TODOS_EXTENSION,
    PATCHMILL_SUBAGENT_PROGRESS_EXTENSION,
  ];
}
```

Do not add the observer to `triagePiProfile()` and do not special-case
`profileExtensionArgs()`.

In `src/pi/resource-profiles.compiled.test.ts`, stage both package-owned source
files beside the compiled modules:

```ts
const observerExtension = join(
  packageRoot,
  "src",
  "pi",
  "extensions",
  "run-once-subagent-progress.ts",
);
const normalizer = join(packageRoot, "src", "pi", "subagent-progress.ts");

await mkdir(dirname(observerExtension), { recursive: true });
await copyFile(
  join(
    sourceRoot,
    "src",
    "pi",
    "extensions",
    "run-once-subagent-progress.ts",
  ),
  observerExtension,
);
await copyFile(join(sourceRoot, "src", "pi", "subagent-progress.ts"), normalizer);
```

Change the existence assertion to `[true, true, true]`, assert the observer is
third, preserve the existing missing/non-file todos checks, restore the todos
file after those checks, then verify the new observer guard independently:

```ts
await rm(todosExtension, { recursive: true, force: true });
await copyFile(join(sourceRoot, "extensions", "todos.ts"), todosExtension);

const missingObserverProfile = join(
  dirname(compiledProfile),
  "resource-profiles-missing-observer.js",
);
await copyFile(compiledProfile, missingObserverProfile);
await rm(observerExtension);
await assert.rejects(
  import(pathToFileURL(missingObserverProfile).href),
  (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
    assert.match(error.message, /run-once-subagent-progress\.ts/u);
    return true;
  },
);

await mkdir(observerExtension);
const directoryObserverProfile = join(
  dirname(compiledProfile),
  "resource-profiles-directory-observer.js",
);
await copyFile(compiledProfile, directoryObserverProfile);
await assert.rejects(
  import(pathToFileURL(directoryObserverProfile).href),
  /Patchmill extension is not a regular file: .*run-once-subagent-progress\.ts/u,
);
```

The compiled test stages `src/pi/subagent-progress.ts` because the observer's
relative import must remain present in the temporary package layout even though
the profile import itself only checks regular files.

- [ ] **Step 4: Run source, compiled, profile, and Pi argument verification**

Run:

```sh
node --test \
  src/pi/resource-profiles.test.ts \
  src/pi/resource-profiles.compiled.test.ts \
  src/pi/extensions/run-once-subagent-progress.load.test.ts \
  src/cli/commands/run-once/pi.test.ts
```

Expected: all tests PASS; the source load test exits 0 and reads exactly
`patchmill-run-once-extensions-loaded\n`.

- [ ] **Step 5: Commit the run-once wiring and in-tree load proof**

```sh
git add \
  fixtures/run-once-extension-load-sentinel.ts \
  src/pi/extensions/run-once-subagent-progress.load.test.ts \
  src/pi/resource-profiles.ts \
  src/pi/resource-profiles.test.ts \
  src/pi/resource-profiles.compiled.test.ts \
  src/cli/commands/run-once/pi.test.ts
git commit -m "feat(pi): load progress observer in run-once profiles"
```

### Task 4: npm-Packed and Nix-Installed Extension Load Proof

**Files:**

- Modify: `scripts/smoke-packed-artifact.mjs:1-184`
- Modify: `nix/package.nix:65-112`

**Interfaces:**

- Consumes: the Task 3 profile ordering and sentinel protocol from installed package roots.
- Produces: executable npm-packed and Nix-installed checks that load the installed observer through Pi's loader, assert its three handlers, then start the installed Pi CLI offline with profile extensions followed by the installed sentinel.
- Testing Value Gate: strengthen the existing executable package checks; do not add a test that parses package metadata or Nix source text.

- [ ] **Step 1: Extend the npm-packed smoke to start installed Pi**

In `scripts/smoke-packed-artifact.mjs`, import `assert` and `spawnSync`, then add
a synchronous RPC load helper that captures output without invoking a model:

```js
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";

function runPiExtensionLoad(command, args, options) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    input: '{"type":"get_commands"}\n',
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /Failed to load extension|Cannot find module|ERR_MODULE_NOT_FOUND/iu,
  );
}
```

After importing the installed `runOncePlanningPiProfile`, keep the existing
first/second path assertions, add the third observer assertion, and run the
installed Pi binary with the installed fixture last:

```js
if (
  !profile.additionalExtensionPaths[2]
    ?.replaceAll("\\", "/")
    .endsWith("/src/pi/extensions/run-once-subagent-progress.ts")
) {
  throw new Error(
    "run-once profile does not load the Patchmill subagent progress observer third",
  );
}

const installedPi = await import(
  pathToFileURL(
    projectRequire.resolve("@earendil-works/pi-coding-agent"),
  ).href
);
const installedAgentDir = join(smokeDir, "pi-agent");
await mkdir(installedAgentDir, { recursive: true });
const loadedObserver = await installedPi.discoverAndLoadExtensions(
  [profile.additionalExtensionPaths[2]],
  patchmillPackageRoot,
  installedAgentDir,
);
assert.deepEqual(loadedObserver.errors, []);
const observer = loadedObserver.extensions.find((extension) =>
  extension.resolvedPath
    .replaceAll("\\", "/")
    .endsWith("/src/pi/extensions/run-once-subagent-progress.ts"),
);
assert.ok(observer);
for (const eventName of [
  "session_start",
  "tool_execution_update",
  "tool_execution_end",
]) {
  assert.ok((observer.handlers.get(eventName)?.length ?? 0) > 0);
}

const sentinelFixture = join(
  patchmillPackageRoot,
  "fixtures",
  "run-once-extension-load-sentinel.ts",
);
if (!existsSync(sentinelFixture)) {
  throw new Error(`Installed sentinel fixture is missing: ${sentinelFixture}`);
}
const sentinelOutput = join(smokeDir, "run-once-extensions-loaded.txt");
runPiExtensionLoad(
  join(projectDir, "node_modules", ".bin", "pi"),
  [
    "--mode",
    "rpc",
    "--no-session",
    "--offline",
    "-ne",
    ...profile.additionalExtensionPaths.flatMap((path) => ["-e", path]),
    "-e",
    sentinelFixture,
  ],
  {
    cwd: projectDir,
    env: {
      ...environment,
      PATCHMILL_RUN_ONCE_EXTENSION_SENTINEL: sentinelOutput,
    },
  },
);
assert.equal(
  await readFile(sentinelOutput, "utf8"),
  "patchmill-run-once-extensions-loaded\n",
);
console.log("packed run-once extensions loaded before sentinel");
```

This uses the profile and Pi loader imported from the installed tarball's
dependency tree. The handler assertions prove the installed default export is
not a no-op before the full Pi CLI load reaches the sentinel.

- [ ] **Step 2: Extend the Nix install check to start installed Pi**

In `nix/package.nix`, retain the existing copied-directory checks and add:

```sh
test -f "$out/share/${pname}/src/pi/subagent-progress.ts"
test -f "$out/share/${pname}/src/pi/extensions/run-once-subagent-progress.ts"
test -f "$out/share/${pname}/fixtures/run-once-extension-load-sentinel.ts"
```

Replace the existing double-quoted inline `node -e "..."` payload with a
single-quoted heredoc. The quoted delimiter prevents the shell from removing
JavaScript quotes or rewriting the embedded RPC JSON:

```nix
    (
      cd "$out/share/${pname}"
      PATCHMILL_INSTALL_CHECK_DIR="$install_check_dir" \
        ${nodejs_24}/bin/node --input-type=module <<'PATCHMILL_NODE'
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { runOncePlanningPiProfile } from "./src/pi/resource-profiles.ts";
import {
  assertInstalledPiSubagentsMatchesRootPin,
  piSubagentsExtensionFiles,
  resolvePiSubagentsPackageRoot,
} from "./src/pi/pi-subagents-package.ts";

assertInstalledPiSubagentsMatchesRootPin("./package.json");
piSubagentsExtensionFiles();
const piSubagentsRoot = resolvePiSubagentsPackageRoot();
const skills = {
  triage: "triage",
  planning: "planning",
  implementation: "implementation",
  developmentEnvironment: "development-environment",
  toolchain: "toolchain",
  review: "review",
  visualEvidence: "visual-evidence",
  landing: "landing",
};
const profile = runOncePlanningPiProfile(skills, process.cwd());
assert.equal(
  realpathSync(profile.additionalExtensionPaths[0]),
  realpathSync(piSubagentsRoot),
);
assert.equal(
  profile.additionalExtensionPaths[1]
    .replaceAll("\\", "/")
    .endsWith("/extensions/todos.ts"),
  true,
);
assert.equal(
  profile.additionalExtensionPaths[2]
    .replaceAll("\\", "/")
    .endsWith("/src/pi/extensions/run-once-subagent-progress.ts"),
  true,
);

const installCheckDir = process.env.PATCHMILL_INSTALL_CHECK_DIR;
assert.ok(installCheckDir);
const agentDir = join(installCheckDir, "pi-agent");
mkdirSync(agentDir, { recursive: true });
const loadedObserver = await discoverAndLoadExtensions(
  [profile.additionalExtensionPaths[2]],
  process.cwd(),
  agentDir,
);
assert.deepEqual(loadedObserver.errors, []);
const observer = loadedObserver.extensions.find((extension) =>
  extension.resolvedPath
    .replaceAll("\\", "/")
    .endsWith("/src/pi/extensions/run-once-subagent-progress.ts"),
);
assert.ok(observer);
for (const eventName of [
  "session_start",
  "tool_execution_update",
  "tool_execution_end",
]) {
  assert.ok((observer.handlers.get(eventName)?.length ?? 0) > 0);
}

const sentinelPath = join(installCheckDir, "run-once-extensions-loaded.txt");
const result = spawnSync(
  process.execPath,
  [
    "./node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
    "--mode",
    "rpc",
    "--no-session",
    "--offline",
    "-ne",
    ...profile.additionalExtensionPaths.flatMap((path) => ["-e", path]),
    "-e",
    "./fixtures/run-once-extension-load-sentinel.ts",
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    input: '{"type":"get_commands"}\n',
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      HOME: join(installCheckDir, "home"),
      XDG_CONFIG_HOME: join(installCheckDir, "config"),
      PATCHMILL_RUN_ONCE_EXTENSION_SENTINEL: sentinelPath,
    },
  },
);
assert.equal(result.error, undefined);
assert.equal(result.status, 0, result.stderr || result.stdout);
assert.doesNotMatch(
  result.stdout + "\n" + result.stderr,
  /Failed to load extension|Cannot find module|ERR_MODULE_NOT_FOUND/iu,
);
assert.equal(
  readFileSync(sentinelPath, "utf8"),
  "patchmill-run-once-extensions-loaded\n",
);
console.log("installed run-once extensions loaded before sentinel");
PATCHMILL_NODE
    )
```

Keep the heredoc terminator unindented in the rendered shell program. Avoid
JavaScript template literals containing Nix `${...}` interpolation syntax.
Keep the npm dependency pins, `npmDepsHash`, package file lists, and Nix copy
layout unchanged.

- [ ] **Step 3: Run direct installed-layout verification before committing**

Run:

```sh
node scripts/smoke-packed-artifact.mjs
nix build .#patchmill --no-link --print-build-logs
```

Expected: both commands exit 0; each uses Pi's installed loader to find all
three observer handlers, then launches Pi in offline RPC mode and verifies the
exact sentinel payload from its installed package layout.

- [ ] **Step 4: Commit the installed-layout checks**

```sh
git add scripts/smoke-packed-artifact.mjs nix/package.nix
git commit -m "test(packaging): load run-once observer in installed layouts"
```

- [ ] **Step 5: Run final regression and distribution verification**

Run:

```sh
node --test \
  src/pi/subagent-progress.test.ts \
  src/pi/extensions/run-once-subagent-progress.test.ts \
  src/pi/extensions/run-once-subagent-progress.runner.test.ts \
  src/pi/extensions/run-once-subagent-progress.load.test.ts \
  src/pi/resource-profiles.test.ts \
  src/pi/resource-profiles.compiled.test.ts \
  src/cli/commands/run-once/pi.test.ts
npm test
npm run lint
node scripts/smoke-packed-artifact.mjs
nix build .#patchmill --no-link --print-build-logs
nix flake check --print-build-logs
git diff --check
```

Expected: every command exits 0. Confirm that no dependency manifest or lockfile
changed, `triage` still has no extensions, the runner test reports one stable
append error before a successful terminal retry, both installed layouts load
all three default-factory handlers and read the exact sentinel payload, and
`git status --short` is empty after all four task commits.
