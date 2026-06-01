# Pi Provider Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `patchmill init` configure and verify Pi provider readiness
before sending users to `triage --dry-run`.

**Architecture:** Add focused init modules for Pi readiness, smoke testing, and
setup prompting. Pi readiness must use Pi's existing `ModelRegistry` and
`AuthStorage` implementation instead of Patchmill duplicating
provider/API-key/auth-file detection. `init` orchestrates these modules after
Patchmill config/skill/label setup and before final next-step output.

**Tech Stack:** TypeScript ESM on NodeNext, `node:test`, Patchmill
`CommandRunner`, Pi public exports from `@earendil-works/pi-coding-agent`
(`AuthStorage`, `ModelRegistry`, config path helpers).

---

## Spec and context

- Spec: `docs/specs/2026-05-31-pi-provider-onboarding-design.md`
- Review adjustment: the implementation should not create a fake
  `pi-setup-wizard` that merely points users at unconstrained Pi `/login`. Until
  Patchmill can call a stable Pi login API, keep setup remediation explicit and
  implement only Pi-backed readiness, model selection, and smoke testing.
- Current direct provider probing: `src/cli/commands/init/pi-preflight.ts`
- Current init orchestration: `src/cli/commands/init/main.ts:206-238`
- Current doctor Pi smoke test: `src/cli/commands/doctor/checks.ts`
- Shared command runner type: `src/cli/commands/triage/types.ts`

## File structure

- Modify `package.json`, `package-lock.json`, `npm-shrinkwrap.json`: add direct
  runtime dependency on `@earendil-works/pi-coding-agent` so Patchmill can use
  Pi's public model/auth implementation.
- Replace `src/cli/commands/init/pi-preflight.ts`: expose Pi-backed readiness
  detection while keeping test injection seams.
- Modify `src/cli/commands/init/pi-preflight.test.ts`: verify readiness through
  a fake Pi registry rather than env/auth-file parsing.
- Create `src/cli/commands/init/pi-smoke-test.ts`: run and classify the
  `PATCHMILL_PI_OK` Pi print-mode smoke test.
- Create `src/cli/commands/init/pi-smoke-test.test.ts`: unit-test command
  construction and success/failure classification.
- Create `src/cli/commands/init/pi-setup-wizard.ts`: provide the first embedded
  setup prompt flow using Pi-discovered models and explicit manual remediation
  text.
- Create `src/cli/commands/init/pi-setup-wizard.test.ts`: unit-test interactive,
  non-interactive, and `--yes` behavior without launching Pi.
- Modify `src/cli/commands/init/main.ts`: wire readiness, wizard, and smoke test
  into `runInit` options and final output.
- Modify `src/cli/commands/init/main.test.ts`: cover init output and
  orchestration.
- Modify `src/cli/commands/doctor/checks.ts`: reuse the smoke-test helper so
  init and doctor construct the same Pi check.
- Modify `src/cli/commands/doctor/checks.test.ts`: update assertions only where
  command construction or remediation text changes.
- Modify `docs/configuration.md` and `docs/issue-agent-workflows.md`: document
  that `init` now verifies Pi provider readiness.

---

### Task 1: Add Pi-backed readiness detection

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `npm-shrinkwrap.json`
- Modify: `src/cli/commands/init/pi-preflight.ts`
- Modify: `src/cli/commands/init/pi-preflight.test.ts`

- [ ] **Step 1: Add direct Pi dependency**

Run:

```bash
npm install @earendil-works/pi-coding-agent@^0.77.0
```

Expected:

- `package.json` contains `"@earendil-works/pi-coding-agent": "^0.77.0"` in
  `dependencies`.
- `package-lock.json` and `npm-shrinkwrap.json` are updated.

- [ ] **Step 2: Replace direct env/auth-file tests with Pi registry tests**

Replace `src/cli/commands/init/pi-preflight.test.ts` with:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  detectPiReadiness,
  formatPiModelLabel,
  type PiRegistryLike,
} from "./pi-preflight.ts";

function registry(
  models: PiRegistryLike["getAvailable"] extends () => infer T ? T : never,
): PiRegistryLike {
  return {
    getAvailable: () => models,
    getError: () => undefined,
    getProviderAuthStatus: (provider) => ({
      configured: models.some((model) => model.provider === provider),
      source: "stored",
    }),
    getProviderDisplayName: (provider) =>
      provider === "anthropic" ? "Anthropic" : provider,
  };
}

