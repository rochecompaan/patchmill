# Non-Interactive Subagent Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Patchmill's parent implementation agent responsible for every
subagent through completion and prevent it from returning progress prose while
background work remains unresolved.

**Architecture:** Add one universal non-interactive orchestration contract and
one finalization gate to the generated implementation prompt. Add the same
lifecycle invariant to all three Patchmill-owned subagent-development wrappers,
then regenerate the installed skill pack so canonical skills, installed copies,
and managed hashes remain synchronized. Preserve each skill's current worker,
reviewer, validation, PR-check, concurrency, and landing topology.

**Tech Stack:** TypeScript prompt builders, Node's built-in test runner,
Markdown Pi skills, Patchmill's managed skill-pack updater, markdownlint, and
Prettier/TypeScript repository checks.

## Global Constraints

- This is a prompt- and skill-only behavior change. Do not add runtime
  enforcement, lifecycle hooks, finalization tools, environment variables,
  parser states, recovery logic, or user/project configuration.
- Preserve the configured workflow's freedom to use one or many subagents,
  sequential or parallel execution, and foreground or background mode.
- Do not add wording that prefers foreground dispatch.
- Do not change worker or reviewer child-output contracts; child-result
  confusion has not been observed.
- Use `subagent({ action: "status" })` as the documented inspection mechanism.
- Explain that status inspection does not replace `wait({ id })` or
  `wait({ all: true })` when a required result is outstanding.
- Permit genuinely independent parent work while background runs execute, but
  prohibit dependent workflow progress and finalization until those runs are
  resolved.
- An unresolved queued, running, paused, or needs-attention run is a hard
  instruction-level prohibition on the parent final response.
- Require completion of all configured tasks, reviews, fixes, re-reviews,
  validation, PR checks, todos, and landing before terminal JSON.
- Never return progress prose or promise to continue after the one-turn
  non-interactive `pi -p` response.
- Preserve the existing `blocked`, `pr-created`, and `merged` JSON schemas and
  parser behavior.
- Keep the upstream installed `subagent-driven-development` dependency
  unchanged. Patchmill-owned wrappers carry the Patchmill-specific invariant.
- Keep canonical `skills/` resources, installed `.patchmill/skills/` resources,
  and `.patchmill/skills/patchmill-skill-pack.json` hashes synchronized.
- Keep the skill pack at version `2026.07.2`; this change does not alter the
  installed Superpowers source tag or skill membership. The updater may refresh
  files and hashes without a version bump.
- Invoke `writing-skills` before editing or validating the skill Markdown. Treat
  the recorded issue #98 failure as the RED pressure scenario and the approved
  five-run observation window as post-deployment behavior evidence.
- Do not add tests that merely assert standalone skill Markdown prose. Use
  automated tests for generated production prompt behavior and direct
  verification for skill text and managed-copy parity.
- `src/cli/commands/run-once/prompts.ts` is already a large cohesive prompt
  builder. Keep the new private formatters beside the existing subagent and
  landing formatters; do not introduce an unrelated module split for this small
  declarative addition.
- The five-run observation window is post-implementation follow-up, not an
  implementation task todo that blocks the current handoff.
- No npm dependency changes are planned. If `package.json`, `package-lock.json`,
  or `npm-shrinkwrap.json` changes, stop and inspect the cause. If a dependency
  change is retained, run the required Nix build.

---

## File Structure

- Modify `src/cli/commands/run-once/prompts.ts` to add private renderers for the
  universal non-interactive orchestration contract and the pre-landing
  finalization gate.
- Modify `src/cli/commands/run-once/prompts.test.ts` to prove generated
  implementation prompts describe status, waiting, unresolved-run blocking,
  one-turn semantics, and terminal-response requirements.
- Modify `skills/subagent-dev-with-validation-and-pr-checks/SKILL.md` to add the
  parent lifecycle invariant without changing task review, validation, or PR
  check behavior.
