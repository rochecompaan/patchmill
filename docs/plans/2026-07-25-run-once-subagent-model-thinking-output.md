# Run-once Subagent Model and Thinking Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render each run-once subagent child's resolved model and thinking
level in Patchmill console progress output.

**Architecture:** A Patchmill Pi extension — loaded from TypeScript source via
jiti — observes `pi-subagents` partial and final tool results, extracts one
normalized progress payload per child, and persists non-context custom session
entries. An opt-in run-once gate inventories requested children, suppresses the
parent call, emits resolved metadata near-live, and flushes one safe agent-only
fallback for every unresolved child; triage keeps immediate pass-through
streaming. The console reporter emits one
`🤖 subagent (agent=..., model=..., thinking=...)` line per resolved child.

**Tech Stack:** TypeScript, Node.js 22 built-in test runner, node:assert/strict,
Pi extension lifecycle events, Pi JSONL sessions, ESLint, Prettier,
markdownlint, npm package dry-runs.

## Global Constraints

- Work in the issue worktree and commit at the end of every task.
- Run all commands from the worktree root:
  `/home/roche/projects/patchmill/.worktrees/patchmill-issue-116-show-model-and-thinking-level-in-run-once-subage`.
- Do not edit `package.json`, `package-lock.json`, or `npm-shrinkwrap.json`; no
  dependency changes are permitted.
- Keep Pi or `pi-subagents` model selection, thinking selection, and fallback
  behavior unchanged.
- Do not duplicate `pi-subagents` agent, override, model, thinking, or fallback
  resolution; consume resolved result metadata only.
- Render one independent line per requested child, including children that fail
  before resolved model metadata appears.
- Keep agent-only summaries for effective async starts because pinned
  `pi-subagents` returns `details.results: []`; buffer every execution shape and
  replay these summaries when the fast async-start tool result arrives rather
  than duplicating upstream effective-mode resolution.
- Keep triage on immediate, ungated tool-call streaming; enrichment buffering is
  run-once-only.
- Custom progress entries must not enter LLM context and must contain no task
  prompts, child output, credentials, costs, or complete result metadata.
- Custom progress data uses only these exact fields: `toolCallId: string`,
  `childIndex: number`, `agent: string`, `model: string`,
  `thinking?: SubagentThinkingLevel`.
- `thinking` is present only when determinable from the child's own result
  metadata (known model suffix or explicit field); never fall back to the parent
  session's thinking level, because `pi-subagents` omits the suffix for
  `off`/unset levels and passes `--thinking` separately.
- `childIndex` is the stable `progress.index` from `pi-subagents`; use the
  result-array position only as a compatibility fallback when `progress.index`
  is absent (compacted final results strip `progress`, and both values derive
  from task order).
- Valid thinking levels are exactly `off`, `minimal`, `low`, `medium`, `high`,
  `xhigh`, and `max`.
- Displayed model IDs remove only the leading provider segment (the portion
  before the first `/`); nested model-ID segments remain intact, and Pi thinking
  suffixes are reported separately as `thinking`.
- Unknown model suffixes remain part of the model ID rather than being
  misreported as thinking.
- Repeated partial/final updates are deduplicated by tool call ID, child index,
  agent, model, and thinking.
- A changed fallback tuple emits another line; the old tuple is not replaced
  retroactively.
- Inventory direct, repeated `tasks`, sequential-chain, and chain-parallel
  children from the validated public call shape; at completion or shutdown, emit
  one agent-only fallback per unresolved child and never expose task text in
  synthesized fallbacks.
- Preserve one `toolCalls` accounting unit per parent `toolCallId`, regardless
  of resolved, changed, or fallback child lines.
- Subagent management calls such as `subagent(action=list)` retain normal tool
  formatting.
- Keep external-result validation and model normalization in
  `src/pi/subagent-progress.ts`; do not move that logic into
  `pi-session-stream.ts`.
- Keep buffer/replay/dedup state in one focused exported gate inside the
  already-large `pi-session-stream.ts`, expose explicit `observe()` and
  `flush()` operations, reduce the polling loop to dispatch, and do not perform
  a broader stream-module refactor.
- Bound and isolate the Pi extension-load smoke process; load only explicit
  extensions and fail loudly on spawn timeout or extension-load errors.
- Verify source, npm-packed, and Nix-installed runtime layouts.
- Run Prettier over each task's changed TypeScript files before its commit.
- Follow `superpowers:test-driven-development` for behavior changes: write each
  failing test first, run it to see it fail, then implement the smallest passing
  change.
- Use `superpowers:verification-before-completion` before every completion claim
  and final handoff.
- Use the `commit` skill format for every commit; commit only the task's files
  and do not push.

---

### Task 1: Normalize `pi-subagents` progress metadata

**Files:**

- Create: `src/pi/subagent-progress.ts`
- Test: `src/pi/subagent-progress.test.ts`

**Interfaces:**

- Consumes: unknown `pi-subagents` partial/final tool-result objects whose shape
  is validated at runtime.
- Produces:
  - `export const SUBAGENT_PROGRESS_CUSTOM_TYPE = "patchmill-subagent-progress";`
  - `export type SubagentThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";`
  - `export type SubagentProgress = { toolCallId: string; childIndex: number; agent: string; model: string; thinking?: SubagentThinkingLevel };`
  - `export type RequestedSubagentChild = { childIndex: number; agent: string };`
  - `export function parseSubagentProgressResults(result: unknown, toolCallId: string): SubagentProgress[]`
  - `export function parseSubagentProgressEntry(entry: Record<string, unknown>): SubagentProgress | undefined`
  - `export function requestedSubagentChildren(args: Record<string, unknown>): RequestedSubagentChild[] | undefined`
  - `export function subagentProgressKey(progress: SubagentProgress): string`
  - `export function isRecord(value: unknown): value is Record<string, unknown>`
    (array-rejecting guard shared by the Task 2 extension and Task 4 session
    streamer)

- [ ] **Step 1: Write the failing extraction tests**

