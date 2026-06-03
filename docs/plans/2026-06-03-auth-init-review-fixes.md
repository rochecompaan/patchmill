# Auth Init Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Pi init review findings by extracting Pi setup orchestration,
removing fake smoke-test outcomes, and deleting duplicated main tests.

**Architecture:** Add `pi-init-setup.ts` as the focused Pi setup orchestrator
with explicit result variants. `main.ts` delegates Pi setup to this module and
only formats the explicit result. Pi-flow tests live in `pi-init-flow.test.ts`;
focused outcome tests live in `pi-init-setup.test.ts`.

**Tech Stack:** TypeScript, Node test runner, existing Patchmill init modules.

---

## File Structure

- Create: `src/cli/commands/init/pi-init-setup.ts` — owns Pi setup orchestration
  and explicit setup result types.
- Create: `src/cli/commands/init/pi-init-setup.test.ts` — verifies canonical
  setup dependency and explicit cancellation/invalid outcomes.
- Modify: `src/cli/commands/init/main.ts` — remove inline Pi selection/smoke
  orchestration and delegate to `resolvePiInitSetup`.
- Modify: `src/cli/commands/init/main.test.ts` — delete duplicated Pi-flow
  scenario tests.
- Modify: `src/cli/commands/init/pi-init-flow.test.ts` — adapt any setup hook
  references to the new dependency name/signature.

### Task 1: Add explicit Pi setup outcome tests

**Files:**

- Create: `src/cli/commands/init/pi-init-setup.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that import `resolvePiInitSetup` and verify:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePiInitSetup } from "./pi-init-setup.ts";
import type { PiModelChoice, PiReadiness } from "./pi-preflight.ts";

function model(): PiModelChoice {
  return {
    provider: "anthropic",
    providerName: "Anthropic",
    id: "claude-sonnet-4-5",
    label: "Anthropic / Claude Sonnet 4.5",
    value: "anthropic/claude-sonnet-4-5",
    authSource: "stored",
    reasoning: true,
    input: ["text"],
  };
}

function readyReadiness(): PiReadiness {
  return {
    status: "ready",
    message: "Pi reported 1 provider/model option with configured auth.",
    models: [model()],
  };
}

function missingReadiness(): PiReadiness {
  return {
    status: "missing",
    message: "Pi did not report any provider/model with configured auth.",
    models: [],
  };
}

test("resolvePiInitSetup returns cancelled without running a fake smoke test", async () => {
  let smokeCalled = false;

  const result = await resolvePiInitSetup({
    repoRoot: "/repo",
    piAgentDir: "/repo/.patchmill/pi-agent",
    readiness: readyReadiness(),
    isInteractive: true,
    selectModelInteractively: async () => undefined,
    runPiSmokeTest: async () => {
      smokeCalled = true;
      throw new Error("smoke should not run");
    },
  });

  assert.equal(result.status, "cancelled");
  assert.equal(result.selection.status, "unavailable");
  assert.equal(result.selection.reason, "cancelled");
  assert.equal(smokeCalled, false);
});

test("resolvePiInitSetup returns invalid without running a fake smoke test", async () => {
  let smokeCalled = false;

  const result = await resolvePiInitSetup({
    repoRoot: "/repo",
    piAgentDir: "/repo/.patchmill/pi-agent",
    readiness: readyReadiness(),
    isInteractive: true,
    selectModelInteractively: async () => ({
      ...model(),
      value: "unknown/model",
      provider: "unknown",
      id: "model",
    }),
    runPiSmokeTest: async () => {
      smokeCalled = true;
      throw new Error("smoke should not run");
    },
  });

  assert.equal(result.status, "invalid");
  assert.equal(result.selection.status, "unavailable");
  assert.equal(result.selection.reason, "invalid-selection");
  assert.equal(smokeCalled, false);
});

test("resolvePiInitSetup uses canonical interactive setup when readiness is missing", async () => {
  let setupAgentDir: string | undefined;
  let smokeModel: string | undefined;

  const result = await resolvePiInitSetup({
    repoRoot: "/repo",
    piAgentDir: "/repo/.patchmill/pi-agent",
    readiness: missingReadiness(),
    isInteractive: true,
    setupPiInteractively: async ({ agentDir }) => {
      setupAgentDir = agentDir;
      return {
        readiness: readyReadiness(),
        selection: {
          status: "selected",
          model: "anthropic/claude-sonnet-4-5",
          provider: "anthropic",
          modelId: "claude-sonnet-4-5",
          message: "Using Pi model Anthropic / Claude Sonnet 4.5.",
        },
      };
    },
    runPiSmokeTest: async (_runner, options) => {
      smokeModel = options.model;
      return {
        status: "pass",
        message:
          "Pi completed the provider smoke test with anthropic/claude-sonnet-4-5.",
        command: "pi smoke",
      };
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(setupAgentDir, "/repo/.patchmill/pi-agent");
  assert.equal(smokeModel, "anthropic/claude-sonnet-4-5");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test src/cli/commands/init/pi-init-setup.test.ts`