- Modify `skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md` to add the
  same invariant without changing task reviews, Codex/thermo reviews, final
  validation, or PR checks.
- Modify `skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md` to
  add the same invariant without changing its single implementation worker or
  later review/validation/PR-check loops.
- Regenerate matching installed `SKILL.md` files beneath `.patchmill/skills/`
  from canonical sources.
- Regenerate `.patchmill/skills/patchmill-skill-pack.json` so managed SHA-256
  entries match the installed files while pack version `2026.07.2` and the
  Superpowers source tag remain unchanged.
- Amend `docs/specs/2026-07-18-non-interactive-subagent-finalization-design.md`
  only to record the required generated skill-pack hash synchronization.

---

### Task 1: Add the Universal Implementation-Prompt Contract

**Files:**

- Modify: `src/cli/commands/run-once/prompts.test.ts:440-655`
- Modify: `src/cli/commands/run-once/prompts.ts:227-236`
- Modify: `src/cli/commands/run-once/prompts.ts:556-632`
- Modify: `src/cli/commands/run-once/prompts.ts:838-902`

**Interfaces:**

- Consumes: existing `buildImplementationPrompt(...)`,
  `formatSubagentSupport()`, `renderLandingResultContracts(...)`, and the
  supported terminal result contracts.
- Produces: private `formatNonInteractiveSubagentOrchestration(): string` and
  `renderSubagentFinalizationGate(): string` helpers included in every
  implementation prompt.
- Preserves: all public prompt-builder signatures and every terminal JSON
  schema.

- [ ] **Step 1: Add failing assertions for the orchestration and finalization
      contracts**

In the existing test named
`buildImplementationPrompt includes plan-first execution, review loop, validation rules, and result contracts`,
add these assertions immediately after the current subagent-support assertions:

```ts
assert.match(prompt, /Non-interactive subagent orchestration:/);
assert.match(
  prompt,
  /This Patchmill `pi -p` invocation has one turn and will not be resumed/,
);
assert.match(
  prompt,
  /Use whatever subagent topology the configured implementation skill requires/,
);
assert.match(
  prompt,
  /Use `subagent\(\{ action: "status" \}\)` to inspect active runs/,
);
assert.match(prompt, /Status is inspection, not waiting/);
assert.match(
  prompt,
  /do not advance past a checkpoint that depends on a subagent/,
);
assert.match(
  prompt,
  /call `wait\(\{ id \}\)` or `wait\(\{ all: true \}\)` rather than ending the turn/,
);
assert.match(
  prompt,
  /Any queued, running, paused, needs-attention, or otherwise unresolved run prohibits the final response/,
);
assert.match(prompt, /Patchmill subagent finalization gate:/);
assert.match(
  prompt,
  /Never return progress prose or promise to continue after the response/,
);

const finalizationGateIndex = prompt.indexOf(
  "Patchmill subagent finalization gate:",
);
const landingContractsIndex = prompt.indexOf("Landing result contracts:");
assert.ok(finalizationGateIndex >= 0);
assert.ok(landingContractsIndex > finalizationGateIndex);
```

These assertions prove production prompt behavior. Do not add tests that parse
or assert the standalone wrapper Markdown.

- [ ] **Step 2: Run the prompt test and verify RED**

Run:

```bash
node --test src/cli/commands/run-once/prompts.test.ts
```

Expected: FAIL in the implementation-prompt test because
`Non-interactive subagent orchestration:` and
`Patchmill subagent finalization gate:` are not yet rendered.

- [ ] **Step 3: Add the universal non-interactive orchestration renderer**

Add this private helper immediately after `formatSubagentSupport()` in
`src/cli/commands/run-once/prompts.ts`:

```ts
function formatNonInteractiveSubagentOrchestration(): string {
  return [
    "Non-interactive subagent orchestration:",
    "- This Patchmill `pi -p` invocation has one turn and will not be resumed.",
    "- Use whatever subagent topology the configured implementation skill requires, including multiple sequential or parallel background runs.",
    "- Track every subagent run until it reaches a terminal state.",
    '- Use `subagent({ action: "status" })` to inspect active runs, or include an `id` to inspect one run.',
    "- Status is inspection, not waiting. Do not repeatedly poll status merely to pass time.",
    "- You may continue genuinely independent work while background runs are active, but do not advance past a checkpoint that depends on a subagent until it completes and you consume its result.",
    "- When no independent work remains and a result is required, call `wait({ id })` or `wait({ all: true })` rather than ending the turn.",
    "- Before finalizing, inspect active runs. Any queued, running, paused, needs-attention, or otherwise unresolved run prohibits the final response.",
    "- Resolve, await, resume, or interrupt every outstanding run before finalization.",
  ].join("\n");
}
```

Include it in `buildImplementationPrompt(...)` immediately after the existing
subagent-support block:

```ts
${formatSubagentSupport()}

${formatNonInteractiveSubagentOrchestration()}
```

Do not put this contract into spec, plan, development-environment, or unrelated
Pi prompt stages.

- [ ] **Step 4: Add the pre-landing finalization gate**

Add this private helper beside the landing-result renderers, immediately before
`renderLandingResultContracts(...)`:

```ts
function renderSubagentFinalizationGate(): string {
  return `Patchmill subagent finalization gate:
Before returning any terminal result:
1. Call \`subagent({ action: "status" })\` and confirm no subagent run is unresolved.
2. Confirm every task, review, accepted fix, re-review, validation command, PR check, todo, and landing step required by the configured workflow is complete.
3. Resolve, await, resume, or interrupt every outstanding run before returning.
4. Return only the specified \`merged\`, \`pr-created\`, or genuine human-input blocker JSON object.
Never return progress prose or promise to continue after the response. This non-interactive Pi invocation has no subsequent turn.`;
}
```

Render it immediately before the landing result contracts in
`buildImplementationPrompt(...)`:

```ts
${renderLandingSkillStep(skills)}

${renderSubagentFinalizationGate()}

${renderLandingResultContracts({
  allowDirectLand: git.allowDirectLand,
  hasLandingSkill: Boolean(skills.landing),
  targetBranch: git.baseBranch,
  remote: git.remote,
  issueNumber: issue.number,
  branch,
})}
```

Keep the gate outside `renderLandingResultContracts(...)` so every direct-land,
PR-only, and missing-landing-skill branch receives identical wording without
copying it three times.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npx prettier --write \
  src/cli/commands/run-once/prompts.ts \
  src/cli/commands/run-once/prompts.test.ts
node --test src/cli/commands/run-once/prompts.test.ts
```

Expected: Prettier reports the two prompt files and the test exits 0 with zero
failures, including the new orchestration assertions.

- [ ] **Step 6: Run TypeScript build verification**

Run:

```bash
npm run build
```

Expected: exit 0 with no TypeScript errors.

- [ ] **Step 7: Commit the prompt behavior**

```bash
git add \
  src/cli/commands/run-once/prompts.ts \
  src/cli/commands/run-once/prompts.test.ts
git commit -m "fix(prompts): require subagent completion before handoff"
```

---

### Task 2: Add the Lifecycle Invariant to Every Patchmill Wrapper

**Files:**

- Modify: `skills/subagent-dev-with-validation-and-pr-checks/SKILL.md:40-44`
- Modify: `skills/subagent-dev-with-validation-and-pr-checks/SKILL.md:145-155`
- Modify: `skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md:34-38`
- Modify: `skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md:219-236`
- Modify:
  `skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md:38-42`
- Modify:
  `skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md:256-273`
- Regenerate:
  `.patchmill/skills/subagent-dev-with-validation-and-pr-checks/SKILL.md`
- Regenerate:
  `.patchmill/skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md`
- Regenerate:
  `.patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md`
- Regenerate: `.patchmill/skills/patchmill-skill-pack.json`

