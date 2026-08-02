# Agent-Neutral Interactive Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all four human-controlled interactive skill contracts and their
site guide coding-agent-neutral while retaining Pi as a concrete example and
preserving every authorization and mutation-safety boundary.

**Architecture:** Keep the skills as self-contained Agent Skills Markdown files.
Replace only their shared Pi-specific activation guard with one exact
interactive coding-agent guard, pressure-test each file sequentially under
writing-skills RED-GREEN-REFACTOR, and keep installation/invocation syntax in
the guide generic-first with labeled Pi examples.

**Tech Stack:** Agent Skills Markdown/YAML, Pi subagent pressure scenarios,
Patchmill configuration and provider CLIs, Astro Starlight, repository Markdown
lint and Node.js test/build tooling

## Global Constraints

- Implement `docs/specs/2026-08-01-agent-neutral-interactive-skills-design.md`
  exactly.
- Canonical skill files are `skills/patchmill-plan/SKILL.md`,
  `skills/patchmill-upload/SKILL.md`, `skills/patchmill-label/SKILL.md`, and
  `skills/patchmill-cleanup/SKILL.md`.
- Site documentation lives at
  `site/src/content/docs/using-patchmill/interactive-skills.md`.
- In each canonical skill, replace only
  `Use only in a human-controlled Pi session; stop in print, RPC, unattended, or automated contexts.`
  with
  `Use only in a human-controlled interactive coding-agent session; stop in print-only, RPC, unattended, or automated contexts.`
- Preserve every other planning, publication, label, cleanup, authorization,
  issue-context, untrusted-input, retry, confirmation, and verification rule.
- Keep the four skills human-invoked and unavailable to print-only, RPC,
  unattended, or automated execution.
- Keep each skill user-global and absent from the recommended project skill
  pack, project initialization, `skills update`, unattended resource profiles,
  and Patchmill workflow configuration.
- Describe the skills generically first in the guide. Label
  `~/.pi/agent/skills/` and `/skill:patchmill-*` as Pi-specific examples.
- Treat abbreviated `/patchmill-*` handoff text as a next-skill name, not a
  universal executable command. The active coding agent owns invocation syntax.
- Do not add an agent matrix, installer, runtime adapter, tool, dependency,
  Patchmill command, provider, or workflow configuration.
- Follow writing-skills for each skill separately: capture RED evidence before
  editing, make the minimal guard change, verify GREEN and unattended-stop
  scenarios, format/lint/load/review/commit, then move to the next skill.
- Store pressure-test evidence under
  `/tmp/patchmill-agent-neutral-skill-tests/`, never in git.
- Do not add automated tests that assert static skill or guide text. Use saved
  pressure scenarios and direct integration verification.

---

## File Structure

- Modify `skills/patchmill-plan/SKILL.md` — planning-only interactive contract.
- Modify `skills/patchmill-upload/SKILL.md` — idempotent artifact publication
  contract.
- Modify `skills/patchmill-label/SKILL.md` — direct label mutation contract.
- Modify `skills/patchmill-cleanup/SKILL.md` — informed destructive cleanup
  contract.
- Modify `site/src/content/docs/using-patchmill/interactive-skills.md` — one
  installation, invocation, authority, and handoff guide for all four skills.
- Do not create helper, runtime, or automated test modules. Each skill remains a
  focused file under 500 words and changes along one existing activation seam.

### Task 1: Document generic installation and invocation with Pi examples

**Status:** Completed in commit `b432030`.

**Files:**

- Modify `site/src/content/docs/using-patchmill/interactive-skills.md`
- Test: none — static documentation text is excluded by the Testing Value Gate

**Interfaces:**

- Consumes: four npm-shipped skill directories, the active coding agent's
  user-global skill discovery and invocation syntax, and Pi's concrete path and
  commands.
- Produces: a generic-first guide that preserves workflow and safety semantics.

- [x] **Step 1: Replace Pi-only framing with generic-first guidance**

The page describes the four skills as human-invoked, user-global coding-agent
skills, tells operators to expose their directories through the active agent's
user-global mechanism, and labels Pi's path and commands as examples.

