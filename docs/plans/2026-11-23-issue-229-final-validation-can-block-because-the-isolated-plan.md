# Managed Reviewer Resolution and Doctor Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans (inline
> execution, as for every kernel run) to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The managed `reviewer` prompt permits validation commands.
`patchmill doctor` fails when the isolated runtime does not resolve the managed,
current `reviewer` with `bash`. `patchmill doctor --fix` restores a missing or
stale definition.

**Architecture:** `src/cli/commands/init/agent-dir.ts` owns the canonical
reviewer content and its provisioning. A new module,
`src/cli/commands/doctor/reviewer-role.ts`, owns the resolution check through
the public `pi-subagents/preflight` entry point. `doctor/checks.ts` and
`doctor/main.ts` call these two modules.

**Tech Stack:** TypeScript on Node 24, `node:test`, the real `pi-subagents`
package (`resolveSubagentLaunchContract`).

**Spec:**
[`docs/specs/2026-11-23-issue-229-final-validation-can-block-because-the-isolated-design.md`](../specs/2026-11-23-issue-229-final-validation-can-block-because-the-isolated-design.md)

**Inputs:** the spec above and its `## Visual explanation` (inline Mermaid). The
spec has no mockup and no HTML companion.

## Global Constraints

- Do not change `skills/`, `review-appendix.md`, pi-subagents, or the
  `patchmill-implementation` agent content.
- The `reviewer` tools line stays `tools: read, grep, find, ls, bash`.
- Check names and order in doctor do not change. The `reviewer` severity becomes
  `fail`.
- `doctor --fix` writes only `<agentDir>/agents/reviewer.md`.
- No new configuration keys. No dependency changes.
- Tests that resolve agents set `HOME` to a temporary directory, so a real
  `~/.agents/reviewer.md` cannot change the result.

## Review Focus

1. `~/.agents/reviewer.md` or `<repo>/.pi/agents/reviewer.md` exists: doctor
   fails, names that file, and `--fix` does not delete it. (Task 2 tests the
   project and home shadows.)
2. `PI_CODING_AGENT_DIR` was already set before doctor ran: the check restores
   the earlier value, also after a throw. (Task 2 uses a malformed
   `settings.json` to make preflight throw.)
3. A custom `pi.agentDir` (not `.patchmill/pi-agent`): provisioning, check and
   `--fix` all use it. (Tasks 1 to 3 use `custom/agent`.)
4. `doctor --fix` when the file is already current: it prints no `[fixed]` line
   and changes no file. (Task 3.)
5. A current `reviewer.md` that loses `bash` at runtime through an
   `agentOverrides` entry: doctor fails and lists the effective tools. (Task 2.)

---

### Task 1: Reviewer prompt and `provisionReviewerAgent`

**Files:**

- Modify: `src/cli/commands/init/agent-dir.ts`
- Modify: `src/cli/commands/init/main.ts:113-117`
- Test: `src/cli/commands/init/agent-dir.test.ts`

**Interfaces:**

- Produces:
  `provisionReviewerAgent(repoRoot: string, agentDir: string): Promise<"written" | "unchanged">`.
  `REVIEWER_AGENT` stays exported with the new prompt.

- [ ] **Step 1: Write the failing test**
      `provisionReviewerAgent writes only the reviewer and reports changes` in
      `agent-dir.test.ts`:
  - First call on an empty temp root with `"custom/agent"` returns `"written"`.
    The file content equals `agent.REVIEWER_AGENT`.
  - `patchmill-implementation.md` does not exist after the call
    (`assert.rejects(stat(...))`).
  - A second call returns `"unchanged"` and keeps the mtime.
  - After `writeFile(file, "damaged")`, a call returns `"written"` and restores
    the content.
- [ ] **Step 2: Run** `node --test src/cli/commands/init/agent-dir.test.ts`.
      Expected: FAIL, `provisionReviewerAgent` is not a function.