**Interfaces:**

- Consumes: the documented `pi-subagents` `subagent({ action: "status" })`,
  `wait({ id })`, `wait({ all: true })`, resume, and interrupt behaviors.
- Produces: one identical `## Non-interactive Patchmill orchestration` section
  in all three canonical wrappers and their installed copies.
- Preserves: task-level worker/reviewer topology, single-worker topology,
  Codex/thermo loops, final validation, PR-check repair, and landing behavior.

- [ ] **Step 1: Establish the RED baseline from the recorded failure**

Read `writing-skills` before editing. Use the approved spec's issue #98 account
as the behavioral RED pressure scenario:

```text
The parent launched an async worker, knew status was running, polled status,
and returned progress prose promising to continue later. The one-turn Pi
process exited while the worker remained active.
```

Confirm the current canonical wrappers do not yet contain the proposed contract:

```bash
rg -n "Non-interactive Patchmill orchestration|Status is inspection, not waiting" \
  skills/subagent-dev-with-validation-and-pr-checks/SKILL.md \
  skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md \
  skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md
```

Expected: exit 1 with no matches. This source check supplements the already
observed behavioral failure; it is not a substitute for that pressure evidence.

- [ ] **Step 2: Add the exact lifecycle section to all three canonical skills**

Insert this exact section after each skill's agent-availability preflight and
before its process or skill-selection section:

```markdown
## Non-interactive Patchmill orchestration

Patchmill runs this skill inside a one-turn, non-interactive `pi -p` invocation.
Preserve the configured worker and reviewer topology, including multiple
sequential or parallel runs, while keeping lifecycle ownership in the parent
agent.

- Track every foreground or background subagent run until it reaches a terminal
  state.
- Use `subagent({ action: "status" })` to inspect active runs, or include an
  `id` to inspect one run.
- Status is inspection, not waiting. Do not repeatedly poll status merely to
  pass time.
- The parent may continue genuinely independent work while background runs are
  active, but it must not advance past a checkpoint that depends on a subagent
  until that run completes and its result is consumed.
- When no independent work remains and a required result is outstanding, call
  `wait({ id })` or `wait({ all: true })` rather than ending the turn.
- Before final handoff, inspect active runs. Any queued, running, paused,
  needs-attention, or otherwise unresolved run prohibits the final response.
- Resolve, await, resume, or interrupt every outstanding run before
  finalization.
- A subagent result is an intermediate workflow checkpoint. Continue through
  every remaining task, review, fix, re-review, validation, PR-check, todo, and
  landing step required by this skill.
- Never return progress prose or promise to continue after the response. This
  non-interactive invocation has no subsequent turn.
```

Do not change the frontmatter descriptions, dispatch examples, model choices,
agent count, concurrency, review order, validation order, PR-check retry policy,
or landing rules.

- [ ] **Step 3: Add explicit red flags to all three canonical skills**

Under each existing `Never:` list, add these exact bullets:

```markdown
- End the Patchmill turn while any subagent run remains unresolved.
- Use repeated status checks as a substitute for `wait` when no independent work
  remains.
- Return progress prose or promise to continue in a later turn.
```

These bullets close the rationalizations observed in issue #98 without changing
how many subagents the skill may use.

- [ ] **Step 4: Run direct canonical skill verification**

Run:

```bash
npx prettier --write \
  skills/subagent-dev-with-validation-and-pr-checks/SKILL.md \
  skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md \
  skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md
npx markdownlint-cli2 \
  skills/subagent-dev-with-validation-and-pr-checks/SKILL.md \
  skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md \
  skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md
```

Expected: Prettier reports the three canonical skill files and markdownlint
reports `Summary: 0 error(s)`.

Then verify each canonical skill contains one lifecycle heading and the three
red flags:

```bash
python - <<'PY'
from pathlib import Path

names = [
    "subagent-dev-with-validation-and-pr-checks",
    "subagent-dev-with-codex-and-thermo-reviews",
    "single-subagent-dev-with-codex-and-thermo-reviews",
]
for name in names:
    text = Path("skills", name, "SKILL.md").read_text()
    assert text.count("## Non-interactive Patchmill orchestration") == 1, name
    assert "Status is inspection, not waiting." in text, name
    assert "End the Patchmill turn while any subagent run remains unresolved." in text, name
    assert "Return progress prose or promise to continue in a later turn." in text, name
    print(f"{name}: lifecycle contract present")
PY
```

Expected: three `lifecycle contract present` lines.

- [ ] **Step 5: Regenerate installed skills and managed hashes**

Run from the task worktree root:

```bash
node bin/patchmill.ts skills update
```

Expected: the updater reports changed managed files, keeps pack version
`2026.07.2`, updates the three installed wrapper files, and refreshes their
entries in `.patchmill/skills/patchmill-skill-pack.json`.

Do not manually edit generated hashes or bump the Superpowers source tag.

- [ ] **Step 6: Verify canonical, installed, and metadata parity**

Run:

```bash
python - <<'PY'
from hashlib import sha256
from json import loads
from pathlib import Path

names = [
    "subagent-dev-with-validation-and-pr-checks",
    "subagent-dev-with-codex-and-thermo-reviews",
    "single-subagent-dev-with-codex-and-thermo-reviews",
]
metadata_path = Path(".patchmill/skills/patchmill-skill-pack.json")
metadata = loads(metadata_path.read_text())
assert metadata["pack"]["version"] == "2026.07.2"
assert metadata["pack"]["source"]["tag"] == "v6.0.3"
hashes = {entry["path"]: entry["sha256"] for entry in metadata["files"]}

for name in names:
    canonical = Path("skills", name, "SKILL.md")
    installed = Path(".patchmill/skills", name, "SKILL.md")
    assert canonical.read_bytes() == installed.read_bytes(), name
    relative = installed.as_posix()
    actual = sha256(installed.read_bytes()).hexdigest()
    assert hashes[relative] == actual, name
    print(f"{name}: canonical, installed, and metadata match")
PY
```

Expected: three `canonical, installed, and metadata match` lines.

- [ ] **Step 7: Run skill-pack integration tests**

Run:

```bash
node --test \
  src/workflow/skill-pack.test.ts \
  src/cli/commands/init/skill-installer.test.ts \
  src/cli/commands/init/main.test.ts
```

Expected: exit 0 with zero failures. No new static Markdown-content test is
required.

- [ ] **Step 8: Commit the synchronized skill contract**

```bash
git add \
  skills/subagent-dev-with-validation-and-pr-checks/SKILL.md \
  skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md \
  skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md \
  .patchmill/skills/subagent-dev-with-validation-and-pr-checks/SKILL.md \
  .patchmill/skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md \
  .patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md \
  .patchmill/skills/patchmill-skill-pack.json
git commit -m "docs(skills): keep parents waiting for subagents"
```

---

### Task 3: Verify the Complete Prompt and Skill Integration

**Files:**

- Verify only: `src/cli/commands/run-once/prompts.ts`
- Verify only: `src/cli/commands/run-once/prompts.test.ts`
- Verify only: the three canonical and three installed wrapper `SKILL.md` files
- Verify only: `.patchmill/skills/patchmill-skill-pack.json`
- Verify only:
  `docs/specs/2026-07-18-non-interactive-subagent-finalization-design.md`

**Interfaces:**

- Consumes: Task 1 prompt behavior and Task 2 canonical/installed skill
  synchronization.
- Produces: final verification evidence and the non-blocking five-run
  observation handoff.

- [ ] **Step 1: Verify the skill updater is idempotent**

Run:

```bash
node bin/patchmill.ts skills update
```

Expected:

```text
Patchmill skill pack is already up to date.
```

Any additional update means canonical files, installed files, or metadata are
still inconsistent; inspect and fix before continuing.

