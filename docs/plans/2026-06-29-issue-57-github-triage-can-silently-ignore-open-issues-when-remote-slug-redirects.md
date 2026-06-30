# GitHub Triage Redirect-Safe Issue Listing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make default `patchmill triage` list GitHub open issues through the
non-search `gh issue list` path so renamed/transferred repository slugs do not
silently produce an empty triage run.

**Architecture:** Keep the fix in the GitHub `gh` host provider by removing the
search-backed ordering flag and relying on the existing `runTriage()` in-process
ordering. Add focused provider regression coverage for the redirect/search
false-empty case, and keep pipeline coverage proving selected issues are still
ordered by `createdAt` before triage agents run.

**Tech Stack:** TypeScript, Node.js built-in `node:test`, mocked
`CommandRunner`, GitHub CLI (`gh`) command construction.

---

## File Structure

- Modify `src/host/github-gh.ts`: change `GitHubGhHostProvider.listOpenIssues()`
  command arguments and make non-zero list failures actionable for
  authentication, remote slug, and permission problems.
- Modify `src/host/github-gh.test.ts`: update the normal list expectation, add
  an explicit no-`--search` assertion, add the redirect false-empty regression,
  and assert the improved list failure message.
- Modify `src/cli/commands/triage/pipeline.test.ts`: update the GitHub triage
  command expectation from the old search-backed command to the non-search
  command. Existing tests at the top of this file already prove oldest-first
  ordering and number fallback through `runTriage()` selection; only add another
  ordering test if those assertions are removed or no longer cover GitHub input
  order.

## Implementation Tasks

### Task 1: Add provider regression tests for non-search GitHub issue listing

**Files:**

- Modify: `src/host/github-gh.test.ts`

- [ ] **Step 1: Update the existing open-issue list test to expect the
      non-search command**

Replace the scripted response key in `GitHubGhHostProvider lists open issues`
with:

```ts
"gh issue list --state open --limit 1000 --json number,title,body,state,labels,author,createdAt,updatedAt,url":
```

After `assertGhContext(runner.calls[0]!);`, add:

```ts
assert.equal(runner.calls[0]!.args.includes("--search"), false);
assert.deepEqual(runner.calls[0]!.args, [
  "issue",
  "list",
  "--state",
  "open",
  "--limit",
  "1000",
  "--json",
  "number,title,body,state,labels,author,createdAt,updatedAt,url",
]);
```

- [ ] **Step 2: Add the redirect false-empty regression test**

Add this test immediately after `GitHubGhHostProvider lists open issues`:

```ts
test("GitHubGhHostProvider avoids search-backed list for redirected repository slugs", async () => {
  const runner: CommandRunner & { calls: RecordedCall[] } = {
    calls: [],
    async run(command, args, options = {}) {
      runner.calls.push({ command, args: [...args], cwd: options.cwd });
      const line = [command, ...args].join(" ");
      if (args.includes("--search")) {
        return { code: 0, stdout: "[]", stderr: "" };
      }
      assert.equal(
        line,
        "gh issue list --state open --limit 1000 --json number,title,body,state,labels,author,createdAt,updatedAt,url",
      );
      return {
        code: 0,
        stdout: JSON.stringify([
          {
            number: 57,
            title: "Remote slug redirects",
            body: "Untrusted issue body is inert test data.",
            state: "OPEN",
            labels: [{ name: "bug" }],
            author: { login: "reporter" },
            createdAt: "2026-06-29T19:00:00Z",
            updatedAt: "2026-06-29T19:15:28Z",
            url: "https://github.example/new-owner/repo/issues/57",
          },
        ]),
        stderr: "",
      };
    },
  };

  const issues = await createProvider(runner).listOpenIssues();

  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.number, 57);
  assert.equal(issues[0]?.created, "2026-06-29T19:00:00Z");
  assert.equal(runner.calls.length, 1);
  assert.equal(runner.calls[0]!.args.includes("--search"), false);
});
```

- [ ] **Step 3: Add a failing assertion for actionable list errors**

Add this test near
`GitHubGhHostProvider command failures include gh and operation context`:

```ts
test("GitHubGhHostProvider reports actionable gh issue list failures", async () => {
  const runner = scriptedRunner({
    "gh issue list --state open --limit 1000 --json number,title,body,state,labels,author,createdAt,updatedAt,url":
      { code: 1, stdout: "", stderr: "HTTP 403: Resource not accessible" },
  });

  await assert.rejects(
    () => createProvider(runner).listOpenIssues(),
    /gh issue list failed; check GitHub authentication, repository remote, and repository permissions: HTTP 403: Resource not accessible/,
  );
});
```

