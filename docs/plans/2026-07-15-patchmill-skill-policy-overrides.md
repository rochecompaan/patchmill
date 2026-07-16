# Patchmill Skill Policy Overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install Patchmill-adapted project-local skill recommendations that
start from pinned Superpowers skills, keep generated workflow artifacts on issue
worktrees, and apply a Testing Value Gate before adding tests.

**Architecture:** Vendor three upstream Superpowers skill directories into
Patchmill's bundled `skills/` tree, then layer narrow Patchmill customizations
on those copies. Update the recommended skill-pack metadata and tests so
`patchmill init` and `patchmill skills update` install the Patchmill-owned
copies. Pass the existing issue-worktree factory into planning-stage advancement
so generated specs and plans run from the issue worktree instead of the base
checkout.

**Tech Stack:** TypeScript, Node.js `node:test`, Patchmill CLI, Pi skill files,
Markdown documentation.

## Global Constraints

- Save this plan under `docs/plans/YYYY-MM-DD-<feature-name>.md`; this file is
  `docs/plans/2026-07-15-patchmill-skill-policy-overrides.md`.
- The approved spec is
  `docs/specs/2026-07-15-patchmill-skill-policy-overrides-design.md`.
- Work in the issue/task worktree at
  `/home/roche/projects/patchmill/.worktrees/patchmill-skill-policy-overrides`;
  do not write implementation files in the base checkout.
- Adapted skills must start from the pinned Superpowers dependency in
  `package.json`, currently `superpowers` tag `v6.0.3`, then apply Patchmill
  customizations on top.
- Do not fork or rewrite the full Superpowers pack; only vendor/customize
  `brainstorming`, `writing-plans`, and `test-driven-development`.
- Apply the Testing Value Gate before adding new tests. Tests below are required
  because they verify runtime behavior, package/install behavior, prompt
  contracts, or update safety. Documentation-only changes use lint/build
  verification instead.
- If `package.json`, `package-lock.json`, or `npm-shrinkwrap.json` changes
  unexpectedly, stop, inspect why, and run the Nix build before final handoff.

---

### Task 1: Vendor adapted Superpowers skill sources and mark them Patchmill-sourced

**Files:**

- Create: `skills/brainstorming/**`
- Create: `skills/writing-plans/**`
- Create: `skills/test-driven-development/**`
- Modify: `src/workflow/skill-pack.ts`
- Modify: `src/workflow/skill-pack.test.ts`
- Modify: `src/cli/commands/init/skill-installer.test.ts`
- Modify: `src/cli/commands/skills/update.test.ts`
- Modify: `bin/package-files.test.ts`

**Interfaces:**

- Consumes: `PATCHMILL_RECOMMENDED_SKILL_PACK.skills`, `sourceRootFor()`
  behavior that maps `source: "patchmill"` to the bundled `skills/` tree, and
  installer/update code that copies every file under a managed skill directory.
- Produces: Patchmill-owned bundled skill directories, a bumped recommended pack
  version, and automated coverage proving init/update copy adapted skill
  sidecars and protect customized managed files.

- [ ] **Step 1: Add a failing test for the recommended pack source model**

  Modify the `default pack records pinned external source` test in
  `src/workflow/skill-pack.test.ts` so it expects version `2026.07.1` and the
  three adapted skills to be Patchmill-sourced:

  ```ts
  assert.equal(PATCHMILL_RECOMMENDED_SKILL_PACK.version, "2026.07.1");
  // ...existing source assertion remains v6.0.3...
  assert.deepEqual(PATCHMILL_RECOMMENDED_SKILL_PACK.skills, [
    { name: "patchmill-issue-triage", source: "patchmill" },
    {
      name: "subagent-dev-with-codex-and-thermo-reviews",
      source: "patchmill",
    },
    {
      name: "single-subagent-dev-with-codex-and-thermo-reviews",
      source: "patchmill",
    },
    { name: "module-size", source: "patchmill" },
    { name: "patchmill-visual-evidence", source: "patchmill" },
    { name: "brainstorming", source: "patchmill" },
    { name: "dispatching-parallel-agents", source: "superpowers" },
    { name: "executing-plans", source: "superpowers" },
    { name: "finishing-a-development-branch", source: "superpowers" },
    { name: "receiving-code-review", source: "superpowers" },
    { name: "requesting-code-review", source: "superpowers" },
    { name: "subagent-driven-development", source: "superpowers" },
    { name: "systematic-debugging", source: "superpowers" },
    { name: "test-driven-development", source: "patchmill" },
    { name: "using-git-worktrees", source: "superpowers" },
    { name: "using-superpowers", source: "superpowers" },
    { name: "verification-before-completion", source: "superpowers" },
    { name: "writing-plans", source: "patchmill" },
    { name: "writing-skills", source: "superpowers" },
  ]);
  ```

  In the `buildSkillPackMetadata records installed file hashes` assertion,
  update the expected `pack.version` to `2026.07.1`.

