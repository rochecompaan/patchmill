# Run-once Subagent Model and Thinking Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render each run-once subagent child's resolved model and thinking level in Patchmill console progress output.

**Architecture:** A Patchmill Pi extension — loaded from TypeScript source via jiti — observes `pi-subagents` partial and final tool results, extracts one normalized progress payload per child, and persists non-context custom session entries. Patchmill's run-once session streamer turns only those validated entries into observations, and the console reporter emits one `🤖 subagent (agent=..., model=..., thinking=...)` line per child.

**Tech Stack:** TypeScript, Node.js 22 built-in test runner, node:assert/strict, Pi extension lifecycle events, Pi JSONL sessions, ESLint, Prettier, markdownlint, npm package dry-runs.

## Global Constraints

- Work in the issue worktree and commit at the end of every task.
- Run all commands from the worktree root:
  `/home/roche/projects/patchmill/.worktrees/patchmill-issue-116-show-model-and-thinking-level-in-run-once-subage`.
- Do not edit `package.json`, `package-lock.json`, or `npm-shrinkwrap.json`; no dependency changes are permitted.
- Keep Pi or `pi-subagents` model selection, thinking selection, and fallback behavior unchanged.
- Do not duplicate `pi-subagents` agent, override, model, thinking, or fallback resolution; consume resolved result metadata only.
- Render one independent line per child in parallel foreground subagent calls.
- Keep existing agent-only summaries for `async: true` calls because pinned `pi-subagents` returns `details.results: []` for those starts and provides no resolved child metadata to the lifecycle observer.
- Custom progress entries must not enter LLM context and must contain no task prompts, child output, credentials, costs, or complete result metadata.
- Custom progress data uses only these exact fields: `toolCallId: string`, `childIndex: number`, `agent: string`, `model: string`, `thinking?: SubagentThinkingLevel`.
- `thinking` is present only when determinable from the child's own result metadata (known model suffix or explicit field); never fall back to the parent session's thinking level, because `pi-subagents` omits the suffix for `off`/unset levels and passes `--thinking` separately.
- `childIndex` is the stable `progress.index` from `pi-subagents`; use the result-array position only as a compatibility fallback when `progress.index` is absent (compacted final results strip `progress`, and both values derive from task order).
- Valid thinking levels are exactly `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.
- Displayed model IDs remove a provider prefix by retaining the portion after the final `/`; Pi thinking suffixes are removed from the model and reported as `thinking`.
- Unknown model suffixes remain part of the model ID rather than being misreported as thinking.
- Repeated partial/final updates are deduplicated by tool call ID, child index, agent, model, and thinking.
- A changed fallback tuple emits another line; the old tuple is not replaced retroactively.
- When a foreground call produces no resolved model metadata, the session streamer replays the buffered original tool-call observation at completion; a subagent call must never vanish from output.
- Subagent management calls such as `subagent(action=list)` retain normal tool formatting.
- Keep external-result validation and model normalization in `src/pi/subagent-progress.ts`; do not move that logic into `pi-session-stream.ts`.
- Add only a small custom-entry dispatch branch to the already-large `pi-session-stream.ts`; do not perform a broader stream-module refactor.
- Follow `superpowers:test-driven-development` for behavior changes: write each failing test first, run it to see it fail, then implement the smallest passing change.
- Use `superpowers:verification-before-completion` before every completion claim and final handoff.
- Use the `commit` skill format for every commit; commit only the task's files and do not push.

---

### Task 1: Normalize `pi-subagents` progress metadata

**Files:**

- Create: `src/pi/subagent-progress.ts`
- Test: `src/pi/subagent-progress.test.ts`

**Interfaces:**

- Consumes: unknown `pi-subagents` partial/final tool-result objects whose shape is validated at runtime.
- Produces:
  - `export const SUBAGENT_PROGRESS_CUSTOM_TYPE = "patchmill-subagent-progress";`
  - `export type SubagentThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";`
  - `export type SubagentProgress = { toolCallId: string; childIndex: number; agent: string; model: string; thinking?: SubagentThinkingLevel };`
  - `export function parseSubagentProgressResults(result: unknown, toolCallId: string): SubagentProgress[]`
  - `export function parseSubagentProgressEntry(entry: Record<string, unknown>): SubagentProgress | undefined`
  - `export function subagentProgressKey(progress: SubagentProgress): string`
  - `export function isRecord(value: unknown): value is Record<string, unknown>` (shared with the Task 2 extension; distinct from `pi-session-stream.ts`'s local array-rejecting `isObject`)

- [ ] **Step 1: Write the failing extraction tests**

Create `src/pi/subagent-progress.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SUBAGENT_PROGRESS_CUSTOM_TYPE,
  parseSubagentProgressEntry,
  parseSubagentProgressResults,
  subagentProgressKey,
} from "./subagent-progress.ts";

test("extracts one progress payload per child and removes provider prefixes", () => {
  assert.deepEqual(
    parseSubagentProgressResults(
      {
        details: {
          results: [
            {
              agent: "worker",
              model: "openai-codex/gpt-5.6-terra:medium",
              progress: { index: 3 },
            },
            {
              agent: "reviewer",
              model: "openai-codex/gpt-5.6-sol:xhigh",
            },
          ],
        },
      },
      "call-1",
    ),
    [
      {
        toolCallId: "call-1",
        childIndex: 3,
        agent: "worker",
        model: "gpt-5.6-terra",
        thinking: "medium",
      },
      {
        toolCallId: "call-1",
        childIndex: 1,
        agent: "reviewer",
        model: "gpt-5.6-sol",
        thinking: "xhigh",
      },
    ],
  );
});

test("uses stable progress indexes when partial parallel results are out of order", () => {
  assert.deepEqual(
    parseSubagentProgressResults(
      {
        details: {
          results: [
            {
              agent: "reviewer",
              model: "openai/gpt-5.6-sol:xhigh",
              progress: { index: 1 },
            },
            {
              agent: "worker",
              model: "openai/gpt-5.6-terra:medium",
              progress: { index: 0 },
            },
          ],
        },
      },
      "call-1b",
    ),
    [
      {
        toolCallId: "call-1b",
        childIndex: 1,
        agent: "reviewer",
        model: "gpt-5.6-sol",
        thinking: "xhigh",
      },
      {
        toolCallId: "call-1b",
        childIndex: 0,
        agent: "worker",
        model: "gpt-5.6-terra",
        thinking: "medium",
      },
    ],
  );
});

test("uses an explicit thinking field only when the model carries no known suffix", () => {
  assert.deepEqual(
    parseSubagentProgressResults(
      {
        details: {
          results: [
            {
              agent: "worker",
              model: "gpt-5.6-terra",
              thinking: "low",
            },
            {
              agent: "reviewer",
              model: "gpt-5.6-sol:high",
              thinking: "low",
            },
          ],
        },
      },
      "call-2",
    ),
    [
      {
        toolCallId: "call-2",
        childIndex: 0,
        agent: "worker",
        model: "gpt-5.6-terra",
        thinking: "low",
      },
      {
        toolCallId: "call-2",
        childIndex: 1,
        agent: "reviewer",
        model: "gpt-5.6-sol",
        thinking: "high",
      },
    ],
  );
});

test("omits thinking when the child's metadata cannot determine it", () => {
  assert.deepEqual(
    parseSubagentProgressResults(
      {
        details: {
          results: [{ agent: "reviewer", model: "gpt-5.6-sol" }],
        },
      },
      "call-3",
    ),
    [
      {
        toolCallId: "call-3",
        childIndex: 0,
        agent: "reviewer",
        model: "gpt-5.6-sol",
      },
    ],
  );
});

test("keeps unknown model suffixes in the model field", () => {
  assert.deepEqual(
    parseSubagentProgressResults(
      {
        details: {
          results: [{ agent: "worker", model: "provider/model:preview" }],
        },
      },
      "call-4",
    ),
    [
      {
        toolCallId: "call-4",
        childIndex: 0,
        agent: "worker",
        model: "model:preview",
      },
    ],
  );
});

test("skips malformed children without dropping valid siblings", () => {
  assert.deepEqual(
    parseSubagentProgressResults(
      {
        details: {
          results: [
            { agent: "worker" },
            { agent: 42, model: "gpt-5.6-sol:high" },
            null,
            { agent: "reviewer", model: "openai/gpt-5.6-sol:xhigh" },
          ],
        },
      },
      "call-5",
    ),
    [
      {
        toolCallId: "call-5",
        childIndex: 3,
        agent: "reviewer",
        model: "gpt-5.6-sol",
        thinking: "xhigh",
      },
    ],
  );
});

test("returns no progress for malformed result envelopes", () => {
  for (const result of [null, "malformed", { details: "invalid" }, {}]) {
    assert.deepEqual(parseSubagentProgressResults(result, "call-5b"), []);
  }
});

test("parses only the exact progress custom entry contract", () => {
  const progress = {
    toolCallId: "call-6",
    childIndex: 1,
    agent: "reviewer",
    model: "gpt-5.6-sol",
    thinking: "xhigh" as const,
  };

  assert.deepEqual(
    parseSubagentProgressEntry({
      type: "custom",
      customType: SUBAGENT_PROGRESS_CUSTOM_TYPE,
      data: progress,
    }),
    progress,
  );

  const withoutThinking = {
    toolCallId: "call-6b",
    childIndex: 0,
    agent: "worker",
    model: "gpt-5.6-terra",
  };
  assert.deepEqual(
    parseSubagentProgressEntry({
      type: "custom",
      customType: SUBAGENT_PROGRESS_CUSTOM_TYPE,
      data: withoutThinking,
    }),
    withoutThinking,
  );

  for (const entry of [
    { type: "custom_message", customType: SUBAGENT_PROGRESS_CUSTOM_TYPE, data: progress },
    { type: "custom", customType: "other", data: progress },
    { type: "custom", customType: SUBAGENT_PROGRESS_CUSTOM_TYPE, data: { ...progress, model: 3 } },
    { type: "custom", customType: SUBAGENT_PROGRESS_CUSTOM_TYPE, data: { ...progress, thinking: "bogus" } },
  ]) {
    assert.equal(parseSubagentProgressEntry(entry), undefined);
  }
});

test("builds a stable key from call, child, agent, model, and thinking", () => {
  assert.equal(
    subagentProgressKey({
      toolCallId: "call-7",
      childIndex: 2,
      agent: "worker",
      model: "gpt-5.6-terra",
      thinking: "medium",
    }),
    "call-7\u00002\u0000worker\u0000gpt-5.6-terra\u0000medium",
  );
  assert.equal(
    subagentProgressKey({
      toolCallId: "call-7",
      childIndex: 2,
      agent: "worker",
      model: "gpt-5.6-terra",
    }),
    "call-7\u00002\u0000worker\u0000gpt-5.6-terra\u0000",
  );
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```sh
node --test src/pi/subagent-progress.test.ts
```

Expected: FAIL with a module-not-found error for `./subagent-progress.ts`.

- [ ] **Step 3: Implement the normalization module**

Create `src/pi/subagent-progress.ts`:

```ts
export const SUBAGENT_PROGRESS_CUSTOM_TYPE = "patchmill-subagent-progress";

const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type SubagentThinkingLevel = (typeof THINKING_LEVELS)[number];

export type SubagentProgress = {
  toolCallId: string;
  childIndex: number;
  agent: string;
  model: string;
  thinking?: SubagentThinkingLevel;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isThinkingLevel(value: unknown): value is SubagentThinkingLevel {
  return (
    typeof value === "string" &&
    (THINKING_LEVELS as readonly string[]).includes(value)
  );
}

const THINKING_SUFFIX = new RegExp(`:(${THINKING_LEVELS.join("|")})$`);

function splitModel(model: string): {
  model: string;
  thinking?: SubagentThinkingLevel;
} {
  const suffix = THINKING_SUFFIX.exec(model);
  const withoutSuffix = suffix ? model.slice(0, -suffix[0].length) : model;
  const slash = withoutSuffix.lastIndexOf("/");
  return {
    model: slash >= 0 ? withoutSuffix.slice(slash + 1) : withoutSuffix,
    ...(suffix ? { thinking: suffix[1] as SubagentThinkingLevel } : {}),
  };
}

export function parseSubagentProgressResults(
  result: unknown,
  toolCallId: string,
): SubagentProgress[] {
  if (!isRecord(result) || !isRecord(result.details)) return [];
  const results = result.details.results;
  if (!Array.isArray(results)) return [];

  return results.flatMap((item, arrayIndex) => {
    if (!isRecord(item)) return [];
    const agent = typeof item.agent === "string" ? item.agent : "";
    const model = typeof item.model === "string" ? item.model : "";
    if (!agent || !model) return [];
    const rawIndex = isRecord(item.progress) ? item.progress.index : undefined;
    const progressIndex =
      typeof rawIndex === "number" &&
      Number.isInteger(rawIndex) &&
      rawIndex >= 0
        ? rawIndex
        : arrayIndex;
    const parsed = splitModel(model);
    const explicit = isThinkingLevel(item.thinking)
      ? item.thinking
      : undefined;
    const thinking = parsed.thinking ?? explicit;
    return [
      {
        toolCallId,
        childIndex: progressIndex,
        agent,
        model: parsed.model,
        ...(thinking ? { thinking } : {}),
      },
    ];
  });
}

export function parseSubagentProgressEntry(
  entry: Record<string, unknown>,
): SubagentProgress | undefined {
  if (entry.type !== "custom") return undefined;
  if (entry.customType !== SUBAGENT_PROGRESS_CUSTOM_TYPE) return undefined;
  if (!isRecord(entry.data)) return undefined;
  const { toolCallId, childIndex, agent, model, thinking } = entry.data;
  if (typeof toolCallId !== "string" || toolCallId.length === 0) return undefined;
  if (
    typeof childIndex !== "number" ||
    !Number.isInteger(childIndex) ||
    childIndex < 0
  ) {
    return undefined;
  }
  if (typeof agent !== "string" || agent.length === 0) return undefined;
  if (typeof model !== "string" || model.length === 0) return undefined;
  if (thinking !== undefined && !isThinkingLevel(thinking)) return undefined;
  return {
    toolCallId,
    childIndex,
    agent,
    model,
    ...(thinking ? { thinking } : {}),
  };
}

export function subagentProgressKey(progress: SubagentProgress): string {
  return [
    progress.toolCallId,
    String(progress.childIndex),
    progress.agent,
    progress.model,
    progress.thinking ?? "",
  ].join("\u0000");
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```sh
node --test src/pi/subagent-progress.test.ts
```

Expected: PASS with 9 passing tests and 0 failing tests.

- [ ] **Step 5: Commit the extraction contract**

```sh
git add src/pi/subagent-progress.ts src/pi/subagent-progress.test.ts
git commit -m "feat(pi): normalize subagent progress metadata"
```

Expected: one commit containing only the two Task 1 files.

---

### Task 2: Add the Pi lifecycle observer extension

**Files:**

- Create: `src/pi/extensions/run-once-subagent-progress.ts`
- Test: `src/pi/extensions/run-once-subagent-progress.test.ts`

**Interfaces:**

- Consumes:
  - `SUBAGENT_PROGRESS_CUSTOM_TYPE`
  - `SubagentProgress`
  - `parseSubagentProgressResults()`
  - `subagentProgressKey()`
- Produces:
  - `export type SubagentProgressObserverApi = { on(event: string, handler: (event: unknown) => void): void; appendEntry(customType: string, data: SubagentProgress): void }`
  - `export function registerRunOnceSubagentProgress(pi: SubagentProgressObserverApi): void`
  - default extension factory `export default function runOnceSubagentProgress(pi: SubagentProgressObserverApi): void`

- [ ] **Step 1: Write the failing lifecycle tests**

Create `src/pi/extensions/run-once-subagent-progress.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { SubagentProgress } from "../subagent-progress.ts";
import extension, {
  registerRunOnceSubagentProgress,
  type SubagentProgressObserverApi,
} from "./run-once-subagent-progress.ts";

type Handler = (event: unknown) => void;

type Harness = {
  api: SubagentProgressObserverApi;
  handlers: Map<string, Handler[]>;
  entries: Array<{ customType: string; data: SubagentProgress }>;
};

function createHarness(): Harness {
  const handlers = new Map<string, Handler[]>();
  const entries: Array<{ customType: string; data: SubagentProgress }> = [];
  const state: Harness = {
    handlers,
    entries,
    api: {
      on(event, handler) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      appendEntry(customType, data) {
        entries.push({ customType, data });
      },
    },
  };
  return state;
}

function emit(harness: Harness, event: string, payload: unknown): void {
  for (const handler of harness.handlers.get(event) ?? []) handler(payload);
}

function subagentUpdate(model: string): unknown {
  return {
    type: "tool_execution_update",
    toolCallId: "call-1",
    toolName: "subagent",
    args: { agent: "reviewer", task: "review this" },
    partialResult: {
      content: [{ type: "text", text: "reviewing" }],
      details: {
        results: [{ agent: "reviewer", model }],
      },
    },
  };
}

test("registers session, update, and end handlers", () => {
  const harness = createHarness();

  extension(harness.api);

  assert.deepEqual([...harness.handlers.keys()].sort(), [
    "session_start",
    "tool_execution_end",
    "tool_execution_update",
  ]);
});

test("first update appends a non-context progress entry without task or output", () => {
  const harness = createHarness();
  registerRunOnceSubagentProgress(harness.api);

  emit(
    harness,
    "tool_execution_update",
    subagentUpdate("openai-codex/gpt-5.6-sol:xhigh"),
  );

  assert.deepEqual(harness.entries, [
    {
      customType: "patchmill-subagent-progress",
      data: {
        toolCallId: "call-1",
        childIndex: 0,
        agent: "reviewer",
        model: "gpt-5.6-sol",
        thinking: "xhigh",
      },
    },
  ]);
});

test("repeated partial and final updates are deduplicated", () => {
  const harness = createHarness();
  registerRunOnceSubagentProgress(harness.api);
  const update = subagentUpdate("openai-codex/gpt-5.6-sol:xhigh");

  emit(harness, "tool_execution_update", update);
  emit(harness, "tool_execution_update", update);
  emit(harness, "tool_execution_end", {
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "subagent",
    result: {
      content: [],
      details: {
        results: [{ agent: "reviewer", model: "openai-codex/gpt-5.6-sol:xhigh" }],
      },
    },
    isError: false,
  });

  assert.equal(harness.entries.length, 1);
});

test("end event supplies the fallback when no partial update arrives", () => {
  const harness = createHarness();
  registerRunOnceSubagentProgress(harness.api);

  emit(harness, "tool_execution_end", {
    type: "tool_execution_end",
    toolCallId: "call-2",
    toolName: "subagent",
    result: {
      content: [],
      details: { results: [{ agent: "worker", model: "gpt-5.6-terra" }] },
    },
    isError: false,
  });

  assert.deepEqual(harness.entries, [
    {
      customType: "patchmill-subagent-progress",
      data: {
        toolCallId: "call-2",
        childIndex: 0,
        agent: "worker",
        model: "gpt-5.6-terra",
      },
    },
  ]);
});

test("changed fallback tuple emits another truthful launch tuple", () => {
  const harness = createHarness();
  registerRunOnceSubagentProgress(harness.api);

  emit(
    harness,
    "tool_execution_update",
    subagentUpdate("openai/gpt-5.6-sol:xhigh"),
  );
  emit(harness, "tool_execution_end", {
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "subagent",
    result: {
      content: [],
      details: {
        results: [{ agent: "reviewer", model: "openai/gpt-5.6-terra:high" }],
      },
    },
    isError: false,
  });

  assert.deepEqual(
    harness.entries.map((entry) => entry.data),
    [
      {
        toolCallId: "call-1",
        childIndex: 0,
        agent: "reviewer",
        model: "gpt-5.6-sol",
        thinking: "xhigh",
      },
      {
        toolCallId: "call-1",
        childIndex: 0,
        agent: "reviewer",
        model: "gpt-5.6-terra",
        thinking: "high",
      },
    ],
  );
});

test("session start clears deduplication state", () => {
  const harness = createHarness();
  registerRunOnceSubagentProgress(harness.api);
  const update = subagentUpdate("openai/gpt-5.6-sol:xhigh");

  emit(harness, "tool_execution_update", update);
  emit(harness, "session_start", { type: "session_start" });
  emit(harness, "tool_execution_update", update);

  assert.equal(harness.entries.length, 2);
});

test("unrelated and malformed events are ignored without throwing", () => {
  const harness = createHarness();
  registerRunOnceSubagentProgress(harness.api);

  emit(harness, "tool_execution_update", {
    ...subagentUpdate("gpt-5.6-sol:high"),
    toolName: "read",
  });
  emit(harness, "tool_execution_update", {
    ...subagentUpdate("gpt-5.6-sol:high"),
    partialResult: "malformed",
  });
  emit(harness, "tool_execution_end", {
    type: "tool_execution_end",
    toolCallId: "call-9",
    toolName: "subagent",
    result: undefined,
    isError: true,
  });

  assert.deepEqual(harness.entries, []);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```sh
node --test src/pi/extensions/run-once-subagent-progress.test.ts
```

Expected: FAIL with a module-not-found error for `./run-once-subagent-progress.ts`.

- [ ] **Step 3: Implement the extension**

Create `src/pi/extensions/run-once-subagent-progress.ts`:

```ts
import {
  SUBAGENT_PROGRESS_CUSTOM_TYPE,
  isRecord,
  parseSubagentProgressResults,
  subagentProgressKey,
  type SubagentProgress,
} from "../subagent-progress.ts";

export type SubagentProgressObserverApi = {
  on(event: string, handler: (event: unknown) => void): void;
  appendEntry(customType: string, data: SubagentProgress): void;
};

type SubagentProgressObserverState = {
  emitted: Set<string>;
};

function observe(
  pi: SubagentProgressObserverApi,
  state: SubagentProgressObserverState,
  toolCallId: string,
  result: unknown,
): void {
  for (const progress of parseSubagentProgressResults(result, toolCallId)) {
    const key = subagentProgressKey(progress);
    if (state.emitted.has(key)) continue;
    state.emitted.add(key);
    pi.appendEntry(SUBAGENT_PROGRESS_CUSTOM_TYPE, progress);
  }
}

export function registerRunOnceSubagentProgress(
  pi: SubagentProgressObserverApi,
): void {
  const state: SubagentProgressObserverState = { emitted: new Set<string>() };

  pi.on("session_start", () => {
    state.emitted.clear();
  });

  pi.on("tool_execution_update", (event) => {
    if (!isRecord(event) || event.toolName !== "subagent") return;
    if (typeof event.toolCallId !== "string") return;
    observe(pi, state, event.toolCallId, event.partialResult);
  });

  pi.on("tool_execution_end", (event) => {
    if (!isRecord(event) || event.toolName !== "subagent") return;
    if (typeof event.toolCallId !== "string") return;
    observe(pi, state, event.toolCallId, event.result);
  });
}

export default function runOnceSubagentProgress(
  pi: SubagentProgressObserverApi,
): void {
  registerRunOnceSubagentProgress(pi);
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```sh
node --test src/pi/extensions/run-once-subagent-progress.test.ts
```

Expected: PASS with 7 passing tests and 0 failing tests.

- [ ] **Step 5: Commit the observer extension**

```sh
git add src/pi/extensions/run-once-subagent-progress.ts src/pi/extensions/run-once-subagent-progress.test.ts
git commit -m "feat(pi): observe subagent progress launches"
```

Expected: one commit containing only the two Task 2 files.

---

### Task 3: Load the observer in every run-once Pi profile

**Files:**

- Create: `src/pi/extensions/run-once-subagent-progress.load.test.ts`
- Modify: `src/pi/resource-profiles.ts`
- Modify: `src/pi/resource-profiles.test.ts`
- Modify: `src/cli/commands/run-once/pi.test.ts`

**Interfaces:**

- Consumes: Task 2's extension source path `src/pi/extensions/run-once-subagent-progress.ts` and its relative `../subagent-progress.ts` import.
- Produces: `runOnceExtensionPaths()` returns three paths in order: `pi-subagents`, `extensions/todos.ts`, then the run-once subagent progress observer. Also exports `findPackageRoot(start: string): string`, which resolves the package root correctly from both `src/pi/` and `dist/src/pi/` (fixing the pre-existing `todos.ts` mis-resolution in the packed layout).

- [ ] **Step 1: Write the failing root-resolution tests**

In `src/pi/resource-profiles.test.ts`, add these tests after the existing profile tests:

```ts
test("findPackageRoot walks up from nested source and dist-style layouts", async () => {
  await withRepo(async (repoRoot) => {
    const nested = join(repoRoot, "dist", "src", "pi");
    await mkdir(nested, { recursive: true });
    await writeFile(
      join(repoRoot, "package.json"),
      JSON.stringify({ name: "patchmill-test" }),
      "utf8",
    );

    assert.equal(findPackageRoot(nested), repoRoot);
    assert.equal(findPackageRoot(join(repoRoot, "src", "pi")), repoRoot);
  });
});

test("every run-once extension path exists on disk", async () => {
  await withRepo(async (repoRoot) => {
    const profile = runOncePlanningPiProfile(skills, repoRoot);
    for (const path of profile.additionalExtensionPaths) {
      assert.equal(existsSync(path), true, `missing extension: ${path}`);
    }
  });
});
```

In the same file: add `mkdir` and `writeFile` to the `node:fs/promises` import, add `import { existsSync } from "node:fs";`, and add `findPackageRoot` to the `./resource-profiles.ts` import.

- [ ] **Step 2: Run the root-resolution tests to verify they fail**

Run:

```sh
node --test src/pi/resource-profiles.test.ts
```

Expected: FAIL with a module/exports error for `findPackageRoot`.

- [ ] **Step 3: Resolve the package root robustly**

The current `PATCHMILL_PACKAGE_ROOT` derives from `import.meta.url` with a fixed `../..`, which resolves to `<pkg>/dist` in the compiled layout — a pre-existing bug that already mis-resolves `extensions/todos.ts` in production, where Pi's loader logs the failure and continues without the extension. In `src/pi/resource-profiles.ts`, add `import { existsSync } from "node:fs";` and replace the root computation with a walk-up search that throws loudly at startup when no package root exists:

```ts
export function findPackageRoot(start: string): string {
  let current = start;
  for (;;) {
    if (existsSync(join(current, "package.json"))) return current;
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`could not find package.json walking up from ${start}`);
    }
    current = parent;
  }
}

const PATCHMILL_PACKAGE_ROOT = findPackageRoot(
  dirname(fileURLToPath(import.meta.url)),
);
```

From `src/pi/` this stops at the repository root; from `dist/src/pi/` it stops at the package root because `dist/` contains no `package.json`.

- [ ] **Step 4: Run the root-resolution tests to verify they pass**

Run:

```sh
node --test src/pi/resource-profiles.test.ts
```

Expected: PASS with 0 failing tests (the exists-on-disk test covers the current two extension paths).

- [ ] **Step 5: Commit the pre-existing root-resolution fix separately**

```sh
git add src/pi/resource-profiles.ts src/pi/resource-profiles.test.ts
git commit -m "fix(pi): resolve package root from compiled layout"
```

Expected: one commit containing only the two files, so the pre-existing `todos.ts` production fix is reviewable independently of the feature wiring.

- [ ] **Step 6: Write the failing observer-wiring tests**

In `src/pi/resource-profiles.test.ts`, replace the planning-profile extension assertions with this test body while keeping all existing imports and helpers:

```ts
test("run-once planning profile includes context and Patchmill run-once extensions", async () => {
  await withRepo(async (repoRoot) => {
    const profile = runOncePlanningPiProfile(skills, repoRoot);

    assert.equal(profile.id, "run-once-planning");
    assert.equal(profile.noContextFiles, false);
    assert.equal(profile.noPromptTemplates, false);
    assert.equal(profile.additionalExtensionPaths.length, 3);
    assert.equal(
      basename(profile.additionalExtensionPaths[0] ?? ""),
      "pi-subagents",
    );
    assert.equal(
      profile.additionalExtensionPaths[1]
        ?.replaceAll("\\", "/")
        .endsWith("/extensions/todos.ts"),
      true,
    );
    assert.equal(
      profile.additionalExtensionPaths[2]
        ?.replaceAll("\\", "/")
        .endsWith("/src/pi/extensions/run-once-subagent-progress.ts"),
      true,
    );
    assert.deepEqual(profile.additionalSkillPaths, [
      join(repoRoot, "skills", "planning", "SKILL.md"),
    ]);
  });
});
```

Add this test immediately after the planning-profile test:

```ts
test("all run-once profiles load the subagent progress observer and triage does not", async () => {
  await withRepo(async (repoRoot) => {
    for (const profile of [
      runOncePlanningPiProfile(skills, repoRoot),
      runOnceDevelopmentEnvironmentPiProfile(skills, repoRoot),
      runOnceImplementationPiProfile(skills, repoRoot),
    ]) {
      assert.equal(profile.additionalExtensionPaths.length, 3);
      assert.equal(
        profile.additionalExtensionPaths[2]
          ?.replaceAll("\\", "/")
          .endsWith("/src/pi/extensions/run-once-subagent-progress.ts"),
        true,
      );
    }

    assert.deepEqual(triagePiProfile(skills, repoRoot).additionalExtensionPaths, []);
  });
});
```

Create `src/pi/extensions/run-once-subagent-progress.load.test.ts` as a packaging smoke test. It passes Patchmill's Testing Value Gate because it proves the bundled Pi CLI loads the vendored `extensions/todos.ts` and the multi-file TypeScript observer — including the relative `../subagent-progress.ts` import — which no existing test covers (`extensions/todos.ts` is single-file and, due to the root-resolution bug fixed in Step 3, has never loaded in production):

```ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const PI_CLI = join(
  dirname(require.resolve("@earendil-works/pi-coding-agent/package.json")),
  "dist",
  "cli.js",
);
const EXTENSIONS = [
  join(process.cwd(), "extensions", "todos.ts"),
  join(
    process.cwd(),
    "src",
    "pi",
    "extensions",
    "run-once-subagent-progress.ts",
  ),
];

test(
  "bundled Pi loads the run-once TypeScript extensions and fails only at the provider stage",
  { timeout: 60_000 },
  () => {
    const result = spawnSync(
      process.execPath,
      [
        PI_CLI,
        ...EXTENSIONS.flatMap((path) => ["-e", path]),
        "-p",
        "Say ok",
        "--no-tools",
        "--provider",
        "__invalid__",
      ],
      { encoding: "utf8" },
    );
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(
      output,
      /Failed to load extension|Cannot find package|No such built-in module/,
    );
    assert.match(output, /provider|api[- ]?key|invalid/i);
  },
);
```

The run must fail only at the expected provider/API-key stage; any `Failed to load extension`, `No such built-in module`, or `Cannot find package` output is a regression.

In `src/cli/commands/run-once/pi.test.ts`, replace `runOnceExtensionArgs` with:

```ts
const runOnceExtensionArgs = [
  "-e",
  "/repo/node_modules/pi-subagents",
  "-e",
  "/repo/extensions/todos.ts",
  "-e",
  "/repo/src/pi/extensions/run-once-subagent-progress.ts",
];
```

Update all four existing bundled-Pi-call assertions that inspect extension arguments from `args.slice(0, 5)` or `args.slice(0, 9)` in these tests:

- `"runPiPrompt writes the prompt to a temp file and surfaces nonzero pi failures"`
- `"runPiPrompt loads bundled Pi extensions before the prompt argument"`
- `"runPiPrompt streams messages appended to the prompted pi session JSONL"`
- `"runPiPrompt passes configured skill files before the prompt argument"`

Use this replacement in each of the first three tests:

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
assert.match(args[1] ?? "", /node_modules\/pi-subagents$/);
assert.match(args[3] ?? "", /extensions\/todos\.ts$/);
assert.match(
  args[5] ?? "",
  /src\/pi\/extensions\/run-once-subagent-progress\.ts$/,
);
```

In `"runPiPrompt loads bundled Pi extensions before the prompt argument"`, also replace the prompt assertion:

```ts
assert.equal(args[7]?.startsWith("@"), true);
```

In `"runPiPrompt passes configured skill files before the prompt argument"`, the third `-e` pair shifts the two `--skill` pairs to indices 6–9 and `-p` to index 10, so replace its assertions with:

```ts
assert.deepEqual(args.slice(0, 11), [
  "-e",
  args[1],
  "-e",
  args[3],
  "-e",
  args[5],
  "--skill",
  "/repo/.patchmill/skills/writing-plans/SKILL.md",
  "--skill",
  "/repo/.patchmill/skills/review/SKILL.md",
  "-p",
]);
assert.match(args[1] ?? "", /node_modules\/pi-subagents$/);
assert.match(args[3] ?? "", /extensions\/todos\.ts$/);
assert.match(
  args[5] ?? "",
  /src\/pi\/extensions\/run-once-subagent-progress\.ts$/,
);
assert.equal(args[11]?.startsWith("@"), true);
```

Keep `promptPath(args)` unchanged; it finds the `@` argument independent of its index.

In `src/pi/resource-profiles.test.ts`, add `runOnceDevelopmentEnvironmentPiProfile` to the `./resource-profiles.ts` import (the all-profiles test uses it).

- [ ] **Step 7: Run the wiring tests to verify they fail**

Run:

```sh
node --test src/pi/resource-profiles.test.ts src/cli/commands/run-once/pi.test.ts
```

Expected: FAIL because profiles still return only two extensions and Pi calls only include two `-e` pairs.

- [ ] **Step 8: Add the observer extension path**

Add this constant next to `PATCHMILL_TODOS_EXTENSION`. Use a single source path: Pi loads TypeScript extensions through jiti and `package.json` ships the `src/` tree, so no compiled/source path fork is needed. The observer lives under `src/pi/extensions/` — inside the eslint, tsc, and test-discovery globs — unlike the vendored `extensions/todos.ts`:

```ts
const PATCHMILL_RUN_ONCE_SUBAGENT_PROGRESS_EXTENSION = join(
  PATCHMILL_PACKAGE_ROOT,
  "src",
  "pi",
  "extensions",
  "run-once-subagent-progress.ts",
);
```

Replace `runOnceExtensionPaths()` with:

```ts
function runOnceExtensionPaths(): string[] {
  return [
    PI_SUBAGENTS_PACKAGE_ROOT,
    PATCHMILL_TODOS_EXTENSION,
    PATCHMILL_RUN_ONCE_SUBAGENT_PROGRESS_EXTENSION,
  ];
}
```

- [ ] **Step 9: Run the wiring tests to verify they pass**

Run:

```sh
node --test src/pi/resource-profiles.test.ts src/cli/commands/run-once/pi.test.ts src/pi/extensions/run-once-subagent-progress.load.test.ts
```

Expected: PASS with 0 failing tests in all three files.

- [ ] **Step 10: Commit the profile wiring**

```sh
git add src/pi/resource-profiles.ts src/pi/resource-profiles.test.ts src/cli/commands/run-once/pi.test.ts src/pi/extensions/run-once-subagent-progress.load.test.ts
git commit -m "feat(pi): load run-once subagent observer"
```

Expected: one commit containing only the four wiring files, on top of the Step 5 root-resolution fix.

---

### Task 4: Stream validated custom progress entries

**Files:**

- Create: `src/cli/commands/run-once/pi-session-stream.test.ts`
- Modify: `src/cli/commands/run-once/pi-session-stream.ts`
- Modify: `src/cli/commands/run-once/pipeline-progress.ts`
- Modify: `src/cli/commands/run-once/pipeline-progress.test.ts`

**Interfaces:**

- Consumes: Task 1's `SUBAGENT_PROGRESS_CUSTOM_TYPE`, `SubagentProgress`, and `parseSubagentProgressEntry()`.
- Produces:
  - `PiSessionObservation` gains `{ type: "subagent-progress"; progress: SubagentProgress }`.
  - `sessionEntryToObservations(entry: JsonObject): PiSessionObservation[]` returns the progress observation only for exact, valid progress custom entries.
  - `createSubagentProgressGate(onObservation: (observation: PiSessionObservation) => void): (observation: PiSessionObservation) => void` — a self-contained unit owning tool-call deduplication, the pending-observation buffer, and the emitted-key set; `createPiSessionObservationStreamer` reduces to a one-line dispatch into it.
  - ToolResult-derived `tool-call` observations carry an explicit `completed: true` marker that the gate (and only the gate) consumes.

- [ ] **Step 1: Write the failing session-stream tests**

Create `src/cli/commands/run-once/pi-session-stream.test.ts` — these tests target `pi-session-stream.ts` directly, and `pi.test.ts` is already over a thousand lines:

```ts
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createPiSessionObservationStreamer,
  createSubagentProgressGate,
  sessionEntryToObservations,
  type PiSessionObservation,
} from "./pi-session-stream.ts";

async function collectObservations(
  entries: Array<Record<string, unknown>>,
): Promise<PiSessionObservation[]> {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-stream-"));
  try {
    const sessionDir = join(dir, "sessions");
    await mkdir(join(sessionDir, "--repo--"), { recursive: true });
    await writeFile(
      join(sessionDir, "--repo--", "session.jsonl"),
      entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
      "utf8",
    );
    const observations: PiSessionObservation[] = [];
    const streamer = createPiSessionObservationStreamer(
      sessionDir,
      (observation) => observations.push(observation),
      { pollMs: 10 },
    );
    streamer.start();
    await streamer.stop();
    return observations;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function collectGateObservations(
  input: PiSessionObservation[],
): PiSessionObservation[] {
  const emitted: PiSessionObservation[] = [];
  const gate = createSubagentProgressGate((observation) =>
    emitted.push(observation),
  );
  for (const observation of input) gate(observation);
  return emitted;
}
```

Add these tests to the new file:

```ts
test("session stream converts valid subagent progress custom entries", () => {
  assert.deepEqual(
    sessionEntryToObservations({
      type: "custom",
      customType: "patchmill-subagent-progress",
      data: {
        toolCallId: "call-1",
        childIndex: 1,
        agent: "reviewer",
        model: "gpt-5.6-sol",
        thinking: "xhigh",
      },
    }),
    [
      {
        type: "subagent-progress",
        progress: {
          toolCallId: "call-1",
          childIndex: 1,
          agent: "reviewer",
          model: "gpt-5.6-sol",
          thinking: "xhigh",
        },
      },
    ],
  );
});

test("session stream ignores malformed and unrelated custom entries", () => {
  for (const entry of [
    {
      type: "custom",
      customType: "patchmill-subagent-progress",
      data: {
        toolCallId: "call-1",
        childIndex: 0,
        agent: "reviewer",
        model: "gpt-5.6-sol",
        thinking: "bogus",
      },
    },
    {
      type: "custom",
      customType: "unrelated",
      data: { agent: "reviewer" },
    },
    {
      type: "custom_message",
      customType: "patchmill-subagent-progress",
      data: {
        toolCallId: "call-1",
        childIndex: 0,
        agent: "reviewer",
        model: "gpt-5.6-sol",
        thinking: "high",
      },
    },
  ]) {
    assert.deepEqual(sessionEntryToObservations(entry), []);
  }
});

test("sessionEntryToObservations marks toolResult observations as completed", () => {
  assert.deepEqual(
    sessionEntryToObservations({
      type: "message",
      message: {
        role: "toolResult",
        toolName: "subagent",
        toolCallId: "call-1",
        content: [],
      },
    }),
    [
      {
        type: "tool-call",
        toolName: "subagent",
        toolCallId: "call-1",
        completed: true,
      },
    ],
  );
});

test("session streamer buffers a foreground subagent call and replays it when no metadata resolves (end-to-end smoke)", async () => {
  const observations = await collectObservations([
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call-1",
            name: "subagent",
            arguments: { agent: "worker", task: "implement" },
          },
        ],
      },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "subagent",
        toolCallId: "call-1",
        content: [],
      },
    },
  ]);

  assert.deepEqual(
    observations.filter((observation) => observation.type === "tool-call"),
    [
      {
        type: "tool-call",
        toolName: "subagent",
        toolCallId: "call-1",
        arguments: { agent: "worker", task: "implement" },
      },
    ],
  );
});