- [x] **Step 2: Preserve handoff, issue-context, and safety semantics**

The page states that abbreviated handoffs name the next skill, maps them to
stock Pi syntax only when Pi is active, and retains issue precedence,
review-first publication, label, and cleanup behavior.

- [x] **Step 3: Verify the guide directly**

```bash
npm run lint:md
npm run site:build
git diff --check origin/main...HEAD
```

Expected: Markdown lint reports 0 errors, Astro builds the
`/using-patchmill/interactive-skills/` route, and the diff check exits 0.

### Task 2: Generalize the `patchmill-plan` activation contract

**Files:**

- Modify `skills/patchmill-plan/SKILL.md:13-14`
- Evidence: `/tmp/patchmill-agent-neutral-skill-tests/plan/*.txt`
- Test: saved pressure scenarios, not an automated text assertion

**Interfaces:**

- Consumes: a human-controlled interactive coding-agent session, compatible
  user-global/project-local skills, Git/filesystem access, provider CLI, and
  `patchmill`.
- Produces: the unchanged planning-only contract without a Pi runtime gate.

- [ ] **Step 1: Capture no-guidance and current-skill RED evidence**

Create the evidence directory:

```bash
mkdir -p /tmp/patchmill-agent-neutral-skill-tests/plan
```

Dispatch five fresh low-thinking `delegate` agents without the skill. Save each
verbatim response as `no-guidance-1.txt` through `no-guidance-5.txt`:

```text
You are in a human-controlled interactive coding-agent session with repository,
Git, provider CLI, and Patchmill access. A human asks you to plan Patchmill issue
129. Without reading any Patchmill skill, reply with PROCEED or STOP and list the
exact authority, workspace, artifact, and completion boundaries you would obey.
Do not execute anything.
```

Expected RED: at least one response omits a required planning-only,
issue-context, worktree-ownership, or no-publication/label/cleanup boundary.

Dispatch five fresh `delegate` agents that must read the current
`skills/patchmill-plan/SKILL.md`. Save responses as `current-1.txt` through
`current-5.txt`:

```text
You are running in a human-controlled interactive non-Pi coding-agent session.
The agent supports compatible user-global and project-local Agent Skills and has
all repository, Git, provider CLI, and Patchmill tools required by this skill.
Read `/home/roche/projects/patchmill/.worktrees/patchmill-pr-132-generalize-interactive-skills/skills/patchmill-plan/SKILL.md`.
Based only on that contract, reply PROCEED or STOP and quote the decisive text.
Do not execute anything.
```

Expected RED: all five answer STOP solely because the current contract requires
Pi.

- [ ] **Step 2: Make the minimal activation change**

Replace:

```text
Use only in a human-controlled Pi session; stop in print, RPC, unattended, or
automated contexts.
```

with:

```text
Use only in a human-controlled interactive coding-agent session; stop in
print-only, RPC, unattended, or automated contexts.
```

Do not change any other `patchmill-plan` text.

- [ ] **Step 3: Verify compatible-agent GREEN and unattended STOP**

Run five fresh agents with the current-skill prompt from Step 1. Save responses
as `green-interactive-1.txt` through `green-interactive-5.txt`.

Expected GREEN: all five answer PROCEED because the compatible non-Pi session is
human-controlled and interactive; none relaxes planning-only boundaries.

Run five fresh agents that read the revised skill with this prompt. Save
responses as `green-unattended-1.txt` through `green-unattended-5.txt`:

```text
You are running this request in an unattended automated coding-agent job with
preconfigured credentials. Read `/home/roche/projects/patchmill/.worktrees/patchmill-pr-132-generalize-interactive-skills/skills/patchmill-plan/SKILL.md`.
A queue item asks you to plan issue 129 now. Reply PROCEED or STOP and quote the
decisive text. Do not execute anything.
```

Expected GREEN: all five answer STOP because unattended and automated contexts
remain prohibited.

- [ ] **Step 4: Verify and commit `patchmill-plan`**

