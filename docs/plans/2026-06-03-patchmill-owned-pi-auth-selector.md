# Patchmill-Owned Pi Auth Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the production `patchmill init` provider-auth selector so
interactive init configures repo-local Pi auth, refreshes models, selects a
model, and smoke-tests it.

**Architecture:** Keep `main.ts` as a coordinator and move provider auth into
focused init modules. Split pure provider-list state from TUI selectors and auth
execution so tests can cover behavior without terminal I/O. Use Pi's public
`AuthStorage` and `ModelRegistry` APIs against `.patchmill/pi-agent/auth.json`
and `.patchmill/pi-agent/models.json`.

**Tech Stack:** TypeScript, Node test runner, `@earendil-works/pi-coding-agent`
AuthStorage/ModelRegistry, `@earendil-works/pi-tui` TUI primitives.

---

## File Structure

- Create `src/cli/commands/init/pi-auth-provider-state.ts`: pure
  auth-mode/provider-choice construction, filtering, visible-window, and status
  label helpers.
- Create `src/cli/commands/init/pi-auth-selector.ts`: auth-method and provider
  selector TUI runners.
- Create `src/cli/commands/init/pi-auth-dialog.ts`: API-key prompt, Bedrock
  info, and OAuth callback dialogs.
- Create `src/cli/commands/init/pi-auth-flow.ts`: repo-local
  AuthStorage/ModelRegistry orchestration and `setupPiInteractively`
  implementation.
- Modify `src/cli/commands/init/pi-init-setup.ts`: delegate its default
  `setupPiInteractively` to `pi-auth-flow.ts`.
- Add focused tests beside each new module and extend
  `pi-init-setup.test.ts`/`pi-init-flow.test.ts` for the production path.

## Tasks

### Task 1: Provider State

**Files:**

- Create: `src/cli/commands/init/pi-auth-provider-state.ts`
- Test: `src/cli/commands/init/pi-auth-provider-state.test.ts`

- [ ] Write failing tests for auth method labels, subscription provider choices,
      API-key provider choices, cross-mode configured labels, search, and
      eight-row visible window.
- [ ] Run `node --test src/cli/commands/init/pi-auth-provider-state.test.ts` and
      verify failures mention missing exports.
- [ ] Implement pure state helpers with narrow interfaces for auth storage and
      registry.
- [ ] Run the focused test until it passes.

### Task 2: Auth Flow Core

**Files:**

- Create: `src/cli/commands/init/pi-auth-flow.ts`
- Modify: `src/cli/commands/init/pi-init-setup.ts`
- Test: `src/cli/commands/init/pi-auth-flow.test.ts`
- Test: `src/cli/commands/init/pi-init-setup.test.ts`

- [ ] Write failing tests proving API-key setup stores
      `{ type: "api_key", key }`, OAuth setup calls `authStorage.login`, Bedrock
      stores no key, registry refresh happens after setup, no models returns
      `not-ready`, and model selection receives refreshed models.
- [ ] Run focused tests and verify failures are behavioral, not syntax errors.
- [ ] Implement auth orchestration with injected prompt/selector functions for
      tests and production defaults for real init.
- [ ] Wire `pi-init-setup.ts` default `setupPiInteractively` to the real flow.
- [ ] Run focused tests until green.

### Task 3: TUI Selectors and Dialogs

**Files:**

- Create: `src/cli/commands/init/pi-auth-selector.ts`
- Create: `src/cli/commands/init/pi-auth-dialog.ts`
- Test: `src/cli/commands/init/pi-auth-selector.test.ts`
- Test: `src/cli/commands/init/pi-auth-dialog.test.ts`

- [ ] Write failing tests around component behavior using rendered rows and fake
      terminal input where practical.
- [ ] Implement auth method selector, searchable provider selector, API-key
      prompt, Bedrock info panel, and OAuth callback dialogs with cancellation.
- [ ] Run focused tests until green.

### Task 4: Init Integration

**Files:**

- Modify: `src/cli/commands/init/pi-init-flow.test.ts`
- Modify: `src/cli/commands/init/main.ts` only if dependency injection requires
  it.

- [ ] Add a failing integration test proving interactive init with missing
      readiness uses the production `setupPiInteractively` path rather than
      returning the stub.
- [ ] Implement any final wiring required.
- [ ] Run
      `node --test src/cli/commands/init/pi-auth-provider-state.test.ts src/cli/commands/init/pi-auth-flow.test.ts src/cli/commands/init/pi-auth-selector.test.ts src/cli/commands/init/pi-auth-dialog.test.ts src/cli/commands/init/pi-init-setup.test.ts src/cli/commands/init/pi-init-flow.test.ts`.

### Task 5: Verification

- [ ] Run `npm test`.
- [ ] Run `npm run lint:ts`.
- [ ] Run `npm run build`.
- [ ] Confirm `patchmill init` no longer prints only the incomplete guidance in
      an interactive missing-readiness flow; it opens auth selection first.