test("detectPiReadiness reports ready when Pi registry has available models", () => {
  const readiness = detectPiReadiness({
    registry: registry([
      {
        provider: "anthropic",
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        reasoning: true,
        input: ["text"],
      },
    ]),
  });

  assert.equal(readiness.status, "ready");
  assert.equal(readiness.models.length, 1);
  assert.deepEqual(readiness.models[0], {
    provider: "anthropic",
    providerName: "Anthropic",
    id: "claude-sonnet-4-5",
    label: "Anthropic / Claude Sonnet 4.5",
    value: "anthropic/claude-sonnet-4-5",
    authSource: "stored",
    reasoning: true,
    input: ["text"],
  });
});

test("detectPiReadiness reports missing when Pi registry has no available models", () => {
  const readiness = detectPiReadiness({ registry: registry([]) });

  assert.deepEqual(readiness, {
    status: "missing",
    models: [],
    message: "Pi did not report any provider/model with configured auth.",
  });
});

test("detectPiReadiness reports error when Pi registry cannot load models", () => {
  const readiness = detectPiReadiness({
    registry: {
      getAvailable: () => [],
      getError: () => "bad models.json",
      getProviderAuthStatus: () => ({ configured: false }),
      getProviderDisplayName: (provider) => provider,
    },
  });

  assert.deepEqual(readiness, {
    status: "error",
    models: [],
    message:
      "Pi model registry could not load provider configuration: bad models.json",
  });
});