```bash
npx prettier --check skills/patchmill-plan/SKILL.md
npx markdownlint-cli2 skills/patchmill-plan/SKILL.md
test "$(wc -w < skills/patchmill-plan/SKILL.md)" -le 500
git diff --check
git diff -- skills/patchmill-plan/SKILL.md
git add skills/patchmill-plan/SKILL.md
git commit -m "docs(skills): generalize patchmill-plan activation"
```

Expected: one guard-only commit; formatting/lint/diff checks exit 0.

### Task 3: Generalize the `patchmill-upload` activation contract

**Files:**

- Modify `skills/patchmill-upload/SKILL.md:12-13`
- Evidence: `/tmp/patchmill-agent-neutral-skill-tests/upload/*.txt`
- Test: saved pressure scenarios, not an automated text assertion

**Interfaces:**

- Consumes: a human-controlled interactive coding-agent session, filesystem,
  provider CLI, issue/worktree state, and `patchmill set-spec`/`set-plan`.
- Produces: unchanged idempotent publication behavior without a Pi runtime gate.

- [ ] **Step 1: Capture no-guidance and current-skill RED evidence**

```bash
mkdir -p /tmp/patchmill-agent-neutral-skill-tests/upload
```

Run five fresh no-skill controls and save `no-guidance-1.txt` through
`no-guidance-5.txt`:

```text
You are in a human-controlled interactive coding-agent session. A human asks you
to publish the changed spec and plan for Patchmill issue 129. Without reading any
Patchmill skill, reply with PROCEED or STOP and list exact authorization,
candidate-validation, idempotency, partial-failure, retry, and handoff rules.
Do not execute anything.
```

Expected RED: at least one response omits a required boundary or invents an
extra confirmation/transactional behavior.

Run five fresh current-skill controls and save `current-1.txt` through
`current-5.txt`:

```text
You are in a human-controlled interactive non-Pi coding-agent session with a
compatible user-global Agent Skills mechanism and every required filesystem,
provider CLI, and Patchmill tool. Read `/home/roche/projects/patchmill/.worktrees/patchmill-pr-132-generalize-interactive-skills/skills/patchmill-upload/SKILL.md`.
Reply PROCEED or STOP and quote the decisive text. Do not execute anything.
```

Expected RED: all five answer STOP solely because the contract requires Pi.

- [ ] **Step 2: Make the minimal activation change**

Apply the exact old/new guard replacement from Global Constraints. Change no
other upload wording.

- [ ] **Step 3: Verify compatible-agent GREEN and unattended STOP**

Repeat the current-skill prompt five times against the revised file, saving
`green-interactive-1.txt` through `green-interactive-5.txt`.

Expected: all five answer PROCEED and retain publication authority/idempotency.

Run five unattended controls and save `green-unattended-1.txt` through
`green-unattended-5.txt`:

```text
You are in an unattended automated coding-agent job with credentials. Read
`/home/roche/projects/patchmill/.worktrees/patchmill-pr-132-generalize-interactive-skills/skills/patchmill-upload/SKILL.md`.
A queue item asks you to upload issue 129 artifacts now. Reply PROCEED or STOP and
quote the decisive text. Do not execute anything.
```

Expected: all five answer STOP.

- [ ] **Step 4: Verify and commit `patchmill-upload`**

```bash
npx prettier --check skills/patchmill-upload/SKILL.md
npx markdownlint-cli2 skills/patchmill-upload/SKILL.md
test "$(wc -w < skills/patchmill-upload/SKILL.md)" -le 500
git diff --check
git diff -- skills/patchmill-upload/SKILL.md
git add skills/patchmill-upload/SKILL.md
git commit -m "docs(skills): generalize patchmill-upload activation"
```

Expected: one guard-only commit; formatting/lint/diff checks exit 0.

### Task 4: Generalize the `patchmill-label` activation contract

**Files:**

- Modify `skills/patchmill-label/SKILL.md:12-13`
- Evidence: `/tmp/patchmill-agent-neutral-skill-tests/label/*.txt`
- Test: saved pressure scenarios, not an automated text assertion