- [ ] **Step 2: Add failing installer coverage for adapted Patchmill skill
      sidecars**

  In `src/cli/commands/init/skill-installer.test.ts`, extend
  `installProjectSkills copies skills and writes metadata` so the dummy
  `patchmillSource` contains these three additional Patchmill-sourced skills:

  ```ts
  const brainstormingSkill = `---
  name: brainstorming
  description: Brainstorm.
  ---
  # Brainstorming
  `;

  const tddSkill = `---
  name: test-driven-development
  description: TDD.
  ---
  # Test-Driven Development
  `;

  await writeSkill(patchmillSource, "brainstorming", brainstormingSkill, {
    "visual-companion.md": "visual companion instructions\n",
    "scripts/server.cjs": "console.log('server');\n",
  });
  await writeSkill(patchmillSource, "writing-plans", planningSkill, {
    "plan-document-reviewer-prompt.md": "review plans carefully\n",
  });
  await writeSkill(patchmillSource, "test-driven-development", tddSkill, {
    "testing-anti-patterns.md": "avoid mock-only tests\n",
  });
  ```

  In that same test, change `packSkills` so `brainstorming`, `writing-plans`,
  and `test-driven-development` are `source: "patchmill"`, then assert the
  installed file contents:

  ```ts
  assert.equal(
    await readFile(
      join(
        repoRoot,
        ".patchmill",
        "skills",
        "brainstorming",
        "visual-companion.md",
      ),
      "utf8",
    ),
    "visual companion instructions\n",
  );
  assert.equal(
    await readFile(
      join(
        repoRoot,
        ".patchmill",
        "skills",
        "writing-plans",
        "plan-document-reviewer-prompt.md",
      ),
      "utf8",
    ),
    "review plans carefully\n",
  );
  assert.equal(
    await readFile(
      join(
        repoRoot,
        ".patchmill",
        "skills",
        "test-driven-development",
        "testing-anti-patterns.md",
      ),
      "utf8",
    ),
    "avoid mock-only tests\n",
  );
  ```

  Update the expected metadata list to include the new adapted skill files and
  their `hashText(...)` values.

- [ ] **Step 3: Add failing update coverage for clean adapted-skill updates and
      customized-file refusal**

  In `src/cli/commands/skills/update.test.ts`, update
  `updateProjectSkills updates clean managed project-local skills` to use a
  `patchmillSource` that contains a Patchmill-sourced `writing-plans` skill with
  a sidecar:

  ```ts
  const patchmillSource = await tempRoot("patchmill-skills-update-patchmill-");
  await writeSkill(patchmillSource, "writing-plans", {
    "SKILL.md": newWritingPlans,
    "plan-document-reviewer-prompt.md": "new reviewer prompt\n",
  });
  ```

  Change the update call to:

  ```ts
  sourceRoots: {
    patchmillSkillsDir: patchmillSource,
    superpowersSkillsDir: superpowersSource,
  },
  packSkills: [{ name: "writing-plans", source: "patchmill" }],
  ```

  Assert that `.patchmill/skills/writing-plans/plan-document-reviewer-prompt.md`
  is copied, owner-writable, and recorded in metadata.

  In `updateProjectSkills aborts when managed files changed locally`, add a
  second dirty managed file under
  `.patchmill/skills/writing-plans/plan-document-reviewer-prompt.md`, record its
  old hash in metadata, and assert the rejection includes both the `SKILL.md`
  path and the sidecar path. This proves customized adapted skill files remain
  protected by the updater.

- [ ] **Step 4: Add a failing package-content test for adapted skill sidecars**

  In `bin/package-files.test.ts`, extend
  `npm pack dry-run includes bundled runtime resources and notices` with these
  assertions:

  ```ts
  assert.equal(files.has("skills/brainstorming/SKILL.md"), true);
  assert.equal(files.has("skills/brainstorming/visual-companion.md"), true);
  assert.equal(files.has("skills/writing-plans/SKILL.md"), true);
  assert.equal(
    files.has("skills/writing-plans/plan-document-reviewer-prompt.md"),
    true,
  );
  assert.equal(files.has("skills/test-driven-development/SKILL.md"), true);
  assert.equal(
    files.has("skills/test-driven-development/testing-anti-patterns.md"),
    true,
  );
  ```

- [ ] **Step 5: Run the focused failing tests**

  Run:

  ```bash
  node --test src/workflow/skill-pack.test.ts src/cli/commands/init/skill-installer.test.ts src/cli/commands/skills/update.test.ts bin/package-files.test.ts
  ```

  Expected: FAIL because `PATCHMILL_RECOMMENDED_SKILL_PACK.version` is still
  `2026.07`, the three skills are still `source: "superpowers"`, the bundled
  `skills/` directories do not exist yet, and installer/update tests expect
  Patchmill-sourced sidecars.

- [ ] **Step 6: Copy the upstream Superpowers skill directories as the starting
      point**

  Run this from the worktree root:

  ```bash
  SUPERPOWERS_SKILLS_DIR="$(node -e 'const { dirname, join } = require("node:path"); const { createRequire } = require("node:module"); const require = createRequire(process.cwd() + "/package.json"); process.stdout.write(join(dirname(require.resolve("superpowers/package.json")), "skills"));')"
  cp -R "$SUPERPOWERS_SKILLS_DIR/brainstorming" skills/brainstorming
  cp -R "$SUPERPOWERS_SKILLS_DIR/writing-plans" skills/writing-plans
  cp -R "$SUPERPOWERS_SKILLS_DIR/test-driven-development" skills/test-driven-development
  ```

  Verify the copied starting points:

  ```bash
  diff -qr "$SUPERPOWERS_SKILLS_DIR/brainstorming" skills/brainstorming
  diff -qr "$SUPERPOWERS_SKILLS_DIR/writing-plans" skills/writing-plans
  diff -qr "$SUPERPOWERS_SKILLS_DIR/test-driven-development" skills/test-driven-development
  ```

  Expected: all three `diff -qr` commands produce no output before Task 2
  customizes the copies.

- [ ] **Step 7: Update the recommended skill pack constant**

  In `src/workflow/skill-pack.ts`, change:

  ```ts
  version: "2026.07",
  ```

  to:

  ```ts
  version: "2026.07.1",
  ```

  In the `skills` array, change only these three entries:

  ```ts
  { name: "brainstorming", source: "patchmill" },
  { name: "test-driven-development", source: "patchmill" },
  { name: "writing-plans", source: "patchmill" },
  ```

  Leave all other Superpowers skills as `source: "superpowers"`.