Create `src/pi/subagent-progress.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SUBAGENT_PROGRESS_CUSTOM_TYPE,
  isRecord,
  parseSubagentProgressEntry,
  parseSubagentProgressResults,
  requestedSubagentChildren,
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

test("removes only the leading provider from nested model IDs", () => {
  assert.deepEqual(
    parseSubagentProgressResults(
      {
        details: {
          results: [
            {
              agent: "reviewer",
              model: "openrouter/anthropic/claude-sonnet-4:high",
            },
            {
              agent: "worker",
              model: "openrouter/meta-llama/llama-3.3-70b-instruct:free:medium",
            },
          ],
        },
      },
      "call-4b",
    ),
    [
      {
        toolCallId: "call-4b",
        childIndex: 0,
        agent: "reviewer",
        model: "anthropic/claude-sonnet-4",
        thinking: "high",
      },
      {
        toolCallId: "call-4b",
        childIndex: 1,
        agent: "worker",
        model: "meta-llama/llama-3.3-70b-instruct:free",
        thinking: "medium",
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
            { agent: "worker", model: "provider/" },
            { agent: "worker", model: ":high" },
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

test("record validation rejects arrays", () => {
  assert.equal(isRecord({}), true);
  assert.equal(isRecord([]), false);
});

test("validates and projects the progress custom entry contract", () => {
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
      data: { ...progress, ignored: "drop-me" },
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
    {
      type: "custom_message",
      customType: SUBAGENT_PROGRESS_CUSTOM_TYPE,
      data: progress,
    },
    { type: "custom", customType: "other", data: progress },
    {
      type: "custom",
      customType: SUBAGENT_PROGRESS_CUSTOM_TYPE,
      data: { ...progress, model: 3 },
    },
    {
      type: "custom",
      customType: SUBAGENT_PROGRESS_CUSTOM_TYPE,
      data: { ...progress, thinking: "bogus" },
    },
  ]) {
    assert.equal(parseSubagentProgressEntry(entry), undefined);
  }
});

test("enumerates requested children in pinned result-index order", () => {
  assert.deepEqual(requestedSubagentChildren({ agent: "reviewer" }), [
    { childIndex: 0, agent: "reviewer" },
  ]);
  assert.deepEqual(
    requestedSubagentChildren({
      tasks: [{ agent: "worker", count: 2 }, { agent: "reviewer" }],
    }),
    [
      { childIndex: 0, agent: "worker" },
      { childIndex: 1, agent: "worker" },
      { childIndex: 2, agent: "reviewer" },
    ],
  );
  assert.deepEqual(
    requestedSubagentChildren({
      chain: [
        { agent: "planner" },
        {
          parallel: [{ agent: "worker", count: 2 }, { agent: "reviewer" }],
        },
      ],
    }),
    [
      { childIndex: 0, agent: "planner" },
      { childIndex: 1, agent: "worker" },
      { childIndex: 2, agent: "worker" },
      { childIndex: 3, agent: "reviewer" },
    ],
  );
  assert.deepEqual(requestedSubagentChildren({ action: "list" }), []);
  assert.equal(
    requestedSubagentChildren({
      agent: "worker",
      tasks: [{ agent: "reviewer" }],
    }),
    undefined,
  );
  assert.equal(
    requestedSubagentChildren({ tasks: [{ agent: "worker", count: 0 }] }),
    undefined,
  );
});

test("builds collision-safe stable tuple keys", () => {
  const progress = {
    toolCallId: "call-7",
    childIndex: 2,
    agent: "worker",
    model: "gpt-5.6-terra",
    thinking: "medium" as const,
  };
  assert.equal(subagentProgressKey(progress), subagentProgressKey(progress));
  assert.notEqual(
    subagentProgressKey({
      ...progress,
      agent: "worker\u0000nested",
      model: "model",
    }),
    subagentProgressKey({
      ...progress,
      agent: "worker",
      model: "nested\u0000model",
    }),
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

export type RequestedSubagentChild = {
  childIndex: number;
  agent: string;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const slash = withoutSuffix.indexOf("/");
  const displayModel =
    slash >= 0 ? withoutSuffix.slice(slash + 1) : withoutSuffix;
  return {
    model: displayModel,
    ...(suffix ? { thinking: suffix[1] as SubagentThinkingLevel } : {}),
  };
}

export function parseSubagentProgressResults(
  result: unknown,
  toolCallId: string,
): SubagentProgress[] {
  if (toolCallId.length === 0) return [];
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
    if (parsed.model.length === 0) return [];
    const explicit = isThinkingLevel(item.thinking) ? item.thinking : undefined;
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
  if (typeof toolCallId !== "string" || toolCallId.length === 0)
    return undefined;
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

function repeatedAgents(items: unknown): string[] | undefined {
  if (!Array.isArray(items) || items.length === 0) return undefined;
  const agents: string[] = [];
  for (const item of items) {
    if (!isRecord(item) || typeof item.agent !== "string" || !item.agent) {
      return undefined;
    }
    const count = item.count ?? 1;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
      return undefined;
    }
    for (let repeat = 0; repeat < count; repeat += 1) {
      agents.push(item.agent);
    }
  }
  return agents;
}

export function requestedSubagentChildren(
  args: Record<string, unknown>,
): RequestedSubagentChild[] | undefined {
  if (typeof args.action === "string") return [];

  const modes = [
    typeof args.agent === "string" && args.agent.length > 0,
    args.tasks !== undefined,
    args.chain !== undefined,
  ].filter(Boolean).length;
  if (modes !== 1) return undefined;

  let agents: string[] | undefined;
  if (typeof args.agent === "string" && args.agent.length > 0) {
    agents = [args.agent];
  } else if (args.tasks !== undefined) {
    agents = repeatedAgents(args.tasks);
  } else if (Array.isArray(args.chain) && args.chain.length > 0) {
    agents = [];
    for (const step of args.chain) {
      if (!isRecord(step)) return undefined;
      const sequentialAgent =
        typeof step.agent === "string" && step.agent.length > 0
          ? step.agent
          : undefined;
      const parallel = step.parallel !== undefined;
      if ((sequentialAgent !== undefined) === parallel) return undefined;
      if (sequentialAgent !== undefined) {
        agents.push(sequentialAgent);
        continue;
      }
      const expanded = repeatedAgents(step.parallel);
      if (!expanded) return undefined;
      agents.push(...expanded);
    }
  }
  if (!agents) return undefined;
  return agents.map((agent, childIndex) => ({ childIndex, agent }));
}

export function subagentProgressKey(progress: SubagentProgress): string {
  return JSON.stringify([
    progress.toolCallId,
    progress.childIndex,
    progress.agent,
    progress.model,
    progress.thinking ?? null,
  ]);
}
```

- [ ] **Step 4: Format the task files and run the focused test**

Run:

```sh
npx prettier --write src/pi/subagent-progress.ts src/pi/subagent-progress.test.ts
node --test src/pi/subagent-progress.test.ts
```