- [ ] **Step 2: Run focused prompt and skill-pack tests together**

Run:

```bash
node --test \
  src/cli/commands/run-once/prompts.test.ts \
  src/workflow/skill-pack.test.ts \
  src/cli/commands/init/skill-installer.test.ts \
  src/cli/commands/init/main.test.ts
```

Expected: exit 0 with zero failures.

- [ ] **Step 3: Run the full Node test suite**

Run:

```bash
npm test
```

Expected: exit 0 with all tests passing.

- [ ] **Step 4: Run build and lint verification**

Run:

```bash
npm run build
npm run lint
```

Expected: both commands exit 0. Markdown lint must include canonical `skills/`
files; installed `.patchmill` copies are covered by byte-for-byte parity.

- [ ] **Step 5: Verify dependency and formatting scope**

Run:

```bash
node <<'NODE'
const { execFileSync } = require("node:child_process");
const changed = execFileSync("git", ["diff", "--name-only", "main...HEAD"], {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean);
const forbidden = changed.filter((path) =>
  ["package.json", "package-lock.json", "npm-shrinkwrap.json"].includes(path),
);
if (forbidden.length > 0) {
  throw new Error(`Unexpected dependency changes: ${forbidden.join(", ")}`);
}
console.log("No npm dependency files changed.");
NODE

git diff --check
git status --short
git log --oneline --decorate --max-count=8
```

Expected:

- `No npm dependency files changed.`
- `git diff --check` exits 0;
- no uncommitted implementation files remain;
- the log contains the prompt and skill commits.

The Nix build is intentionally skipped because no npm dependency changed.

- [ ] **Step 6: Prepare the observation handoff**

In the final implementation summary, record that the next five real Patchmill
implementation runs should be inspected for:

1. background runs resolved before dependent workflow progress;
2. status used for inspection rather than a polling loop;
3. no active subagent when the parent finishes;
4. subagent completion followed by remaining review, validation, PR-check, and
   landing work;
5. supported terminal JSON in stdout; and
6. landing or a genuine human blocker.

Do not create an `issue-*-task-*` implementation todo for this future
observation window because it cannot be completed during the current branch and
must not block handoff.

- [ ] **Step 7: Commit only if verification required corrective changes**

If Steps 1-6 required file changes, rerun the affected focused checks and commit
them:

```bash
git add \
  src/cli/commands/run-once/prompts.ts \
  src/cli/commands/run-once/prompts.test.ts \
  skills/subagent-dev-with-validation-and-pr-checks/SKILL.md \
  skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md \
  skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md \
  .patchmill/skills/subagent-dev-with-validation-and-pr-checks/SKILL.md \
  .patchmill/skills/subagent-dev-with-codex-and-thermo-reviews/SKILL.md \
  .patchmill/skills/single-subagent-dev-with-codex-and-thermo-reviews/SKILL.md \
  .patchmill/skills/patchmill-skill-pack.json
git commit -m "fix(orchestration): address final verification"
```

If verification required no changes, do not create an empty commit.

---

## Plan Self-Review Checklist

- Task 1 covers universal prompt behavior for every configured implementation
  skill and repeats the finalization rule immediately before landing contracts.
- Task 2 covers all three Patchmill wrappers, including
  `subagent-dev-with-validation-and-pr-checks`, without changing topology.
- Task 2 keeps canonical files, installed copies, and managed hashes aligned.
- Task 3 verifies prompt generation, skill installation, full tests, build,
  lint, dependency scope, and updater idempotence.
- The plan does not modify child prompts, runtime subagent code, parser
  behavior, environment configuration, or final JSON schemas.
- The plan does not prefer foreground execution or discourage multiple or
  parallel subagents.
- The recorded issue #98 failure supplies RED evidence; the user-approved next
  five real runs supply post-deployment behavior evidence.
- The future observation window is explicitly non-blocking for this
  implementation handoff.