- [ ] **Step 8: Run focused tests and commit Task 1**

  Run:

  ```bash
  node --test src/workflow/skill-pack.test.ts src/cli/commands/init/skill-installer.test.ts src/cli/commands/skills/update.test.ts bin/package-files.test.ts
  ```

  Expected: PASS.

  Commit:

  ```bash
  git add skills/brainstorming skills/writing-plans skills/test-driven-development src/workflow/skill-pack.ts src/workflow/skill-pack.test.ts src/cli/commands/init/skill-installer.test.ts src/cli/commands/skills/update.test.ts bin/package-files.test.ts
  git commit -m "feat(skills): vendor Patchmill-adapted Superpowers skills"
  ```

### Task 2: Apply Patchmill customizations to the adapted skill copies

**Files:**

- Modify: `skills/brainstorming/SKILL.md`
- Modify: `skills/writing-plans/SKILL.md`
- Modify: `skills/test-driven-development/SKILL.md`
- Modify: `src/workflow/skill-pack.test.ts`

**Interfaces:**

- Consumes: Upstream-derived skill copies from Task 1.
- Produces: Runtime skill text that tells project-local agents to use
  `docs/specs/`, `docs/plans/`, issue worktrees, and the Testing Value Gate.

- [ ] **Step 1: Add a failing runtime skill contract test**

  In `src/workflow/skill-pack.test.ts`, add these imports:

  ```ts
  import { readFileSync } from "node:fs";
  import { dirname, join } from "node:path";
  import { fileURLToPath } from "node:url";
  ```

  Add this helper near `const unixNewline = "name: sample\n";`:

  ```ts
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

  function bundledSkillText(skillName: string): string {
    return readFileSync(
      join(repoRoot, "skills", skillName, "SKILL.md"),
      "utf8",
    );
  }
  ```

  Add this test after `default pack records pinned external source`:

  ```ts
  test("Patchmill-adapted skills encode artifact locations, worktree policy, and test value", () => {
    const brainstorming = bundledSkillText("brainstorming");
    assert.match(brainstorming, /Patchmill customization/u);
    assert.match(brainstorming, /docs\/specs\/YYYY-MM-DD-<topic>-design\.md/u);
    assert.match(brainstorming, /issue worktree/u);
    assert.match(brainstorming, /using-git-worktrees/u);

    const writingPlans = bundledSkillText("writing-plans");
    assert.match(writingPlans, /Patchmill customization/u);
    assert.match(writingPlans, /docs\/plans\/YYYY-MM-DD-<feature-name>\.md/u);
    assert.match(writingPlans, /Testing Value Gate/u);
    assert.match(writingPlans, /direct verification/u);

    const tdd = bundledSkillText("test-driven-development");
    assert.match(tdd, /Patchmill customization/u);
    assert.match(tdd, /Testing Value Gate/u);
    assert.match(tdd, /Do not write new tests merely to assert/u);
    assert.match(tdd, /documentation text/u);
    assert.match(tdd, /package lock contents/u);
  });
  ```

- [ ] **Step 2: Run the focused failing test**

  Run:

  ```bash
  node --test src/workflow/skill-pack.test.ts
  ```

  Expected: FAIL because the copied upstream skills do not yet include Patchmill
  customization text.

- [ ] **Step 3: Customize `skills/brainstorming/SKILL.md`**

  Keep the upstream structure. Add this section immediately after the
  overview/hard-gate introduction and before the checklist:

  ```markdown
  ## Patchmill customization

  This skill starts from the pinned Superpowers `brainstorming` skill and layers
  Patchmill workflow policy on top.

  For Patchmill repositories:

  - Write validated design specs to `docs/specs/YYYY-MM-DD-<topic>-design.md`.
  - Treat the spec as the first artifact of the feature branch, not a
    base-branch note.
  - If already running in a Patchmill issue worktree, use that issue worktree
    and do not create another one.
  - If working ad hoc outside an issue worktree, use `using-git-worktrees`
    before writing the spec.
  - Return spec paths relative to the repository root.
  ```

  Replace the checklist item that mentions
  `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` with:

  ```markdown
  6. **Write design doc** — save to `docs/specs/YYYY-MM-DD-<topic>-design.md` in
     the issue worktree and commit
  ```

  Replace the documentation bullet that says
  `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` with:

  ```markdown
  - Write the validated design (spec) to
    `docs/specs/YYYY-MM-DD-<topic>-design.md`
    - (User preferences for spec location override this default)
    - In Patchmill runs, this path is relative to the issue worktree repository
      root.
  ```

  Update the user review gate example so it prints the new `docs/specs/...`
  path, not `docs/superpowers/specs/...`.

- [ ] **Step 4: Customize `skills/writing-plans/SKILL.md`**

  Keep the upstream structure. Replace the context/save block near the top with:

  ```markdown
  **Context:** In Patchmill repositories, plans are feature artifacts. Write
  them in the active Patchmill issue worktree. If no issue worktree exists yet,
  use `using-git-worktrees` before writing the plan.

  **Save plans to:** `docs/plans/YYYY-MM-DD-<feature-name>.md`

  - (User preferences for plan location override this default)
  - In Patchmill runs, this path is relative to the issue worktree repository
    root.
  ```

  Add this section after `## File Structure` and before task decomposition
  guidance:

  ```markdown
  ## Patchmill Testing Value Gate

  This skill starts from the pinned Superpowers `writing-plans` skill and layers
  Patchmill testing policy on top.

  Before planning a new automated test, apply the Testing Value Gate:

  - Will this test prove behavior rather than restate implementation or
    configuration?
  - Could it fail for a meaningful regression?
  - Will future maintainers benefit from rerunning it?
  - Is the behavior reusable or risky enough to justify test maintenance?

  Use automated tests by default for production behavior changes, bug fixes,
  reusable logic, parsing/validation, API contracts, error handling,
  security-sensitive behavior, and regressions.

  Do not write new tests merely to assert GitHub Actions workflow YAML content,
  dependency or requirements versions, package lock contents, static config
  values, documentation text, or one-off script structure. For those cases, plan
  direct verification instead, such as linting, syntax checks, dry-runs, builds,
  or existing test suites. When skipping a new automated test, state the
  verification used instead.
  ```

  In the plan template and execution handoff examples, replace
  `docs/superpowers/plans/<filename>.md` with `docs/plans/<filename>.md`.

