# Patchmill Init Interactive Model Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Pi-like searchable model selector to `patchmill init`, scoped to
repository-local Pi settings.

**Architecture:** Keep Patchmill in control of the init experience. Split the
work into focused modules: local Pi agent path/settings persistence, pure
selector state, terminal selector rendering, and init integration. Persist
selected models to `.patchmill/pi-agent/settings.json` using Pi-compatible
`defaultProvider` and `defaultModel` keys.

**Tech Stack:** TypeScript, Node.js built-in `node:test`, Node terminal
keypress/readline APIs, existing `@earendil-works/pi-coding-agent` registry
APIs.

---

## Baseline

The feature worktree is at:

```text
.worktrees/init-model-selector-design
```

Baseline verification completed before writing this plan:

```bash
cd .worktrees/init-model-selector-design
npm test
```

Result: 561 tests passed, 0 failed.

## File structure

- Create `src/cli/commands/init/pi-agent-settings.ts`
  - Owns repository-local Pi agent directory resolution.
  - Reads and writes `.patchmill/pi-agent/settings.json`.
  - Preserves unrelated settings keys.
  - Exposes a small `PI_CODING_AGENT_DIR` env helper for Pi subprocesses.
- Create `src/cli/commands/init/pi-agent-settings.test.ts`
  - Tests path resolution, JSON merging, invalid JSON handling, and env helper
    output.
- Modify `src/cli/commands/init/pi-preflight.ts`
  - Accept an optional `agentDir` so readiness checks use repo-local Pi
    auth/models.
- Modify `src/cli/commands/init/pi-preflight.test.ts`
  - Verify `createPiRegistry({ agentDir })` reads `auth.json` and `models.json`
    from that directory.
- Modify `src/cli/commands/init/pi-smoke-test.ts`
  - Accept an optional `piAgentDir` and pass it as `PI_CODING_AGENT_DIR` when
    spawning `pi`.
- Modify `src/cli/commands/init/pi-smoke-test.test.ts`
  - Verify `PI_CODING_AGENT_DIR` is forwarded.
- Create `src/cli/commands/init/pi-model-selector-state.ts`
  - Pure selector state: filtering, visible ten-row window, navigation, and
    count formatting.
- Create `src/cli/commands/init/pi-model-selector-state.test.ts`
  - Tests the model selector behavior without terminal I/O.
- Modify `package.json`, `package-lock.json`, and `npm-shrinkwrap.json`
  - Add `@earendil-works/pi-tui` as a direct dependency because Patchmill
    imports it directly.
- Create `src/cli/commands/init/pi-model-selector.ts`
  - Patchmill-owned selector component and runner built with
    `@earendil-works/pi-tui` primitives (`Input`, `SelectList`, `Text`,
    `Container`, `TUI`, and `ProcessTerminal`).
- Modify `src/cli/commands/init/pi-model-selection.ts`
  - Replace the readline numbered prompt with the selector abstraction.
  - Persist selected available models.
  - Keep deterministic non-interactive selection.
- Modify `src/cli/commands/init/pi-model-selection.test.ts`
  - Cover selector selection, cancellation fallback, persistence calls, and
    non-ready behavior.
- Modify `src/cli/commands/init/main.ts`
  - Compute the repo-local Pi agent dir.
  - Pass it to readiness, model selection, persistence, and smoke test.
- Modify `src/cli/commands/init/main.test.ts`
  - Verify init persists selected model and smoke-tests `provider/model`.
  - Verify missing readiness skips selector.
- Update `docs/specs/2026-06-02-patchmill-init-model-selector-design.md` only if
  implementation discovers a design correction. No doc update is expected for
  the current plan.

---

### Task 1: Add repo-local Pi settings persistence

**Files:**

- Create: `src/cli/commands/init/pi-agent-settings.ts`
- Create: `src/cli/commands/init/pi-agent-settings.test.ts`

- [ ] **Step 1: Write failing tests for local Pi settings**

