# Process Triage Issues Oldest First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `patchmill triage` select and process batch issues oldest-created
first, applying `--limit` after eligibility filtering and ordering.

**Architecture:** Carry optional issue creation timestamps through host and
triage issue summaries. GitHub requests oldest-created results and parses
`createdAt`, Forgejo parses creation fields when present, and the triage
pipeline applies a provider-independent stable ordering helper before limiting
selected batches.

**Tech Stack:** TypeScript ES modules, Node.js built-in test runner
(`node --test`), GitHub CLI `gh`, Forgejo/Gitea `tea`, Markdown documentation.

---

## File Structure

- Modify `src/host/types.ts`: add optional `created?: string` to the host-facing
  `IssueSummary` type.
- Modify `src/cli/commands/triage/types.ts`: add optional `created?: string` to
  the triage-facing `IssueSummary` type.
- Modify `src/host/github-gh.ts`: request `createdAt`, pass
  `--search sort:created-asc` to `gh issue list`, and parse `createdAt` into
  `IssueSummary.created`.
- Modify `src/cli/commands/triage/forgejo.ts`: parse a creation timestamp from
  supported tea JSON fields while preserving issue-number sorting as fallback.
- Modify `src/cli/commands/triage/pipeline.ts`: add ordering helpers and sort
  selected issues before applying `--limit`.
- Modify `src/host/github-gh.test.ts`: cover GitHub list command ordering fields
  and creation timestamp parsing; update view command expectations.
- Modify `src/cli/commands/triage/pipeline.test.ts`: cover default and `--all`
  limit-after-ordering behavior.
- Modify `docs/issue-agent-workflows.md`: document oldest-created-first triage
  batch ordering and `--limit` placement.

## Validation Commands

Run these commands from the repository root after the relevant tasks:

```sh
node --test src/host/github-gh.test.ts src/cli/commands/triage/pipeline.test.ts
npm test
npm run lint
```

## Tasks

### Task 1: Add creation timestamps to issue summaries and GitHub parsing

**Files:**

- Modify: `src/host/types.ts`
- Modify: `src/cli/commands/triage/types.ts`
- Modify: `src/host/github-gh.ts`
- Test: `src/host/github-gh.test.ts`

- [ ] **Step 1: Update the GitHub provider test expectation first**

  In `src/host/github-gh.test.ts`, update
  `GitHubGhHostProvider lists open issues` so the scripted command key and
  expected issue include `createdAt`/`created`:

  ```ts
  "gh issue list --state open --search sort:created-asc --limit 1000 --json number,title,body,state,labels,author,createdAt,updatedAt,url":
    {
      code: 0,
      stdout: JSON.stringify([
        {
          number: 42,
          title: "Fix dashboard",
          body: null,
          state: "OPEN",
          labels: [{ name: "agent-ready" }, { name: "bug" }],
          author: { login: "alice" },
          createdAt: "2026-05-27T09:00:00Z",
          updatedAt: "2026-05-28T10:00:00Z",
          url: "https://github.example/issues/12",
        },
      ]),
      stderr: "",
    },
  ```

  Expected parsed issue object addition:

  ```ts
  created: "2026-05-27T09:00:00Z",
  ```

- [ ] **Step 2: Run the focused GitHub test and confirm it fails**

  Run:

  ```sh
  node --test src/host/github-gh.test.ts
  ```

  Expected: FAIL with an unexpected old command such as
  `gh issue list --state open --limit 1000 --json ...updatedAt...` or a missing
  `created` field.

- [ ] **Step 3: Add optional `created` to both issue summary types**

  In `src/host/types.ts`, change `IssueSummary` to include:

  ```ts
  author?: string;
  created?: string;
  updated?: string;
  url?: string;
  ```

  In `src/cli/commands/triage/types.ts`, change `IssueSummary` to include:

  ```ts
  url?: string;
  author?: string;
  created?: string;
  updated?: string;
  comments?: IssueCommentSummary[];
  ```