- [ ] **Step 5: Customize `skills/test-driven-development/SKILL.md`**

  Keep the upstream red-green-refactor sections, but change the trigger policy
  from indiscriminate TDD to value-gated TDD.

  Add this section after `## Overview`:

  ```markdown
  ## Patchmill customization

  This skill starts from the pinned Superpowers `test-driven-development` skill
  and layers Patchmill testing policy on top.

  Automated tests are the default for production behavior changes, bug fixes,
  reusable logic, parsing/validation, API contracts, error handling,
  security-sensitive behavior, and regressions. Before writing a new automated
  test, apply the Testing Value Gate below. If the gate fails, use direct
  verification instead and state what verification was used.
  ```

  Replace the current `## When to Use` section with:

  ```markdown
  ## When to Use

  Use test-first development when changing behavior that should be protected by
  a reusable automated regression check:

  - Production behavior changes
  - Bug fixes and regressions
  - Reusable logic
  - Parsing and validation
  - API contracts
  - Error handling
  - Security-sensitive behavior

  Before writing a new automated test, apply the Testing Value Gate:

  - Will this test prove behavior rather than restate implementation or
    configuration?
  - Could it fail for a meaningful regression?
  - Will future maintainers benefit from rerunning it?
  - Is the behavior reusable or risky enough to justify test maintenance?

  If the answer is no, do not write a new automated test. Use direct
  verification instead.

  Do not write new tests merely to assert:

  - GitHub Actions workflow YAML content
  - Dependency or requirements versions
  - Package lock contents
  - Static config values
  - Documentation text
  - One-off script structure

  For those cases, verify with the appropriate command instead, such as linting,
  syntax checks, dry-runs, builds, or existing test suites. When skipping a new
  test, briefly state the verification used instead.
  ```

  Replace the `## The Iron Law` intro with:

  ````markdown
  ## The Iron Law

  ```text
  NO PRODUCTION BEHAVIOR CODE WITHOUT A VALUE-GATED FAILING TEST FIRST
  ```

  If the Testing Value Gate says a test is valuable, write the failing test
  before production behavior code. If the gate says a new test would only
  restate static content or configuration, do not force a test; use direct
  verification and document it.
  ````

  Update the `Verification Checklist` so `Every new function/method has a test`
  becomes:

  ```markdown
  - [ ] Every production behavior change that passed the Testing Value Gate has
        a test
  - [ ] Direct verification is stated for changes where the Testing Value Gate
        rejected a new test
  ```

- [ ] **Step 6: Run focused tests and commit Task 2**

  Run:

  ```bash
  node --test src/workflow/skill-pack.test.ts
  ```

  Expected: PASS.

  Commit:

  ```bash
  git add skills/brainstorming/SKILL.md skills/writing-plans/SKILL.md skills/test-driven-development/SKILL.md src/workflow/skill-pack.test.ts
  git commit -m "feat(skills): adapt planning and TDD policy for Patchmill"
  ```

### Task 3: Resolve and create planning artifacts from one issue-worktree context

**Files:**

- Modify: `src/cli/commands/run-once/stage-advancement.ts`
- Modify: `src/cli/commands/run-once/pipeline.ts`
- Modify: `src/cli/commands/run-once/pipeline.test.ts`

**Interfaces:**

- Consumes: `ensureIssueWorkspace()` closure in `pipeline.ts` and
  `IssueWorktreeResult` from `src/cli/commands/run-once/git.ts`.
- Produces: One `PlanningArtifactWorkspace` used before artifact resolution and
  then consistently for saved path checks, filename discovery, generated paths,
  Pi cwd, skill paths, path normalization, blocked details, and run-state
  updates.

- [ ] **Step 1: Update the existing plan-only test to assert Pi cwd through
      workspace state, not low-level argument order**

  In
  `runOneIssue claims the issue, comments automation start, writes run state, and exits plan-created for plan-only mode`,
  add these constants after `expectedPlanPath`:

  ```ts
  const expectedBranch = "agent/issue-12-add-once-runner-pipeline";
  const expectedWorktreePath =
    ".worktrees/patchmill-issue-12-add-once-runner-pipeline";
  const expectedWorktreeRoot = join(config.repoRoot, expectedWorktreePath);
  ```

  Add worktree command handlers before the `pi` handler:

  ```ts
  if (
    call.command === "git" &&
    call.args[0] === "worktree" &&
    call.args[1] === "list"
  ) {
    return { code: 0, stdout: "", stderr: "" };
  }

  if (
    call.command === "git" &&
    call.args[0] === "worktree" &&
    call.args[1] === "add"
  ) {
    assert.deepEqual(call.args, [
      "worktree",
      "add",
      "-b",
      expectedBranch,
      expectedWorktreePath,
      "HEAD",
    ]);
    return { code: 0, stdout: "", stderr: "" };
  }
  ```

  Replace the `pi` handler assertion:

  ```ts
  assert.equal(call.cwd, config.repoRoot);
  ```

  with:

  ```ts
  assert.equal(call.cwd, expectedWorktreeRoot);
  ```

  Add run-state assertions after `assert.equal(runState.planCommit, "abc123");`:

  ```ts
  assert.equal(runState.branch, expectedBranch);
  assert.equal(runState.worktreePath, expectedWorktreePath);
  ```