test("formatPiModelLabel falls back to provider and id", () => {
  assert.equal(
    formatPiModelLabel({
      provider: "openai",
      providerName: "openai",
      id: "gpt-4.1",
      label: "openai / gpt-4.1",
      value: "openai/gpt-4.1",
      reasoning: false,
      input: ["text"],
    }),
    "openai/gpt-4.1",
  );
});
```

- [ ] **Step 3: Run the new failing test**

Run:

```bash
node --test src/cli/commands/init/pi-preflight.test.ts
```

Expected: FAIL because `PiRegistryLike`, `detectPiReadiness`, and
`formatPiModelLabel` do not exist yet.

- [ ] **Step 4: Implement Pi-backed readiness**

Replace `src/cli/commands/init/pi-preflight.ts` with:

```ts
import {
  AuthStorage,
  getAuthPath,
  getModelsPath,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";

type PiAuthStatus = {
  configured: boolean;
  source?:
    | "stored"
    | "runtime"
    | "environment"
    | "fallback"
    | "models_json_key"
    | "models_json_command";
  label?: string;
};

type PiRegistryModel = {
  provider: string;
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: string[];
};

export type PiRegistryLike = {
  getAvailable(): PiRegistryModel[];
  getError(): string | undefined;
  getProviderAuthStatus(provider: string): PiAuthStatus;
  getProviderDisplayName(provider: string): string;
};

export type PiModelChoice = {
  provider: string;
  providerName: string;
  id: string;
  label: string;
  value: string;
  authSource?: PiAuthStatus["source"];
  reasoning: boolean;
  input: string[];
};

export type PiReadiness =
  | {
      status: "ready";
      models: PiModelChoice[];
      message: string;
    }
  | {
      status: "missing" | "error";
      models: PiModelChoice[];
      message: string;
    };

export function createPiRegistry(): PiRegistryLike {
  const auth = AuthStorage.create(getAuthPath());
  const registry = ModelRegistry.create(auth, getModelsPath());
  registry.refresh();
  return registry;
}

function toChoice(
  registry: PiRegistryLike,
  model: PiRegistryModel,
): PiModelChoice {
  const providerName = registry.getProviderDisplayName(model.provider);
  const label = `${providerName} / ${model.name ?? model.id}`;
  return {
    provider: model.provider,
    providerName,
    id: model.id,
    label,
    value: `${model.provider}/${model.id}`,
    authSource: registry.getProviderAuthStatus(model.provider).source,
    reasoning: model.reasoning ?? false,
    input: model.input ?? ["text"],
  };
}

export function formatPiModelLabel(model: PiModelChoice): string {
  if (
    model.providerName === model.provider &&
    model.label === `${model.provider} / ${model.id}`
  ) {
    return model.value;
  }
  return model.label;
}

export function detectPiReadiness(
  options: { registry?: PiRegistryLike } = {},
): PiReadiness {
  const registry = options.registry ?? createPiRegistry();
  const loadError = registry.getError();
  if (loadError) {
    return {
      status: "error",
      models: [],
      message: `Pi model registry could not load provider configuration: ${loadError}`,
    };
  }

  const models = registry
    .getAvailable()
    .map((model) => toChoice(registry, model));
  if (models.length === 0) {
    return {
      status: "missing",
      models: [],
      message: "Pi did not report any provider/model with configured auth.",
    };
  }

  return {
    status: "ready",
    models,
    message: `Pi reported ${models.length} provider/model option${models.length === 1 ? "" : "s"} with configured auth.`,
  };
}
```

- [ ] **Step 5: Run the readiness test**

Run:

```bash
node --test src/cli/commands/init/pi-preflight.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add package.json package-lock.json npm-shrinkwrap.json \
  src/cli/commands/init/pi-preflight.ts \
  src/cli/commands/init/pi-preflight.test.ts
git commit -m "feat(init): detect Pi readiness via Pi registry"
```

---

### Task 2: Add shared Pi smoke-test helper

**Files:**

- Create: `src/cli/commands/init/pi-smoke-test.ts`
- Create: `src/cli/commands/init/pi-smoke-test.test.ts`

- [ ] **Step 1: Write smoke-test unit tests**

Create `src/cli/commands/init/pi-smoke-test.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { runPiSmokeTest } from "./pi-smoke-test.ts";
import type { CommandRunner } from "../triage/types.ts";

function runner(result: {
  code: number;
  stdout?: string;
  stderr?: string;
}): CommandRunner & {
  calls: Array<{ command: string; args: string[]; cwd?: string }>;
} {
  const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
  return {
    calls,
    async run(command, args, options = {}) {
      calls.push({ command, args, cwd: options.cwd });
      return { stdout: "", stderr: "", ...result };
    },
  };
}

test("runPiSmokeTest succeeds when Pi prints sentinel", async () => {
  const fake = runner({ code: 0, stdout: "PATCHMILL_PI_OK\n" });

  const result = await runPiSmokeTest(fake, {
    repoRoot: "/repo",
    model: "anthropic/claude-sonnet-4-5",
  });

  assert.deepEqual(result, {
    status: "pass",
    message:
      "Pi completed the provider smoke test with anthropic/claude-sonnet-4-5.",
    command:
      "pi --no-session --no-context-files --no-prompt-templates --model anthropic/claude-sonnet-4-5 -p Reply with PATCHMILL_PI_OK and nothing else.",
  });
  assert.deepEqual(fake.calls, [
    {
      command: "pi",
      cwd: "/repo",
      args: [
        "--no-session",
        "--no-context-files",
        "--no-prompt-templates",
        "--model",
        "anthropic/claude-sonnet-4-5",
        "-p",
        "Reply with PATCHMILL_PI_OK and nothing else.",
      ],
    },
  ]);
});

test("runPiSmokeTest omits model when no model is selected", async () => {
  const fake = runner({ code: 0, stdout: "PATCHMILL_PI_OK\n" });

  await runPiSmokeTest(fake, { repoRoot: "/repo" });

  assert.deepEqual(fake.calls[0]?.args, [
    "--no-session",
    "--no-context-files",
    "--no-prompt-templates",
    "-p",
    "Reply with PATCHMILL_PI_OK and nothing else.",
  ]);
});

test("runPiSmokeTest fails when Pi exits non-zero", async () => {
  const fake = runner({ code: 1, stderr: "missing key" });

  const result = await runPiSmokeTest(fake, { repoRoot: "/repo" });

  assert.equal(result.status, "fail");
  assert.match(result.message, /Pi could not complete the provider smoke test/);
  assert.match(result.details, /missing key/);
});

test("runPiSmokeTest fails when sentinel is absent", async () => {
  const fake = runner({ code: 0, stdout: "hello\n" });

  const result = await runPiSmokeTest(fake, { repoRoot: "/repo" });

  assert.equal(result.status, "fail");
  assert.match(result.details, /hello/);
});
```

- [ ] **Step 2: Run the failing smoke-test tests**

Run:

```bash
node --test src/cli/commands/init/pi-smoke-test.test.ts
```

Expected: FAIL because `pi-smoke-test.ts` does not exist.

- [ ] **Step 3: Implement smoke-test helper**

Create `src/cli/commands/init/pi-smoke-test.ts`:

```ts
import type { CommandRunner } from "../triage/types.ts";

const PI_SMOKE_PROMPT = "Reply with PATCHMILL_PI_OK and nothing else.";
const PI_SMOKE_SENTINEL = "PATCHMILL_PI_OK";

export type PiSmokeTestResult = {
  status: "pass" | "fail";
  message: string;
  command: string;
  details?: string;
};

function shellQuote(value: string): string {
  return /\s/u.test(value) ? value : value;
}

function formatCommand(args: string[]): string {
  return ["pi", ...args.map(shellQuote)].join(" ");
}

function commandOutput(stdout: string, stderr: string): string {
  return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
}

export async function runPiSmokeTest(
  runner: CommandRunner,
  options: { repoRoot: string; model?: string },
): Promise<PiSmokeTestResult> {
  const args = ["--no-session", "--no-context-files", "--no-prompt-templates"];
  if (options.model) args.push("--model", options.model);
  args.push("-p", PI_SMOKE_PROMPT);

  const result = await runner.run("pi", args, { cwd: options.repoRoot });
  const command = formatCommand(args);
  if (result.code === 0 && result.stdout.includes(PI_SMOKE_SENTINEL)) {
    return {
      status: "pass",
      message: `Pi completed the provider smoke test${options.model ? ` with ${options.model}` : ""}.`,
      command,
    };
  }

  return {
    status: "fail",
    message: "Pi could not complete the provider smoke test.",
    command,
    details:
      commandOutput(result.stdout, result.stderr) || `exit code ${result.code}`,
  };
}
```

- [ ] **Step 4: Run smoke-test tests**

Run:

```bash
node --test src/cli/commands/init/pi-smoke-test.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/cli/commands/init/pi-smoke-test.ts \
  src/cli/commands/init/pi-smoke-test.test.ts
git commit -m "feat(init): add Pi provider smoke test helper"
```

---

### Task 3: Add setup wizard decision module

**Files:**

- Create: `src/cli/commands/init/pi-setup-wizard.ts`
- Create: `src/cli/commands/init/pi-setup-wizard.test.ts`

- [ ] **Step 1: Write setup wizard tests**

Create `src/cli/commands/init/pi-setup-wizard.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { runPiSetupWizard, type SetupPrompt } from "./pi-setup-wizard.ts";
import type { PiModelChoice, PiReadiness } from "./pi-preflight.ts";

const model: PiModelChoice = {
  provider: "anthropic",
  providerName: "Anthropic",
  id: "claude-sonnet-4-5",
  label: "Anthropic / Claude Sonnet 4.5",
  value: "anthropic/claude-sonnet-4-5",
  authSource: "stored",
  reasoning: true,
  input: ["text"],
};

function prompt(answers: string[]): SetupPrompt & { questions: string[] } {
  const questions: string[] = [];
  return Object.assign(
    async (question: string) => {
      questions.push(question);
      return answers.shift() ?? "";
    },
    { questions },
  );
}

test("runPiSetupWizard accepts existing ready model", async () => {
  const ask = prompt(["", "1"]);
  const result = await runPiSetupWizard({
    readiness: { status: "ready", models: [model], message: "ready" },
    isInteractive: true,
    assumeYes: false,
    prompt: ask,
  });

  assert.deepEqual(result, {
    status: "selected",
    model: "anthropic/claude-sonnet-4-5",
    message: "Using Pi model Anthropic / Claude Sonnet 4.5.",
  });
});

test("runPiSetupWizard lets user skip existing config", async () => {
  const ask = prompt(["n"]);
  const result = await runPiSetupWizard({
    readiness: { status: "ready", models: [model], message: "ready" },
    isInteractive: true,
    assumeYes: false,
    prompt: ask,
  });

  assert.equal(result.status, "manual");
  assert.match(result.message, /Pi setup was left unchanged/);
});

test("runPiSetupWizard prints manual instructions when missing and non-interactive", async () => {
  const result = await runPiSetupWizard({
    readiness: {
      status: "missing",
      models: [],
      message: "Pi did not report any provider/model with configured auth.",
    },
    isInteractive: false,
    assumeYes: false,
    prompt: prompt([]),
  });

  assert.equal(result.status, "manual");
  assert.match(result.message, /Run `pi`, then `\/login`/);
});

test("runPiSetupWizard does not invent credentials under --yes", async () => {
  const result = await runPiSetupWizard({
    readiness: {
      status: "missing",
      models: [],
      message: "Pi did not report any provider/model with configured auth.",
    },
    isInteractive: true,
    assumeYes: true,
    prompt: prompt([]),
  });

  assert.equal(result.status, "manual");
  assert.match(
    result.message,
    /--yes does not choose or create Pi credentials/,
  );
});

for (const answer of ["2", "anthropic/claude-haiku-4-5"]) {
  test(`runPiSetupWizard accepts manual model entry after ${answer}`, async () => {
    const ask = prompt(["y", answer]);
    const readiness: PiReadiness = {
      status: "missing",
      models: [],
      message: "Pi did not report any provider/model with configured auth.",
    };

    const result = await runPiSetupWizard({
      readiness,
      isInteractive: true,
      assumeYes: false,
      prompt: ask,
    });

    if (answer === "2") {
      assert.equal(result.status, "manual");
      assert.match(result.message, /Run `pi`, then `\/login`/);
    } else {
      assert.deepEqual(result, {
        status: "selected",
        model: "anthropic/claude-haiku-4-5",
        message: "Using manually entered Pi model anthropic/claude-haiku-4-5.",
      });
    }
  });
}
```

- [ ] **Step 2: Run the failing wizard tests**

Run:

```bash
node --test src/cli/commands/init/pi-setup-wizard.test.ts
```

Expected: FAIL because `pi-setup-wizard.ts` does not exist.

- [ ] **Step 3: Implement setup wizard module**

Create `src/cli/commands/init/pi-setup-wizard.ts`:

```ts
import { formatPiModelLabel, type PiReadiness } from "./pi-preflight.ts";

export type SetupPrompt = (question: string) => Promise<string>;

export type PiSetupWizardResult =
  | { status: "selected"; model: string; message: string }
  | { status: "manual"; message: string };

const MANUAL_SETUP = [
  "Run `pi`, then `/login` to configure a provider using Pi's native login flow.",
  "After login, rerun `patchmill init` or `patchmill doctor`.",
].join("\n");

function isYes(value: string): boolean {
  return /^(|y|yes)$/iu.test(value.trim());
}

function isNo(value: string): boolean {
  return /^(n|no)$/iu.test(value.trim());
}

function isModelValue(value: string): boolean {
  return /^[^\s/]+\/.+$/u.test(value.trim());
}

function modelMenu(readiness: PiReadiness): string {
  if (readiness.models.length === 0) return "";
  return readiness.models
    .map(
      (model, index) =>
        `  ${index + 1}. ${formatPiModelLabel(model)} (${model.value})`,
    )
    .join("\n");
}

export async function runPiSetupWizard(options: {
  readiness: PiReadiness;
  isInteractive: boolean;
  assumeYes: boolean;
  prompt: SetupPrompt;
}): Promise<PiSetupWizardResult> {
  if (!options.isInteractive) {
    return { status: "manual", message: MANUAL_SETUP };
  }

  if (options.assumeYes && options.readiness.status !== "ready") {
    return {
      status: "manual",
      message: `--yes does not choose or create Pi credentials.\n${MANUAL_SETUP}`,
    };
  }

  if (options.readiness.status === "ready") {
    const useExisting = await options.prompt(
      `${options.readiness.message}\nUse existing Pi provider/model configuration? [Y/n] `,
    );
    if (isNo(useExisting)) {
      return {
        status: "manual",
        message: `Pi setup was left unchanged.\n${MANUAL_SETUP}`,
      };
    }

    const menu = modelMenu(options.readiness);
    const answer = await options.prompt(
      `Select a Pi model for the smoke test:\n${menu}\nChoose 1-${options.readiness.models.length} or enter provider/model [1]: `,
    );
    const trimmed = answer.trim();
    const index = trimmed === "" ? 0 : Number.parseInt(trimmed, 10) - 1;
    const selected = Number.isInteger(index)
      ? options.readiness.models[index]
      : undefined;
    if (selected) {
      return {
        status: "selected",
        model: selected.value,
        message: `Using Pi model ${formatPiModelLabel(selected)}.`,
      };
    }
    if (isModelValue(trimmed)) {
      return {
        status: "selected",
        model: trimmed,
        message: `Using manually entered Pi model ${trimmed}.`,
      };
    }
    return {
      status: "selected",
      model: options.readiness.models[0]?.value ?? "",
      message: `Using Pi model ${formatPiModelLabel(options.readiness.models[0]!)}.`,
    };
  }

  const configure = await options.prompt(
    `${options.readiness.message}\nConfigure Pi now using Pi's native /login flow, then enter a provider/model for the smoke test? [y/N] `,
  );
  if (!isYes(configure)) {
    return { status: "manual", message: MANUAL_SETUP };
  }

  const model = await options.prompt(
    "After completing `pi` + `/login`, enter the Pi model as provider/model, or press Enter for manual setup instructions: ",
  );
  const trimmed = model.trim();
  if (isModelValue(trimmed)) {
    return {
      status: "selected",
      model: trimmed,
      message: `Using manually entered Pi model ${trimmed}.`,
    };
  }

  return { status: "manual", message: MANUAL_SETUP };
}
```

- [ ] **Step 4: Run wizard tests**

Run:

```bash
node --test src/cli/commands/init/pi-setup-wizard.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/cli/commands/init/pi-setup-wizard.ts \
  src/cli/commands/init/pi-setup-wizard.test.ts
git commit -m "feat(init): add Pi setup wizard decision flow"
```

---

### Task 4: Wire readiness, wizard, and smoke test into init

**Files:**

- Modify: `src/cli/commands/init/main.ts`
- Modify: `src/cli/commands/init/main.test.ts`

- [ ] **Step 1: Add focused init orchestration tests**

Append these tests to `src/cli/commands/init/main.test.ts`:

```ts
test("runInit runs Pi smoke test when Pi readiness is available", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];
  let smokeModel: string | undefined;

  assert.equal(
    await runInit(
      [],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        isInteractive: false,
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
        runPiSmokeTest: async (_runner, options) => {
          smokeModel = options.model;
          return {
            status: "pass",
            message:
              "Pi completed the provider smoke test with anthropic/claude-sonnet-4-5.",
            command:
              "pi --no-session --no-context-files --no-prompt-templates --model anthropic/claude-sonnet-4-5 -p Reply with PATCHMILL_PI_OK and nothing else.",
          };
        },
      },
    ),
    0,
  );

  assert.equal(smokeModel, "anthropic/claude-sonnet-4-5");
  assert.match(stdout.join("\n"), /Pi completed the provider smoke test/);
  assert.match(stdout.join("\n"), /Next:\n  patchmill triage --dry-run/);
});