- [ ] **Step 4: Run the provider test and confirm it fails before
      implementation**

Run:

```sh
node --test src/host/github-gh.test.ts
```

Expected before Task 2: FAIL because `listOpenIssues()` still calls
`--search sort:created-asc`, and the new failure-message assertion still expects
the remediation hint.

### Task 2: Remove search-backed listing and improve list failure messaging

**Files:**

- Modify: `src/host/github-gh.ts`

- [ ] **Step 1: Change `listOpenIssues()` to call non-search `gh issue list`**

Replace the current argument array in `listOpenIssues()` with:

```ts
const result = await this.runGh([
  "issue",
  "list",
  "--state",
  "open",
  "--limit",
  "1000",
  "--json",
  ISSUE_LIST_JSON_FIELDS,
]);
```

- [ ] **Step 2: Make non-zero list failures actionable**

Replace the current non-zero error with:

```ts
if (result.code !== 0)
  throw new Error(
    `gh issue list failed; check GitHub authentication, repository remote, and repository permissions: ${commandOutput(result)}`,
  );
```

Do not catch or convert failures into an empty issue array; `runTriage()`
already writes a failure triage log and rethrows provider errors.

- [ ] **Step 3: Run the provider test and confirm it passes**

Run:

```sh
node --test src/host/github-gh.test.ts
```

Expected: PASS.

### Task 3: Update triage pipeline GitHub command expectations and verify ordering coverage

**Files:**

- Modify: `src/cli/commands/triage/pipeline.test.ts`

- [ ] **Step 1: Update the GitHub list command assertion**

In the `runTriage uses GitHub host provider when configured` test, replace:

```ts
"gh issue list --state open --search sort:created-asc --limit 1000 --json number,title,body,state,labels,author,createdAt,updatedAt,url",
```

with:

```ts
"gh issue list --state open --limit 1000 --json number,title,body,state,labels,author,createdAt,updatedAt,url",
```

- [ ] **Step 2: Confirm existing ordering tests still cover provider-order
      independence**

Read the first tests in `src/cli/commands/triage/pipeline.test.ts` and keep
these assertions intact:

```ts
assert.equal(result.issues[0]?.issueNumber, 30);
```

from `runTriage applies limit after oldest-first default selection`, and the
corresponding `--all` oldest-first test. These tests feed issues in non-oldest
order and prove `orderTriageIssues()` controls selected issue order, so no extra
production code is needed for ordering.

- [ ] **Step 3: Run targeted triage tests**

Run:

```sh
node --test src/host/github-gh.test.ts src/cli/commands/triage/pipeline.test.ts
```

Expected: PASS.

### Task 4: Run full validation

**Files:**

- No source edits expected.

- [ ] **Step 1: Run the full test suite**

Run:

```sh
npm test
```

Expected: PASS.

- [ ] **Step 2: Confirm no Nix build is required**

Because this issue does not change `package.json`, `package-lock.json`,
`npm-shrinkwrap.json`, or any skill-pack dependency, AGENTS.md does not require
a Nix build. If implementation changes any npm dependency metadata despite this
plan, run the project Nix build before merge.

### Task 5: Commit the implementation

**Files:**

- Modify: `src/host/github-gh.ts`
- Modify: `src/host/github-gh.test.ts`
- Modify: `src/cli/commands/triage/pipeline.test.ts`

- [ ] **Step 1: Review the final diff**

Run:

```sh
git diff -- src/host/github-gh.ts src/host/github-gh.test.ts src/cli/commands/triage/pipeline.test.ts
```

Expected: the diff removes only `--search sort:created-asc` from default GitHub
issue listing, adds/updates focused tests, and improves the `gh issue list`
error message.

- [ ] **Step 2: Commit with a Conventional Commit message**

Run:

```sh
git add src/host/github-gh.ts src/host/github-gh.test.ts src/cli/commands/triage/pipeline.test.ts
git commit -m "fix: avoid github search for triage issue listing"
```

Expected: commit succeeds with only the three implementation files staged.

## Validation Commands

Use these commands for this issue:

```sh
node --test src/host/github-gh.test.ts
node --test src/host/github-gh.test.ts src/cli/commands/triage/pipeline.test.ts
npm test
```

No Nix build is required unless npm dependency metadata changes.