- [ ] **Step 3: Implement.** In `agent-dir.ts`:
  - Add a private
    `writeWhenDifferent(file: string, content: string): Promise<boolean>` from
    the loop body of `provisionAgentDir` (ENOENT means missing).
  - Add `provisionReviewerAgent`: `mkdir`
    `resolve(repoRoot, agentDir, "agents")` (use `resolve`, not `join`), then
    `writeWhenDifferent` for `reviewer.md`.
  - `provisionAgentDir` calls `provisionReviewerAgent`, then
    `writeWhenDifferent` for the worker.
  - In `REVIEWER_AGENT`, replace the line that starts with
    `Use read-only commands.` with the six lines in the spec's "Reviewer prompt"
    section, verbatim. Keep all other lines.
  - In `init/main.ts`, remove the `optionalText(reviewer)` compare. Call
    `provisionReviewerAgent` first, then `provisionAgentDir`, and print
    `Agent directory: ${result}`. Remove the `REVIEWER_AGENT` import if it is no
    longer used.
- [ ] **Step 4: Run**
      `node --test src/cli/commands/init/agent-dir.test.ts src/cli/commands/init/main.test.ts`.
      Expected: PASS.
- [ ] **Step 5: Commit**
      `feat(init): let the managed reviewer run validation commands (#229)`.

### Task 2: `checkReviewerRole`

**Files:**

- Create: `src/cli/commands/doctor/reviewer-role.ts`
- Test: `src/cli/commands/doctor/reviewer-role.test.ts`
- Test: `src/cli/commands/init/main.test.ts` (one new test)

**Interfaces:**

- Consumes: `REVIEWER_AGENT`, `provisionReviewerAgent` (Task 1).
- Produces:

```ts
export type ReviewerRoleCheck =
  | { ok: true }
  | { ok: false; repairable: boolean; message: string };
export async function checkReviewerRole(input: {
  repoRoot: string;
  agentDir: string;
}): Promise<ReviewerRoleCheck>;
```

- [ ] **Step 1: Write the failing tests** in `reviewer-role.test.ts`. A fixture
      makes a temp root with `git init`, a temp `HOME` (set `process.env.HOME`,
      restore in `t.after`), and `agentDir = "custom/agent"`.
  - `passes for the provisioned reviewer`: after `provisionReviewerAgent`,
    result is `{ ok: true }`.
  - `passes through a symlinked repository path` (smoke test): symlink the temp
    root; call with the link path; result is `{ ok: true }`.
  - `missing is repairable`: no file; `ok: false`, `repairable: true`, message
    matches `/Missing reviewer: .*custom\/agent\/agents\/reviewer\.md.*--fix/`.
  - `stale is repairable`: write `REVIEWER_AGENT + "\n"`; `repairable: true`,
    message matches `/Stale reviewer/`.
  - `a project definition shadows the managed reviewer`: provision, then write
    `<root>/.pi/agents/reviewer.md` with frontmatter `name: reviewer`,
    `description: x`, `tools: read`; `repairable: false`, message includes that
    path and `project`. The file still exists after the check.
  - `a home definition shadows the managed reviewer`: same with
    `<HOME>/.agents/reviewer.md`; message includes that path.
  - `an agentOverrides tools entry fails the tools check`: provision, then write
    `custom/agent/settings.json` with
    `{"subagents":{"agentOverrides":{"reviewer":{"tools":["read"]}}}}`;
    `repairable: false`, message matches `/effective tools: read(,|$)/`.
  - `a disabled reviewer is not resolved`: provision, then write
    `{"subagents":{"agentOverrides":{"reviewer":{"disabled":true}}}}`;
    `repairable: false`, message includes `missing_agent`.
  - `restores PI_CODING_AGENT_DIR`: set
    `process.env.PI_CODING_AGENT_DIR = "/earlier"`. Run a passing check. Then
    write a malformed `custom/agent/settings.json` (`"{"`) and assert that the
    check rejects. The value is `/earlier` after both. Delete the variable when
    it was unset before the test.
- [ ] **Step 2: Run**
      `node --test src/cli/commands/doctor/reviewer-role.test.ts`. Expected:
      FAIL, module not found.
- [ ] **Step 3: Implement** `checkReviewerRole` in `reviewer-role.ts`, with the
      order and messages of the spec's "Reviewer role check" section.
  - Managed path: `resolve(repoRoot, agentDir, "agents/reviewer.md")`.
  - Read the file; ENOENT gives "Missing"; a content mismatch gives "Stale".
  - Set `process.env.PI_CODING_AGENT_DIR = resolve(repoRoot, agentDir)` and call
    `resolveSubagentLaunchContract({ agent: "reviewer", cwd: repoRoot })` from
    `"pi-subagents/preflight"`. Restore the earlier value (or delete the key) in
    `finally`.
  - Compare `await realpath(contract.agent.filePath)` with
    `await realpath(managedPath)`.
  - `ok: false` from preflight gives `repairable: false` and a message with the
    pi-subagents `code` and `message`. A throw propagates.
  - Tools check on `contract.tools.effectiveAllowlist`: needs `bash`; rejects
    `edit`, `write`, `subagent`. Message:
    `Reviewer needs bash and no edit, write or subagent; effective tools: <comma-separated list>`.