- [ ] **Step 2: Add a resume test where the saved plan exists only in the issue
      worktree**

  Add a new test after
  `runOneIssue reuses a saved created plan as plan-created in plan-only mode`:

  ```ts
  test("runOneIssue resolves saved planning artifacts from the issue worktree on resume", async () => {
    const config = await makeConfig({
      dryRun: false,
      execute: true,
      planOnly: true,
    });
    const planPath = "docs/plans/2026-05-14-issue-45-worktree-only-plan.md";
    const worktreePath = ".worktrees/patchmill-issue-45-worktree-only-plan";
    const worktreeRoot = join(config.repoRoot, worktreePath);
    await mkdir(join(worktreeRoot, "docs", "plans"), { recursive: true });
    await writeFile(
      join(worktreeRoot, planPath),
      "# worktree-only plan\n",
      "utf8",
    );
    await writeRunState(
      config.runStateDir,
      {
        issueNumber: 45,
        title: "Worktree only plan",
        status: "planning",
        branch: "agent/issue-45-worktree-only-plan",
        worktreePath,
        planPath,
        checkpoints: {
          claimed: true,
          startedCommentPosted: true,
          planCreated: true,
        },
      },
      NOW.toISOString(),
    );

    const runner = createMockRunner(async (call) => {
      if (
        call.command === "tea" &&
        call.args[0] === "issues" &&
        call.args[1] === "list"
      ) {
        const page = call.args[call.args.indexOf("--page") + 1];
        return {
          code: 0,
          stdout:
            page === "1"
              ? issueListPayload([
                  issue(45, ["in-progress", "bug"], "Worktree only plan"),
                ])
              : "[]",
          stderr: "",
        };
      }
      if (call.command === "git" && call.args[0] === "status") {
        return { code: 0, stdout: "", stderr: "" };
      }
      if (
        call.command === "git" &&
        call.args[0] === "worktree" &&
        call.args[1] === "list"
      ) {
        return { code: 0, stdout: `worktree ${worktreeRoot}\n`, stderr: "" };
      }
      if (
        call.command === "git" &&
        call.args[0] === "-C" &&
        call.args[2] === "branch"
      ) {
        return {
          code: 0,
          stdout: "agent/issue-45-worktree-only-plan\n",
          stderr: "",
        };
      }
      if (
        call.command === "tea" &&
        call.args[0] === "issues" &&
        call.args[1] === "edit"
      ) {
        return { code: 0, stdout: "", stderr: "" };
      }
      if (call.command === "tea" && call.args[0] === "comment") {
        return { code: 0, stdout: "", stderr: "" };
      }
      if (call.command === "pi") {
        throw new Error("saved worktree plan should not be regenerated");
      }
      throw new Error(
        `unexpected command: ${call.command} ${call.args.join(" ")}`,
      );
    });

    const result = await runOneIssue(runner, config, { now: NOW });

    assert.equal(result.status, "plan-created");
    assert.equal(result.planPath, planPath);
    assert.equal(
      runner.calls.some((call) => call.command === "pi"),
      false,
    );
  });
  ```

- [ ] **Step 3: Run the focused failing tests**

  Run:

  ```bash
  node --test src/cli/commands/run-once/pipeline.test.ts --test-name-pattern "plan-created for plan-only mode|worktree-only plan"
  ```

  Expected: FAIL because planning artifacts are still resolved against
  `config.repoRoot`, and generated plan Pi still runs from the base checkout.

- [ ] **Step 4: Add one planning artifact workspace type and artifact-dir
      mapper**

  In `src/cli/commands/run-once/stage-advancement.ts`, add a type import:

  ```ts
  import type { IssueWorktreeResult } from "./git.ts";
  ```

  Add this type near `WorkflowArtifactResolution`:

  ```ts
  type PlanningArtifactWorkspace = {
    repoRoot: string;
    branch?: string;
    worktreePath?: string;
  };
  ```

  Add this helper near `repoPath()`:

  ```ts
  function artifactDirForRepo(
    baseRepoRoot: string,
    artifactRepoRoot: string,
    artifactDir: string,
  ): string {
    return join(artifactRepoRoot, repoPath(baseRepoRoot, artifactDir).relative);
  }
  ```

- [ ] **Step 5: Extend `AdvancePlanningStagesOptions` with a pre-resolution
      workspace callback**

  Add this field to `AdvancePlanningStagesOptions`:

  ```ts
  ensurePlanningArtifactWorkspace?: () => Promise<PlanningArtifactWorkspace>;
  ```

  Destructure it in `advancePlanningStages`:

  ```ts
  ensurePlanningArtifactWorkspace,
  ```

  Add this code before
  `const preexistingPlan = await resolveWorkflowArtifact({ ... })`:

  ```ts
  const planningArtifactWorkspace = ensurePlanningArtifactWorkspace
    ? await ensurePlanningArtifactWorkspace()
    : { repoRoot: config.repoRoot };
  const planningRepoRoot = planningArtifactWorkspace.repoRoot;
  const planningPlansDir = artifactDirForRepo(
    config.repoRoot,
    planningRepoRoot,
    config.plansDir,
  );
  const planningSpecsDir = artifactDirForRepo(
    config.repoRoot,
    planningRepoRoot,
    config.specsDir,
  );
  const planningWorkspaceState = () => ({
    ...(planningArtifactWorkspace.branch
      ? { branch: planningArtifactWorkspace.branch }
      : {}),
    ...(planningArtifactWorkspace.worktreePath
      ? { worktreePath: planningArtifactWorkspace.worktreePath }
      : {}),
  });
  ```

  If TypeScript complains that `PlanningArtifactWorkspace` is not assignable
  from `IssueWorktreeResult`, map it explicitly rather than widening the
  callback type.