- [ ] **Step 4: Request and parse GitHub creation timestamps**

  In `src/host/github-gh.ts`, change the list fields to:

  ```ts
  const ISSUE_LIST_JSON_FIELDS =
    "number,title,body,state,labels,author,createdAt,updatedAt,url";
  ```

  In `parseIssuePayload`, add this immediately before the existing `updatedAt`
  parsing:

  ```ts
  if (typeof issue.createdAt === "string") parsed.created = issue.createdAt;
  ```

  In `listOpenIssues`, pass `--search sort:created-asc` before `--limit`:

  ```ts
  const result = await this.runGh([
    "issue",
    "list",
    "--state",
    "open",
    "--search",
    "sort:created-asc",
    "--limit",
    "1000",
    "--json",
    ISSUE_LIST_JSON_FIELDS,
  ]);
  ```

- [ ] **Step 5: Update existing GitHub view/hydration command expectations**

  In `src/host/github-gh.test.ts`, replace every expected view command field
  list:

  ```text
  number,title,body,state,labels,author,updatedAt,url,comments
  ```

  with:

  ```text
  number,title,body,state,labels,author,createdAt,updatedAt,url,comments
  ```

  Add `createdAt` to at least one `viewIssue` response and assert the parsed
  `issue.created` value:

  ```ts
  createdAt: "2026-05-27T10:00:00Z",
  ```

  ```ts
  assert.equal(issue.created, "2026-05-27T10:00:00Z");
  ```

- [ ] **Step 6: Run the focused GitHub test and commit**

  Run:

  ```sh
  node --test src/host/github-gh.test.ts
  ```

  Expected: PASS.

  Commit:

  ```sh
  git add src/host/types.ts src/cli/commands/triage/types.ts src/host/github-gh.ts src/host/github-gh.test.ts
  git commit -m "feat: capture issue creation timestamps"
  ```

### Task 2: Parse Forgejo creation timestamps when tea provides them

**Files:**

- Modify: `src/cli/commands/triage/forgejo.ts`
- Test: `src/cli/commands/triage/pipeline.test.ts` indirectly exercises Forgejo
  issue parsing through pipeline fixtures.

- [ ] **Step 1: Add creation parsing to Forgejo issue payloads**

  In `src/cli/commands/triage/forgejo.ts`, add a helper near `authorName`:

  ```ts
  function issueCreated(issue: Record<string, unknown>): string | undefined {
    for (const field of ["created", "createdAt", "created_at"]) {
      const value = issue[field];
      if (typeof value === "string") return value;
    }
    return undefined;
  }
  ```

- [ ] **Step 2: Store parsed Forgejo creation timestamps**

  In `parseIssuePayload`, add `created: issueCreated(issue),` to the
  `parsedIssue` object:

  ```ts
  const parsedIssue: IssueSummary = {
    number,
    title: issue.title,
    body: typeof issue.body === "string" ? issue.body : "",
    state: typeof issue.state === "string" ? issue.state : "open",
    labels: labelNames(issue.labels),
    author: authorName(issue.author),
    created: issueCreated(issue),
    updated: typeof issue.updated === "string" ? issue.updated : undefined,
    comments: issueComments(issue.comments),
  };
  ```

- [ ] **Step 3: Preserve tea field compatibility**

  Keep the existing field list unchanged unless local verification shows tea
  supports adding a creation field:

  ```ts
  const ISSUE_FIELDS =
    "index,title,body,state,labels,author,updated,comments,url";
  ```

  Rationale: parsing `created`, `createdAt`, and `created_at` is safe for JSON
  payloads that already include those fields; preserving `ISSUE_FIELDS` avoids
  breaking tea versions that reject unsupported fields.

- [ ] **Step 4: Run triage tests for regressions and commit**

  Run:

  ```sh
  node --test src/cli/commands/triage/pipeline.test.ts
  ```

  Expected: PASS.

  Commit:

  ```sh
  git add src/cli/commands/triage/forgejo.ts
  git commit -m "feat: parse forgejo issue creation time"
  ```

### Task 3: Sort selected triage batches before applying limits

**Files:**

- Modify: `src/cli/commands/triage/pipeline.ts`
- Test: `src/cli/commands/triage/pipeline.test.ts`

