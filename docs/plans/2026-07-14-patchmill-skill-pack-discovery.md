# Patchmill Skill Pack Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Patchmill-launched Pi runs load the project-local
`.patchmill/skills/` directory while using prompts to select the configured
stage skill.

**Architecture:** Centralize skill argument resolution in
`src/workflow/skill-resolution.ts`, so triage, run-once, and doctor all get
directory-oriented skill arguments through existing call sites. The resolver
should include the project-local skill directory when it exists, omit duplicate
individual paths for skills under that directory, and keep explicit paths for
configured skills outside that directory.

**Tech Stack:** TypeScript on Node.js 24, Node's built-in test runner, existing
Patchmill command runner test helpers, Pi CLI `--skill` directory discovery.

## Global Constraints

- Full project-local skill directory discovery is desirable and should be
  enabled for Patchmill-launched Pi runs.
- Configured stage-specific skills should be selected by prompt, not by
  duplicating every in-directory skill path as an explicit `--skill` argument.
- Patchmill should still pass individual configured skill paths when they are
  outside the loaded project skill directory.
- Patchmill should not write persistent Pi settings for this behavior.
- `patchmill doctor` should verify runtime discoverability of
  `.patchmill/skills/`.
- Do not hardcode a dependency graph for Superpowers or Patchmill-managed
  workflow skills.
- Do not parse free-form skill prose at runtime to infer support-skill
  dependencies.
- Do not change npm dependencies. If dependency files change accidentally,
  revert them before committing.

---

## File structure

- Modify `src/workflow/skill-resolution.ts`
  - Add project-local skill directory detection.
  - Change `resolveConfiguredSkillInvocation()` so its `paths` output is
    directory-oriented.
  - Preserve exported compatibility through `skillInvocationPaths()` and
    `skillInvocationArgs()`.
- Modify `src/workflow/skill-resolution.test.ts`
  - Add resolver regression tests for directory inclusion, in-directory path
    omission, external path preservation, and missing-directory fallback.
  - Update existing expectations that assumed explicit in-directory `SKILL.md`
    arguments.
- Modify runtime invocation tests only where expectations change:
  - `src/pi/runner.test.ts`
  - `src/cli/commands/triage/execute-agent.test.ts`
  - `src/cli/commands/triage/dry-run-agent.test.ts`
  - Existing run-once pipeline tests if they assert `--skill` paths.
- Modify `src/cli/commands/doctor/checks.ts`
  - Update smoke-test wording from configured local skill files to project-local
    skill directory discovery.
  - Keep the smoke test using `resolveConfiguredSkillInvocation()` output so
    doctor matches runtime.
- Modify `src/cli/commands/doctor/checks.test.ts`
  - Update smoke command expectations to use `.patchmill/skills/` plus explicit
    outside-directory paths.
  - Replace the old “ignores unused .patchmill skills” expectation with a
    directory-discovery expectation.

---

### Task 1: Make skill resolution directory-oriented

**Files:**

- Modify: `src/workflow/skill-resolution.ts`
- Modify: `src/workflow/skill-resolution.test.ts`

**Interfaces:**

- Consumes: `DEFAULT_PROJECT_SKILL_DIR` from `src/workflow/skill-pack.ts`.
- Produces: unchanged public functions:
  - `resolveConfiguredSkillInvocation(skills: Array<string | undefined>, repoRoot: string): SkillInvocationResolution`
  - `skillInvocationPaths(skills: Array<string | undefined>, repoRoot: string): string[]`
  - `skillInvocationArgs(skill: string | undefined, repoRoot: string): string[]`
- Behavior change: when `repoRoot/.patchmill/skills` exists as a directory,
  `paths` starts with that directory and excludes individual configured skill
  paths under that directory.

- [ ] **Step 1: Add failing resolver tests for project-local directory
      discovery**

Add these tests to `src/workflow/skill-resolution.test.ts` after the existing
`skillInvocationPaths keeps only invokable skill paths in order` test:

```ts
test("skillInvocationPaths loads project-local skill directory once", async () => {
  const repoRoot = await tempRepo();
  await writeProjectLocalSkill(repoRoot, "writing-plans");
  await writeProjectLocalSkill(repoRoot, "subagent-driven-development");

  assert.deepEqual(
    skillInvocationPaths(
      [
        `${DEFAULT_PROJECT_SKILL_DIR}/writing-plans`,
        `${DEFAULT_PROJECT_SKILL_DIR}/subagent-driven-development/SKILL.md`,
      ],
      repoRoot,
    ),
    [join(repoRoot, DEFAULT_PROJECT_SKILL_DIR)],
  );
});

test("skillInvocationPaths keeps explicit skills outside project-local directory", async () => {
  const repoRoot = await tempRepo();
  await writeProjectLocalSkill(repoRoot, "writing-plans");
  await mkdir(join(repoRoot, "custom-skills", "review"), { recursive: true });
  await writeFile(
    join(repoRoot, "custom-skills", "review", "SKILL.md"),
    skillDocument("review"),
  );

  assert.deepEqual(
    skillInvocationPaths(
      [`${DEFAULT_PROJECT_SKILL_DIR}/writing-plans`, "custom-skills/review"],
      repoRoot,
    ),
    [
      join(repoRoot, DEFAULT_PROJECT_SKILL_DIR),
      join(repoRoot, "custom-skills", "review", "SKILL.md"),
    ],
  );
});

test("skillInvocationPaths preserves configured paths when project-local directory is absent", async () => {
  const repoRoot = await tempRepo();

  assert.deepEqual(
    skillInvocationPaths(
      [`${DEFAULT_PROJECT_SKILL_DIR}/writing-plans`],
      repoRoot,
    ),
    [join(repoRoot, DEFAULT_PROJECT_SKILL_DIR, "writing-plans", "SKILL.md")],
  );
});
```

- [ ] **Step 2: Run the new resolver tests and confirm failure**

Run:

```bash
node --test src/workflow/skill-resolution.test.ts
```

Expected result: at least the two directory-discovery assertions fail because
the resolver still returns individual `SKILL.md` paths under
`.patchmill/skills/`.

- [ ] **Step 3: Implement readable project-local skill directory detection**

In `src/workflow/skill-resolution.ts`, update the imports:

```ts
import { existsSync, statSync } from "node:fs";
```

Add these helpers near `pathStartsWith()`:

```ts
function readableDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function projectLocalSkillRoot(repoRoot: string): string {
  return resolve(repoRoot, DEFAULT_PROJECT_SKILL_DIR);
}

function isProjectLocalSkillPath(path: string, repoRoot: string): boolean {
  return pathStartsWith(resolve(path), projectLocalSkillRoot(repoRoot));
}
```

- [ ] **Step 4: Update `resolveConfiguredSkillInvocation()` path construction**

Replace the current `projectLocalRoot`, `configuredProjectLocalPaths`, and
return block in `resolveConfiguredSkillInvocation()` with this shape:

```ts
const projectLocalRoot = projectLocalSkillRoot(repoRoot);
const projectLocalRootAvailable = readableDirectory(projectLocalRoot);
const configuredProjectLocalPaths = configuredPaths.filter((path) =>
  isProjectLocalSkillPath(path, repoRoot),
);
const configuredOutsideProjectLocalPaths = configuredPaths.filter(
  (path) =>
    !projectLocalRootAvailable || !isProjectLocalSkillPath(path, repoRoot),
);

return {
  paths: unique([
    ...(projectLocalRootAvailable ? [projectLocalRoot] : []),
    ...configuredOutsideProjectLocalPaths,
  ]),
  diagnostics,
  configuredProjectLocalPaths: unique(configuredProjectLocalPaths),
  usedProjectLocalPack: projectLocalRootAvailable,
};
```

Keep the existing `configuredPaths` construction unchanged so bundled skill
references and explicit outside paths still resolve exactly as before.

- [ ] **Step 5: Update old resolver test expectations affected by an existing
      project-local directory**

In `src/workflow/skill-resolution.test.ts`, update tests that create
`.patchmill/skills/` and then expected individual in-directory paths.

For
`resolveConfiguredSkillInvocation uses only skill paths configured in patchmill config`,
change `result.paths` to:

```ts
assert.deepEqual(result.paths, [join(repoRoot, DEFAULT_PROJECT_SKILL_DIR)]);
```

Keep `result.configuredProjectLocalPaths` assertions as individual `SKILL.md`
paths; that field still records which configured paths pointed into the
project-local skill root.

For
`resolveConfiguredSkillInvocation uses configured paths only when metadata is missing`,
change `result.paths` to:

```ts
assert.deepEqual(result.paths, [join(repoRoot, DEFAULT_PROJECT_SKILL_DIR)]);
```

For
`resolveConfiguredSkillInvocation preserves mixed configured ordering when metadata is missing`,
change `result.paths` to:

```ts
assert.deepEqual(result.paths, [
  join(repoRoot, DEFAULT_PROJECT_SKILL_DIR),
  join(repoRoot, "skills", "toolchain", "SKILL.md"),
]);
```

- [ ] **Step 6: Run resolver tests**

Run:

```bash
node --test src/workflow/skill-resolution.test.ts
```

Expected result: all tests in `src/workflow/skill-resolution.test.ts` pass.

- [ ] **Step 7: Commit resolver changes**

Run:

```bash
git add src/workflow/skill-resolution.ts src/workflow/skill-resolution.test.ts
git commit -m "fix(skills): resolve project skill directory"
```

---

### Task 2: Update runtime invocation tests for directory-oriented skill args

**Files:**

- Modify: `src/pi/runner.test.ts`
- Modify: `src/cli/commands/triage/execute-agent.test.ts`
- Modify: `src/cli/commands/triage/dry-run-agent.test.ts`
- Modify if failing after targeted runs: `src/cli/commands/run-once/*.test.ts`

**Interfaces:**

- Consumes: updated `skillInvocationPaths()` behavior from Task 1.
- Produces: runtime Pi invocations that pass `.patchmill/skills/` when it exists
  and keep outside-directory explicit paths.

- [ ] **Step 1: Run targeted runtime tests and record failing expectations**

Run:

```bash
node --test src/pi/runner.test.ts src/cli/commands/triage/execute-agent.test.ts src/cli/commands/triage/dry-run-agent.test.ts
```

Expected result: tests that previously asserted explicit
`.patchmill/skills/name/SKILL.md` arguments fail because the resolver now
returns `.patchmill/skills/` once.

- [ ] **Step 2: Update Pi runner plan test expectations**

In `src/pi/runner.test.ts`, find the plan test that checks a configured local
planning skill. Change the expected `--skill` path from the individual planning
`SKILL.md` file to:

```ts
join(repoRoot, ".patchmill", "skills");
```

Also assert the generated prompt still names the configured planning skill path,
for example:

```ts
assert.match(call.args.join(" "), /--skill/);
assert.match(
  call.prompt ?? "",
  /Use the configured planning skill: `\.patchmill\/skills\/writing-plans`\./u,
);
```

If the fake runner does not expose `prompt`, assert against the prompt-building
unit test instead of adding new fake-runner plumbing.

- [ ] **Step 3: Update Pi runner implementation test expectations**

In `src/pi/runner.test.ts`, update the implementation test that currently
expects toolchain, implementation `SKILL.md`, and bundled visual evidence paths.
With a local `.patchmill/skills/` directory present and a custom toolchain
outside the directory, the expected skill paths should be:

```ts
assert.deepEqual(skillPaths, [
  join(repoRoot, ".patchmill", "skills"),
  join(repoRoot, "skills", "toolchain", "SKILL.md"),
  bundledVisualEvidenceSkillPath(),
]);
```

If the test config sets `visualEvidence` to a project-local path, omit
`bundledVisualEvidenceSkillPath()` and expect only the project skill directory
plus outside toolchain path.

- [ ] **Step 4: Update triage execute test expectations**

In `src/cli/commands/triage/execute-agent.test.ts`, update the test that creates
`.patchmill/skills/patchmill-issue-triage/SKILL.md`.

The captured skill paths should be:

```ts
assert.deepEqual(skillPaths, [join(repoRoot, ".patchmill", "skills")]);
```

Add or keep an assertion that the prompt still contains:

```ts
assert.match(
  prompt,
  /Use the configured triage skill: `\.patchmill\/skills\/patchmill-issue-triage`\./u,
);
```

- [ ] **Step 5: Update triage dry-run test expectations**

In `src/cli/commands/triage/dry-run-agent.test.ts`, update the local triage
skill assertion the same way:

```ts
assert.deepEqual(skillPaths, [join(repoRoot, ".patchmill", "skills")]);
```

Keep or add prompt assertion:

```ts
assert.match(
  prompt,
  /Use the configured triage skill: `\.patchmill\/skills\/patchmill-issue-triage`\./u,
);
```

- [ ] **Step 6: Add a regression test for outside-directory configured skills**

Add a runtime-level test in `src/pi/runner.test.ts` or
`src/workflow/skill-resolution.test.ts` if Task 1 did not cover it sufficiently.
The lower-level resolver test is enough for the core behavior; add a runtime
test only if an existing runtime test already covers mixed local and custom
skill paths.

Use this expected path shape:

```ts
[
  join(repoRoot, ".patchmill", "skills"),
  join(repoRoot, "custom-skills", "implementation", "SKILL.md"),
];
```

- [ ] **Step 7: Run targeted runtime tests**

Run:

```bash
node --test src/pi/runner.test.ts src/cli/commands/triage/execute-agent.test.ts src/cli/commands/triage/dry-run-agent.test.ts
```