- [ ] **Step 6: Use the planning repo root consistently for artifact resolution
      and generation**

  In `advancePlanningStages()`, change the `preexistingPlan` resolver to use:

  ```ts
  repoRoot: planningRepoRoot,
  artifactDir: planningPlansDir,
  ```

  Change the spec resolver to use:

  ```ts
  repoRoot: planningRepoRoot,
  artifactDir: planningSpecsDir,
  ```

  Change the later plan resolver to use:

  ```ts
  repoRoot: planningRepoRoot,
  artifactDir: planningPlansDir,
  ```

  In both generated spec and generated plan `runPiPrompt()` calls, use
  `planningRepoRoot` for the cwd, `skillInvocationPaths(..., planningRepoRoot)`,
  and `repoRoot: planningRepoRoot`.

  Normalize returned artifact paths against `planningRepoRoot`:

  ```ts
  specPath = repoPath(planningRepoRoot, specResult.specPath).relative;
  planPath = repoPath(planningRepoRoot, planned.planPath).relative;
  ```

  Include `...planningWorkspaceState()` in blocked details and in every
  `writeRunState()` update that occurs after `planningArtifactWorkspace` is
  created, including `specPathResolved`, `specCreated`, `planPathResolved`,
  `planCreated`, `specReadyCommentPosted`, `planReadyCommentPosted`, and
  `readyLabelRestored` updates.

- [ ] **Step 7: Pass the pipeline's existing issue-worktree factory into
      planning advancement**

  In `src/cli/commands/run-once/pipeline.ts`, add this property to the
  `advancePlanningStages({ ... })` call:

  ```ts
  ensurePlanningArtifactWorkspace: async () => {
    const workspace = await ensureIssueWorkspace();
    return {
      repoRoot: join(config.repoRoot, workspace.worktreePath),
      branch: workspace.branch,
      worktreePath: workspace.worktreePath,
    };
  },
  ```

  Do not create a second worktree helper in `stage-advancement.ts`; reuse the
  closure that already validates resumable branch/worktree state and sets the
  pipeline's `branch` and `worktreePath` variables.

- [ ] **Step 8: Run focused tests and commit Task 3**

  Run:

  ```bash
  node --test src/cli/commands/run-once/pipeline.test.ts --test-name-pattern "plan-created for plan-only mode|worktree-only plan"
  node --test src/cli/commands/run-once/pipeline.test.ts
  ```

  Expected: PASS.

  Commit:

  ```bash
  git add src/cli/commands/run-once/stage-advancement.ts src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/pipeline.test.ts
  git commit -m "fix(run-once): resolve planning artifacts in issue worktrees"
  ```

### Task 4: Align Patchmill prompts and review templates with the Testing Value Gate

**Files:**

- Modify: `src/cli/commands/run-once/prompts.ts`
- Modify: `src/cli/commands/run-once/prompts.test.ts`
- Modify:
  `skills/single-subagent-dev-with-codex-and-thermo-reviews/prompts/implement-plan.md`
- Modify:
  `skills/subagent-dev-with-codex-and-thermo-reviews/prompts/fix-review-findings.md`
- Modify:
  `skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-review.md`

**Interfaces:**

- Consumes: Prompt builders used by plan and implementation stages.
- Produces: No-conflict instructions: plan creation, implementation workers, fix
  workers, and final reviewers all use value-gated automated tests instead of
  indiscriminate TDD.

- [ ] **Step 1: Add failing prompt tests for the Testing Value Gate**

  In
  `buildPlanCreationPrompt includes issue context, workflow rules, and result contracts`,
  add:

  ```ts
  assert.match(prompt, /Testing Value Gate/);
  assert.match(
    prompt,
    /Will this test prove behavior rather than restate implementation or configuration\?/,
  );
  assert.match(prompt, /Use direct verification instead/);
  assert.match(prompt, /documentation text/);
  ```

  In
  `buildImplementationPrompt includes plan-first execution, review loop, validation rules, and result contracts`,
  add:

  ```ts
  assert.match(prompt, /Testing Value Gate/);
  assert.match(prompt, /production behavior changes/);
  assert.match(prompt, /static config values/);
  assert.match(prompt, /When skipping a new automated test/);
  ```

- [ ] **Step 2: Run the focused failing prompt tests**

  Run:

  ```bash
  node --test src/cli/commands/run-once/prompts.test.ts
  ```

  Expected: FAIL because the prompt builders do not yet render the Testing Value
  Gate.

- [ ] **Step 3: Add shared Testing Value Gate prompt text**

  In `src/cli/commands/run-once/prompts.ts`, add this helper near the
  validation-rendering helpers:

  ```ts
  function renderTestingValueGateStep(): string {
    return renderNumberedStepText(
      [
        "Apply Patchmill's Testing Value Gate before adding new automated tests:",
        "- Will this test prove behavior rather than restate implementation or configuration?",
        "- Could it fail for a meaningful regression?",
        "- Will future maintainers benefit from rerunning it?",
        "- Is the behavior reusable or risky enough to justify test maintenance?",
        "Use automated tests by default for production behavior changes, bug fixes, reusable logic, parsing/validation, API contracts, error handling, security-sensitive behavior, and regressions.",
        "Do not write new tests merely to assert workflow YAML content, dependency versions, package lock contents, static config values, documentation text, or one-off script structure. Use direct verification instead, such as linting, syntax checks, dry-runs, builds, or existing test suites. When skipping a new automated test, state the verification used instead.",
      ].join("\n"),
    );
  }
  ```

  Add `renderTestingValueGateStep()` to the `workflow` arrays in
  `buildPlanCreationPrompt()` and `buildImplementationPrompt()` immediately
  after the existing validation-rule step.

