# Run-once Subagent Model and Thinking Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render each run-once subagent child's resolved model and thinking level in Patchmill console progress output.

**Architecture:** A compiled Patchmill Pi extension observes `pi-subagents` partial and final tool results, extracts one normalized progress payload per child, and persists non-context custom session entries. Patchmill's run-once session streamer turns only those validated entries into observations, and the console reporter emits one `🤖 subagent (agent=..., model=..., thinking=...)` line per child.

**Tech Stack:** TypeScript, Node.js 22 built-in test runner, node:assert/strict, Pi extension lifecycle events, Pi JSONL sessions, ESLint, Prettier, markdownlint, npm package dry-runs.

## Global Constraints

- Work in the issue worktree and commit at the end of every task.
- Run all commands from the worktree root:
  `/home/roche/projects/patchmill/.worktrees/patchmill-issue-116-show-model-and-thinking-level-in-run-once-subage`.
- Do not edit `package.json`, `package-lock.json`, or `npm-shrinkwrap.json`; no dependency changes are permitted.
- Keep Pi or `pi-subagents` model selection, thinking selection, and fallback behavior unchanged.
- Do not duplicate `pi-subagents` agent, override, model, thinking, or fallback resolution; consume resolved result metadata only.
- Render one independent line per child in parallel subagent calls.
- Custom progress entries must not enter LLM context and must contain no task prompts, child output, credentials, costs, or complete result metadata.
- Custom progress data uses only these exact fields: `toolCallId: string`, `childIndex: number`, `agent: string`, `model: string`, `thinking: SubagentThinkingLevel`.
- Valid thinking levels are exactly `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.
- Displayed model IDs remove a provider prefix by retaining the portion after the final `/`; Pi thinking suffixes are removed from the model and reported as `thinking`.
- Unknown model suffixes remain part of the model ID rather than being misreported as thinking.
- Repeated partial/final updates are deduplicated by tool call ID, child index, agent, model, and thinking.
- A changed fallback tuple emits another line; the old tuple is not replaced retroactively.
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
  - `export type SubagentProgress = { toolCallId: string; childIndex: number; agent: string; model: string; thinking: SubagentThinkingLevel };`
  - `export function parseSubagentProgressResults(result: unknown, toolCallId: string, activeThinking: SubagentThinkingLevel): SubagentProgress[]`
  - `export function parseSubagentProgressEntry(entry: Record<string, unknown>): SubagentProgress | undefined`
  - `export function subagentProgressKey(progress: SubagentProgress): string`

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
            },
            {
              agent: "reviewer",
              model: "openai-codex/gpt-5.6-sol:xhigh",
            },
          ],
        },
      },
      "call-1",
      "high",
    ),
    [
      {
        toolCallId: "call-1",
        childIndex: 0,
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

test("prefers an explicit thinking field over the active Pi fallback", () => {
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
          ],
        },
      },
      "call-2",
      "high",
    ),
    [
      {
        toolCallId: "call-2",
        childIndex: 0,
        agent: "worker",
        model: "gpt-5.6-terra",
        thinking: "low",
      },
    ],
  );
});

test("uses the active Pi thinking level when result metadata omits thinking", () => {
  assert.deepEqual(
    parseSubagentProgressResults(
      {
        details: {
          results: [{ agent: "reviewer", model: "gpt-5.6-sol" }],
        },
      },
      "call-3",
      "xhigh",
    ),
    [
      {
        toolCallId: "call-3",
        childIndex: 0,
        agent: "reviewer",
        model: "gpt-5.6-sol",
        thinking: "xhigh",
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
      "medium",
    ),
    [
      {
        toolCallId: "call-4",
        childIndex: 0,
        agent: "worker",
        model: "model:preview",
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
          ],
        },
      },
      "call-5",
      "low",
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
    assert.deepEqual(
      parseSubagentProgressResults(result, "call-5b", "medium"),
      [],
    );
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

  for (const entry of [
    { type: "custom_message", customType: SUBAGENT_PROGRESS_CUSTOM_TYPE, data: progress },
    { type: "custom", customType: "other", data: progress },
    { type: "custom", customType: SUBAGENT_PROGRESS_CUSTOM_TYPE, data: { ...progress, model: 3 } },
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
  thinking: SubagentThinkingLevel;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isThinkingLevel(value: unknown): value is SubagentThinkingLevel {
  return (
    typeof value === "string" &&
    (THINKING_LEVELS as readonly string[]).includes(value)
  );
}

function splitModel(model: string): {
  model: string;
  thinking?: SubagentThinkingLevel;
} {
  const suffix = /:(off|minimal|low|medium|high|xhigh|max)$/.exec(model);
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
  activeThinking: SubagentThinkingLevel,
): SubagentProgress[] {
  if (!isObject(result) || !isObject(result.details)) return [];
  const results = result.details.results;
  if (!Array.isArray(results)) return [];

  return results.flatMap((item, childIndex) => {
    if (!isObject(item)) return [];
    const agent = typeof item.agent === "string" ? item.agent : "";
    const model = typeof item.model === "string" ? item.model : "";
    if (!agent || !model) return [];
    const parsed = splitModel(model);
    const explicit = isThinkingLevel(item.thinking)
      ? item.thinking
      : undefined;
    const thinking = explicit ?? parsed.thinking ?? activeThinking;
    return [
      {
        toolCallId,
        childIndex,
        agent,
        model: parsed.model,
        thinking,
      },
    ];
  });
}

export function parseSubagentProgressEntry(
  entry: Record<string, unknown>,
): SubagentProgress | undefined {
  if (entry.type !== "custom") return undefined;
  if (entry.customType !== SUBAGENT_PROGRESS_CUSTOM_TYPE) return undefined;
  if (!isObject(entry.data)) return undefined;
  const { toolCallId, childIndex, agent, model, thinking } = entry.data;
  if (typeof toolCallId !== "string" || toolCallId.length === 0) return undefined;
  if (!Number.isInteger(childIndex) || (childIndex as number) < 0) return undefined;
  if (typeof agent !== "string" || agent.length === 0) return undefined;
  if (typeof model !== "string" || model.length === 0) return undefined;
  if (!isThinkingLevel(thinking)) return undefined;
  return { toolCallId, childIndex: childIndex as number, agent, model, thinking };
}

export function subagentProgressKey(progress: SubagentProgress): string {
  return [
    progress.toolCallId,
    String(progress.childIndex),
    progress.agent,
    progress.model,
    progress.thinking,
  ].join("\u0000");
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```sh
node --test src/pi/subagent-progress.test.ts
```

Expected: PASS with 8 passing tests and 0 failing tests.

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
  - `SubagentThinkingLevel`
  - `SubagentProgress`
  - `parseSubagentProgressResults()`
  - `subagentProgressKey()`
- Produces:
  - `export type SubagentProgressObserverApi = { on(event: string, handler: (event: unknown) => void): void; appendEntry(customType: string, data: SubagentProgress): void; getThinkingLevel(): SubagentThinkingLevel }`
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
  thinking: string;
};

function createHarness(): Harness {
  const handlers = new Map<string, Handler[]>();
  const entries: Array<{ customType: string; data: SubagentProgress }> = [];
  const state: Harness = {
    handlers,
    entries,
    thinking: "high",
    api: {
      on(event, handler) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      appendEntry(customType, data) {
        entries.push({ customType, data });
      },
      getThinkingLevel() {
        return state.thinking as "high";
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
        thinking: "high",
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
  parseSubagentProgressResults,
  subagentProgressKey,
  type SubagentProgress,
  type SubagentThinkingLevel,
} from "../subagent-progress.ts";

export type SubagentProgressObserverApi = {
  on(event: string, handler: (event: unknown) => void): void;
  appendEntry(customType: string, data: SubagentProgress): void;
  getThinkingLevel(): SubagentThinkingLevel;
};

type SubagentProgressObserverState = {
  emitted: Set<string>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function observe(
  pi: SubagentProgressObserverApi,
  state: SubagentProgressObserverState,
  toolCallId: string,
  result: unknown,
): void {
  for (const progress of parseSubagentProgressResults(
    result,
    toolCallId,
    pi.getThinkingLevel(),
  )) {
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
    if (!isObject(event) || event.toolName !== "subagent") return;
    if (typeof event.toolCallId !== "string") return;
    observe(pi, state, event.toolCallId, event.partialResult);
  });

  pi.on("tool_execution_end", (event) => {
    if (!isObject(event) || event.toolName !== "subagent") return;
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

- Modify: `src/pi/resource-profiles.ts`
- Modify: `src/pi/resource-profiles.test.ts`
- Modify: `src/cli/commands/run-once/pi.test.ts`

**Interfaces:**

- Consumes: Task 2's compiled extension source path `src/pi/extensions/run-once-subagent-progress.ts` and expected distribution path `dist/src/pi/extensions/run-once-subagent-progress.js`.
- Produces: `runOnceExtensionPaths()` returns three paths in order: `pi-subagents`, `extensions/todos.ts`, then the run-once subagent progress observer.

- [ ] **Step 1: Write the failing profile and CLI expectation tests**

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

In the same file, add `runOnceDevelopmentEnvironmentPiProfile` to the existing import list if it is not already imported.

In `src/cli/commands/run-once/pi.test.ts`, replace `runOnceExtensionArgs` with:

```ts
const runOnceExtensionArgs = [
  "-e",
  "/repo/node_modules/pi-subagents",
  "-e",
  "/repo/extensions/todos.ts",
  "-e",
  "/repo/dist/src/pi/extensions/run-once-subagent-progress.js",
];
```

Update the two existing bundled-Pi-call assertions that inspect extension arguments from `args.slice(0, 5)` to:

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
  /dist\/src\/pi\/extensions\/run-once-subagent-progress\.js$/,
);
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```sh
node --test src/pi/resource-profiles.test.ts src/cli/commands/run-once/pi.test.ts
```

Expected: FAIL because profiles still return only two extensions and Pi calls only include two `-e` pairs.

- [ ] **Step 3: Add the compiled extension path**

Modify `src/pi/resource-profiles.ts` so the constants read:

```ts
const PATCHMILL_TODOS_EXTENSION = join(
  PATCHMILL_PACKAGE_ROOT,
  "extensions",
  "todos.ts",
);
const PATCHMILL_RUN_ONCE_SUBAGENT_PROGRESS_EXTENSION =
  PATCHMILL_PACKAGE_ROOT.endsWith(join("dist", "src", "pi"))
    ? join(
        PATCHMILL_PACKAGE_ROOT,
        "extensions",
        "run-once-subagent-progress.js",
      )
    : join(
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

- [ ] **Step 4: Run the focused tests to verify they pass**

Run:

```sh
node --test src/pi/resource-profiles.test.ts src/cli/commands/run-once/pi.test.ts
```

Expected: PASS with 0 failing tests in both files.

- [ ] **Step 5: Commit the profile wiring**

```sh
git add src/pi/resource-profiles.ts src/pi/resource-profiles.test.ts src/cli/commands/run-once/pi.test.ts
git commit -m "feat(pi): load run-once subagent observer"
```

Expected: one commit containing only the three Task 3 files.

---

### Task 4: Stream validated custom progress entries

**Files:**

- Modify: `src/cli/commands/run-once/pi-session-stream.ts`
- Modify: `src/cli/commands/run-once/pi.test.ts`

**Interfaces:**

- Consumes: Task 1's `SUBAGENT_PROGRESS_CUSTOM_TYPE`, `SubagentProgress`, and `parseSubagentProgressEntry()`.
- Produces:
  - `PiSessionObservation` gains `{ type: "subagent-progress"; progress: SubagentProgress }`.
  - `sessionEntryToObservations(entry: JsonObject): PiSessionObservation[]` returns that observation only for exact, valid progress custom entries.

- [ ] **Step 1: Write the failing session-stream tests**

Add these tests near the existing `sessionEntryToObservations` coverage in `src/cli/commands/run-once/pi.test.ts`:

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
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```sh
node --test src/cli/commands/run-once/pi.test.ts
```

Expected: FAIL because `sessionEntryToObservations` returns no `subagent-progress` observation.

- [ ] **Step 3: Add the custom-entry observation**

In `src/cli/commands/run-once/pi-session-stream.ts`, add this import:

```ts
import {
  parseSubagentProgressEntry,
  type SubagentProgress,
} from "../../../pi/subagent-progress.ts";
```

Extend `PiSessionObservation` with this union member:

```ts
| {
    type: "subagent-progress";
    progress: SubagentProgress;
  }
```

At the start of `sessionEntryToObservations`, before the existing `custom_message` branch, add:

```ts
const subagentProgress = parseSubagentProgressEntry(entry);
if (subagentProgress) {
  return [{ type: "subagent-progress", progress: subagentProgress }];
}
```

Leave `sessionEntryToStreamText` and `sessionEntryToRawText` unchanged: valid custom entries are observations only, not raw or pretty text.

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```sh
node --test src/cli/commands/run-once/pi.test.ts
```

Expected: PASS with 0 failing tests.

- [ ] **Step 5: Commit the session observation**

```sh
git add src/cli/commands/run-once/pi-session-stream.ts src/cli/commands/run-once/pi.test.ts
git commit -m "feat(run-once): stream subagent launch progress"
```

Expected: one commit containing only the two Task 4 files.

---

### Task 5: Render enriched subagent progress lines

**Files:**

- Modify: `src/cli/commands/run-once/console-progress.ts`
- Modify: `src/cli/commands/run-once/console-progress.test.ts`

**Interfaces:**

- Consumes: Task 4's observation `{ type: "subagent-progress"; progress: SubagentProgress }`.
- Produces: console lines exactly matching `🤖 subagent (agent=<agent>, model=<model>, thinking=<level>)`; direct, parallel, and chain subagent execution tool-call observations no longer emit the old agent-only summaries.

- [ ] **Step 1: Write the failing console tests**

Replace the existing `"console reporter renders subagent tool calls with only agent details"` test with:

```ts
test("console reporter ignores raw subagent execution calls", () => {
  const lines: string[] = [];
  const reporter = new AgentIssueConsoleProgressReporter({
    writeLine: (line) => lines.push(line),
    startedAt: BASE,
  });

  reporter.event(
    event({
      observation: {
        type: "tool-call",
        toolName: "subagent",
        arguments: { agent: "worker", task: "write tests" },
      },
    }),
  );
  reporter.event(
    event({
      observation: {
        type: "tool-call",
        toolName: "subagent",
        arguments: {
          tasks: [
            { agent: "worker", task: "implement" },
            { agent: "reviewer", task: "review" },
          ],
        },
      },
    }),
  );
  reporter.event(
    event({
      observation: {
        type: "tool-call",
        toolName: "subagent",
        arguments: {
          chain: [
            { agent: "worker", task: "implement" },
            { agent: "reviewer", task: "review" },
          ],
        },
      },
    }),
  );

  assert.deepEqual(lines, []);
});

test("console reporter renders one enriched line per resolved subagent child", () => {
  const lines: string[] = [];
  const reporter = new AgentIssueConsoleProgressReporter({
    writeLine: (line) => lines.push(line),
    startedAt: BASE,
  });

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
    "   🤖 subagent (agent=worker, model=gpt-5.6-terra, thinking=medium)",
    "   🤖 subagent (agent=reviewer, model=gpt-5.6-sol, thinking=xhigh)",
  ]);
});
```

Keep the existing `"console reporter renders subagent management calls as normal tools"` test unchanged.

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```sh
node --test src/cli/commands/run-once/console-progress.test.ts
```

Expected: FAIL because raw execution calls still emit agent-only lines and `subagent-progress` observations are unhandled.

- [ ] **Step 3: Render progress observations and suppress raw execution summaries**

In `src/cli/commands/run-once/console-progress.ts`, delete `subagentLabel()`, `subagentLabels()`, and `formatSubagentCall()`. Add:

```ts
function formatSubagentProgress(progress: {
  agent: string;
  model: string;
  thinking: string;
}): string {
  return `🤖 subagent (agent=${progress.agent}, model=${progress.model}, thinking=${progress.thinking})`;
}
```

Replace the body of `formatObservation()` with:

```ts
function formatObservation(
  observation: NonNullable<AgentIssueProgressEvent["observation"]>,
): string | undefined {
  if (observation.type === "subagent-progress") {
    return formatSubagentProgress(observation.progress);
  }
  if (observation.type !== "tool-call") return undefined;
  const name = observation.toolName ?? "tool";
  if (name === "subagent" && !("action" in (observation.arguments ?? {}))) {
    return undefined;
  }
  const summary = summarizeArgs(observation.arguments);
  const prefix = name === "subagent" ? "🤖" : "🔧";
  return summary ? `${prefix} ${name} (${summary})` : `🔧 ${name}`;
}
```

In `event()`'s observation switch, add this branch before the `tool-call` branch:

```ts
if (event.observation?.type === "subagent-progress") {
  this.writeLine(`   ${formatSubagentProgress(event.observation.progress)}`);
  return;
}
```

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
  src/pi/resource-profiles.test.ts \
  src/cli/commands/run-once/pi.test.ts \
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

Expected: TypeScript compilation succeeds and produces `dist/src/pi/extensions/run-once-subagent-progress.js`.

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

Expected: the dry-run package contents include `dist/src/pi/extensions/run-once-subagent-progress.js` and the command exits successfully.

- [ ] **Step 7: Commit any verification fixes**

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
- Parallel calls render one enriched line per child.
- Repeated partial/final updates do not duplicate an unchanged tuple.
- A changed fallback tuple is reported rather than hidden.
- Direct, parallel, and chain subagent execution calls do not emit the previous agent-only line.
- Subagent management calls retain normal tool-call output.
- Custom progress entries do not enter LLM context and contain no task or child output.
- Malformed hook data does not fail the run.
- Focused tests, the full test suite, lint, build, diff checks, and package dry-run pass.