- [ ] **Step 4: Add the init acceptance test**
      `fresh init resolves a command-capable reviewer in the isolated agent directory`
      to `init/main.test.ts`: set a temp `HOME`, run `init.main([], f.options)`,
      then
      `checkReviewerRole({ repoRoot: f.root, agentDir: ".patchmill/pi-agent" })`
      equals `{ ok: true }`.
- [ ] **Step 5: Run**
      `node --test src/cli/commands/doctor/reviewer-role.test.ts src/cli/commands/init/main.test.ts`.
      Expected: PASS.
- [ ] **Step 6: Commit**
      `feat(doctor): resolve the reviewer role through pi-subagents preflight (#229)`.

### Task 3: Doctor check, `--fix`, and documentation

**Files:**

- Modify: `src/cli/commands/doctor/checks.ts` (the `reviewer` check)
- Modify: `src/cli/commands/doctor/main.ts`
- Modify: `src/cli/main.ts:21` (command summary)
- Modify: `README.md` (rows near lines 97 and 346),
  `site/src/content/docs/reference/environment-and-config.md` (lines 72 and 81),
  `site/src/content/docs/guides/pi-and-subagents.md` ("Readiness")
- Test: `src/cli/commands/doctor/checks.test.ts`

**Interfaces:**

- Consumes: `checkReviewerRole` (Task 2), `provisionReviewerAgent` (Task 1).

- [ ] **Step 1: Update the fixture and write the failing tests** in
      `checks.test.ts`:
  - Fixture: set `process.env.HOME` to a temp directory (restore in `t.after`),
    run `git init` in `repoRoot`, and write the reviewer with
    `provisionReviewerAgent(repoRoot, config.pi.agentDir)` instead of
    `"fixture"`. The first test still expects `reviewer` to `pass`.
  - In `missing resources fail or warn ...`, change the expected `reviewer`
    status to `fail`.
  - New `a stale reviewer fails with a fix hint`: write `"fixture"`; the
    `reviewer` check is `fail` and its message matches `/--fix/`.
  - New `doctor --fix restores only the managed reviewer`: remove `reviewer.md`,
    write `custom/agent/agents/patchmill-implementation.md` and
    `custom/agent/settings.json` with known bytes. `main([], options)` returns 1
    and prints `[fail] reviewer:`. `main(["--fix"], options)` returns 0, prints
    `[fixed] reviewer: wrote <path>` and `[pass] reviewer:`. The two other files
    keep their bytes. A second `main(["--fix"], options)` prints no `[fixed]`
    line.
  - New `doctor --fix does not remove a shadowing definition`: write
    `<repoRoot>/.pi/agents/reviewer.md` (tools `read`);
    `main(["--fix"], options)` returns 1, the output names that path, and the
    file still exists.
  - Extend `doctor CLI prints diagnostics ...`: `main(["--fix", "--fix"])` and
    `main(["--bad"])` return 1. `main(["--help"])` output matches
    `/Usage: patchmill doctor \[--fix\]/`.
- [ ] **Step 2: Run** `node --test src/cli/commands/doctor/checks.test.ts`.
      Expected: FAIL (`reviewer` is `warn`, `--fix` is an unknown argument).
- [ ] **Step 3: Implement.**
  - `checks.ts`:
    `check("reviewer", "fail", async () => { const r = await checkReviewerRole({ repoRoot, agentDir: config.pi.agentDir }); return r.ok ? { ok: true } : { ok: false, message: r.message }; })`.
    Remove `missingFiles` only if no other check uses it (the `skills` check
    uses it, so keep it).
  - `main.ts`: accept `[]` or `["--fix"]`; any other argument list gives
    `Unknown argument: <first>. Use --help.` With `--fix`, after `loadConfig`,
    call `provisionReviewerAgent`; on `"written"`, print
    `[fixed] reviewer: wrote <absolute path>`. Help text from the spec.
  - `src/cli/main.ts`: summary text from the spec.
  - Documentation: the sentences in the spec's "Documentation" section.