- [ ] **Step 4: Update implementation worker prompt templates**

  In
  `skills/single-subagent-dev-with-codex-and-thermo-reviews/prompts/implement-plan.md`,
  replace the current TDD bullet with:

  ```markdown
  - Use automated tests by default for production behavior changes, bug fixes,
    reusable logic, parsing/validation, API contracts, error handling,
    security-sensitive behavior, and regressions. Before adding a new automated
    test, apply the Patchmill Testing Value Gate: the test must prove behavior
    rather than restate implementation/configuration, fail for a meaningful
    regression, benefit future maintainers, and cover behavior reusable or risky
    enough to justify maintenance. For workflow YAML, dependency versions,
    package lock contents, static config values, documentation text, or one-off
    script structure, use direct verification such as linting, syntax checks,
    dry-runs, builds, or existing test suites and state that verification.
  ```

  In
  `skills/subagent-dev-with-codex-and-thermo-reviews/prompts/fix-review-findings.md`,
  replace:

  ```markdown
  - Add or update tests when fixing behavior, validation, parsing, error
    handling, or regressions.
  ```

  with:

  ```markdown
  - Add or update tests when fixing behavior, validation, parsing, error
    handling, security-sensitive behavior, or regressions that pass the
    Patchmill Testing Value Gate. For static workflow/config/docs/lockfile
    findings where a new test would only restate file content, use direct
    verification and state it.
  ```

  In
  `skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-review.md`,
  update review guidance that asks for regressions/edge cases so reviewers flag
  missing high-value tests but do not demand low-value static-content tests. Add
  this bullet under the review focus list:

  ```markdown
  - Check that automated tests were added for behavior changes that pass the
    Patchmill Testing Value Gate, and that direct verification is stated for
    static docs/config/workflow/lockfile changes where a new test would only
    restate content.
  ```

- [ ] **Step 5: Run focused tests and commit Task 4**

  Run:

  ```bash
  node --test src/cli/commands/run-once/prompts.test.ts
  ```

  Expected: PASS.

  Commit:

  ```bash
  git add src/cli/commands/run-once/prompts.ts src/cli/commands/run-once/prompts.test.ts skills/single-subagent-dev-with-codex-and-thermo-reviews/prompts/implement-plan.md skills/subagent-dev-with-codex-and-thermo-reviews/prompts/fix-review-findings.md skills/subagent-dev-with-codex-and-thermo-reviews/prompts/final-review.md
  git commit -m "feat(prompts): apply Testing Value Gate guidance"
  ```

### Task 5: Refresh installed project-local skills, notices, and docs

**Files:**

- Modify: `.patchmill/skills/**`
- Modify: `.patchmill/skills/patchmill-skill-pack.json`
- Modify: `THIRD_PARTY_NOTICES.md`
- Modify: `bin/package-files.test.ts`
- Modify: `site/src/content/docs/guides/skills-configuration.md`

**Interfaces:**

- Consumes: Updated recommended bundled skill pack from Tasks 1-4 and the
  vendored Superpowers-derived skill copies.
- Produces: This repository's live project-local skill pack, release notices for
  vendored Superpowers material, and public docs that explain Patchmill-adapted
  Superpowers skills.

- [ ] **Step 1: Add failing third-party notice/package assertions**

  In `bin/package-files.test.ts`, extend
  `package metadata identifies Patchmill as Apache-2.0` with:

  ```ts
  assert.match(thirdPartyNotices, /## Superpowers adapted skills/u);
  assert.match(
    thirdPartyNotices,
    /Repository: <https:\/\/github\.com\/obra\/superpowers>/u,
  );
  assert.match(thirdPartyNotices, /License: MIT License/u);
  assert.match(thirdPartyNotices, /skills\/brainstorming/u);
  assert.match(thirdPartyNotices, /skills\/writing-plans/u);
  assert.match(thirdPartyNotices, /skills\/test-driven-development/u);
  ```

  Run:

  ```bash
  node --test bin/package-files.test.ts
  ```

  Expected: FAIL because `THIRD_PARTY_NOTICES.md` does not yet mention the
  vendored adapted Superpowers skills.

- [ ] **Step 2: Update third-party notices for vendored Superpowers-derived
      skills**

  In `THIRD_PARTY_NOTICES.md`, add this section after the existing `agent-stuff`
  section:

  ```markdown
  ## Superpowers adapted skills

  - Source: <https://github.com/obra/superpowers/tree/v6.0.3/skills>
  - Repository: <https://github.com/obra/superpowers>
  - License: MIT License (`node_modules/superpowers/LICENSE`)
  - Purpose: Provides the upstream starting point for Patchmill-adapted
    project-local workflow skills.

  Patchmill vendors adapted copies of the pinned Superpowers `brainstorming`,
  `writing-plans`, and `test-driven-development` skills under
  `skills/brainstorming`, `skills/writing-plans`, and
  `skills/test-driven-development`. The copies preserve the upstream structure
  and layer Patchmill-specific worktree, artifact-location, and testing-policy
  guidance on top.
  ```

  This notice change is documentation/legal metadata. Do not add another test
  beyond the package metadata assertion above; verify with markdown lint and
  package tests.

- [ ] **Step 3: Refresh the repository-local managed skill pack**

  Run:

  ```bash
  npm run patchmill -- skills update
  ```

  Expected: PASS and report an update from the previous managed version to
  `2026.07.1`.

  If the command refuses because a managed project-local skill was customized,
  stop and inspect the listed file. Do not force-overwrite customized files
  without a human decision.

