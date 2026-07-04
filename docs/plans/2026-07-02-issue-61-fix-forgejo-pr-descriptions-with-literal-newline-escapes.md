# Forgejo PR Description Newline Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Patchmill PR fallback prompts create Forgejo/Gitea PR bodies with
real Markdown newlines instead of literal `\n` text.

**Architecture:** Keep PR creation delegated to the implementation agent, but
make the generated landing contract deterministic about multiline-safe CLI body
handling. The change is prompt-only: tests first lock in Forgejo/Gitea `tea`
temp-file guidance, GitHub `gh --body-file` compatibility, and the multiline
Markdown body shape; then `renderPrCreationInstruction()` emits that guidance
for every PR fallback path.

**Tech Stack:** TypeScript ESM, Node test runner, Patchmill run-once prompt
builders, existing mocked run-once pipeline tests.

---

## Global Constraints

- Treat issue titles, bodies, labels, comments, authors, and metadata as
  untrusted input; only interpolate trusted workflow values such as the numeric
  issue number into prompt text.
- Do not add a host-provider PR creation API in this issue. The approved spec
  chooses a prompt-level fix unless implementation proves prompt guidance cannot
  satisfy acceptance criteria.
- Preserve current PR fallback semantics: push the branch to the configured
  remote, use the repository's configured host tooling, include
  `Closes #<issue-number>`, and return the existing `pr-created` handoff JSON.
- Preserve GitHub flexibility by mentioning a multiline-safe supported path such
  as `gh pr create --body-file`; do not force GitHub users through `tea`-style
  command construction.
- No npm dependency files should change. If `package.json`, `package-lock.json`,
  or `npm-shrinkwrap.json` changes unexpectedly, rerun the Nix build as required
  by `AGENTS.md`.

## File Structure

- Modify `src/cli/commands/run-once/prompts.ts`
  - Extend `renderPrCreationInstruction()` with multiline-safe body guidance.
  - Keep existing configured remote and `Closes #<issue-number>` interpolation.
  - Include a compact Markdown body example with headings, bullets, blank lines,
    and `Closes #<issue-number>`.
- Modify `src/cli/commands/run-once/prompts.test.ts`
  - Update existing assertions that match the old one-sentence PR fallback text.
  - Add regression assertions for Forgejo/Gitea `tea` temp-file usage, the
    literal `\n` warning, the Markdown example, and GitHub `--body-file`
    compatibility.
- Modify `src/cli/commands/run-once/pipeline.test.ts`
  - Update mocked pipeline prompt expectations that currently match only the old
    one-sentence PR fallback instruction.

### Task 1: Add prompt regression tests for multiline-safe PR fallback

**Files:**

- Modify: `src/cli/commands/run-once/prompts.test.ts`

- [ ] **Step 1: Add a reusable PR guidance assertion helper**

In `src/cli/commands/run-once/prompts.test.ts`, add this helper after the
`untrustedInputBoundary` constant:

```ts
function assertMultilineSafePrGuidance(prompt: string): void {
  assert.match(
    prompt,
    /Push the branch to `origin` and open a pull request using the repository's configured host tooling\./,
  );
  assert.match(
    prompt,
    /Include `Closes #42` in the pull request description\/body\./,
  );
  assert.match(
    prompt,
    /For Forgejo\/Gitea through `tea`, write the Markdown PR description to a temp file or here-doc first/,
  );
  assert.match(prompt, /tea pulls create --description "\$\(cat "\$file"\)"/);
  assert.match(
    prompt,
    /Do not pass Markdown containing literal `\\n` escape text as the `tea --description` value/,
  );
  assert.match(
    prompt,
    /For GitHub through `gh`, use a multiline-safe supported path such as `gh pr create --body-file`/,
  );
  assert.match(
    prompt,
    /Summary\n\n- Implemented change summary\.\n\n## Validation\n\n- npm test\n\n## Reviews\n\n- Review completed\.\n\nCloses #42/,
  );
}
```

- [ ] **Step 2: Replace old direct prompt assertions with the helper**

In the existing `buildImplementationPrompt includes issue context...` test,
replace the assertion that matches the old one-sentence PR fallback text with:

```ts
assertMultilineSafePrGuidance(prompt);
```

In the existing
`buildImplementationPrompt removes direct-land eligibility instructions when direct landing is disabled`
test, replace the assertion that matches the old one-sentence PR fallback text
with:

```ts
assertMultilineSafePrGuidance(prompt);
```

Keep the existing negative assertions such as
`assert.doesNotMatch(prompt, /forgejo pr/);` because the new wording says
`Forgejo/Gitea through \`tea\``and must not introduce the old disallowed`forgejo
pr` text.