- [ ] **Step 4: Run**
      `node --test src/cli/commands/doctor/checks.test.ts src/cli/main.test.ts`.
      Expected: PASS.
- [ ] **Step 5: Run the repository checks:** `npm run lint`, `npm test`,
      `npm run build`. Expected: all exit with 0.
- [ ] **Step 6: Commit**
      `feat(doctor): fail on an unresolved reviewer and add --fix (#229)`.

## Verification

- Behavior tests: Tasks 1 to 3, through `provisionReviewerAgent`,
  `checkReviewerRole`, and the doctor `main` and `runDoctorChecks` interfaces.
- The prompt text is not tested for exact wording (Testing Value Gate). The
  review reads `REVIEWER_AGENT` directly against the spec.
- Documentation: `npm run lint` (Prettier and markdownlint).
- No npm dependency changes, so no Nix build is necessary.

## Visual explanation

Task order and ownership:

```text
Task 1  init/agent-dir.ts      REVIEWER_AGENT prompt, provisionReviewerAgent
  │                            (init/main.ts uses the return value)
  ▼
Task 2  doctor/reviewer-role.ts checkReviewerRole → pi-subagents/preflight
  │                            (init acceptance test)
  ▼
Task 3  doctor/checks.ts       reviewer check: warn → fail
        doctor/main.ts         --fix → provisionReviewerAgent, then checks
        README + site docs
```

## Planning review

### Pass 1: combined with the specification

- **Scope:** implementation plan and specification
  (`docs/specs/2026-11-23-issue-229-final-validation-can-block-because-the-isolated-design.md`).
- **Reviewer:** canonical `reviewer` (managed Patchmill definition), model
  `claude-bridge/claude-opus-5-5`, thinking `high`. Fresh context for each pass.
- **Base revision:** `360c592` (`main`).
- **Survey:** the reviewer read the agent-dir, init, doctor, console start and
  serve sources and tests, the review skills, and the pi-subagents discovery and
  preflight code. It ran probes with temporary `HOME` and repositories. They
  confirmed the project and home shadows, `agentOverrides` tools and `disabled`
  effects, and a throw on a malformed `settings.json`.
- **Findings and dispositions:**
  - B1 (blocker, plan): no tests for the not-resolved and wrong-tools checks.
    **Accepted.** Task 2 adds the `agentOverrides` tools and `disabled` cases.
  - S1 (plan, spec): the env-restore test did not reach the `finally` after a
    throw. **Accepted.** The test uses a malformed `settings.json`. The spec
    says that the throw propagates.
  - S2 (spec, plan): `join` versus `resolve` for an absolute `pi.agentDir`.
    **Accepted.** `provisionReviewerAgent` uses `resolve`.
  - S3 (plan): the symlink test does not prove `realpath` use on Linux.
    **Accepted.** It is now a smoke test. Review Focus 5 now names the
    `agentOverrides` case.
  - S4 (spec): the flow skipped "not resolved", and the override wording was not
    exact. **Accepted.** Mermaid and wording revised.
  - S5 (spec): "read-only" in the skills. **Accepted.** Non-goals define its
    meaning after this change.
  - Confirmation suggestion C1 (plan): "does not claim `bash`" was ambiguous.
    **Accepted** after the confirmation. The plan now fixes the tools message
    format and asserts `effective tools: read`. This edit changes only that test
    assertion and message text.
- **Inspection limits:** pi-subagents 0.80.0 only. No repository checks run (no
  implementation yet). Kernel project-trust setting and macOS `/tmp` symlinks
  not inspected.
- **Confirmation:** a fresh scoped confirmation verified B1 and S1 to S5 against
  the real package. No blockers remain.
- **Reviewed body SHA-256:**
  `b7254baf6aa0928e410366596cea2d9e56faa08fbbb29324db8d7b598b9f4006` (initial).
- **Compared specification body SHA-256:**
  `bf505c36aac716d3aae77fb7e2e32ee1a299ec400ea1b7d46b5fa6014b153629`.
- **Final body SHA-256:**
  `54e649e23d437b29db5975422a34e5eeffc8aa6fff97c322aa75165e12321aea`.
- **Outcome:** `ready`.