Expected: FAIL because `./pi-init-setup.ts` does not exist.

### Task 2: Implement `pi-init-setup.ts`

**Files:**

- Create: `src/cli/commands/init/pi-init-setup.ts`

- [ ] **Step 1: Add implementation**

Create `resolvePiInitSetup` with explicit result variants, call `selectPiModel`,
call optional canonical `setupPiInteractively` only when readiness is missing
and the terminal is interactive, and run smoke tests only for non-aborting
outcomes.

- [ ] **Step 2: Run focused setup tests**

Run: `node --test src/cli/commands/init/pi-init-setup.test.ts`

Expected: PASS.

### Task 3: Delegate Pi setup from `main.ts`

**Files:**

- Modify: `src/cli/commands/init/main.ts`
- Modify: `src/cli/commands/init/pi-init-flow.test.ts`

- [ ] **Step 1: Update `main.ts` imports and option type**

Import `resolvePiInitSetup`, `type PiInitSetupResult`, and
`type InteractivePiSetup` from `pi-init-setup.ts`. Remove local
`InteractivePiSetup`, `selectedModelFromReadiness`, and
`shouldAbortForSelection`.

- [ ] **Step 2: Update message formatter**

Change `formatPiSetupMessage` to accept `PiInitSetupResult`. It should include
readiness message, ready warning, distinct selection message, real smoke result
when present, and direct cancellation/invalid messages when no smoke exists.

- [ ] **Step 3: Replace inline orchestration**

Replace the local readiness/selection/smoke block with a call to
`resolvePiInitSetup` using existing dependencies and settings warning
persistence callback.

- [ ] **Step 4: Run Pi-flow tests**

Run:
`node --test src/cli/commands/init/pi-init-flow.test.ts src/cli/commands/init/pi-init-setup.test.ts`

Expected: PASS.

### Task 4: Remove duplicated `main.test.ts` Pi-flow block

**Files:**

- Modify: `src/cli/commands/init/main.test.ts`

- [ ] **Step 1: Delete duplicated tests**

Remove tests from
`runInit uses Pi-reported ready configuration without launching an interactive selector`
through
`runInit aborts when the required interactive model selector is cancelled` from
`main.test.ts`.

- [ ] **Step 2: Remove unused imports**

Remove `stat` from `node:fs/promises` if no longer used.

- [ ] **Step 3: Run main and Pi-flow tests**

Run:
`node --test src/cli/commands/init/main.test.ts src/cli/commands/init/pi-init-flow.test.ts src/cli/commands/init/pi-init-setup.test.ts`

Expected: PASS.

### Task 5: Final verification

**Files:**

- All changed files

- [ ] **Step 1: Run build**

Run: `npm run build`

Expected: PASS with no TypeScript errors.

- [ ] **Step 2: Run TypeScript lint**

Run: `npm run lint:ts`

Expected: PASS with zero warnings.

- [ ] **Step 3: Check file sizes**

Run:
`wc -l src/cli/commands/init/main.test.ts src/cli/commands/init/main.ts src/cli/commands/init/pi-init-setup.ts src/cli/commands/init/pi-init-setup.test.ts`

Expected: `main.test.ts` is materially below the prior 942 lines, and no touched
file crosses 1000 lines.