- [ ] **Step 1: Add a failing default-selection test**

  Add this test to `src/cli/commands/triage/pipeline.test.ts` near the other
  dry-run pipeline tests:

  ```ts
  test("runTriage applies limit after oldest-first default selection", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
    const runner = createStaticCommandRunner([
      {
        code: 0,
        stdout: JSON.stringify([
          {
            index: 30,
            title: "Newest eligible",
            body: "Newer work",
            state: "open",
            labels: [{ name: "bug" }],
            created: "2026-06-03T00:00:00Z",
          },
          {
            index: 10,
            title: "Oldest eligible",
            body: "Older work",
            state: "open",
            labels: [{ name: "bug" }],
            created: "2026-06-01T00:00:00Z",
          },
          {
            index: 20,
            title: "Skipped middle",
            body: "Already ready",
            state: "open",
            labels: [{ name: "agent-ready" }],
            created: "2026-06-02T00:00:00Z",
          },
        ]),
        stderr: "",
      },
      { code: 0, stdout: JSON.stringify([]), stderr: "" },
      noCommentsOutput,
      { code: 0, stdout: agentReadyPreviewJson(10), stderr: "" },
    ]);

    const result = await runTriage(runner, {
      repoRoot: "/repo",
      dryRun: true,
      execute: false,
      limit: 1,
      logDir,
      host: DEFAULT_PATCHMILL_CONFIG.host,
    });

    assert.equal(result.status, "dry-run");
    assert.equal(result.issueCount, 1);
    assert.equal(result.issues[0]?.issueNumber, 10);
  });
  ```

- [ ] **Step 2: Run the new pipeline test and confirm it fails**

  Run:

  ```sh
  node --test src/cli/commands/triage/pipeline.test.ts
  ```

  Expected: FAIL because `limit: 1` selects issue `#30` from provider order
  before sorting.

- [ ] **Step 3: Add triage ordering helpers**

  In `src/cli/commands/triage/pipeline.ts`, add these helpers above
  `selectIssues`:

  ```ts
  function createdMillis(issue: IssueSummary): number | undefined {
    if (!issue.created) return undefined;
    const millis = Date.parse(issue.created);
    return Number.isFinite(millis) ? millis : undefined;
  }

  function compareTriageIssueOrder(
    left: IssueSummary,
    right: IssueSummary,
  ): number {
    const leftCreated = createdMillis(left);
    const rightCreated = createdMillis(right);
    if (
      leftCreated !== undefined &&
      rightCreated !== undefined &&
      leftCreated !== rightCreated
    ) {
      return leftCreated - rightCreated;
    }
    return left.number - right.number;
  }

  function orderTriageIssues(issues: IssueSummary[]): IssueSummary[] {
    return [...issues].sort(compareTriageIssueOrder);
  }
  ```

- [ ] **Step 4: Apply ordering after filtering and before limiting**

  In `selectIssues`, insert ordering immediately before the existing limit
  block:

  ```ts
  selected = orderTriageIssues(selected);

  if (config.limit !== undefined) {
    selected = selected.slice(0, config.limit);
  }
  ```

  This keeps `--issue` effectively unchanged because a targeted selection
  contains at most one open issue.

- [ ] **Step 5: Run the focused pipeline test and commit**

  Run:

  ```sh
  node --test src/cli/commands/triage/pipeline.test.ts
  ```

  Expected: PASS.

  Commit:

  ```sh
  git add src/cli/commands/triage/pipeline.ts src/cli/commands/triage/pipeline.test.ts
  git commit -m "feat: order triage batches oldest first"
  ```

### Task 4: Cover `--all` ordering and fallback tie-breakers

**Files:**

- Modify: `src/cli/commands/triage/pipeline.test.ts`

