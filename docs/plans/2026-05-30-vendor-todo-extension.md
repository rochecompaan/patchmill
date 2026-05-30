# Vendor Todo Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bundle the file-backed Pi `todo` extension with Patchmill so run-once
workflows always have the `todo` tool available.

**Architecture:** Vendor the existing Apache-2.0
`agent-stuff/extensions/todos.ts` under `extensions/todos.ts`, ship Apache
license/third-party notices, and load the extension in every `runPiPrompt()`
invocation beside `pi-subagents`. Pass `PI_TODO_PATH` from the configured task
contract so custom todo roots stay consistent with Patchmill progress tracking.

**Tech Stack:** TypeScript, Node test runner, Pi extension loading via `pi -e`,
npm package files, Nix package copy rules.

---

## Task 1: Package and license coverage

**Files:**

- Modify: `bin/package-files.test.ts`
- Modify: `package.json`
- Modify: `nix/package.nix`
- Create: `extensions/todos.ts`
- Create: `THIRD_PARTY_NOTICES.md`

- [ ] Write a failing package dry-run test asserting the npm tarball includes
      `extensions/todos.ts` and `THIRD_PARTY_NOTICES.md`, and does not include a
      duplicate `LICENSES/Apache-2.0.txt` file.
- [ ] Run `node --test bin/package-files.test.ts` and verify it fails because
      the package still includes the duplicate license file or notices still
      reference it.
- [ ] Vendor the upstream todo extension, preserving Apache-2.0 provenance and
      adding a modification notice.
- [ ] Add third-party notice pointing at Patchmill's top-level Apache-2.0
      `LICENSE`.
- [ ] Update `package.json` `files` and license metadata for Apache-2.0
      distribution.
- [ ] Update Nix `postInstall` to copy `extensions` and `THIRD_PARTY_NOTICES.md`
      into `$out/share/patchmill`.
- [ ] Re-run `node --test bin/package-files.test.ts` and verify it passes.

## Task 2: Pi invocation loads the bundled todo extension

**Files:**

- Modify: `src/cli/commands/run-once/pi.test.ts`
- Modify: `src/cli/commands/run-once/pi.ts`
- Modify: `src/cli/commands/triage/types.ts`
- Modify: `src/cli/commands/triage/command.ts`

- [ ] Write a failing test asserting `runPiPrompt()` passes both
      `-e <pi-subagents>` and `-e <patchmill>/extensions/todos.ts` before `-p`.
- [ ] Write a failing test asserting custom `taskContract.todoRoot` becomes
      `PI_TODO_PATH` in the command runner environment.
- [ ] Run `node --test src/cli/commands/run-once/pi.test.ts` and verify the new
      tests fail for the expected missing args/env.
- [ ] Add env support to `CommandRunOptions` and merge it into `spawn()`
      environment in `createCommandRunner()`.
- [ ] Resolve the Patchmill package root from `import.meta.url`, include
      `extensions/todos.ts` in Pi args, and pass `PI_TODO_PATH` from
      `taskContract.todoRoot`.
- [ ] Re-run `node --test src/cli/commands/run-once/pi.test.ts` and verify it
      passes.

## Task 3: Documentation and full verification

**Files:**

- Modify: `README.md` or `docs/issue-agent-workflows.md` if needed

- [ ] Add a short note that Patchmill bundles the file-backed Pi `todo`
      extension and writes local todo state under the configured task-contract
      todo root.
- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