Create `src/cli/commands/init/pi-agent-settings.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  localPiAgentDir,
  piAgentEnv,
  readLocalPiDefaultModel,
  writeLocalPiDefaultModel,
} from "./pi-agent-settings.ts";

async function tempRepo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "patchmill-pi-agent-settings-"));
}

test("localPiAgentDir resolves the repository-local Pi agent directory", async () => {
  const repoRoot = await tempRepo();

  assert.equal(
    localPiAgentDir(repoRoot),
    join(repoRoot, ".patchmill", "pi-agent"),
  );
});

test("piAgentEnv returns the PI_CODING_AGENT_DIR override", async () => {
  const repoRoot = await tempRepo();
  const agentDir = localPiAgentDir(repoRoot);

  assert.deepEqual(piAgentEnv(agentDir), {
    PI_CODING_AGENT_DIR: agentDir,
  });
});

test("writeLocalPiDefaultModel creates settings.json with provider and model", async () => {
  const repoRoot = await tempRepo();
  const agentDir = localPiAgentDir(repoRoot);

  await writeLocalPiDefaultModel(agentDir, {
    provider: "openai-codex",
    modelId: "gpt-5.5",
  });

  assert.deepEqual(
    JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")),
    {
      defaultProvider: "openai-codex",
      defaultModel: "gpt-5.5",
    },
  );
});

test("writeLocalPiDefaultModel preserves unrelated settings", async () => {
  const repoRoot = await tempRepo();
  const agentDir = localPiAgentDir(repoRoot);
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({ theme: "dark", defaultThinkingLevel: "high" }, null, 2),
  );

  await writeLocalPiDefaultModel(agentDir, {
    provider: "anthropic",
    modelId: "claude-opus-4-1",
  });

  assert.deepEqual(
    JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")),
    {
      theme: "dark",
      defaultThinkingLevel: "high",
      defaultProvider: "anthropic",
      defaultModel: "claude-opus-4-1",
    },
  );
});

test("writeLocalPiDefaultModel rejects invalid JSON without overwriting it", async () => {
  const repoRoot = await tempRepo();
  const agentDir = localPiAgentDir(repoRoot);
  const settingsPath = join(agentDir, "settings.json");
  await mkdir(agentDir, { recursive: true });
  await writeFile(settingsPath, "{not json", "utf8");

  await assert.rejects(
    writeLocalPiDefaultModel(agentDir, {
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
    }),
    /Could not parse local Pi settings/u,
  );
  assert.equal(await readFile(settingsPath, "utf8"), "{not json");
});

test("readLocalPiDefaultModel returns the persisted provider and model", async () => {
  const repoRoot = await tempRepo();
  const agentDir = localPiAgentDir(repoRoot);
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "anthropic",
      defaultModel: "claude-opus-4-1",
    }),
  );

  assert.deepEqual(await readLocalPiDefaultModel(agentDir), {
    provider: "anthropic",
    modelId: "claude-opus-4-1",
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd .worktrees/init-model-selector-design
node --test src/cli/commands/init/pi-agent-settings.test.ts
```

Expected: FAIL because `pi-agent-settings.ts` does not exist.

- [ ] **Step 3: Implement local Pi settings helpers**

Create `src/cli/commands/init/pi-agent-settings.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type LocalPiDefaultModel = {
  provider: string;
  modelId: string;
};

export function localPiAgentDir(repoRoot: string): string {
  return join(repoRoot, ".patchmill", "pi-agent");
}

export function piAgentEnv(agentDir: string): Record<string, string> {
  return { PI_CODING_AGENT_DIR: agentDir };
}

function settingsPath(agentDir: string): string {
  return join(agentDir, "settings.json");
}

async function readSettings(path: string): Promise<Record<string, unknown>> {
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error("settings.json must contain a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {};
    }
    throw new Error(
      `Could not parse local Pi settings: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function readLocalPiDefaultModel(
  agentDir: string,
): Promise<LocalPiDefaultModel | undefined> {
  const settings = await readSettings(settingsPath(agentDir));
  return typeof settings.defaultProvider === "string" &&
    typeof settings.defaultModel === "string"
    ? { provider: settings.defaultProvider, modelId: settings.defaultModel }
    : undefined;
}