Expected result: all targeted tests pass.

- [ ] **Step 8: Run run-once prompt and pipeline tests if needed**

Run:

```bash
node --test src/cli/commands/run-once/*.test.ts
```

Expected result: all run-once tests pass. If a test fails because it asserted
individual in-directory skill files, update it to expect `.patchmill/skills/`
and keep assertions that prompts name the configured stage skill.

- [ ] **Step 9: Commit runtime test changes**

Run:

```bash
git add src/pi/runner.test.ts src/cli/commands/triage/execute-agent.test.ts src/cli/commands/triage/dry-run-agent.test.ts src/cli/commands/run-once/*.test.ts
git commit -m "test(skills): cover directory-based pi invocations"
```

If `src/cli/commands/run-once/*.test.ts` did not change, omit that path from
`git add`.

---

### Task 3: Align doctor smoke tests with project skill directory discovery

**Files:**

- Modify: `src/cli/commands/doctor/checks.ts`
- Modify: `src/cli/commands/doctor/checks.test.ts`

**Interfaces:**

- Consumes: `resolveConfiguredSkillInvocation()` from Task 1.
- Produces: doctor smoke tests that use the same directory-oriented skill paths
  as runtime.

- [ ] **Step 1: Add failing doctor tests for directory smoke paths**

In `src/cli/commands/doctor/checks.test.ts`, update
`recommendedProjectLocalSmokePaths(repoRoot)` if it currently returns individual
`SKILL.md` files. It should return:

```ts
function recommendedProjectLocalSmokePaths(repoRoot: string): string[] {
  return [join(repoRoot, DEFAULT_PROJECT_SKILL_DIR)];
}
```

Then update the
`runDoctorChecks passes for fresh configured project-local skills` test so its
`expectedSmokeCommand` uses that directory-only path list.

Run:

```bash
node --test src/cli/commands/doctor/checks.test.ts
```

Expected result: at least one doctor test fails because production doctor still
uses old wording or old path assumptions.

- [ ] **Step 2: Update doctor smoke-test prompt and summary wording**

In `src/cli/commands/doctor/checks.ts`, update the project-local smoke test
summary strings.

Replace:

```ts
summary: "Pi loaded configured local skills",
```

with:

```ts
summary: "Pi loaded the project-local skill directory",
```

Replace:

```ts
summary: `Pi could not load the configured local skills: ${commandOutput(result)}`,
```

with:

```ts
summary: `Pi could not load the project-local skill directory: ${commandOutput(result)}`,
```

If `PROJECT_LOCAL_SKILLS_PROMPT` says “configured local skills”, update it to
directory-oriented wording:

```ts
const PROJECT_LOCAL_SKILLS_PROMPT =
  "Confirm Patchmill project-local skills are discoverable. If the available skills include Patchmill project-local skills from the loaded skill directory, print PATCHMILL_SKILLS_OK and nothing else.";
```

Keep the exact sentinel string `PATCHMILL_SKILLS_OK`.

- [ ] **Step 3: Ensure doctor smoke testing uses resolver paths unchanged**

Keep this existing call shape in `checkSkills()`:

```ts
await smokeTestProjectLocalSkills(
  runner,
  repoRoot,
  resolution.paths,
  piAgentDir,
);
```

Do not build a separate doctor-specific list. After Task 1, `resolution.paths`
is already the runtime-compatible directory-oriented list.

- [ ] **Step 4: Update the global/named-skill doctor test**

Rename the old test:

```ts
test("runDoctorChecks ignores unused .patchmill skills when config uses global/named skills", async () => {
```

to:

```ts
test("runDoctorChecks smoke-tests project-local skills when directory exists with named config", async () => {
```

Change its test data so the directory contains at least one valid skill rather
than only an invalid stale skill:

```ts
await writeProjectLocalSkill(
  repoRoot,
  "module-size",
  skillDocument("module-size", "Keep modules focused."),
);
```

Set the expected smoke paths to include the project-local directory and the
bundled default visual evidence path, because the merged default config still
includes bundled visual evidence when the test does not override it:

```ts
const smokePaths = [
  join(repoRoot, DEFAULT_PROJECT_SKILL_DIR),
  bundledVisualEvidenceSkillPath(),
];
```

Mock success for that command:

```ts
successMocks(REQUIRED_LABELS, {
  [projectLocalPiSmokeCommand(smokePaths)]: {
    code: 0,
    stdout: "PATCHMILL_SKILLS_OK\n",
  },
});
```

Update assertions:

```ts
assert.match(
  skills?.message ?? "",
  /Pi loaded the project-local skill directory/,
);
assert.ok(calls.includes(projectLocalPiSmokeCommand(smokePaths)));
```