test("runInit keeps config but reports incomplete Pi setup when smoke test fails", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];

  assert.equal(
    await runInit(
      [],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        isInteractive: false,
        setupLabels: async () => ({
          status: "skipped",
          message: "labels skipped",
        }),
        detectPiReadiness: () => ({
          status: "missing",
          message: "Pi did not report any provider/model with configured auth.",
          models: [],
        }),
        runPiSmokeTest: async () => ({
          status: "fail",
          message: "Pi could not complete the provider smoke test.",
          command:
            "pi --no-session --no-context-files --no-prompt-templates -p Reply with PATCHMILL_PI_OK and nothing else.",
          details: "missing key",
        }),
      },
    ),
    0,
  );

  assert.match(stdout.join("\n"), /Pi setup is incomplete/);
  assert.match(stdout.join("\n"), /missing key/);
  assert.match(stdout.join("\n"), /Next:\n  patchmill doctor/);
  assert.doesNotMatch(
    await readFile(join(repoRoot, "patchmill.config.json"), "utf8"),
    /missing key|sk-/u,
  );
});
```

If `main.test.ts` already has helper names that conflict, keep the assertions
and adjust local variable names only.

- [ ] **Step 2: Run the failing init tests**

Run:

```bash
node --test src/cli/commands/init/main.test.ts
```

Expected: FAIL because `runInit` does not accept the new injected
`detectPiReadiness` and `runPiSmokeTest` options.

- [ ] **Step 3: Update imports and option types in init**

In `src/cli/commands/init/main.ts`, replace the preflight import:

```ts
import { detectPiReadiness, type PiReadiness } from "./pi-preflight.ts";
import {
  runPiSetupWizard,
  type PiSetupWizardResult,
} from "./pi-setup-wizard.ts";
import { runPiSmokeTest, type PiSmokeTestResult } from "./pi-smoke-test.ts";
```

Add option types near existing `PiLauncher` types:

```ts
export type PiReadinessDetector = () => PiReadiness;
export type PiSmokeTestRunner = typeof runPiSmokeTest;
```

Add to the `runInit` options object type:

```ts
detectPiReadiness?: PiReadinessDetector;
runPiSmokeTest?: PiSmokeTestRunner;
```

Keep `launchPi` and `checkPiAvailable` only if other tests still rely on them
during the transition; remove them in a later cleanup task if unused.

- [ ] **Step 4: Add Pi output formatting helpers**

In `src/cli/commands/init/main.ts`, replace `successNextSteps()` with:

```ts
function nextSteps(piReady: boolean) {
  return piReady
    ? "Run `patchmill triage --dry-run` to preview issue triage.\n\nNext:\n  patchmill triage --dry-run"
    : "Run `patchmill doctor` after completing Pi setup.\n\nNext:\n  patchmill doctor";
}