export async function writeLocalPiDefaultModel(
  agentDir: string,
  model: LocalPiDefaultModel,
): Promise<void> {
  const path = settingsPath(agentDir);
  const settings = await readSettings(path);
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(
      {
        ...settings,
        defaultProvider: model.provider,
        defaultModel: model.modelId,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}
```

- [ ] **Step 4: Run settings tests and verify they pass**

Run:

```bash
cd .worktrees/init-model-selector-design
node --test src/cli/commands/init/pi-agent-settings.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
cd .worktrees/init-model-selector-design
git add src/cli/commands/init/pi-agent-settings.ts src/cli/commands/init/pi-agent-settings.test.ts
git commit -m "feat(init): add local Pi settings helpers"
```

---

### Task 2: Scope Pi readiness and smoke tests to the local Pi agent dir

**Files:**

- Modify: `src/cli/commands/init/pi-preflight.ts`
- Modify: `src/cli/commands/init/pi-preflight.test.ts`
- Modify: `src/cli/commands/init/pi-smoke-test.ts`
- Modify: `src/cli/commands/init/pi-smoke-test.test.ts`

- [ ] **Step 1: Write failing preflight and smoke-test assertions**

In `src/cli/commands/init/pi-preflight.test.ts`, add this import:

```ts
import { join } from "node:path";
```

Add this test:

```ts
test("createPiRegistry uses auth and models from the provided agent dir", () => {
  const registry = createPiRegistry({ agentDir: "/repo/.patchmill/pi-agent" });

  assert.equal(registry.getError(), undefined);
  assert.equal(
    String(registry.constructor.name).length > 0,
    true,
    "registry should be constructed",
  );
  assert.equal(
    join("/repo/.patchmill/pi-agent", "auth.json"),
    "/repo/.patchmill/pi-agent/auth.json",
  );
});
```

Update the import list from `./pi-preflight.ts` to include `createPiRegistry`.

In `src/cli/commands/init/pi-smoke-test.test.ts`, change the fake runner call
recording type to include env:

```ts
calls: Array<{
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
}>;
```

Inside `run`, push env:

```ts
calls.push({ command, args, cwd: options.cwd, env: options.env });
```

Add this smoke test:

```ts
test("runPiSmokeTest scopes Pi to the provided local agent dir", async () => {
  const fake = runner({ code: 0, stdout: "PATCHMILL_PI_OK\n" });

  await runPiSmokeTest(fake, {
    repoRoot: "/repo",
    model: "openai-codex/gpt-5.5",
    piAgentDir: "/repo/.patchmill/pi-agent",
  });

  assert.equal(
    fake.calls[0]?.env?.PI_CODING_AGENT_DIR,
    "/repo/.patchmill/pi-agent",
  );
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
cd .worktrees/init-model-selector-design
node --test src/cli/commands/init/pi-preflight.test.ts src/cli/commands/init/pi-smoke-test.test.ts
```

Expected: FAIL because `createPiRegistry` does not accept options and
`runPiSmokeTest` does not accept `piAgentDir`.

- [ ] **Step 3: Update `pi-preflight.ts` to accept `agentDir`**

In `src/cli/commands/init/pi-preflight.ts`, change `createPiRegistry` to:

```ts
export function createPiRegistry(
  options: { agentDir?: string } = {},
): PiRegistryLike {
  const agentDir = options.agentDir ?? getAgentDir();
  const auth = AuthStorage.create(join(agentDir, "auth.json"));
  const registry = ModelRegistry.create(auth, join(agentDir, "models.json"));
  registry.refresh();
  return registry;
}
```

Change `detectPiReadiness` to pass `agentDir` through:

```ts
export function detectPiReadiness(
  options: { registry?: PiRegistryLike; agentDir?: string } = {},
): PiReadiness {
  const registry =
    options.registry ?? createPiRegistry({ agentDir: options.agentDir });
```

- [ ] **Step 4: Update `pi-smoke-test.ts` to pass local Pi env**

Import the env helper:

```ts
import { piAgentEnv } from "./pi-agent-settings.ts";
```

Change the options type:

```ts
options: { repoRoot: string; model?: string; piAgentDir?: string },
```

Change the runner call:

```ts
const result = await runner.run("pi", args, {
  cwd: options.repoRoot,
  ...(options.piAgentDir ? { env: piAgentEnv(options.piAgentDir) } : {}),
});
```

- [ ] **Step 5: Run focused tests and verify they pass**

Run:

```bash
cd .worktrees/init-model-selector-design
node --test src/cli/commands/init/pi-preflight.test.ts src/cli/commands/init/pi-smoke-test.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
cd .worktrees/init-model-selector-design
git add src/cli/commands/init/pi-preflight.ts src/cli/commands/init/pi-preflight.test.ts src/cli/commands/init/pi-smoke-test.ts src/cli/commands/init/pi-smoke-test.test.ts
git commit -m "feat(init): scope Pi checks to local agent dir"
```

---

### Task 3: Add pure selector state

**Files:**

- Create: `src/cli/commands/init/pi-model-selector-state.ts`
- Create: `src/cli/commands/init/pi-model-selector-state.test.ts`

- [ ] **Step 1: Write failing selector state tests**

Create `src/cli/commands/init/pi-model-selector-state.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PiModelChoice } from "./pi-preflight.ts";
import {
  createModelSelectorState,
  formatModelSelectorCount,
  modelSelectorDetails,
  moveModelSelection,
  searchModelSelector,
  visibleModelRows,
} from "./pi-model-selector-state.ts";

function model(provider: string, id: string, name = id): PiModelChoice {
  return {
    provider,
    providerName: provider === "anthropic" ? "Anthropic" : provider,
    id,
    label: `${provider} / ${name}`,
    value: `${provider}/${id}`,
    authSource: "stored",
    reasoning: id.includes("opus"),
    input: ["text"],
  };
}

const models = [
  model("openai-codex", "gpt-5.5", "GPT-5.5"),
  model("anthropic", "claude-3-5-haiku-20241022"),
  model("anthropic", "claude-3-5-haiku-latest"),
  model("anthropic", "claude-3-5-sonnet-20240620"),
  model("anthropic", "claude-3-5-sonnet-20241022"),
  model("anthropic", "claude-3-7-sonnet-20250219"),
  model("anthropic", "claude-3-haiku-20240307"),
  model("anthropic", "claude-3-opus-20240229"),
  model("anthropic", "claude-3-sonnet-20240229"),
  model("anthropic", "claude-haiku-4-5"),
  model("anthropic", "claude-opus-4-0"),
];

test("visibleModelRows returns the first ten selector rows", () => {
  const state = createModelSelectorState(models, {
    current: { provider: "openai-codex", modelId: "gpt-5.5" },
  });

  assert.equal(visibleModelRows(state).length, 10);
  assert.equal(visibleModelRows(state)[0]?.model.id, "gpt-5.5");
  assert.equal(visibleModelRows(state)[0]?.selected, true);
  assert.equal(visibleModelRows(state)[0]?.current, true);
  assert.equal(formatModelSelectorCount(state), "(1/11)");
});

test("searchModelSelector filters by model id and resets selection", () => {
  const state = searchModelSelector(createModelSelectorState(models), "opus-4");

  assert.deepEqual(
    visibleModelRows(state).map((row) => row.model.id),
    ["claude-opus-4-0"],
  );
  assert.equal(formatModelSelectorCount(state), "(1/1)");
});

test("searchModelSelector filters by provider display name", () => {
  const state = searchModelSelector(
    createModelSelectorState(models),
    "anthropic",
  );

  assert.equal(state.filtered.length, 10);
  assert.equal(state.filtered[0]?.provider, "anthropic");
});

test("moveModelSelection moves selection and keeps a ten-row window", () => {
  let state = createModelSelectorState(models);
  for (let index = 0; index < 10; index += 1) {
    state = moveModelSelection(state, 1);
  }

  assert.equal(state.selectedIndex, 10);
  assert.equal(visibleModelRows(state).length, 10);
  assert.equal(visibleModelRows(state).at(-1)?.model.id, "claude-opus-4-0");
  assert.equal(formatModelSelectorCount(state), "(11/11)");
});

test("searchModelSelector handles empty results", () => {
  const state = searchModelSelector(
    createModelSelectorState(models),
    "not-present",
  );

  assert.equal(state.filtered.length, 0);
  assert.deepEqual(visibleModelRows(state), []);
  assert.equal(formatModelSelectorCount(state), "(0/0)");
});

test("modelSelectorDetails returns Pi-like footer details", () => {
  const state = createModelSelectorState(models);

  assert.equal(modelSelectorDetails(state), "Model Name: GPT-5.5");
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd .worktrees/init-model-selector-design
node --test src/cli/commands/init/pi-model-selector-state.test.ts
```

Expected: FAIL because `pi-model-selector-state.ts` does not exist.

- [ ] **Step 3: Implement pure selector state**

Create `src/cli/commands/init/pi-model-selector-state.ts`:

```ts
import type { LocalPiDefaultModel } from "./pi-agent-settings.ts";
import type { PiModelChoice } from "./pi-preflight.ts";

const VISIBLE_ROWS = 10;

export type ModelSelectorState = {
  models: PiModelChoice[];
  filtered: PiModelChoice[];
  query: string;
  selectedIndex: number;
  current?: LocalPiDefaultModel;
};

export type VisibleModelRow = {
  model: PiModelChoice;
  selected: boolean;
  current: boolean;
};

function matchesCurrent(
  model: PiModelChoice,
  current: LocalPiDefaultModel | undefined,
): boolean {
  return current?.provider === model.provider && current.modelId === model.id;
}

function searchableText(model: PiModelChoice): string {
  return [
    model.id,
    model.provider,
    model.providerName,
    model.label,
    model.value,
  ]
    .join("\n")
    .toLowerCase();
}

function filterModels(models: PiModelChoice[], query: string): PiModelChoice[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return models;
  return models.filter((model) => searchableText(model).includes(normalized));
}

export function createModelSelectorState(
  models: PiModelChoice[],
  options: { current?: LocalPiDefaultModel; query?: string } = {},
): ModelSelectorState {
  const filtered = filterModels(models, options.query ?? "");
  const currentIndex = filtered.findIndex((model) =>
    matchesCurrent(model, options.current),
  );
  return {
    models,
    filtered,
    query: options.query ?? "",
    selectedIndex: currentIndex >= 0 ? currentIndex : 0,
    current: options.current,
  };
}

export function searchModelSelector(
  state: ModelSelectorState,
  query: string,
): ModelSelectorState {
  return createModelSelectorState(state.models, {
    current: state.current,
    query,
  });
}

export function moveModelSelection(
  state: ModelSelectorState,
  delta: number,
): ModelSelectorState {
  if (state.filtered.length === 0) return { ...state, selectedIndex: 0 };
  const next = Math.max(
    0,
    Math.min(state.filtered.length - 1, state.selectedIndex + delta),
  );
  return { ...state, selectedIndex: next };
}

export function selectedModel(
  state: ModelSelectorState,
): PiModelChoice | undefined {
  return state.filtered[state.selectedIndex];
}

export function visibleModelRows(state: ModelSelectorState): VisibleModelRow[] {
  if (state.filtered.length === 0) return [];
  const start = Math.min(
    Math.max(0, state.selectedIndex - VISIBLE_ROWS + 1),
    Math.max(0, state.filtered.length - VISIBLE_ROWS),
  );
  return state.filtered.slice(start, start + VISIBLE_ROWS).map((model) => ({
    model,
    selected: model === selectedModel(state),
    current: matchesCurrent(model, state.current),
  }));
}

export function formatModelSelectorCount(state: ModelSelectorState): string {
  if (state.filtered.length === 0) return "(0/0)";
  return `(${state.selectedIndex + 1}/${state.filtered.length})`;
}

export function modelSelectorDetails(state: ModelSelectorState): string {
  const model = selectedModel(state);
  return model
    ? `Model Name: ${model.label.split(" / ").at(-1) ?? model.id}`
    : "No matching models";
}
```

- [ ] **Step 4: Run selector state tests and verify they pass**

Run:

```bash
cd .worktrees/init-model-selector-design
node --test src/cli/commands/init/pi-model-selector-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
cd .worktrees/init-model-selector-design
git add src/cli/commands/init/pi-model-selector-state.ts src/cli/commands/init/pi-model-selector-state.test.ts
git commit -m "feat(init): add model selector state"
```

---

### Task 4: Add terminal model selector UI with pi-tui primitives

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `npm-shrinkwrap.json`
- Create: `src/cli/commands/init/pi-model-selector.ts`

- [ ] **Step 1: Add `@earendil-works/pi-tui` as a direct dependency**

Run:

```bash
cd .worktrees/init-model-selector-design
npm install @earendil-works/pi-tui@^0.74.2 --save
```

Expected: `package.json`, `package-lock.json`, and `npm-shrinkwrap.json` record
`@earendil-works/pi-tui` as a direct dependency. This is required because
Patchmill will import pi-tui directly instead of relying on Pi's transitive
dependency.

- [ ] **Step 2: Create the pi-tui selector component and runner**

Create `src/cli/commands/init/pi-model-selector.ts`:

```ts
import {
  Container,
  Input,
  ProcessTerminal,
  SelectList,
  Text,
  TUI,
  type Component,
  type Focusable,
  type SelectItem,
  type SelectListTheme,
  type Terminal,
} from "@earendil-works/pi-tui";
import type { LocalPiDefaultModel } from "./pi-agent-settings.ts";
import type { PiModelChoice } from "./pi-preflight.ts";
import {
  createModelSelectorState,
  formatModelSelectorCount,
  modelSelectorDetails,
  searchModelSelector,
  selectedModel,
  type ModelSelectorState,
} from "./pi-model-selector-state.ts";

export type InteractiveModelSelector = (options: {
  models: PiModelChoice[];
  current?: LocalPiDefaultModel;
  terminal?: Terminal;
}) => Promise<PiModelChoice | undefined>;

const selectorTheme: SelectListTheme = {
  selectedPrefix: (text) => `→ ${text}`,
  selectedText: (text) => text,
  description: (text) => text,
  scrollInfo: (text) => text,
  noMatch: (text) => text,
};

function modelItem(
  model: PiModelChoice,
  current: LocalPiDefaultModel | undefined,
): SelectItem {
  const isCurrent =
    current?.provider === model.provider && current.modelId === model.id;
  return {
    value: model.value,
    label: `${model.id} [${model.provider}]${isCurrent ? " ✓" : ""}`,
    description: model.label,
  };
}

class ModelSelectorComponent extends Container implements Focusable {
  private readonly searchInput = new Input();
  private readonly list: SelectList;
  private readonly count = new Text();
  private readonly details = new Text();
  private state: ModelSelectorState;
  private _focused = false;

  constructor(
    private readonly models: PiModelChoice[],
    private readonly current: LocalPiDefaultModel | undefined,
    private readonly onSelect: (model: PiModelChoice) => void,
    private readonly onCancel: () => void,
  ) {
    super();
    this.state = createModelSelectorState(models, { current });
    this.list = new SelectList(
      this.state.filtered.map((model) => modelItem(model, current)),
      10,
      selectorTheme,
    );
    this.searchInput.onEscape = onCancel;
    this.list.onCancel = onCancel;
    this.list.onSelect = (item) => {
      const model = this.models.find((entry) => entry.value === item.value);
      if (model) this.onSelect(model);
    };
    this.list.onSelectionChange = (item) => {
      const index = this.state.filtered.findIndex(
        (model) => model.value === item.value,
      );
      this.state = { ...this.state, selectedIndex: Math.max(0, index) };
      this.updateFooter();
    };
    this.addChild(this.searchInput);
    this.addChild(new Text(""));
    this.addChild(this.list);
    this.addChild(this.count);
    this.addChild(new Text(""));
    this.addChild(this.details);
    this.updateFooter();
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.searchInput.focused = value;
  }

  handleInput(data: string): void {
    if (data === "\x1b[A" || data === "\x1b[B" || data === "\r") {
      this.list.handleInput(data);
      return;
    }
    this.searchInput.handleInput(data);
    this.state = searchModelSelector(this.state, this.searchInput.getValue());
    this.list.setFilter(this.searchInput.getValue());
    this.list.setSelectedIndex(0);
    this.updateFooter();
  }

  private updateFooter(): void {
    const item = this.list.getSelectedItem();
    if (item) {
      const index = this.state.filtered.findIndex(
        (model) => model.value === item.value,
      );
      this.state = { ...this.state, selectedIndex: Math.max(0, index) };
    }
    this.count.setText(formatModelSelectorCount(this.state));
    this.details.setText(modelSelectorDetails(this.state));
  }
}

export async function selectModelInteractively(options: {
  models: PiModelChoice[];
  current?: LocalPiDefaultModel;
  terminal?: Terminal;
}): Promise<PiModelChoice | undefined> {
  const terminal = options.terminal ?? new ProcessTerminal();
  const tui = new TUI(terminal, true);
  let component: Component | undefined;

  return new Promise((resolve) => {
    const finish = async (model: PiModelChoice | undefined) => {
      tui.stop();
      await terminal.drainInput();
      resolve(model);
    };

    component = new ModelSelectorComponent(
      options.models,
      options.current,
      (model) => void finish(model),
      () => void finish(undefined),
    );
    tui.addChild(component);
    tui.setFocus(component);
    tui.start();
    tui.requestRender(true);
  });
}
```

This component is Patchmill-owned and only uses public pi-tui primitives. It
does not import or depend on Pi's private `ModelSelectorComponent`.

- [ ] **Step 3: Run TypeScript check for the new file**

Run:

```bash
cd .worktrees/init-model-selector-design
npm run lint:ts
```

Expected: PASS. If `SelectList.handleInput()` key encodings differ from the
literal escape sequences above, inspect
`node_modules/@earendil-works/pi-tui/dist/components/select-list.js`, replace
the literals with the encodings used by pi-tui, and rerun until PASS.

- [ ] **Step 4: Commit Task 4**

```bash
cd .worktrees/init-model-selector-design
git add package.json package-lock.json npm-shrinkwrap.json src/cli/commands/init/pi-model-selector.ts
git commit -m "feat(init): add pi-tui model selector"
```

---

### Task 5: Integrate selection and persistence in `pi-model-selection.ts`

**Files:**

- Modify: `src/cli/commands/init/pi-model-selection.ts`
- Modify: `src/cli/commands/init/pi-model-selection.test.ts`

- [ ] **Step 1: Replace old prompt tests with selector-driven tests**

In `src/cli/commands/init/pi-model-selection.test.ts`, replace the `prompt`
helper and prompt-specific tests with this helper:

```ts
function secondModel(): PiModelChoice {
  return {
    provider: "openai-codex",
    providerName: "OpenAI Codex",
    id: "gpt-5.5",
    label: "OpenAI Codex / GPT-5.5",
    value: "openai-codex/gpt-5.5",
    authSource: "stored",
    reasoning: true,
    input: ["text"],
  };
}

const twoReady: PiReadiness = {
  status: "ready",
  models: [model, secondModel()],
  message: "Pi reported 2 provider/model options with configured auth.",
};
```

Add these tests:

```ts
test("selectPiModel uses the interactive selector and persists the selected model", async () => {
  const persisted: Array<{ provider: string; modelId: string }> = [];

  const result = await selectPiModel({
    readiness: twoReady,
    isInteractive: true,
    currentDefault: { provider: "anthropic", modelId: "claude-sonnet-4-5" },
    selectModelInteractively: async () => secondModel(),
    persistDefaultModel: async (selection) => {
      persisted.push(selection);
    },
  });

  assert.deepEqual(result, {
    status: "selected",
    model: "openai-codex/gpt-5.5",
    provider: "openai-codex",
    modelId: "gpt-5.5",
    message: "Using Pi model OpenAI Codex / GPT-5.5.",
  });
  assert.deepEqual(persisted, [
    { provider: "openai-codex", modelId: "gpt-5.5" },
  ]);
});

test("selectPiModel falls back to current default when selector is cancelled", async () => {
  const result = await selectPiModel({
    readiness: twoReady,
    isInteractive: true,
    currentDefault: { provider: "openai-codex", modelId: "gpt-5.5" },
    selectModelInteractively: async () => undefined,
  });

  assert.equal(result.status, "selected");
  assert.equal(result.model, "openai-codex/gpt-5.5");
});

test("selectPiModel falls back to first model when selector is cancelled without a current default", async () => {
  const result = await selectPiModel({
    readiness: twoReady,
    isInteractive: true,
    selectModelInteractively: async () => undefined,
  });

  assert.equal(result.status, "selected");
  assert.equal(result.model, "anthropic/claude-sonnet-4-5");
});

test("selectPiModel persists deterministic non-interactive selection", async () => {
  const persisted: Array<{ provider: string; modelId: string }> = [];

  const result = await selectPiModel({
    readiness: twoReady,
    isInteractive: false,
    persistDefaultModel: async (selection) => {
      persisted.push(selection);
    },
  });

  assert.equal(result.status, "selected");
  assert.equal(result.model, "anthropic/claude-sonnet-4-5");
  assert.deepEqual(persisted, [
    { provider: "anthropic", modelId: "claude-sonnet-4-5" },
  ]);
});
```

Keep the existing non-ready test and update it to omit `prompt`.

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd .worktrees/init-model-selector-design
node --test src/cli/commands/init/pi-model-selection.test.ts
```

Expected: FAIL because the new options and result fields do not exist.

- [ ] **Step 3: Update `pi-model-selection.ts`**

Replace `src/cli/commands/init/pi-model-selection.ts` with:

```ts
import type { LocalPiDefaultModel } from "./pi-agent-settings.ts";
import { selectModelInteractively } from "./pi-model-selector.ts";
import {
  formatPiModelLabel,
  type PiModelChoice,
  type PiReadiness,
} from "./pi-preflight.ts";

export type PiModelSelection =
  | {
      status: "selected";
      model: string;
      provider: string;
      modelId: string;
      message: string;
    }
  | {
      status: "unavailable";
      reason: "not-ready" | "invalid-selection";
      message: string;
    };

export type SelectInteractiveModel = typeof selectModelInteractively;
export type PersistDefaultModel = (
  selection: LocalPiDefaultModel,
) => Promise<void>;

function selectedMessage(model: { label: string; value: string }): string {
  return `Using Pi model ${model.label}.`;
}

function toSelection(
  model: PiModelChoice,
): Extract<PiModelSelection, { status: "selected" }> {
  return {
    status: "selected",
    model: model.value,
    provider: model.provider,
    modelId: model.id,
    message: selectedMessage(model),
  };
}

function findCurrentDefault(
  models: PiModelChoice[],
  current: LocalPiDefaultModel | undefined,
): PiModelChoice | undefined {
  return current
    ? models.find(
        (model) =>
          model.provider === current.provider && model.id === current.modelId,
      )
    : undefined;
}

async function persistSelection(
  persistDefaultModel: PersistDefaultModel | undefined,
  model: PiModelChoice,
): Promise<void> {
  await persistDefaultModel?.({ provider: model.provider, modelId: model.id });
}

export async function selectPiModel(options: {
  readiness: PiReadiness;
  isInteractive: boolean;
  currentDefault?: LocalPiDefaultModel;
  selectModelInteractively?: SelectInteractiveModel;
  persistDefaultModel?: PersistDefaultModel;
}): Promise<PiModelSelection> {
  if (options.readiness.status !== "ready") {
    return {
      status: "unavailable",
      reason: "not-ready",
      message: options.readiness.message,
    };
  }

  const first = options.readiness.models[0];
  if (!first) {
    return {
      status: "unavailable",
      reason: "not-ready",
      message: "Pi did not report any provider/model with configured auth.",
    };
  }

  const select = options.selectModelInteractively ?? selectModelInteractively;
  const selected = options.isInteractive
    ? ((await select({
        models: options.readiness.models,
        current: options.currentDefault,
      })) ??
      findCurrentDefault(options.readiness.models, options.currentDefault) ??
      first)
    : (findCurrentDefault(options.readiness.models, options.currentDefault) ??
      first);

  await persistSelection(options.persistDefaultModel, selected);
  return toSelection({
    ...selected,
    label: formatPiModelLabel(selected),
  });
}
```

- [ ] **Step 4: Run model selection tests and verify they pass**

Run:

```bash
cd .worktrees/init-model-selector-design
node --test src/cli/commands/init/pi-model-selection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
cd .worktrees/init-model-selector-design
git add src/cli/commands/init/pi-model-selection.ts src/cli/commands/init/pi-model-selection.test.ts
git commit -m "feat(init): persist selected Pi model"
```

---

### Task 6: Wire local Pi agent state into `patchmill init`

**Files:**

- Modify: `src/cli/commands/init/main.ts`
- Modify: `src/cli/commands/init/main.test.ts`

- [ ] **Step 1: Write failing init integration tests**

In `src/cli/commands/init/main.test.ts`, add `stat` to the `node:fs/promises`
import:

```ts
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
```

Add this test near the existing Pi readiness tests:

```ts
test("runInit persists selected model to local Pi settings and smoke-tests it", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];
  let smokeModel: string | undefined;
  let smokeAgentDir: string | undefined;

  assert.equal(
    await runInit(
      ["--skills", "none"],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        isInteractive: true,
        setupLabels: async () => ({
          status: "skipped",
          message: "labels skipped",
        }),
        detectPiReadiness: () => ({
          status: "ready",
          message: "Pi reported 2 provider/model options with configured auth.",
          models: [
            {
              provider: "anthropic",
              providerName: "Anthropic",
              id: "claude-sonnet-4-5",
              label: "Anthropic / Claude Sonnet 4.5",
              value: "anthropic/claude-sonnet-4-5",
              authSource: "stored",
              reasoning: true,
              input: ["text"],
            },
            {
              provider: "openai-codex",
              providerName: "OpenAI Codex",
              id: "gpt-5.5",
              label: "OpenAI Codex / GPT-5.5",
              value: "openai-codex/gpt-5.5",
              authSource: "stored",
              reasoning: true,
              input: ["text"],
            },
          ],
        }),
        selectModelInteractively: async ({ models }) => models[1],
        runPiSmokeTest: async (_runner, options) => {
          smokeModel = options.model;
          smokeAgentDir = options.piAgentDir;
          return {
            status: "pass",
            message:
              "Pi completed the provider smoke test with openai-codex/gpt-5.5.",
            command: "pi smoke",
          };
        },
      },
    ),
    0,
  );

  assert.equal(smokeModel, "openai-codex/gpt-5.5");
  assert.equal(smokeAgentDir, join(repoRoot, ".patchmill", "pi-agent"));
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(repoRoot, ".patchmill", "pi-agent", "settings.json"),
        "utf8",
      ),
    ),
    {
      defaultProvider: "openai-codex",
      defaultModel: "gpt-5.5",
    },
  );
  assert.match(stdout.join("\n"), /Using Pi model OpenAI Codex \/ GPT-5\.5/);
});

test("runInit skips model selector and local settings when no models are available", async () => {
  const repoRoot = await tempRepo();
  let selectorCalled = false;

  assert.equal(
    await runInit(
      ["--skills", "none"],
      repoRoot,
      { stdout: () => undefined, stderr: () => undefined },
      {
        isInteractive: true,
        detectPiReadiness: missingPiReadiness,
        selectModelInteractively: async () => {
          selectorCalled = true;
          return undefined;
        },
        runPiSmokeTest: failingPiSmokeTest,
      },
    ),
    0,
  );

  assert.equal(selectorCalled, false);
  await assert.rejects(
    stat(join(repoRoot, ".patchmill", "pi-agent", "settings.json")),
    /ENOENT/u,
  );
});
```

- [ ] **Step 2: Run init tests and verify they fail**

Run:

```bash
cd .worktrees/init-model-selector-design
node --test src/cli/commands/init/main.test.ts
```

Expected: FAIL because `runInit` does not accept `selectModelInteractively`,
does not persist local settings, and does not pass `piAgentDir` to smoke tests.

- [ ] **Step 3: Update `main.ts` option types and imports**

In `src/cli/commands/init/main.ts`, add imports:

```ts
import {
  localPiAgentDir,
  readLocalPiDefaultModel,
  writeLocalPiDefaultModel,
} from "./pi-agent-settings.ts";
import type { SelectInteractiveModel } from "./pi-model-selection.ts";
```

Change `PiReadinessDetector` to accept options:

```ts
export type PiReadinessDetector = (options: {
  agentDir: string;
}) => PiReadiness;
```

Add this option to the `runInit` options object type:

```ts
selectModelInteractively?: SelectInteractiveModel;
```

- [ ] **Step 4: Wire local Pi state in `runInit`**

Before readiness detection, compute the local agent dir and current default:

```ts
const piAgentDir = localPiAgentDir(config.repoRoot);
let currentDefault: Awaited<ReturnType<typeof readLocalPiDefaultModel>>;
let settingsWarning: string | undefined;
try {
  currentDefault = await readLocalPiDefaultModel(piAgentDir);
} catch (error) {
  settingsWarning = `Could not read local Pi settings: ${error instanceof Error ? error.message : String(error)}`;
}
```

Replace readiness and selection with:

```ts
const readiness = (options.detectPiReadiness ?? detectPiReadiness)({
  agentDir: piAgentDir,
});
const selection = await selectPiModel({
  readiness,
  isInteractive,
  currentDefault,
  selectModelInteractively: options.selectModelInteractively,
  persistDefaultModel: (model) => writeLocalPiDefaultModel(piAgentDir, model),
});
```

Pass the local agent dir into the smoke test:

```ts
await (options.runPiSmokeTest ?? runPiSmokeTest)(createCommandRunner(), {
  repoRoot: config.repoRoot,
  piAgentDir,
  model:
    selection.status === "selected"
      ? selection.model
      : selectedModelFromReadiness(readiness),
});
```

Include `settingsWarning` in the final Pi message by appending it before
`piMessage`:

```ts
const piSettingsMessage = settingsWarning ? `${settingsWarning}\n\n` : "";
```

Then update the final stdout template to use:

```ts
${piSettingsMessage}${piMessage}
```

- [ ] **Step 5: Update stale prompt-based tests**

In `src/cli/commands/init/main.test.ts`, remove assertions that expect the old
prompt text `Select a Pi model`. For tests that need an interactive selected
model, pass:

```ts
selectModelInteractively: async ({ models }) => models[0],
```

For tests that verify invalid model input, replace the old invalid prompt test
with a cancellation fallback assertion:

```ts
test("runInit falls back to first model when interactive selector is cancelled", async () => {
  const repoRoot = await tempRepo();
  let smokeModel: string | undefined;

  assert.equal(
    await runInit(
      ["--skills", "none"],
      repoRoot,
      { stdout: () => undefined, stderr: () => undefined },
      {
        isInteractive: true,
        setupLabels: async () => ({
          status: "skipped",
          message: "labels skipped",
        }),
        detectPiReadiness: () => ({
          status: "ready",
          message: "Pi reported 1 provider/model option with configured auth.",
          models: [
            {
              provider: "anthropic",
              providerName: "Anthropic",
              id: "claude-sonnet-4-5",
              label: "Anthropic / Claude Sonnet 4.5",
              value: "anthropic/claude-sonnet-4-5",
              authSource: "stored",
              reasoning: true,
              input: ["text"],
            },
          ],
        }),
        selectModelInteractively: async () => undefined,
        runPiSmokeTest: async (_runner, options) => {
          smokeModel = options.model;
          return {
            status: "pass",
            message: "Pi completed the provider smoke test.",
            command: "pi smoke",
          };
        },
      },
    ),
    0,
  );

  assert.equal(smokeModel, "anthropic/claude-sonnet-4-5");
});
```

- [ ] **Step 6: Run init tests and verify they pass**

Run:

```bash
cd .worktrees/init-model-selector-design
node --test src/cli/commands/init/main.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
cd .worktrees/init-model-selector-design
git add src/cli/commands/init/main.ts src/cli/commands/init/main.test.ts
git commit -m "feat(init): wire local Pi model selection"
```

---

### Task 7: Full verification and cleanup

**Files:**

- Review all files changed by Tasks 1-6.
- Modify tests only if full-suite verification reveals a mismatch introduced by
  this feature.

- [ ] **Step 1: Run the full test suite**

Run:

```bash
cd .worktrees/init-model-selector-design
npm test
```

Expected: PASS with all tests passing.

- [ ] **Step 2: Run lint**

Run:

```bash
cd .worktrees/init-model-selector-design
npm run lint
```

Expected: PASS for Prettier, ESLint, and markdownlint.

- [ ] **Step 3: Run build**

Run:

```bash
cd .worktrees/init-model-selector-design
npm run build
```

Expected: PASS and `dist/` generated successfully.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
cd .worktrees/init-model-selector-design
git diff --stat main...HEAD
git diff --check main...HEAD
```

Expected: diff includes only the spec, plan, and init model selector
implementation; `git diff --check` prints no whitespace errors.

- [ ] **Step 5: Commit the plan document if it is still uncommitted**

```bash
cd .worktrees/init-model-selector-design
git add docs/plans/2026-06-02-patchmill-init-model-selector.md
git commit -m "docs(init): plan interactive model selector"
```

If the plan was already committed before implementation began, skip this
command.

---

## Self-review

Spec coverage:

- Available models only: Task 3 filters and Task 5 selects from
  `readiness.models` only.
- Searchable ten-row UI: Tasks 3 and 4 implement query filtering and ten visible
  rows.
- Count display: Task 3 implements `(selected/filtered)` formatting.
- Repo-local Pi settings: Tasks 1 and 6 use `.patchmill/pi-agent/settings.json`.
- `defaultProvider` and `defaultModel`: Task 1 writes both keys and preserves
  unrelated settings.
- Smoke test uses selected model: Task 6 passes `selection.model` to
  `runPiSmokeTest`.
- Local Pi auth/config scope: Task 2 and Task 6 pass `PI_CODING_AGENT_DIR` and
  `agentDir`.
- No models available: Task 6 preserves existing incomplete setup guidance and
  skips selector.
- Non-interactive mode: Task 5 keeps deterministic first/current default model
  selection.

Placeholder scan: no placeholder steps remain. Each code-changing step includes
concrete code or exact replacement instructions.

Type consistency: `LocalPiDefaultModel`, `PiModelChoice`, `PiModelSelection`,
`SelectInteractiveModel`, and `PersistDefaultModel` are introduced before later
tasks reference them.