- [ ] **Step 1: Add a failing `--all` limit-after-ordering test**

  Add this test to `src/cli/commands/triage/pipeline.test.ts`:

  ```ts
  test("runTriage --all applies limit after oldest-first ordering", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
    const runner = createStaticCommandRunner([
      {
        code: 0,
        stdout: JSON.stringify([
          {
            index: 30,
            title: "Newest normal",
            body: "Newer work",
            state: "open",
            labels: [{ name: "bug" }],
            created: "2026-06-03T00:00:00Z",
          },
          {
            index: 10,
            title: "Oldest excluded",
            body: "Older protected work",
            state: "open",
            labels: [{ name: "agent-ready" }],
            created: "2026-06-01T00:00:00Z",
          },
          {
            index: 20,
            title: "Middle normal",
            body: "Middle work",
            state: "open",
            labels: [{ name: "bug" }],
            created: "2026-06-02T00:00:00Z",
          },
        ]),
        stderr: "",
      },
      noCommentsOutput,
      { code: 0, stdout: agentReadyPreviewJson(10), stderr: "" },
    ]);

    const result = await runTriage(runner, {
      repoRoot: "/repo",
      dryRun: true,
      execute: false,
      all: true,
      limit: 1,
      logDir,
      host: DEFAULT_PATCHMILL_CONFIG.host,
    });

    assert.equal(result.status, "dry-run");
    assert.equal(result.issueCount, 1);
    assert.equal(result.issues[0]?.issueNumber, 10);
  });
  ```

  Expected before Task 3 implementation: FAIL because provider order would pick
  `#30`; expected after Task 3: PASS.

- [ ] **Step 2: Add fallback ordering coverage for invalid or missing dates**

  Add this test to the same file:

  ```ts
  test("runTriage orders by issue number when created dates are missing or invalid", async () => {
    const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
    const runner = createStaticCommandRunner([
      {
        code: 0,
        stdout: JSON.stringify([
          {
            index: 30,
            title: "Invalid date",
            body: "Bad date",
            state: "open",
            labels: [{ name: "bug" }],
            created: "not-a-date",
          },
          {
            index: 10,
            title: "Missing date",
            body: "No date",
            state: "open",
            labels: [{ name: "bug" }],
          },
        ]),
        stderr: "",
      },
      { code: 0, stdout: JSON.stringify([]), stderr: "" },
      noCommentsOutput,
      { code: 0, stdout: agentReadyPreviewJson(10), stderr: "" },
    ]);

    const result = await runTriage(runner, {
      repoRoot: "/repo",
      dryRun: true,
      execute: false,
      limit: 1,
      logDir,
      host: DEFAULT_PATCHMILL_CONFIG.host,
    });

    assert.equal(result.status, "dry-run");
    assert.equal(result.issues[0]?.issueNumber, 10);
  });
  ```

- [ ] **Step 3: Run focused triage tests and commit**

  Run:

  ```sh
  node --test src/cli/commands/triage/pipeline.test.ts
  ```

  Expected: PASS.

  Commit:

  ```sh
  git add src/cli/commands/triage/pipeline.test.ts
  git commit -m "test: cover triage ordering limits"
  ```

### Task 5: Document and validate the triage ordering rule

**Files:**

- Modify: `docs/issue-agent-workflows.md`

- [ ] **Step 1: Update workflow documentation**

  In `docs/issue-agent-workflows.md`, add this paragraph after the initial
  `patchmill triage` execution description under `### Flow`:

  ```md
  Batch triage orders selected issues oldest-created first before applying
  `--limit`. When creation timestamps are unavailable or invalid, Patchmill uses
  lower issue number as the fallback and tie-breaker. Default triage applies
  this ordering after excluded/protection label filtering, `--all` applies it to
  all open issues, and targeted `--issue <number>` remains a single-issue
  selection. Dry-run prompts, execution prompts, progress output, blocked
  preprocessing, and triage logs preserve this selected order.
  ```

- [ ] **Step 2: Run targeted tests**

  Run:

  ```sh
  node --test src/host/github-gh.test.ts src/cli/commands/triage/pipeline.test.ts
  ```

  Expected: PASS.

- [ ] **Step 3: Run full validation**

  Run:

  ```sh
  npm test
  npm run lint
  ```

  Expected: both commands PASS. If either command fails for unrelated
  pre-existing repository state, record the failing command, error summary, and
  why it is unrelated in the implementation handoff.

- [ ] **Step 4: Commit documentation and validation updates**

  Commit:

  ```sh
  git add docs/issue-agent-workflows.md
  git commit -m "docs: document triage ordering"
  ```