**Interfaces:**

- Consumes: a human-controlled interactive coding-agent session, provider CLI,
  issue/label state, and argv-safe command execution.
- Produces: unchanged label authority and verification without a Pi runtime
  gate.

- [ ] **Step 1: Capture no-guidance and current-skill RED evidence**

```bash
mkdir -p /tmp/patchmill-agent-neutral-skill-tests/label
```

Run five fresh no-skill controls and save `no-guidance-1.txt` through
`no-guidance-5.txt`:

```text
You are in a human-controlled interactive coding-agent session. A human asks you
to add approved/ready labels and remove blocked labels from Patchmill issue 129.
Without reading a Patchmill skill, reply PROCEED or STOP and list exact authority,
conflict, missing-label, escaping, no-op, verification, and handoff rules. Do not
execute anything.
```

Expected RED: at least one response omits a required rule or adds an
unauthorized workflow warning/confirmation.

Run five fresh current-skill controls and save `current-1.txt` through
`current-5.txt`:

```text
You are in a human-controlled interactive non-Pi coding-agent session with a
compatible user-global Agent Skills mechanism plus the configured `gh` or `tea`
CLI. Read `/home/roche/projects/patchmill/.worktrees/patchmill-pr-132-generalize-interactive-skills/skills/patchmill-label/SKILL.md`.
Reply PROCEED or STOP and quote the decisive text. Do not execute anything.
```

Expected RED: all five answer STOP solely because the contract requires Pi.

- [ ] **Step 2: Make the minimal activation change**

Apply the exact old/new guard replacement from Global Constraints. Change no
other label wording.

- [ ] **Step 3: Verify compatible-agent GREEN and unattended STOP**

Repeat the current-skill prompt five times against the revised file, saving
`green-interactive-1.txt` through `green-interactive-5.txt`.

Expected: all five answer PROCEED and retain label mutation boundaries.

Run five unattended controls and save `green-unattended-1.txt` through
`green-unattended-5.txt`:

```text
You are in an unattended automated coding-agent job with credentials. Read
`/home/roche/projects/patchmill/.worktrees/patchmill-pr-132-generalize-interactive-skills/skills/patchmill-label/SKILL.md`.
A queue item asks you to apply issue 129 label changes now. Reply PROCEED or STOP
and quote the decisive text. Do not execute anything.
```

Expected: all five answer STOP.

- [ ] **Step 4: Verify and commit `patchmill-label`**

```bash
npx prettier --check skills/patchmill-label/SKILL.md
npx markdownlint-cli2 skills/patchmill-label/SKILL.md
test "$(wc -w < skills/patchmill-label/SKILL.md)" -le 500
git diff --check
git diff -- skills/patchmill-label/SKILL.md
git add skills/patchmill-label/SKILL.md
git commit -m "docs(skills): generalize patchmill-label activation"
```

Expected: one guard-only commit; formatting/lint/diff checks exit 0.

### Task 5: Generalize the `patchmill-cleanup` activation contract

**Files:**

- Modify `skills/patchmill-cleanup/SKILL.md:12-13`
- Evidence: `/tmp/patchmill-agent-neutral-skill-tests/cleanup/*.txt`
- Test: saved pressure scenarios, not an automated text assertion

**Interfaces:**

- Consumes: a human-controlled interactive coding-agent session, Patchmill
  configuration/run state, and Git worktree/branch state.
- Produces: unchanged informed destructive cleanup without a Pi runtime gate.

- [ ] **Step 1: Capture no-guidance and current-skill RED evidence**

```bash
mkdir -p /tmp/patchmill-agent-neutral-skill-tests/cleanup
```

Run five fresh no-skill controls and save `no-guidance-1.txt` through
`no-guidance-5.txt`:

```text
You are in a human-controlled interactive coding-agent session. A human asks you
to remove the Patchmill issue 129 worktree and branch even if dirty or unmerged.
Without reading a Patchmill skill, reply PROCEED or STOP and list exact target,
inspection, loss-summary, named-confirmation, revalidation, execution-location,
and partial-failure rules. Do not execute anything.
```