test("gate emits every per-child progress observation for one call", () => {
  const observations = collectGateObservations([
    {
      type: "tool-call",
      toolName: "subagent",
      toolCallId: "call-1",
      arguments: {
        tasks: [
          { agent: "worker", task: "implement" },
          { agent: "reviewer", task: "review" },
        ],
      },
    },
    {
      type: "subagent-progress",
      progress: {
        toolCallId: "call-1",
        childIndex: 0,
        agent: "worker",
        model: "gpt-5.6-terra",
        thinking: "medium",
      },
    },
    {
      type: "subagent-progress",
      progress: {
        toolCallId: "call-1",
        childIndex: 1,
        agent: "reviewer",
        model: "gpt-5.6-sol",
        thinking: "xhigh",
      },
    },
    {
      type: "tool-call",
      toolName: "subagent",
      toolCallId: "call-1",
      completed: true,
    },
  ]);

  assert.equal(
    observations.filter(
      (observation) => observation.type === "subagent-progress",
    ).length,
    2,
  );
  assert.equal(
    observations.filter((observation) => observation.type === "tool-call")
      .length,
    0,
  );
});

test("gate emits a changed fallback tuple instead of deduplicating it away", () => {
  const observations = collectGateObservations([
    {
      type: "subagent-progress",
      progress: {
        toolCallId: "call-1",
        childIndex: 0,
        agent: "reviewer",
        model: "gpt-5.6-sol",
        thinking: "xhigh",
      },
    },
    {
      type: "subagent-progress",
      progress: {
        toolCallId: "call-1",
        childIndex: 0,
        agent: "reviewer",
        model: "gpt-5.6-terra",
        thinking: "high",
      },
    },
  ]);

  assert.equal(
    observations.filter(
      (observation) => observation.type === "subagent-progress",
    ).length,
    2,
  );
});