function selectedModelFromReadiness(
  readiness: PiReadiness,
): string | undefined {
  return readiness.status === "ready" ? readiness.models[0]?.value : undefined;
}

function formatPiSetupMessage(
  readiness: PiReadiness,
  setup: PiSetupWizardResult,
  smoke: PiSmokeTestResult,
): string {
  const setupMessage = setup.message;
  if (smoke.status === "pass") {
    return [readiness.message, setupMessage, smoke.message].join("\n\n");
  }
  return [
    readiness.message,
    setupMessage,
    "Pi setup is incomplete.",
    smoke.message,
    smoke.details ? `Details:\n${smoke.details}` : undefined,
    "Configure Pi using `pi` and `/login`, then rerun `patchmill doctor`.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
```

- [ ] **Step 5: Replace old Pi provider block**

In `src/cli/commands/init/main.ts`, replace lines equivalent to the old
`hasApparentPiProviderConfig` block with:

```ts
const readiness = (options.detectPiReadiness ?? detectPiReadiness)();
const setup = await runPiSetupWizard({
  readiness,
  isInteractive,
  assumeYes: config.yes,
  prompt: options.prompt ?? defaultPrompt,
});
const smoke = await (options.runPiSmokeTest ?? runPiSmokeTest)(
  createCommandRunner(),
  {
    repoRoot: config.repoRoot,
    model:
      setup.status === "selected"
        ? setup.model
        : selectedModelFromReadiness(readiness),
  },
);
const piReady = smoke.status === "pass";
const piMessage = formatPiSetupMessage(readiness, setup, smoke);
```

Update final output to call `nextSteps(piReady)` instead of
`successNextSteps()`.

- [ ] **Step 6: Run init tests**

Run:

```bash
node --test src/cli/commands/init/main.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/cli/commands/init/main.ts src/cli/commands/init/main.test.ts
git commit -m "feat(init): verify Pi provider during init"
```

---

### Task 5: Reuse smoke-test helper from doctor

**Files:**

- Modify: `src/cli/commands/doctor/checks.ts`
- Modify: `src/cli/commands/doctor/checks.test.ts`

- [ ] **Step 1: Add/adjust doctor test expectation**

In `src/cli/commands/doctor/checks.test.ts`, keep the existing successful mock
command:

```ts
"pi --no-session --no-context-files --no-prompt-templates -p Reply with PATCHMILL_PI_OK and nothing else.": {
  code: 0,
  stdout: "PATCHMILL_PI_OK\n",
},
```

Add an assertion in the existing Pi provider failure test, or create a new test
if none exists:

```ts
assert.match(
  results
    .find((result) => result.name === "pi provider")
    ?.remediation?.join("\n") ?? "",
  /patchmill init/,
);
```

- [ ] **Step 2: Run doctor checks tests before implementation**

Run:

```bash
node --test src/cli/commands/doctor/checks.test.ts
```

Expected: FAIL if the new remediation assertion is not yet satisfied.

- [ ] **Step 3: Replace duplicate doctor smoke-test command construction**

In `src/cli/commands/doctor/checks.ts`, import:

```ts
import { runPiSmokeTest } from "../init/pi-smoke-test.ts";
```

Replace the body of `checkPiProvider()` with:

```ts
async function checkPiProvider(
  runner: CommandRunner,
  repoRoot: string,
): Promise<DoctorCheckResult> {
  const result = await runPiSmokeTest(runner, { repoRoot });
  if (result.status === "pass") {
    return pass("pi provider", "minimal LLM smoke test succeeded");
  }
  return fail(
    "pi provider",
    "Pi could not complete a minimal LLM smoke test",
    [
      "Patchmill doctor did not change the repository or issue host.",
      "The Pi check made no Patchmill workflow changes, but it could not reach a configured model provider.",
      "",
      "Run Patchmill's guided setup, then rerun doctor:",
      "  patchmill init",
      "  patchmill doctor",
      "",
      "Manual Pi setup is also supported:",
      "  pi",
      "  /login",
      "  patchmill doctor",
      "",
      result.details ? `Details: ${result.details}` : "",
    ].filter(Boolean),
  );
}
```

- [ ] **Step 4: Run doctor tests**

Run:

```bash
node --test src/cli/commands/doctor/checks.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/cli/commands/doctor/checks.ts src/cli/commands/doctor/checks.test.ts
git commit -m "refactor(doctor): share Pi smoke test"
```

---

### Task 6: Update docs and user-facing workflow text

**Files:**

- Modify: `docs/configuration.md`
- Modify: `docs/issue-agent-workflows.md`
- Modify: `src/cli/commands/init/main.test.ts`

- [ ] **Step 1: Update configuration docs**

In `docs/configuration.md`, update the `Creating the initial config` section so
it states:

````md
Run `patchmill init` to create the smallest useful `patchmill.config.json` for a
repository. Init also checks Pi provider readiness through Pi's own model/auth
registry, guides you to Pi login/model setup when needed, and runs a minimal Pi
smoke test. When the smoke test passes, continue with:

```sh
patchmill triage --dry-run
```

If the smoke test fails, complete Pi setup with `pi` and `/login`, then run
`patchmill doctor`.
````

Keep the existing host provider and skill mapping details in the same section.

- [ ] **Step 2: Update workflow docs**

In `docs/issue-agent-workflows.md`, change the first-use flow from:

```sh
patchmill init
patchmill doctor
patchmill triage --dry-run
```

to:

```sh
patchmill init
patchmill triage --dry-run
```

Then add a sentence after the command block:

```md
`init` creates local Patchmill config, checks Pi provider readiness using Pi's
own model/auth implementation, and runs a minimal Pi smoke test. Use
`patchmill doctor` when you want a full troubleshooting checklist or when the
init smoke test reports incomplete setup.
```

- [ ] **Step 3: Update init output tests for next command**

If existing `main.test.ts` assertions still expect `patchmill doctor` after a
successful smoke test, change only those assertions to expect:

```ts
assert.match(stdout.join("\n"), /Next:\n  patchmill triage --dry-run/);
```

Failure-path assertions should continue to expect:

```ts
assert.match(stdout.join("\n"), /Next:\n  patchmill doctor/);
```

- [ ] **Step 4: Run docs lint and init tests**

Run:

```bash
node --test src/cli/commands/init/main.test.ts
npx markdownlint-cli2 docs/configuration.md docs/issue-agent-workflows.md
```

Expected: both commands PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add docs/configuration.md docs/issue-agent-workflows.md \
  src/cli/commands/init/main.test.ts
git commit -m "docs(init): document Pi provider onboarding"
```

---

### Task 7: Full verification and cleanup

**Files:**

- Review: `src/cli/commands/init/*.ts`
- Review: `src/cli/commands/doctor/checks.ts`
- Review: `package.json`, lockfiles

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test src/cli/commands/init/*.test.ts src/cli/commands/doctor/*.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS with zero failures.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Confirm no secrets entered repo config or tests**

Run:

```bash
rg -n "sk-|ANTHROPIC_API_KEY=.*[A-Za-z0-9]|OPENAI_API_KEY=.*[A-Za-z0-9]|GEMINI_API_KEY=.*[A-Za-z0-9]" \
  src docs package.json package-lock.json npm-shrinkwrap.json
```

Expected: no output. Test strings such as provider names without key material
are acceptable; if this command prints a real-looking secret value, remove it
before committing.

- [ ] **Step 5: Check git status and final diff**

Run:

```bash
git status --short
git diff --stat origin/main...HEAD
```

Expected:

- No unexpected untracked files.
- Diff contains only dependency metadata, init/doctor implementation/tests, and
  docs.

- [ ] **Step 6: Commit final cleanup if needed**

If formatting, lint, or cleanup changed files, run:

```bash
git add <changed-files>
git commit -m "chore(init): finalize Pi onboarding verification"
```

If no files changed, do not create an empty commit.

---

## Execution order

Implement tasks in order. Do not start Task 4 before Tasks 1-3 are committed,
because `main.ts` needs the readiness, wizard, and smoke-test seams. After each
task, review the staged diff before committing.

## Self-review notes

- Spec coverage: the plan uses Pi's own readiness implementation through
  `ModelRegistry` and `AuthStorage`; keeps credentials user-level; embeds init
  setup prompting; runs init smoke test; keeps doctor as troubleshooting; covers
  non-interactive and `--yes` behavior; adds tests and docs.
- Placeholder scan: this plan contains no placeholder markers, no omitted
  implementation steps, and no unscoped edge-case instructions.
- Type consistency: `PiReadiness`, `PiModelChoice`, `PiSetupWizardResult`, and
  `PiSmokeTestResult` are defined before later tasks consume them.