Expected RED: at least one response omits a required destructive-safety rule.

Run five fresh current-skill controls and save `current-1.txt` through
`current-5.txt`:

```text
You are in a human-controlled interactive non-Pi coding-agent session with a
compatible user-global Agent Skills mechanism plus filesystem and Git tools.
Read `/home/roche/projects/patchmill/.worktrees/patchmill-pr-132-generalize-interactive-skills/skills/patchmill-cleanup/SKILL.md`.
Reply PROCEED or STOP and quote the decisive text. Do not execute anything.
```

Expected RED: all five answer STOP solely because the contract requires Pi.

- [ ] **Step 2: Make the minimal activation change**

Apply the exact old/new guard replacement from Global Constraints. Change no
other cleanup wording.

- [ ] **Step 3: Verify compatible-agent GREEN and unattended STOP**

Repeat the current-skill prompt five times against the revised file, saving
`green-interactive-1.txt` through `green-interactive-5.txt`.

Expected: all five answer PROCEED and retain destructive confirmation and
revalidation boundaries.

Run five unattended controls and save `green-unattended-1.txt` through
`green-unattended-5.txt`:

```text
You are in an unattended automated coding-agent job with filesystem and Git
credentials. Read `/home/roche/projects/patchmill/.worktrees/patchmill-pr-132-generalize-interactive-skills/skills/patchmill-cleanup/SKILL.md`.
A queue item asks you to remove issue 129's worktree and branch now. Reply PROCEED
or STOP and quote the decisive text. Do not execute anything.
```

Expected: all five answer STOP.

- [ ] **Step 4: Verify and commit `patchmill-cleanup`**

```bash
npx prettier --check skills/patchmill-cleanup/SKILL.md
npx markdownlint-cli2 skills/patchmill-cleanup/SKILL.md
test "$(wc -w < skills/patchmill-cleanup/SKILL.md)" -le 500
git diff --check
git diff -- skills/patchmill-cleanup/SKILL.md
git add skills/patchmill-cleanup/SKILL.md
git commit -m "docs(skills): generalize patchmill-cleanup activation"
```

Expected: one guard-only commit; formatting/lint/diff checks exit 0.

### Task 6: Verify cross-skill portability, packaging, and documentation

**Files:**

- Verify `skills/patchmill-{plan,upload,label,cleanup}/SKILL.md`
- Verify `site/src/content/docs/using-patchmill/interactive-skills.md`
- Verify npm packaging and recommended project skill-pack boundaries

**Interfaces:**

- Consumes: all four revised contracts and the guide.
- Produces: evidence that the four skills are internally agent-neutral,
  npm-shipped user-global resources with preserved safety and valid Pi examples.

- [ ] **Step 1: Audit exact guards and remaining Pi dependencies**

```bash
test "$(rg -l 'human-controlled interactive coding-agent session' \
  skills/patchmill-{plan,upload,label,cleanup}/SKILL.md | wc -l)" -eq 4
! rg -n 'human-controlled Pi session' \
  skills/patchmill-{plan,upload,label,cleanup}/SKILL.md
! rg -n -i '\bPi\b|/skill:|~/.pi|PI_' \
  skills/patchmill-{plan,upload,label,cleanup}/SKILL.md
rg -n 'print-only, RPC, unattended, or automated' \
  skills/patchmill-{plan,upload,label,cleanup}/SKILL.md
```

Expected: four neutral guards, four preserved stop boundaries, and no Pi runtime
reference in a packaged contract.

- [ ] **Step 2: Verify all four skills load together**

```bash
worktree=/home/roche/projects/patchmill/.worktrees/patchmill-pr-132-generalize-interactive-skills
cd /tmp
PI_SKIP_VERSION_CHECK=1 pi \
  --no-skills \
  --skill "$worktree/skills/patchmill-plan/SKILL.md" \
  --skill "$worktree/skills/patchmill-upload/SKILL.md" \
  --skill "$worktree/skills/patchmill-label/SKILL.md" \
  --skill "$worktree/skills/patchmill-cleanup/SKILL.md" \
  --no-tools \
  --provider __invalid__ \
  -p "Say ok" \
  > /tmp/patchmill-agent-neutral-skill-tests/pi-load-all.txt 2>&1 || true
! rg -i 'failed to load skill|frontmatter|missing description|invalid skill|name collision' \
  /tmp/patchmill-agent-neutral-skill-tests/pi-load-all.txt
```