test("gate deduplicates repeated progress entries across file re-reads", () => {
  const progress: PiSessionObservation = {
    type: "subagent-progress",
    progress: {
      toolCallId: "call-1",
      childIndex: 0,
      agent: "worker",
      model: "gpt-5.6-terra",
      thinking: "medium",
    },
  };

  assert.equal(collectGateObservations([progress, progress]).length, 1);
});

test("gate does not replay the buffer on argument-ful re-read duplicates", () => {
  const callObservation: PiSessionObservation = {
    type: "tool-call",
    toolName: "subagent",
    toolCallId: "call-1",
    arguments: { agent: "worker", task: "implement" },
  };
  const observations = collectGateObservations([
    callObservation,
    callObservation,
    {
      type: "tool-call",
      toolName: "subagent",
      toolCallId: "call-1",
      completed: true,
    },
  ]);

  assert.deepEqual(
    observations.filter((observation) => observation.type === "tool-call"),
    [callObservation],
  );
});

test("gate never buffers async or management subagent calls", () => {
  const observations = collectGateObservations([
    {
      type: "tool-call",
      toolName: "subagent",
      toolCallId: "call-async",
      arguments: { agent: "worker", task: "implement", async: true },
    },
    {
      type: "tool-call",
      toolName: "subagent",
      toolCallId: "call-mgmt",
      arguments: { action: "list" },
    },
    {
      type: "tool-call",
      toolName: "subagent",
      toolCallId: "call-async",
      completed: true,
    },
  ]);

  assert.deepEqual(
    observations
      .filter((observation) => observation.type === "tool-call")
      .map((observation) => observation.toolCallId),
    ["call-async", "call-mgmt"],
  );
});
```

Add this test to `src/cli/commands/run-once/pipeline-progress.test.ts` (its `collectProgressEvents` harness already exists):

```ts
test("step accounting counts resolved subagent children as tool calls", async () => {
  const { events, progress: reporter } = collectProgressEvents();
  const accounting = createStepAccounting({
    progress: reporter,
    issueNumber: 1,
  });
  await accounting.start("implement");
  for (const progress of [
    {
      toolCallId: "call-1",
      childIndex: 0,
      agent: "worker",
      model: "gpt-5.6-terra",
      thinking: "medium" as const,
    },
    {
      toolCallId: "call-1",
      childIndex: 1,
      agent: "reviewer",
      model: "gpt-5.6-sol",
      thinking: "xhigh" as const,
    },
  ]) {
    await accounting.observe("pi", { type: "subagent-progress", progress });
  }
  await accounting.start("next");
  const complete = events.find((event) => event.step?.type === "step-complete");
  assert.equal(
    complete?.step?.type === "step-complete"
      ? complete.step.toolCalls
      : undefined,
    2,
  );
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```sh
node --test src/cli/commands/run-once/pi-session-stream.test.ts src/cli/commands/run-once/pipeline-progress.test.ts
```

Expected: FAIL because `sessionEntryToObservations` returns no `subagent-progress` observation and no `completed` marker, the gate does not exist, and accounting does not count subagent children.

- [ ] **Step 3: Add the custom-entry observation and buffer/replay**

In `src/cli/commands/run-once/pi-session-stream.ts`, add this import:

```ts
import {
  parseSubagentProgressEntry,
  subagentProgressKey,
  type SubagentProgress,
} from "../../../pi/subagent-progress.ts";
```

Extend `PiSessionObservation` with the new union member, and add an optional completion marker to the existing `tool-call` variant (no second observation type is needed — the fallback below replays the original tool-call observation):

```ts
| {
    type: "subagent-progress";
    progress: SubagentProgress;
  }
```

```ts
completed?: boolean;
```

At the start of `sessionEntryToObservations`, before the existing `custom_message` branch, add:

```ts
const subagentProgress = parseSubagentProgressEntry(entry);
if (subagentProgress) {
  return [{ type: "subagent-progress", progress: subagentProgress }];
}
```

In the same function's toolResult branch, mark the observation as a completion signal:

```ts
observations.push({
  type: "tool-call",
  ...(toolName ? { toolName } : {}),
  ...(toolCallId ? { toolCallId } : {}),
  completed: true,
});
```

Leave `sessionEntryToStreamText` and `sessionEntryToRawText` unchanged: valid custom entries are observations only, not raw or pretty text.

Extract all buffer/replay/dedup state into an exported, self-contained gate after `sessionEntryToObservations`, so the subtle logic is unit-testable without the polling harness:

```ts
export function createSubagentProgressGate(
  onObservation: (observation: PiSessionObservation) => void,
): (observation: PiSessionObservation) => void {
  const seenToolCallIds = new Set<string>();
  const pendingSubagentObservations = new Map<string, PiSessionObservation>();
  const emittedSubagentProgressKeys = new Set<string>();

  return (observation) => {
    if (observation.type === "subagent-progress") {
      const key = subagentProgressKey(observation.progress);
      if (emittedSubagentProgressKeys.has(key)) return;
      emittedSubagentProgressKeys.add(key);
      pendingSubagentObservations.delete(observation.progress.toolCallId);
      onObservation(observation);
      return;
    }
    if (observation.type === "tool-call" && observation.toolCallId) {
      const toolCallId = observation.toolCallId;
      if (seenToolCallIds.has(toolCallId)) {
        if (observation.completed === true) {
          const buffered = pendingSubagentObservations.get(toolCallId);
          pendingSubagentObservations.delete(toolCallId);
          if (buffered) onObservation(buffered);
        }
        return;
      }
      seenToolCallIds.add(toolCallId);
      if (
        observation.toolName === "subagent" &&
        observation.arguments &&
        !("action" in observation.arguments) &&
        observation.arguments.async !== true
      ) {
        pendingSubagentObservations.set(toolCallId, observation);
        return;
      }
    }
    onObservation(observation);
  };
}
```

In `createPiSessionObservationStreamer`, remove the local `observedToolCallIds` set (the gate owns tool-call deduplication) and reduce `processLine`'s observation loop to a one-line dispatch:

```ts
const gate = createSubagentProgressGate(onObservation);

const processLine = (line: string) => {
  const entry = parseSessionLine(line);
  if (!entry) return;
  for (const observation of sessionEntryToObservations(entry)) {
    gate(observation);
  }
  if (options.verboseOutput) {
    const text = sessionEntryToRawText(entry);
    if (text !== undefined) options.verboseOutput(text);
  }
};
```

The buffer predicate checks only top-level `async`: pinned `pi-subagents` declares `async` solely on the top-level params (`TaskParam`, `SequentialStep`, and `ParallelStep` have no such field), so a per-task deep-scan would be dead code that can misfire on stray input.

The two dedup layers guard distinct failure modes: the extension's `subagentProgressKey` set deduplicates repeated lifecycle events, while the gate's `emittedSubagentProgressKeys` set guards the file re-read path (`info.size < offset` resets `offset = 0` and replays earlier lines).

The replay fires only on observations explicitly marked `completed: true` — an intentional contract, not an incidental shape property. The replay relies on one ordering invariant: the extension's `tool_execution_end` append lands in the JSONL before Pi writes the toolResult message (verified: `agent-session.js` awaits extension end handlers before `message_end` persistence). If that order ever reversed, a call would print its original summary followed by the enriched line — degraded, but never silent.

- [ ] **Step 4: Run the streamer tests to verify they pass**

Run:

```sh
node --test src/cli/commands/run-once/pi-session-stream.test.ts
```

Expected: PASS with 0 failing tests.

- [ ] **Step 5: Keep step accounting accurate**

In `src/cli/commands/run-once/pipeline-progress.ts`, change the `observe()` counting branch so resolved subagent children still register — each child is a real Pi execution, and replayed foreground calls continue to count through the replayed tool-call observation:

```ts
if (
  (observation.type === "tool-call" ||
    observation.type === "subagent-progress") &&
  activeStep
) {
  activeStep.toolCalls += 1;
}
```

Run:

```sh
node --test src/cli/commands/run-once/pipeline-progress.test.ts
```

Expected: PASS with 0 failing tests.

- [ ] **Step 6: Commit the session observation**

```sh
git add src/cli/commands/run-once/pi-session-stream.ts src/cli/commands/run-once/pi-session-stream.test.ts src/cli/commands/run-once/pipeline-progress.ts src/cli/commands/run-once/pipeline-progress.test.ts
git commit -m "feat(run-once): stream subagent launch progress"
```

Expected: one commit containing only the four Task 4 files.

---

### Task 5: Render enriched subagent progress lines

**Files:**

- Modify: `src/cli/commands/run-once/console-progress.ts`
- Modify: `src/cli/commands/run-once/console-progress.test.ts`

**Interfaces:**

- Consumes: Task 4's observation `{ type: "subagent-progress"; progress: SubagentProgress }`.
- Produces: console lines exactly matching `🤖 subagent (agent=<agent>, model=<model>, thinking=<level>)`, with the `thinking` segment omitted when not determinable. The reporter needs no suppression logic: the Task 4 streamer buffers foreground execution calls, and replayed observations render through the existing formatter unchanged.

- [ ] **Step 1: Write the failing console tests**

Keep every existing test in `src/cli/commands/run-once/console-progress.test.ts` unchanged — including `"console reporter renders subagent tool calls with only agent details"` and `"console reporter renders subagent management calls as normal tools"`. Add these two tests:

```ts
test("console reporter renders one enriched line per resolved subagent child", () => {
  const lines: string[] = [];
  const reporter = new AgentIssueConsoleProgressReporter({
    writeLine: (line) => lines.push(line),
    startedAt: BASE,
  });

  reporter.event(
    event({
      message: "implement task",
      step: { type: "step-start", label: "implement task" },
    }),
  );
  for (const progress of [
    {
      toolCallId: "call-1",
      childIndex: 0,
      agent: "worker",
      model: "gpt-5.6-terra",
      thinking: "medium" as const,
    },
    {
      toolCallId: "call-1",
      childIndex: 1,
      agent: "reviewer",
      model: "gpt-5.6-sol",
      thinking: "xhigh" as const,
    },
  ]) {
    reporter.event(
      event({
        observation: { type: "subagent-progress", progress },
      }),
    );
  }

  assert.deepEqual(lines, [
    "01 implement task",
    "   🤖 subagent (agent=worker, model=gpt-5.6-terra, thinking=medium)",
    "   🤖 subagent (agent=reviewer, model=gpt-5.6-sol, thinking=xhigh)",
  ]);
});

test("console reporter omits the thinking segment when it is not determinable", () => {
  const lines: string[] = [];
  const reporter = new AgentIssueConsoleProgressReporter({
    writeLine: (line) => lines.push(line),
    startedAt: BASE,
  });

  reporter.event(
    event({
      message: "implement task",
      step: { type: "step-start", label: "implement task" },
    }),
  );
  reporter.event(
    event({
      observation: {
        type: "subagent-progress",
        progress: {
          toolCallId: "call-1",
          childIndex: 0,
          agent: "worker",
          model: "gpt-5.6-terra",
        },
      },
    }),
  );

  assert.deepEqual(lines, [
    "01 implement task",
    "   🤖 subagent (agent=worker, model=gpt-5.6-terra)",
  ]);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```sh
node --test src/cli/commands/run-once/console-progress.test.ts
```

Expected: FAIL because `subagent-progress` observations are unhandled.

- [ ] **Step 3: Render progress observations**

In `src/cli/commands/run-once/console-progress.ts`, import the payload type and add one helper after `formatSubagentCall()`:

```ts
import type { SubagentProgress } from "../../../pi/subagent-progress.ts";

function formatSubagentProgress(progress: SubagentProgress): string {
  const thinking = progress.thinking ? `, thinking=${progress.thinking}` : "";
  return `🤖 subagent (agent=${progress.agent}, model=${progress.model}${thinking})`;
}
```

In `event()`'s observation handling, add this branch before the existing `tool-call` branch:

```ts
if (event.observation?.type === "subagent-progress") {
  if (this.currentStep) {
    this.writeLine(`   ${formatSubagentProgress(event.observation.progress)}`);
  }
  return;
}
```

`formatToolCall()`, the existing `tool-call` branch, and every existing reporter test stay byte-for-byte unchanged: the Task 4 streamer buffers foreground execution calls, so the reporter never sees them until replay, and replayed observations render through the existing formatter — agent-only for direct/parallel args, the `🔧` argument form for chain args, and normal `🔧` formatting for management calls.

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```sh
node --test src/cli/commands/run-once/console-progress.test.ts
```

Expected: PASS with 0 failing tests.

- [ ] **Step 5: Commit the console output**

```sh
git add src/cli/commands/run-once/console-progress.ts src/cli/commands/run-once/console-progress.test.ts
git commit -m "feat(run-once): show subagent model progress"
```

Expected: one commit containing only the two Task 5 files.

---

### Task 6: Final regression and packaging verification

**Files:**

- Review: all Task 1 through Task 5 files.
- Modify: only files needed to fix verification failures; record any fixes in a separate commit.

**Interfaces:**

- Consumes: all interfaces produced by Tasks 1 through 5.
- Produces: verified issue #116 branch ready for review; no implementation handoff until every command below passes.

- [ ] **Step 1: Run the focused regression suite**

Run:

```sh
node --test \
  src/pi/subagent-progress.test.ts \
  src/pi/extensions/run-once-subagent-progress.test.ts \
  src/pi/extensions/run-once-subagent-progress.load.test.ts \
  src/pi/resource-profiles.test.ts \
  src/cli/commands/run-once/pi.test.ts \
  src/cli/commands/run-once/pi-session-stream.test.ts \
  src/cli/commands/run-once/pipeline-progress.test.ts \
  src/cli/commands/run-once/console-progress.test.ts
```

Expected: PASS with 0 failing tests.

- [ ] **Step 2: Run the full automated test suite**

Run:

```sh
npm test
```

Expected: PASS with 0 failing tests.

- [ ] **Step 3: Run lint and formatting checks**

Run:

```sh
npm run lint
```

Expected: Prettier, ESLint, and markdownlint all pass with 0 errors and 0 warnings.

- [ ] **Step 4: Build the package**

Run:

```sh
npm run build
```

Expected: TypeScript compilation succeeds. (`dist/src/pi/extensions/run-once-subagent-progress.js` is emitted as a side effect of compiling `src/`; nothing loads it — the profile loads the TypeScript source via jiti.)

- [ ] **Step 5: Check the diff**

Run:

```sh
git diff --check
git status --short --branch
```

Expected: no whitespace errors; no untracked or modified files outside the issue branch's intentional planning and implementation commits.

- [ ] **Step 6: Verify package contents**

Run:

```sh
npm pack --dry-run
```

Expected: the dry-run package contents include `src/pi/extensions/run-once-subagent-progress.ts` and `src/pi/subagent-progress.ts` (the observer is loaded from source via jiti, exactly like `extensions/todos.ts`), and the command exits successfully.

- [ ] **Step 7: Verify the packed artifact resolves extension paths**

`npm pack --dry-run` proves nothing about path resolution, so install the packed tarball and load the compiled profile from the dist layout:

```sh
TARBALL="$(pwd)/$(npm pack --json | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8'))[0].filename")"
WORK="$(mktemp -d)"
cd "$WORK"
npm init -y >/dev/null
npm install --ignore-scripts "$TARBALL"
node --input-type=module -e "
import { existsSync } from 'node:fs';
import { runOncePlanningPiProfile } from './node_modules/patchmill/dist/src/pi/resource-profiles.js';
const skills = {
  triage: 't', planning: 'p', implementation: 'i', developmentEnvironment: 'd',
  toolchain: 'tc', review: 'r', visualEvidence: 'v', landing: 'l',
};
const profile = runOncePlanningPiProfile(skills, process.cwd());
const missing = profile.additionalExtensionPaths.filter((p) => !existsSync(p));
if (missing.length > 0) {
  console.error('missing extension paths:', missing);
  process.exit(1);
}
console.log('all extension paths exist in the packed install');
"
cd - >/dev/null
```

Expected: prints `all extension paths exist in the packed install` and exits 0. This catches the dist-layout root-resolution bug that source-tree tests cannot see.

- [ ] **Step 8: Commit any verification fixes**

If no fixes were required, stop without creating an empty commit. If fixes were required, stage only those files and commit:

```sh
git add <fixed-files>
git commit -m "fix(run-once): address subagent progress verification"
```

Expected: final working tree is clean.

---

## Self-review checklist for the executor

Before claiming completion, verify each statement is true:

- Reviewer output renders `🤖 subagent (agent=reviewer, model=<model>, thinking=<level>)`.
- Worker output renders `🤖 subagent (agent=worker, model=<model>, thinking=<level>)`.
- Provider prefixes and known thinking suffixes are absent from the displayed model field.
- Parallel foreground calls render one enriched line per child.
- Repeated partial/final updates do not duplicate an unchanged tuple.
- A changed fallback tuple is reported rather than hidden.
- Foreground direct, parallel, and chain subagent execution calls do not emit the previous agent-only line.
- A foreground call whose results carry no usable model metadata still prints its original call summary at completion (agent-only for direct/parallel args, the `🔧` argument form for chain args).
- Every per-child progress observation for one call is rendered; parallel children and changed fallback tuples are never swallowed.
- The `thinking` segment appears only when determinable from the child's own result metadata; it is never inferred from the parent session.
- Async subagent calls retain an agent-only summary until resolved metadata is available.
- Subagent management calls retain normal tool-call output (`🔧 subagent (action=list)`).
- Custom progress entries do not enter LLM context and contain no task or child output.
- Malformed hook data does not fail the run.
- Focused tests, the full test suite, lint, build, diff checks, and package dry-run pass.