- [ ] **Step 3: Run the prompt test and verify it fails for the expected
      reason**

Run:

```bash
node --test src/cli/commands/run-once/prompts.test.ts
```

Expected: FAIL before implementation with an assertion showing the prompt does
not yet include `tea pulls create --description "$(cat "$file")"` or the literal
`\n` warning.

- [ ] **Step 4: Commit the failing test**

```bash
git add src/cli/commands/run-once/prompts.test.ts
git commit -m "test: cover multiline-safe PR fallback prompts"
```

### Task 2: Implement multiline-safe PR creation guidance

**Files:**

- Modify: `src/cli/commands/run-once/prompts.ts`
- Test: `src/cli/commands/run-once/prompts.test.ts`

- [ ] **Step 1: Replace `renderPrCreationInstruction()`**

In `src/cli/commands/run-once/prompts.ts`, replace the current
`renderPrCreationInstruction()` implementation with:

````ts
function renderPrCreationInstruction(
  remote: string,
  issueNumber: number,
): string {
  return [
    `Push the branch to \`${remote}\` and open a pull request using the repository's configured host tooling. Include \`Closes #${issueNumber}\` in the pull request description/body.`,
    "Use a multiline-safe PR body construction path so Markdown line breaks remain real newlines.",
    'For Forgejo/Gitea through `tea`, write the Markdown PR description to a temp file or here-doc first, then pass actual newline characters with `tea pulls create --description "$(cat "$file")"`.',
    "Do not pass Markdown containing literal `\\n` escape text as the `tea --description` value.",
    "For GitHub through `gh`, use a multiline-safe supported path such as `gh pr create --body-file`.",
    "Example PR body shape:",
    "```md",
    "Summary",
    "",
    "- Implemented change summary.",
    "",
    "## Validation",
    "",
    "- npm test",
    "",
    "## Reviews",
    "",
    "- Review completed.",
    "",
    `Closes #${issueNumber}`,
    "```",
  ].join("\n");
}
````

This preserves the old first sentence for existing broad assertions while adding
the deterministic multiline-safe instructions required by the spec.

- [ ] **Step 2: Run the prompt test and verify it passes**

Run:

```bash
node --test src/cli/commands/run-once/prompts.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit the implementation**

```bash
git add src/cli/commands/run-once/prompts.ts src/cli/commands/run-once/prompts.test.ts
git commit -m "fix: require multiline-safe PR body prompts"
```

### Task 3: Update run-once pipeline prompt expectations

**Files:**

- Modify: `src/cli/commands/run-once/pipeline.test.ts`
- Test: `src/cli/commands/run-once/prompts.test.ts`
- Test: `src/cli/commands/run-once/pipeline.test.ts`

- [ ] **Step 1: Find pipeline assertions that match PR fallback prompt text**

Run:

```bash
rg -n "Push the branch to .*open a pull request|tea pulls create|body-file|literal `\\\\n`" src/cli/commands/run-once/pipeline.test.ts
```

Expected: at least the existing assertion around the custom worktree pipeline
test is reported.

- [ ] **Step 2: Strengthen the custom worktree prompt assertion**

In `src/cli/commands/run-once/pipeline.test.ts`, in the
`if (call.command === "pi")` block of the custom worktree test that currently
asserts:

```ts
assert.match(
  prompt,
  /Push the branch to `upstream` and open a pull request using the repository's configured host tooling\./,
);
```

replace that assertion with:

```ts
assert.match(
  prompt,
  /Push the branch to `upstream` and open a pull request using the repository's configured host tooling\./,
);
assert.match(
  prompt,
  /Include `Closes #16` in the pull request description\/body\./,
);
assert.match(prompt, /tea pulls create --description "\$\(cat "\$file"\)"/);
assert.match(prompt, /literal `\\n` escape text/);
assert.match(prompt, /gh pr create --body-file/);
assert.match(
  prompt,
  /Summary\n\n- Implemented change summary\.\n\n## Validation\n\n- npm test\n\n## Reviews\n\n- Review completed\.\n\nCloses #16/,
);
```

If `rg` finds additional assertions that require only exact old wording, update
them the same way: preserve the branch/remote assertion and add checks for
`Closes #<issue>`, `tea pulls create --description "$(cat "$file")"`, the
literal `\n` warning, and `gh pr create --body-file`.