Remove assertions that expect no `PATCHMILL_SKILLS_OK` smoke test.

- [ ] **Step 5: Update malformed metadata smoke-path expectations**

In
`runDoctorChecks smoke-tests the exact shared resolver paths when metadata is malformed`,
update `smokePaths` from individual project-local skill files to:

```ts
const smokePaths = [
  join(repoRoot, DEFAULT_PROJECT_SKILL_DIR),
  bundledVisualEvidenceSkillPath(),
];
```

Keep the assertion that stale skill names do not appear directly in the command,
because the command should contain the directory path, not every skill file
path:

```ts
assert.equal(
  calls.some((call) => call.includes("stale-unused-skill/SKILL.md")),
  false,
);
```

- [ ] **Step 6: Add a failing-smoke diagnostic test**

Add this test near the other project-local doctor tests:

```ts
test("runDoctorChecks fails when Pi cannot discover project-local skill directory", async () => {
  const repoRoot = await tempRepo();
  await writeConfig(repoRoot, recommendedProjectLocalConfig());
  await mkdir(join(repoRoot, "docs"), { recursive: true });
  await installProjectSkills({
    repoRoot,
    installedAt: "2026-05-29T00:00:00.000Z",
  });

  const smokePaths = recommendedProjectLocalSmokePaths(repoRoot);
  const runner: CommandRunner = {
    async run(command, args) {
      const key = normalizePiCommandKey(command, args);
      return (
        successMocks(REQUIRED_LABELS, {
          [projectLocalPiSmokeCommand(smokePaths)]: {
            code: 1,
            stdout: "",
            stderr: "skill path does not exist",
          },
        })[key] ?? {
          code: 127,
          stdout: "",
          stderr: `missing mock for ${key}`,
        }
      );
    },
  };

  const results = await runDoctorChecks(runner, {
    repoRoot,
    teaRepoRootForTests: "/repo",
  });
  const skills = results.find((result) => result.name === "skills");

  assert.equal(skills?.status, "fail");
  assert.match(
    skills?.message ?? "",
    /Pi could not load the project-local skill directory/,
  );
});
```

- [ ] **Step 7: Run doctor tests**

Run:

```bash
node --test src/cli/commands/doctor/checks.test.ts
```

Expected result: all doctor tests pass.

- [ ] **Step 8: Commit doctor changes**

Run:

```bash
git add src/cli/commands/doctor/checks.ts src/cli/commands/doctor/checks.test.ts
git commit -m "fix(doctor): verify project skill directory discovery"
```

---

### Task 4: Final verification and cleanup

**Files:**

- No planned source edits unless verification reveals a regression.
- Review: `docs/specs/2026-07-14-patchmill-skill-pack-discovery-design.md`
- Review: `docs/plans/2026-07-14-patchmill-skill-pack-discovery.md`

**Interfaces:**

- Consumes: all implementation commits from Tasks 1 through 3.
- Produces: verified branch ready for review or PR handoff.

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm test
```

Expected result:

```text
fail 0
```

The exact pass count can vary as tests are added, but there must be zero failing
tests.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected result: Prettier, TypeScript ESLint, and markdownlint all complete
successfully.

- [ ] **Step 3: Verify package files did not change**

Run:

```bash
git status --short
```

Expected result: no changes to `package.json`, `package-lock.json`, or
`npm-shrinkwrap.json`. If one changed accidentally, inspect the diff and revert
it unless the implementation intentionally changed dependencies.

- [ ] **Step 4: Inspect final skill-argument behavior from tests**

Run:

```bash
node --test src/workflow/skill-resolution.test.ts src/pi/runner.test.ts src/cli/commands/triage/execute-agent.test.ts src/cli/commands/triage/dry-run-agent.test.ts src/cli/commands/doctor/checks.test.ts
```

Expected result: all targeted tests pass, covering directory discovery,
prompt-directed stage skills, outside-directory explicit paths, and doctor
runtime parity.

- [ ] **Step 5: Review final diff**

Run:

```bash
git diff --stat main...HEAD
git diff main...HEAD -- src/workflow/skill-resolution.ts src/cli/commands/doctor/checks.ts
```

Expected result: resolver changes are limited to skill argument resolution, and
doctor changes are limited to project-local skill directory discoverability.

- [ ] **Step 6: Commit any final verification-only fixes**

If verification required small test or formatting fixes, commit them with:

```bash
git add src test-support docs
 git commit -m "test(skills): verify skill pack discovery"
```

If no files changed during verification, do not create an empty commit.