Expected: Prettier exits 0 and the test file passes with 12 passing tests and 0
failing tests.

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
  - default extension factory
    `export default function runOnceSubagentProgress(pi: SubagentProgressObserverApi): void`

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
        results: [
          { agent: "reviewer", model: "openai-codex/gpt-5.6-sol:xhigh" },
        ],
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
    subagentUpdate("openrouter/acme/shared-model:high"),
  );
  emit(harness, "tool_execution_end", {
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "subagent",
    result: {
      content: [],
      details: {
        results: [
          { agent: "reviewer", model: "openrouter/other/shared-model:high" },
        ],
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
        model: "acme/shared-model",
        thinking: "high",
      },
      {
        toolCallId: "call-1",
        childIndex: 0,
        agent: "reviewer",
        model: "other/shared-model",
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
  emit(harness, "tool_execution_update", {
    ...subagentUpdate("gpt-5.6-sol:high"),
    toolCallId: "",
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

Expected: FAIL with a module-not-found error for
`./run-once-subagent-progress.ts`.

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
    if (typeof event.toolCallId !== "string" || event.toolCallId.length === 0) {
      return;
    }
    observe(pi, state, event.toolCallId, event.partialResult);
  });

  pi.on("tool_execution_end", (event) => {
    if (!isRecord(event) || event.toolName !== "subagent") return;
    if (typeof event.toolCallId !== "string" || event.toolCallId.length === 0) {
      return;
    }
    observe(pi, state, event.toolCallId, event.result);
  });
}

export default function runOnceSubagentProgress(
  pi: SubagentProgressObserverApi,
): void {
  registerRunOnceSubagentProgress(pi);
}
```

- [ ] **Step 4: Format the task files and run the focused test**

Run:

```sh
npx prettier --write src/pi/extensions/run-once-subagent-progress.ts src/pi/extensions/run-once-subagent-progress.test.ts
node --test src/pi/extensions/run-once-subagent-progress.test.ts
```

Expected: Prettier exits 0 and the test file passes with 7 passing tests and 0
failing tests.

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

- Consumes: Task 2's extension source path
  `src/pi/extensions/run-once-subagent-progress.ts`, its relative
  `../subagent-progress.ts` import, and the canonical
  `resolveBundledPiCommand()` / `piCommandArgs()` helpers from
  `src/cli/pi-cli.ts`.
- Produces: `runOnceExtensionPaths()` returns three paths in order:
  `pi-subagents`, `extensions/todos.ts`, then the run-once subagent progress
  observer. Also exports `findPackageRoot(start: string): string`, which
  resolves the package root correctly from both `src/pi/` and `dist/src/pi/`
  (fixing the pre-existing `todos.ts` mis-resolution in the packed layout).

- [ ] **Step 1: Write the failing root-resolution tests**

In `src/pi/resource-profiles.test.ts`, add these tests after the existing
profile tests:

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

In the same file: add `mkdir` and `writeFile` to the `node:fs/promises` import,
add `import { existsSync } from "node:fs";`, and add `findPackageRoot` to the
`./resource-profiles.ts` import.

- [ ] **Step 2: Run the root-resolution tests to verify they fail**

Run:

```sh
node --test src/pi/resource-profiles.test.ts
```

Expected: FAIL with a module/exports error for `findPackageRoot`.

- [ ] **Step 3: Resolve the package root robustly**

The current `PATCHMILL_PACKAGE_ROOT` derives from `import.meta.url` with a fixed
`../..`, which resolves to `<pkg>/dist` in the compiled layout — a pre-existing
bug that already mis-resolves `extensions/todos.ts` in production, where Pi's
loader logs the failure and continues without the extension. In
`src/pi/resource-profiles.ts`, add `import { existsSync } from "node:fs";` and
replace the root computation with a walk-up search that throws loudly at startup
when no package root exists:

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

From `src/pi/` this stops at the repository root; from `dist/src/pi/` it stops
at the package root because `dist/` contains no `package.json`.

- [ ] **Step 4: Format the root fix and run its focused tests**

Run:

```sh
npx prettier --write src/pi/resource-profiles.ts src/pi/resource-profiles.test.ts
node --test src/pi/resource-profiles.test.ts
```

Expected: Prettier exits 0 and the tests pass with 0 failures (the
exists-on-disk test covers the current two extension paths).

- [ ] **Step 5: Commit the pre-existing root-resolution fix separately**

```sh
git add src/pi/resource-profiles.ts src/pi/resource-profiles.test.ts
git commit -m "fix(pi): resolve package root from compiled layout"
```

Expected: one commit containing only the two files, so the pre-existing
`todos.ts` production fix is reviewable independently of the feature wiring.

- [ ] **Step 6: Write the failing observer-wiring tests**

In `src/pi/resource-profiles.test.ts`, replace the planning-profile extension
assertions with this test body while keeping all existing imports and helpers:

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

    assert.deepEqual(
      triagePiProfile(skills, repoRoot).additionalExtensionPaths,
      [],
    );
  });
});
```

In the existing `"profile argument helpers render extension and skill flags"`
test, replace the `profileExtensionArgs(profile)` expectation so it proves the
third path is forwarded:

```ts
assert.deepEqual(profileExtensionArgs(profile), [
  "-e",
  profile.additionalExtensionPaths[0],
  "-e",
  profile.additionalExtensionPaths[1],
  "-e",
  profile.additionalExtensionPaths[2],
]);
```

Create `src/pi/extensions/run-once-subagent-progress.load.test.ts` as a
packaging smoke test. It passes Patchmill's Testing Value Gate because it proves
the bundled Pi CLI loads the vendored `extensions/todos.ts` and the multi-file
TypeScript observer — including the relative `../subagent-progress.ts` import —
which no existing test covers (`extensions/todos.ts` is single-file and, due to
the root-resolution bug fixed in Step 3, has never loaded in production).
Resolve Pi through `src/cli/pi-cli.ts`; the package exports map does not expose
`@earendil-works/pi-coding-agent/package.json`, and the canonical helper already
handles that case and reads the package's actual `bin` field:

```ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { piCommandArgs, resolveBundledPiCommand } from "../../cli/pi-cli.ts";

const PI_COMMAND = resolveBundledPiCommand();
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
  "isolated bundled Pi loads explicit run-once extensions before provider failure",
  { timeout: 45_000 },
  async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "patchmill-pi-load-"));
    const home = join(sandbox, "home");
    const agentDir = join(sandbox, "pi-agent");
    await mkdir(home, { recursive: true });
    await mkdir(agentDir, { recursive: true });

    try {
      const result = spawnSync(
        PI_COMMAND.command,
        piCommandArgs(PI_COMMAND, [
          ...EXTENSIONS.flatMap((path) => ["-e", path]),
          "--no-extensions",
          "--no-skills",
          "--no-prompt-templates",
          "--no-themes",
          "--no-context-files",
          "--no-tools",
          "--no-session",
          "--no-approve",
          "--provider",
          "__invalid__",
          "-p",
          "Say ok",
        ]),
        {
          cwd: sandbox,
          encoding: "utf8",
          timeout: 30_000,
          killSignal: "SIGKILL",
          env: {
            ...process.env,
            HOME: home,
            XDG_CONFIG_HOME: join(sandbox, "xdg-config"),
            XDG_DATA_HOME: join(sandbox, "xdg-data"),
            XDG_CACHE_HOME: join(sandbox, "xdg-cache"),
            PI_CODING_AGENT_DIR: agentDir,
            PI_OFFLINE: "1",
            PI_SKIP_VERSION_CHECK: "1",
            PI_TELEMETRY: "0",
          },
        },
      );
      assert.ifError(result.error);
      const output = `${result.stdout}\n${result.stderr}`;
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(
        output,
        /Failed to load extension|Cannot find package|No such built-in module/,
      );
      assert.match(output, /provider|api[- ]?key|invalid/i);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  },
);
```

Pinned Pi documents `--no-extensions -e <path>` as the supported way to disable
discovery while retaining explicit extensions. The isolated working directory,
HOME/XDG/Pi-agent paths, disabled resource discovery, offline environment, and
`--no-session` prevent ambient configuration from affecting the smoke test. The
synchronous child has its own 30-second `SIGKILL` timeout;
`assert.ifError(result.error)` turns a timeout or spawn failure into the primary
test failure before output assertions run. The command must otherwise fail only
at the expected provider/API-key stage; any `Failed to load extension`,
`No such built-in module`, or `Cannot find package` output is a regression.

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

Immediately after `runOnceExtensionArgs`, add one assertion helper so future
extension additions update a single expected list instead of four positional
slices. The helper deliberately preserves the profile's documented extension
order while deriving each `-e` value without magic indices, and verifies every
extension precedes `-p`:

```ts
function optionValues(args: string[], option: string): string[] {
  return args.flatMap((arg, index) => {
    const value = args[index + 1];
    return arg === option && value !== undefined ? [value] : [];
  });
}

function assertRunOnceExtensionPaths(args: string[]): void {
  const promptIndex = args.indexOf("-p");
  assert.ok(promptIndex >= 0, `expected -p in ${args.join(" ")}`);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "-e") {
      assert.ok(index < promptIndex, "expected extensions before -p");
    }
  }
  assert.deepEqual(optionValues(args, "-e"), [
    "/repo/node_modules/pi-subagents",
    "/repo/extensions/todos.ts",
    "/repo/src/pi/extensions/run-once-subagent-progress.ts",
  ]);
}
```

In each of these four tests, replace the existing `args.slice(...)` and
individual extension-index assertions with `assertRunOnceExtensionPaths(args);`:

- `"runPiPrompt writes the prompt to a temp file and surfaces nonzero pi failures"`
- `"runPiPrompt loads bundled Pi extensions before the prompt argument"`
- `"runPiPrompt streams messages appended to the prompted pi session JSONL"`
- `"runPiPrompt passes configured skill files before the prompt argument"`

In `"runPiPrompt loads bundled Pi extensions before the prompt argument"`,
replace the positional prompt assertion with:

```ts
const promptIndex = args.indexOf("-p");
assert.equal(args[promptIndex + 1]?.startsWith("@"), true);
```

In `"runPiPrompt passes configured skill files before the prompt argument"`,
preserve the skill-value check without coupling it to extension indices:

```ts
assert.deepEqual(optionValues(args, "--skill"), [
  "/repo/.patchmill/skills/writing-plans/SKILL.md",
  "/repo/.patchmill/skills/review/SKILL.md",
]);
const promptIndex = args.indexOf("-p");
assert.equal(args[promptIndex + 1]?.startsWith("@"), true);
```

Keep `promptPath(args)` unchanged; it finds the `@` argument independent of its
index.

In `src/pi/resource-profiles.test.ts`, add
`runOnceDevelopmentEnvironmentPiProfile` to the `./resource-profiles.ts` import
(the all-profiles test uses it).

- [ ] **Step 7: Run the wiring tests to verify they fail**

Run:

```sh
node --test src/pi/resource-profiles.test.ts src/cli/commands/run-once/pi.test.ts
```

Expected: FAIL in `resource-profiles.test.ts` because profiles still return only
two extensions. The `pi.test.ts` cases should pass and prove that three supplied
`-e` pairs are forwarded without positional-index coupling.

- [ ] **Step 8: Add the observer extension path**

Add this constant next to `PATCHMILL_TODOS_EXTENSION`. Use a single source path:
Pi loads TypeScript extensions through jiti and `package.json` ships the `src/`
tree, so no compiled/source path fork is needed. The observer lives under
`src/pi/extensions/` — inside the eslint, tsc, and test-discovery globs — unlike
the vendored `extensions/todos.ts`:

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

- [ ] **Step 9: Format the wiring files and run their focused tests**

Run:

```sh
npx prettier --write src/pi/resource-profiles.ts src/pi/resource-profiles.test.ts src/cli/commands/run-once/pi.test.ts src/pi/extensions/run-once-subagent-progress.load.test.ts
node --test src/pi/resource-profiles.test.ts src/cli/commands/run-once/pi.test.ts src/pi/extensions/run-once-subagent-progress.load.test.ts
```

Expected: Prettier exits 0 and all three test files pass with 0 failures.

- [ ] **Step 10: Commit the profile wiring**

```sh
git add src/pi/resource-profiles.ts src/pi/resource-profiles.test.ts src/cli/commands/run-once/pi.test.ts src/pi/extensions/run-once-subagent-progress.load.test.ts
git commit -m "feat(pi): load run-once subagent observer"
```

Expected: one commit containing only the four wiring files, on top of the Step 5
root-resolution fix.

---

### Task 4: Stream validated custom progress entries

**Files:**

- Create: `src/cli/commands/run-once/pi-session-stream.test.ts`
- Create: `src/cli/commands/triage/tool-call-observer.test.ts`
- Modify: `src/cli/commands/run-once/pi-session-stream.ts`
- Modify: `src/cli/commands/run-once/pi.ts`
- Modify: `src/cli/commands/run-once/pi.test.ts`
- Modify: `src/cli/commands/run-once/pipeline-progress.ts`
- Modify: `src/cli/commands/run-once/pipeline-progress.test.ts`

**Interfaces:**

- Consumes: Task 1's `SUBAGENT_PROGRESS_CUSTOM_TYPE`, `SubagentProgress`,
  `isRecord()`, `parseSubagentProgressEntry()`, and
  `requestedSubagentChildren()`.
- Produces:
  - `PiSessionObservation` gains
    `{ type: "subagent-progress"; progress: SubagentProgress }`.
  - `sessionEntryToObservations(entry: JsonObject): PiSessionObservation[]`
    returns the progress observation only for exact, valid progress custom
    entries.
  - `createSubagentProgressGate(onObservation, { enrichSubagentProgress }): { observe(observation): void; flush(): void }`
    owns generic tool-call deduplication plus opt-in run-once buffering,
    per-child resolution, residual fallback, and progress-key deduplication.
  - `createPiSessionObservationStreamer()` defaults to immediate tool-call
    delivery (triage behavior); `runPiPrompt()` explicitly enables subagent
    enrichment.
  - ToolResult-derived `tool-call` observations carry an explicit
    `completed: true` marker consumed by the gate.
  - Step accounting counts each parent `toolCallId` once, independent of the
    number of resolved, changed, or fallback child observations.

- [ ] **Step 1: Write the failing session-stream tests**

In `src/cli/commands/run-once/pi.test.ts`, update the two existing exact
toolResult-observation expectations for the explicit completion contract. In
`"runPiPrompt emits structured observations and suppresses raw text unless streamOutput is provided"`,
replace the expected tool-call item with:

```ts
{ type: "tool-call", toolName: "read", completed: true },
```

In
`"sessionEntryToObservations reports tool calls without streaming tool results"`,
replace the expected array with:

```ts
assert.deepEqual(observations, [
  {
    type: "tool-call",
    toolName: "bash",
    toolCallId: "call-1",
    completed: true,
  },
]);
```

Create `src/cli/commands/run-once/pi-session-stream.test.ts` — new streamer
coverage belongs here because `pi.test.ts` is already over a thousand lines:

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
  enrichSubagentProgress = false,
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
      { pollMs: 10, enrichSubagentProgress },
    );
    streamer.start();
    await streamer.stop();
    return observations;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function createGateHarness(enrichSubagentProgress = true) {
  const emitted: PiSessionObservation[] = [];
  const gate = createSubagentProgressGate(
    (observation) => emitted.push(observation),
    { enrichSubagentProgress },
  );
  return { emitted, gate };
}

function collectGateObservations(
  input: PiSessionObservation[],
  enrichSubagentProgress = true,
): PiSessionObservation[] {
  const { emitted, gate } = createGateHarness(enrichSubagentProgress);
  for (const observation of input) gate.observe(observation);
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

test("enriched session streaming flushes a safe fallback when metadata never resolves", async () => {
  const observations = await collectObservations(
    [
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
    ],
    true,
  );

  assert.deepEqual(
    observations.filter((observation) => observation.type === "tool-call"),
    [
      {
        type: "tool-call",
        toolName: "subagent",
        toolCallId: "call-1",
        arguments: { agent: "worker" },
      },
    ],
  );
});

test("streamer stop propagates malformed JSON instead of skipping it", async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), "patchmill-stream-error-"));
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, "session.jsonl"), "{not-json}\n", "utf8");
  const streamer = createPiSessionObservationStreamer(
    sessionDir,
    () => undefined,
  );

  try {
    await assert.rejects(streamer.stop(), SyntaxError);
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }
});