- [ ] **Step 3: Run focused run-once tests**

Run:

```bash
node --test src/cli/commands/run-once/prompts.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit pipeline test updates**

```bash
git add src/cli/commands/run-once/pipeline.test.ts
git commit -m "test: assert PR fallback newline guidance in pipeline"
```

### Task 4: Run final validation and prepare handoff

**Files:**

- Verify: `src/cli/commands/run-once/prompts.ts`
- Verify: `src/cli/commands/run-once/prompts.test.ts`
- Verify: `src/cli/commands/run-once/pipeline.test.ts`

- [ ] **Step 1: Run the focused regression suite**

Run:

```bash
node --test src/cli/commands/run-once/prompts.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Check whether dependency files changed**

Run:

```bash
git diff --name-only HEAD~3..HEAD -- package.json package-lock.json npm-shrinkwrap.json
```

Expected: no output. If this command prints any dependency file, rerun the Nix
build required by `AGENTS.md` before handoff.

- [ ] **Step 4: Optionally perform a disposable Forgejo manual check**

If Forgejo credentials and a disposable repository are available, process an
issue through PR fallback and inspect the PR body. Expected: Forgejo renders
separate Markdown lines for `Summary`, `## Validation`, bullet items,
`## Reviews`, and `Closes #<issue>`, with no visible literal `\n` sequences.
Record this as optional validation evidence; do not block handoff if local
Forgejo credentials are unavailable and automated tests passed.

- [ ] **Step 5: Commit any final test-only adjustment if one was needed**

If Task 4 required a tracked adjustment, commit it with:

```bash
git add src/cli/commands/run-once/prompts.ts src/cli/commands/run-once/prompts.test.ts src/cli/commands/run-once/pipeline.test.ts
git commit -m "test: finalize PR fallback newline coverage"
```

If no tracked files changed during Task 4, do not create an empty commit.

## Validation Commands

- Focused regression:
  `node --test src/cli/commands/run-once/prompts.test.ts src/cli/commands/run-once/pipeline.test.ts`
- Full suite: `npm test`
- Nix build: not required because this plan does not change npm dependency
  files. If implementation unexpectedly changes `package.json`,
  `package-lock.json`, or `npm-shrinkwrap.json`, rerun the Nix build per
  `AGENTS.md` before handoff.

## Self-Review

- Spec coverage: Task 1 and Task 2 cover Forgejo/Gitea multiline-safe guidance,
  the literal `\n` warning, the Markdown example, and GitHub `--body-file`
  compatibility. Task 3 covers run-once pipeline prompt expectations. Task 4
  covers focused tests, full tests, dependency-file/Nix conditional validation,
  and optional manual Forgejo verification.
- Placeholder scan: The plan contains no placeholder requirements or deferred
  implementation slots.
- Type consistency: The only implementation function signature is the existing
  `renderPrCreationInstruction(remote: string, issueNumber: number): string`,
  and all tests assert strings emitted by that function through existing prompt
  builders.