- [ ] **Step 4: Verify local metadata points at the pinned upstream source and
      new pack version**

  Run:

  ```bash
  node -e 'const fs = require("node:fs"); const data = JSON.parse(fs.readFileSync(".patchmill/skills/patchmill-skill-pack.json", "utf8")); console.log(data.pack.version); console.log(data.pack.source.repository); console.log(data.pack.source.tag); console.log(data.files.some((file) => file.path === ".patchmill/skills/brainstorming/SKILL.md")); console.log(data.files.some((file) => file.path === ".patchmill/skills/writing-plans/SKILL.md")); console.log(data.files.some((file) => file.path === ".patchmill/skills/test-driven-development/SKILL.md"));'
  ```

  Expected output:

  ```text
  2026.07.1
  obra/superpowers
  v6.0.3
  true
  true
  true
  ```

- [ ] **Step 5: Update skills-configuration docs**

  In `site/src/content/docs/guides/skills-configuration.md`, add this paragraph
  after the first paragraph under `## Recommended skill pack`:

  ```markdown
  A few recommended project-local skills are Patchmill-adapted copies of pinned
  Superpowers skills. Patchmill uses the upstream Superpowers skill as the
  starting point, then layers repository workflow rules on top. The adapted
  `brainstorming` and `writing-plans` skills save artifacts under `docs/specs/`
  and `docs/plans/` in the issue worktree; the adapted `test-driven-development`
  skill keeps test-first behavior for meaningful production behavior while
  applying Patchmill's Testing Value Gate so agents use direct verification for
  static docs, workflow YAML, lockfiles, dependency versions, and similar
  low-value-test changes.
  ```

  This is a documentation change. Do not add a new automated test solely for the
  paragraph; verify it with markdown lint and the docs build in Task 6.

- [ ] **Step 6: Run direct docs/package verification and commit Task 5**

  Run:

  ```bash
  node --test bin/package-files.test.ts
  npm run lint:md
  ```

  Expected: PASS.

  Commit:

  ```bash
  git add .patchmill/skills THIRD_PARTY_NOTICES.md bin/package-files.test.ts site/src/content/docs/guides/skills-configuration.md
  git commit -m "docs(skills): describe adapted Superpowers skills"
  ```

### Task 6: Full verification, package check, and final review readiness

**Files:**

- No planned source changes unless verification reveals a defect.

**Interfaces:**

- Consumes: All previous task commits.
- Produces: Verified final branch with tests, lint, package check, docs build,
  notice coverage, and clean status.

- [ ] **Step 1: Run the full automated test suite**

  Run:

  ```bash
  npm test
  ```

  Expected: PASS.

- [ ] **Step 2: Run the full lint suite**

  Run:

  ```bash
  npm run lint
  ```

  Expected: PASS.

- [ ] **Step 3: Verify package contents include adapted skills and notices**

  Run:

  ```bash
  npm pack --dry-run --json --ignore-scripts > /tmp/patchmill-pack.json
  node -e 'const fs = require("node:fs"); const files = new Set(JSON.parse(fs.readFileSync("/tmp/patchmill-pack.json", "utf8"))[0].files.map((file) => file.path)); for (const path of ["skills/brainstorming/SKILL.md", "skills/brainstorming/visual-companion.md", "skills/writing-plans/SKILL.md", "skills/writing-plans/plan-document-reviewer-prompt.md", "skills/test-driven-development/SKILL.md", "skills/test-driven-development/testing-anti-patterns.md", "THIRD_PARTY_NOTICES.md"]) { if (!files.has(path)) { throw new Error(`missing ${path}`); } console.log(`ok ${path}`); }'
  ```

  Expected: seven `ok ...` lines.

- [ ] **Step 4: Verify upstream starting-point references and notice text**

  Run:

  ```bash
  node -e 'const fs = require("node:fs"); const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")); const pack = JSON.parse(fs.readFileSync(".patchmill/skills/patchmill-skill-pack.json", "utf8")); const notices = fs.readFileSync("THIRD_PARTY_NOTICES.md", "utf8"); console.log(pkg.dependencies.superpowers); console.log(pack.pack.source.tag); console.log(pack.pack.version); console.log(/Superpowers adapted skills/.test(notices)); console.log(/MIT License/.test(notices));'
  ```

  Expected output includes:

  ```text
  https://github.com/obra/superpowers/archive/refs/tags/v6.0.3.tar.gz
  v6.0.3
  2026.07.1
  true
  true
  ```

- [ ] **Step 5: Build docs site**

  Run:

  ```bash
  npm --prefix site run build
  ```

  Expected: PASS.

- [ ] **Step 6: Check whether Nix build is required**

  Run:

  ```bash
  git diff --name-only main...HEAD | grep -E '^(package.json|package-lock.json|npm-shrinkwrap.json)$' || true
  ```

  Expected: no output. If there is output, run the project's Nix build before
  final handoff.

- [ ] **Step 7: Inspect final diff and status**

  Run:

  ```bash
  git status --short
  git log --oneline --max-count=8
  git diff --stat main...HEAD
  ```

  Expected: clean worktree, task commits present, and diff limited to
  bundled/adapted skills, skill-pack code/tests, installer/update tests,
  run-once planning workspace fix, prompt text, project-local skill refresh,
  third-party notices, docs, spec, and plan.

- [ ] **Step 8: Prepare final handoff**

  Summarize:
  - adapted skills installed from Superpowers starting points plus Patchmill
    customizations;
  - generated spec/plan Pi runs now resolve and create artifacts from one
    issue-worktree planning context;
  - Testing Value Gate appears in skill and prompt instructions;
  - installer/update tests cover adapted skill files, sidecars, hashes, clean
    updates, and customized-file refusal;
  - `THIRD_PARTY_NOTICES.md` covers vendored Superpowers-derived skills;
  - `patchmill skills update` refreshed local managed skills or any reason it
    could not;
  - validation commands and results.