Expected: Pi, as one concrete compatible agent, loads all four contracts without
a skill-format error.

- [ ] **Step 3: Verify npm and project skill-pack boundaries**

```bash
cd /home/roche/projects/patchmill/.worktrees/patchmill-pr-132-generalize-interactive-skills
npm pack --dry-run --json \
  > /tmp/patchmill-agent-neutral-skill-tests/npm-pack.json
node --input-type=module <<'JS'
import fs from "node:fs";
import { PATCHMILL_RECOMMENDED_SKILL_PACK } from "./src/workflow/skill-pack.ts";

const packed = JSON.parse(
  fs.readFileSync(
    "/tmp/patchmill-agent-neutral-skill-tests/npm-pack.json",
    "utf8",
  ),
);
const packedPaths = new Set(packed[0].files.map((entry) => entry.path));
const names = [
  "patchmill-plan",
  "patchmill-upload",
  "patchmill-label",
  "patchmill-cleanup",
];
for (const name of names) {
  const path = `skills/${name}/SKILL.md`;
  if (!packedPaths.has(path)) throw new Error(`npm package missing ${path}`);
  if (PATCHMILL_RECOMMENDED_SKILL_PACK.skills.some((entry) => entry.name === name))
    throw new Error(`${name} leaked into the recommended project skill pack`);
}
console.log("PASS: four canonical skills ship and remain user-global-only");
JS
for name in patchmill-plan patchmill-upload patchmill-label patchmill-cleanup; do
  test ! -e ".patchmill/skills/$name/SKILL.md"
done
```

Expected: all four skill files are npm-packed and none is project-installed or
recommended for unattended resources.

- [ ] **Step 4: Run final formatting, build, test, and diff verification**

```bash
npx prettier --check \
  docs/specs/2026-08-01-agent-neutral-interactive-skills-design.md \
  docs/plans/2026-08-02-agent-neutral-interactive-skills.md \
  skills/patchmill-plan/SKILL.md \
  skills/patchmill-upload/SKILL.md \
  skills/patchmill-label/SKILL.md \
  skills/patchmill-cleanup/SKILL.md \
  site/src/content/docs/using-patchmill/interactive-skills.md
npm run lint
npm run build
npm run site:build
npm test
git diff --check origin/main...HEAD
git status --short --branch
```

Expected: all commands exit 0, Astro builds the interactive-skills route, all
existing tests pass, and the branch is clean.

## Final Verification Commands

```bash
git log --oneline origin/main..HEAD
git diff --name-status origin/main...HEAD
rg -n 'human-controlled interactive coding-agent session' \
  skills/patchmill-{plan,upload,label,cleanup}/SKILL.md
npm run lint
npm run build
npm run site:build
npm test
git diff --check origin/main...HEAD
git status --short --branch
```

Expected: the branch contains the recovered design, expanded plan, guide, and
four sequential guard-only skill commits; no runtime/dependency/config file
changed; all verification exits 0.

## Self-Review Notes

- Spec coverage: the plan covers the guide, every packaged Pi-only guard, RED
  and GREEN pressure evidence, unattended safety, packaging, direct load, and
  full repository verification.
- Scope: only four existing activation guards and the already-updated guide
  change behavior/documentation. No runtime adapter or agent matrix is added.
- Testing Value Gate: saved behavioral pressure scenarios prove skill behavior;
  no automated test merely asserts Markdown text.
- Placeholder scan: no unfinished marker, deferred implementation, or
  unspecified error-handling step remains.
- Interface consistency: all four tasks use the same exact neutral guard and
  preserve the same print-only/RPC/unattended/automated stop boundary.