test("default gate mode preserves immediate triage-style delivery", () => {
  const { emitted, gate } = createGateHarness(false);
  const call: PiSessionObservation = {
    type: "tool-call",
    toolName: "subagent",
    toolCallId: "call-1",
    arguments: { agent: "worker", task: "implement" },
  };

  gate.observe(call);

  assert.deepEqual(emitted, [call]);
});

test("enriched gate emits every resolved child and no fallback for them", () => {
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

test("completion emits one fallback for each unresolved parallel child", () => {
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
      type: "tool-call",
      toolName: "subagent",
      toolCallId: "call-1",
      completed: true,
    },
  ]);

  assert.deepEqual(observations, [
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
      type: "tool-call",
      toolName: "subagent",
      toolCallId: "call-1",
      arguments: { agent: "reviewer" },
    },
  ]);
});

test("gate emits changed tuples but resolves the child only once", () => {
  const observations = collectGateObservations([
    {
      type: "tool-call",
      toolName: "subagent",
      toolCallId: "call-1",
      arguments: { agent: "reviewer", task: "review" },
    },
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

test("argument-bearing re-reads emit only one safe residual fallback", () => {
  const call: PiSessionObservation = {
    type: "tool-call",
    toolName: "subagent",
    toolCallId: "call-1",
    arguments: { agent: "worker", task: "implement" },
  };
  const observations = collectGateObservations([
    call,
    call,
    {
      type: "tool-call",
      toolName: "subagent",
      toolCallId: "call-1",
      completed: true,
    },
  ]);

  assert.deepEqual(observations, [
    {
      type: "tool-call",
      toolName: "subagent",
      toolCallId: "call-1",
      arguments: { agent: "worker" },
    },
  ]);
});

test("gate observes authoritative async results instead of guessing mode", () => {
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
      toolCallId: "call-async",
      completed: true,
    },
    {
      type: "tool-call",
      toolName: "subagent",
      toolCallId: "call-clarify",
      arguments: {
        agent: "reviewer",
        task: "review",
        async: true,
        clarify: true,
      },
    },
    {
      type: "subagent-progress",
      progress: {
        toolCallId: "call-clarify",
        childIndex: 0,
        agent: "reviewer",
        model: "gpt-5.6-sol",
        thinking: "xhigh",
      },
    },
    {
      type: "tool-call",
      toolName: "subagent",
      toolCallId: "call-clarify",
      completed: true,
    },
  ]);

  assert.deepEqual(
    observations.map((observation) => observation.type),
    ["tool-call", "subagent-progress"],
  );
  assert.deepEqual(observations[0], {
    type: "tool-call",
    toolName: "subagent",
    toolCallId: "call-async",
    arguments: { agent: "worker" },
  });
});

test("management calls remain immediate in enriched mode", () => {
  const { emitted, gate } = createGateHarness();
  const call: PiSessionObservation = {
    type: "tool-call",
    toolName: "subagent",
    toolCallId: "call-mgmt",
    arguments: { action: "list" },
  };

  gate.observe(call);

  assert.deepEqual(emitted, [call]);
});

test("shutdown flushes every unresolved chain child in index order", () => {
  const { emitted, gate } = createGateHarness();
  gate.observe({
    type: "tool-call",
    toolName: "subagent",
    toolCallId: "call-chain",
    arguments: {
      chain: [
        { agent: "planner", task: "plan" },
        {
          parallel: [
            { agent: "worker", task: "first", count: 2 },
            { agent: "reviewer", task: "review" },
          ],
        },
      ],
    },
  });
  gate.observe({
    type: "subagent-progress",
    progress: {
      toolCallId: "call-chain",
      childIndex: 2,
      agent: "worker",
      model: "gpt-5.6-terra",
      thinking: "medium",
    },
  });

  gate.flush();

  assert.deepEqual(
    emitted
      .filter((observation) => observation.type === "tool-call")
      .map((observation) => observation.arguments?.agent),
    ["planner", "worker", "reviewer"],
  );
});
```

Create `src/cli/commands/triage/tool-call-observer.test.ts` to pin the shared
streamer's default pass-through policy at the triage integration boundary:

```ts
import assert from "node:assert/strict";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { runWithToolCallObservation } from "./tool-call-observer.ts";

function waitForObservation(observation: Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("triage tool call was delayed")),
      2_000,
    );
    observation.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

test(
  "triage observes a subagent call before its tool result exists",
  { timeout: 5_000 },
  async () => {
    let observed = false;
    let resolveObserved: (() => void) | undefined;
    const firstObservation = new Promise<void>((resolve) => {
      resolveObserved = resolve;
    });

    const result = await runWithToolCallObservation(
      () => {
        observed = true;
        resolveObserved?.();
      },
      async (sessionDir) => {
        assert.ok(sessionDir);
        await appendFile(
          join(sessionDir, "session.jsonl"),
          `${JSON.stringify({
            type: "message",
            message: {
              role: "assistant",
              content: [
                {
                  type: "toolCall",
                  id: "call-1",
                  name: "subagent",
                  arguments: { agent: "reviewer", task: "review" },
                },
              ],
            },
          })}\n`,
        );
        await waitForObservation(firstObservation);
        assert.equal(observed, true);
        return "done";
      },
    );

    assert.equal(result, "done");
  },
);
```

Add this test to `src/cli/commands/run-once/pipeline-progress.test.ts` (its
`collectProgressEvents` harness already exists):

```ts
test("step accounting counts one parent call across all child lines", async () => {
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
      // A changed fallback tuple is another truthful line, not another child.
      toolCallId: "call-1",
      childIndex: 0,
      agent: "worker",
      model: "gpt-5.6-terra-preview",
      thinking: "high" as const,
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
  await accounting.observe("pi", {
    type: "tool-call",
    toolName: "subagent",
    toolCallId: "call-1",
    arguments: { agent: "scout" },
  });
  await accounting.start("next");
  const complete = events.find((event) => event.step?.type === "step-complete");
  assert.equal(
    complete?.step?.type === "step-complete"
      ? complete.step.toolCalls
      : undefined,
    1,
  );
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```sh
node --test src/cli/commands/run-once/pi-session-stream.test.ts src/cli/commands/run-once/pi.test.ts src/cli/commands/run-once/pipeline-progress.test.ts src/cli/commands/triage/tool-call-observer.test.ts
```

Expected: FAIL because `sessionEntryToObservations` returns no
`subagent-progress` observation or `completed` marker, the gate does not exist,
both updated `pi.test.ts` expectations fail, and accounting has no per-parent
call-ID set. The triage test may already pass because it protects unchanged
default behavior.

- [ ] **Step 3: Add the custom-entry observation and opt-in per-child gate**

In `src/cli/commands/run-once/pi-session-stream.ts`, add this import:

```ts
import {
  isRecord,
  parseSubagentProgressEntry,
  requestedSubagentChildren,
  subagentProgressKey,
  type RequestedSubagentChild,
  type SubagentProgress,
} from "../../../pi/subagent-progress.ts";
```

Delete the streamer's local `isObject` function and replace its call sites with
the shared `isRecord`. Task 1's guard rejects arrays, so parsing behavior
remains unchanged while external-result, extension-event, and session-entry
validation use one record contract:

```ts
// Delete this local function:
function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Replace every isObject(value) call in this file with isRecord(value).
```

Make nonempty malformed JSON fail loudly. Remove `parseSessionLine()`'s catch,
let `JSON.parse()` propagate `SyntaxError`, and throw
`TypeError("Pi session entry must be an object")` when parsed JSON is not a
record. Empty lines remain ignorable.

Because `start()` polls in the background, add a captured `pollError` and attach
a rejection handler to every fire-and-forget `runPoll()` call. `stop()` must run
one final poll, always flush pending calls, and propagate every parsing, I/O, or
flush failure. If both final processing and flushing fail, throw an
`AggregateError` containing both rather than replacing either.

Extend `PiSessionObservation` with the new union member, and add an optional
completion marker to the existing `tool-call` variant (no second observation
type is needed — the fallback below replays the original tool-call observation):

```ts
| {
    type: "subagent-progress";
    progress: SubagentProgress;
  }
```

```ts
completed?: boolean;
```

At the start of `sessionEntryToObservations`, before the existing
`custom_message` branch, add:

```ts
const subagentProgress = parseSubagentProgressEntry(entry);
if (subagentProgress) {
  return [{ type: "subagent-progress", progress: subagentProgress }];
}
```

In the same function's toolResult branch, mark the observation as a completion
signal:

```ts
observations.push({
  type: "tool-call",
  ...(toolName ? { toolName } : {}),
  ...(toolCallId ? { toolCallId } : {}),
  completed: true,
});
```

Leave `sessionEntryToStreamText` and `sessionEntryToRawText` unchanged: valid
custom entries are observations only, not raw or pretty text.

Extract all buffer/replay/dedup state into an exported, self-contained gate
after `sessionEntryToObservations`, so the subtle logic is unit-testable without
the polling harness:

```ts
type PendingSubagentCall = {
  children: RequestedSubagentChild[];
  resolvedChildren: Set<number>;
};

function fallbackObservation(
  toolCallId: string,
  child: RequestedSubagentChild,
): PiSessionObservation {
  return {
    type: "tool-call",
    toolName: "subagent",
    toolCallId,
    arguments: { agent: child.agent },
  };
}

export function createSubagentProgressGate(
  onObservation: (observation: PiSessionObservation) => void,
  options: { enrichSubagentProgress?: boolean } = {},
): {
  observe(observation: PiSessionObservation): void;
  flush(): void;
} {
  const seenToolCallIds = new Set<string>();
  const pendingSubagentCalls = new Map<string, PendingSubagentCall>();
  const emittedSubagentProgressKeys = new Set<string>();

  const flushCall = (toolCallId: string): void => {
    const pending = pendingSubagentCalls.get(toolCallId);
    pendingSubagentCalls.delete(toolCallId);
    if (!pending) return;
    for (const child of pending.children) {
      if (!pending.resolvedChildren.has(child.childIndex)) {
        onObservation(fallbackObservation(toolCallId, child));
      }
    }
  };

  return {
    observe(observation) {
      if (observation.type === "subagent-progress") {
        const key = subagentProgressKey(observation.progress);
        if (emittedSubagentProgressKeys.has(key)) return;
        emittedSubagentProgressKeys.add(key);
        const pending = pendingSubagentCalls.get(
          observation.progress.toolCallId,
        );
        if (
          pending?.children.some(
            (child) =>
              child.childIndex === observation.progress.childIndex &&
              child.agent === observation.progress.agent,
          )
        ) {
          pending.resolvedChildren.add(observation.progress.childIndex);
        }
        onObservation(observation);
        return;
      }

      if (observation.type === "tool-call" && observation.toolCallId) {
        const toolCallId = observation.toolCallId;
        if (seenToolCallIds.has(toolCallId)) {
          if (observation.completed === true) flushCall(toolCallId);
          return;
        }
        seenToolCallIds.add(toolCallId);
        if (
          options.enrichSubagentProgress === true &&
          observation.completed !== true &&
          observation.toolName === "subagent" &&
          observation.arguments
        ) {
          const children = requestedSubagentChildren(observation.arguments);
          if (children && children.length > 0) {
            pendingSubagentCalls.set(toolCallId, {
              children,
              resolvedChildren: new Set<number>(),
            });
            return;
          }
        }
      }
      onObservation(observation);
    },
    flush() {
      for (const toolCallId of [...pendingSubagentCalls.keys()]) {
        flushCall(toolCallId);
      }
    },
  };
}
```

In `createPiSessionObservationStreamer`, remove the local `observedToolCallIds`
set (the gate owns tool-call deduplication) and reduce `processLine`'s
observation loop to a one-line dispatch:

```ts
const gate = createSubagentProgressGate(onObservation, {
  enrichSubagentProgress: options.enrichSubagentProgress,
});

const processLine = (line: string) => {
  const entry = parseSessionLine(line);
  if (!entry) return;
  for (const observation of sessionEntryToObservations(entry)) {
    gate.observe(observation);
  }
  if (options.verboseOutput) {
    const text = sessionEntryToRawText(entry);
    if (text !== undefined) options.verboseOutput(text);
  }
};
```

Add `enrichSubagentProgress?: boolean` to the streamer options. In `stop()`,
flush pending calls even when the final poll or partial-line processing throws;
the `finally` preserves the original error:

```ts
let pollError: unknown;
const capturePollError = (error: unknown): void => {
  pollError ??= error;
};

// In start(), use this for the initial poll and every timer callback:
void runPoll().catch(capturePollError);

// In the returned streamer:
stop: async () => {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
  const errors: unknown[] = [];
  try {
    await runPoll().catch(capturePollError);
    if (pollError !== undefined) throw pollError;
    if (buffered.trim()) {
      processLine(buffered);
      buffered = "";
    }
  } catch (error) {
    errors.push(error);
  }
  try {
    gate.flush();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "Pi session streamer stop failed");
  }
},
```

In `runPiPrompt()`, opt in explicitly while preserving the existing verbose
callback:

```ts
{
  verboseOutput: options.verbosePiOutput ? streamOutput : undefined,
  enrichSubagentProgress: true,
},
```

Do not pass the option from triage. Default mode preserves current immediate
delivery and generic tool-call-ID deduplication. Enriched mode buffers every
recognized execution shape, regardless of submitted `async` or `clarify` fields.
This intentionally avoids reproducing the pinned `forceTopLevelAsync` /
`asyncByDefault` / `clarify` precedence: authoritative custom metadata resolves
foreground children, while a metadata-free async-start result quickly triggers
residual fallbacks.

The requested-child inventory mirrors only the pinned public expansion order:
one direct child, `tasks` expanded by `count` in task order, and chain leaves
flattened in the executor's global index order. It does not select agents,
models, or thinking. Management calls return an empty inventory; malformed or
conflicting shapes return `undefined` and pass through rather than being
guessed.

The two dedup layers guard distinct failure modes: the extension's
`subagentProgressKey` set deduplicates repeated lifecycle events, while the
gate's `emittedSubagentProgressKeys` set guards file re-reads
(`info.size < offset` resets `offset = 0`). Resolved identity is tracked
separately by child index and agent, so changed tuples remain visible without
hiding unresolved siblings.

Completion and shutdown call the same per-call residual flush. Synthetic
fallbacks contain only `agent`; task text and other submitted arguments are
never copied. The completion path relies on one ordering invariant:
`tool_execution_end` custom entries land before Pi writes the toolResult message
(verified in pinned `agent-session.js`). If ordering ever reverses, the fallback
appears before a later enriched line — degraded, but never silent.

- [ ] **Step 4: Format the streamer files and run their focused tests**

Run:

```sh
npx prettier --write src/cli/commands/run-once/pi-session-stream.ts src/cli/commands/run-once/pi-session-stream.test.ts src/cli/commands/run-once/pi.ts src/cli/commands/run-once/pi.test.ts src/cli/commands/triage/tool-call-observer.test.ts
node --test src/cli/commands/run-once/pi-session-stream.test.ts src/cli/commands/run-once/pi.test.ts src/cli/commands/triage/tool-call-observer.test.ts
```

Expected: Prettier exits 0 and all three test files pass, including
completion-marker, opt-in gating, shutdown flush, and immediate triage
observations.

- [ ] **Step 5: Preserve parent-level step accounting**

In `src/cli/commands/run-once/pipeline-progress.ts`, track parent call IDs
inside each active step. Multiple resolved children, changed tuples, and
residual fallbacks remain separate visible lines but represent one parent Pi
tool invocation.

Add the set to `ActiveStep`:

```ts
type ActiveStep = {
  label: string;
  startOutputTokens: number;
  toolCalls: number;
  countedToolCallIds: Set<string>;
};
```

Initialize a fresh set whenever a step starts:

```ts
activeStep = {
  label,
  startOutputTokens: totalOutputTokens,
  toolCalls: 0,
  countedToolCallIds: new Set<string>(),
};
```

Replace the existing tool-call counting branch in `observe()` with one
parent-level path. Preserve existing ID-less observation semantics by counting
each such `tool-call`:

```ts
if (
  activeStep &&
  (observation.type === "tool-call" || observation.type === "subagent-progress")
) {
  const toolCallId =
    observation.type === "subagent-progress"
      ? observation.progress.toolCallId
      : observation.toolCallId;
  if (!toolCallId || !activeStep.countedToolCallIds.has(toolCallId)) {
    if (toolCallId) activeStep.countedToolCallIds.add(toolCallId);
    activeStep.toolCalls += 1;
  }
}
```

Run:

```sh
npx prettier --write src/cli/commands/run-once/pipeline-progress.ts src/cli/commands/run-once/pipeline-progress.test.ts
node --test src/cli/commands/run-once/pipeline-progress.test.ts
```

Expected: Prettier exits 0 and the focused tests pass, including
`toolCalls === 1` for multiple child lines and a fallback sharing one parent ID.

- [ ] **Step 6: Commit the session observation**

```sh
git add src/cli/commands/run-once/pi-session-stream.ts src/cli/commands/run-once/pi-session-stream.test.ts src/cli/commands/run-once/pi.ts src/cli/commands/run-once/pi.test.ts src/cli/commands/triage/tool-call-observer.test.ts src/cli/commands/run-once/pipeline-progress.ts src/cli/commands/run-once/pipeline-progress.test.ts
git commit -m "feat(run-once): stream subagent launch progress"
```

Expected: one commit containing only the seven Task 4 files.

---

### Task 5: Render enriched subagent progress lines

**Files:**

- Modify: `src/cli/commands/run-once/console-progress.ts`
- Modify: `src/cli/commands/run-once/console-progress.test.ts`

**Interfaces:**

- Consumes: Task 4's observation
  `{ type: "subagent-progress"; progress: SubagentProgress }`.
- Produces: console lines exactly matching
  `🤖 subagent (agent=<agent>, model=<model>, thinking=<level>)`, with the
  `thinking` segment omitted when not determinable. The reporter needs no
  suppression logic: the Task 4 streamer buffers foreground execution calls, and
  replayed observations render through the existing formatter unchanged.

- [ ] **Step 1: Write the failing console tests**

Keep every existing test in `src/cli/commands/run-once/console-progress.test.ts`
unchanged — including
`"console reporter renders subagent tool calls with only agent details"` and
`"console reporter renders subagent management calls as normal tools"`. Add
these two tests:

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
      model: "anthropic/claude-sonnet-4",
      thinking: "high" as const,
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
    "   🤖 subagent (agent=reviewer, model=anthropic/claude-sonnet-4, thinking=high)",
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

In `src/cli/commands/run-once/console-progress.ts`, import the payload type and
add one helper after `formatSubagentCall()`:

```ts
import type { SubagentProgress } from "../../../pi/subagent-progress.ts";

function formatSubagentProgress(progress: SubagentProgress): string {
  const thinking = progress.thinking ? `, thinking=${progress.thinking}` : "";
  return `🤖 subagent (agent=${progress.agent}, model=${progress.model}${thinking})`;
}
```

In `event()`'s observation handling, add this branch before the existing
`tool-call` branch:

```ts
if (event.observation?.type === "subagent-progress") {
  if (this.currentStep) {
    this.writeLine(`   ${formatSubagentProgress(event.observation.progress)}`);
  }
  return;
}
```

`formatToolCall()`, the existing `tool-call` branch, and every existing reporter
test stay byte-for-byte unchanged: the Task 4 streamer buffers foreground
execution calls, so the reporter never sees them until replay, and replayed
observations render through the existing formatter — agent-only for
direct/parallel args, the `🔧` argument form for chain args, and normal `🔧`
formatting for management calls.

- [ ] **Step 4: Format the console files and run the focused test**

Run:

```sh
npx prettier --write src/cli/commands/run-once/console-progress.ts src/cli/commands/run-once/console-progress.test.ts
node --test src/cli/commands/run-once/console-progress.test.ts
```

Expected: Prettier exits 0 and the focused tests pass with 0 failures.

- [ ] **Step 5: Commit the console output**

```sh
git add src/cli/commands/run-once/console-progress.ts src/cli/commands/run-once/console-progress.test.ts
git commit -m "feat(run-once): show subagent model progress"
```

Expected: one commit containing only the two Task 5 files.

---

### Task 6: Verify the Nix-installed runtime layout

**Files:**

- Modify: `nix/package.nix`

**Interfaces:**

- Consumes: Tasks 1 and 3's source-loaded observer, shared parser, package-root
  resolver, and run-once profile.
- Produces: an install check that imports the profile from
  `$out/share/patchmill`, resolves every configured extension, and proves each
  path exists in the installed runtime.

- [ ] **Step 1: Add installed-runtime assertions**

This is static Nix verification wiring, a Testing Value Gate exclusion; do not
add a test that restates the expression. Extend the existing `installCheckPhase`
after the fixture assertion and use the Nix build itself as direct verification:

```nix
    test -f "$out/share/${pname}/src/pi/subagent-progress.ts"
    test -f "$out/share/${pname}/src/pi/extensions/run-once-subagent-progress.ts"
    (
      cd "$out/share/${pname}"
      ${nodejs_24}/bin/node --input-type=module -e "
        import { existsSync } from 'node:fs';
        import { runOncePlanningPiProfile } from './src/pi/resource-profiles.ts';
        const skills = {
          triage: 't', planning: 'p', implementation: 'i',
          developmentEnvironment: 'd', toolchain: 'tc', review: 'r',
          visualEvidence: 'v', landing: 'l',
        };
        const profile = runOncePlanningPiProfile(skills, process.cwd());
        const missing = profile.additionalExtensionPaths.filter(
          (path) => !existsSync(path),
        );
        if (missing.length > 0) {
          console.error('missing installed extension paths:', missing);
          process.exit(1);
        }
      "
    )
```

Do not invent a `checks.*` target; this flake exposes package outputs only. The
imported profile must include the vendored todos extension, pinned
`pi-subagents` extension, and new observer source path.

- [ ] **Step 2: Build and run the install check**

Run:

```sh
nix build .#patchmill --no-link --print-build-logs
```

Expected: the package and `installCheckPhase` succeed. Any missing source file,
incorrect package root, unresolved dependency extension, or installed-layout
import failure makes the build fail.

- [ ] **Step 3: Commit the Nix verification**

```sh
git add nix/package.nix
git commit -m "test(nix): verify run-once extension layout"
```

Expected: one commit containing only `nix/package.nix`.

---

### Task 7: Final regression and packaging verification

**Files:**

- Review: all Task 1 through Task 6 files.
- Modify: only files needed to fix verification failures; record any fixes in a
  separate commit.

**Interfaces:**

- Consumes: all interfaces produced by Tasks 1 through 6.
- Produces: verified issue #116 branch ready for review; no implementation
  handoff until every command below passes.

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
  src/cli/commands/run-once/console-progress.test.ts \
  src/cli/commands/triage/tool-call-observer.test.ts
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

Expected: Prettier, ESLint, and markdownlint all pass with 0 errors and 0
warnings.

- [ ] **Step 4: Build the package**

Run:

```sh
npm run build
```

Expected: TypeScript compilation succeeds.
(`dist/src/pi/extensions/run-once-subagent-progress.js` is emitted as a side
effect of compiling `src/`; nothing loads it — the profile loads the TypeScript
source via jiti.)

- [ ] **Step 5: Check the diff**

Run:

```sh
git diff --check
git status --short --branch
```

Expected: no whitespace errors; no untracked or modified files outside the issue
branch's intentional planning and implementation commits.

- [ ] **Step 6: Verify package contents**

Run:

```sh
npm pack --dry-run
```

Expected: the dry-run package contents include
`src/pi/extensions/run-once-subagent-progress.ts` and
`src/pi/subagent-progress.ts` (the observer is loaded from source via jiti,
exactly like `extensions/todos.ts`), and the command exits successfully.

- [ ] **Step 7: Verify the packed artifact resolves extension paths**

`npm pack --dry-run` proves nothing about path resolution, so install the packed
tarball and load the compiled profile from the dist layout:

```sh
set -eu
ROOT="$PWD"
TARBALL=""
WORK=""
cleanup() {
  cd "$ROOT"
  if [ -n "$WORK" ]; then rm -rf "$WORK"; fi
  if [ -n "$TARBALL" ]; then rm -f "$TARBALL"; fi
}
trap cleanup EXIT
TARBALL="$ROOT/$(npm pack --json | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8'))[0].filename")"
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
cleanup
trap - EXIT
```

Expected: prints `all extension paths exist in the packed install`, removes both
the temporary install and generated tarball even on failure, and exits 0. This
catches the dist-layout root-resolution bug that source-tree tests cannot see.

- [ ] **Step 8: Rebuild and verify the Nix-installed layout**

Run:

```sh
nix build .#patchmill --no-link --print-build-logs
```

Expected: PASS, including Task 6's installed source-file and
resolved-extension-path assertions under `$out/share/patchmill`.

- [ ] **Step 9: Commit any verification fixes**

If no fixes were required, stop without creating an empty commit. If fixes were
required, stage only those files and commit:

```sh
git add <fixed-files>
git commit -m "fix(run-once): address subagent progress verification"
git status --short
```

If no fixes were required, run `git status --short` by itself. Expected: no
output; the final working tree is clean.

---

## Self-review checklist for the executor

Before claiming completion, verify each statement is true:

- Reviewer output renders
  `🤖 subagent (agent=reviewer, model=<model>, thinking=<level>)`.
- Worker output renders
  `🤖 subagent (agent=worker, model=<model>, thinking=<level>)`.
- Only the leading provider segment and known thinking suffix are removed;
  nested model-ID segments remain intact.
- Direct, repeated-task, sequential-chain, and chain-parallel calls render one
  visible line per requested child.
- Repeated partial/final updates do not duplicate an unchanged tuple.
- A changed fallback tuple is reported rather than hidden.
- Resolved foreground children do not also emit the previous agent-only line.
- Completion and streamer shutdown emit one task-free, agent-only fallback for
  every unresolved child, including mixed-success parallel siblings.
- Every per-child progress observation for one call is rendered; resolved
  children, unresolved siblings, and changed fallback tuples are never
  swallowed.
- The `thinking` segment appears only when determinable from the child's own
  result metadata; it is never inferred from the parent session.
- Effective async starts retain one agent-only summary without reimplementing
  upstream async/default/clarify precedence.
- Triage observes ordinary subagent calls immediately and never opts into
  run-once buffering.
- Subagent management calls retain normal tool-call output
  (`🔧 subagent (action=list)`).
- Custom progress entries and synthetic fallbacks do not enter LLM context and
  contain no task or child output.
- Parent `toolCalls` accounting remains one unit per `toolCallId`, regardless of
  child lines.
- Malformed hook data does not fail the run; parsing, I/O, spawn, timeout, and
  extension-load failures still propagate.
- The Pi load smoke is bounded and isolated from ambient HOME/XDG/Pi resources.
- Source, npm-packed, and Nix `$out/share/patchmill` extension paths all resolve
  and exist.
- Focused tests, the full test suite, lint, build, diff checks, package checks,
  and Nix build pass.
