# Blocked Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `blocked` as an explicit canonical triage bucket and repository
label that records concrete blocking issue numbers and automatically moves
blocked issues to `agent-ready` when all blockers are closed.

**Architecture:** Promote `blocked` into the canonical triage state map, extend
dry-run/log contracts with `blockedBy`, and add deterministic runtime handling
for already-blocked issues before they reach the triage agent. Initial blocked
classification still flows through the triage prompt/skill; later auto-unblock
is host-driven and uses parsed Patchmill triage comments plus `viewIssue` state
checks. The unblock transition must remove `blocked`, add `agent-ready`, and
post a new unblock comment.

**Tech Stack:** TypeScript, Node test runner, Patchmill CLI triage pipeline,
GitHub `gh` and Forgejo/Gitea `tea` host providers.

---

## File structure

- Modify `src/policy/triage-state.ts` to add `blocked` to canonical buckets and
  default state maps.
- Modify `src/policy/triage-state.test.ts` and `src/policy/triage.test.ts` for
  canonical-state and policy expectations.
- Modify `src/config/defaults.test.ts` and `src/config/load.test.ts` only where
  default state map expectations need the new bucket.
- Modify `src/cli/commands/triage/types.ts` to add `blockedBy` to raw previews,
  normalized previews, and log entries.
- Modify `src/cli/commands/triage/dry-run-agent.ts` to document and validate
  `blockedBy`.
- Modify `src/cli/commands/triage/dry-run-agent.test.ts` for prompt and parser
  coverage.
- Create `src/cli/commands/triage/blocked.ts` for blocked comment formatting,
  parsing, label replacement, and blocker-state resolution.
- Create `src/cli/commands/triage/blocked.test.ts` for the helper module.
- Modify `src/cli/commands/triage/reporting.ts` and
  `src/cli/commands/triage/reporting.test.ts` so preview and observed logs
  preserve `blockedBy`.
- Modify `src/cli/commands/triage/pipeline.ts` so default triage includes
  blocked issues, previews auto-unblock in dry-run, and applies auto-unblock in
  execute mode.
- Modify `src/cli/commands/triage/pipeline-selection.test.ts` and
  `src/cli/commands/triage/pipeline.test.ts` for default blocked selection and
  auto-unblock behavior.
- Modify `src/cli/commands/triage/execute-agent.ts` and
  `src/cli/commands/triage/execute-agent.test.ts` only if the execution prompt
  needs an explicit blocked reminder beyond the skill.
- Modify `skills/patchmill-issue-triage/SKILL.md` to define the `blocked` bucket
  and comment requirements.
- Modify `docs/configuration.md`, `docs/issue-agent-workflows.md`, and relevant
  fixture issue files under `fixtures/patchmill-test-repo/issues/`.

## Task 1: Promote `blocked` to a canonical triage state

**Files:**

- Modify: `src/policy/triage-state.ts`
- Modify: `src/policy/triage-state.test.ts`
- Modify: `src/policy/triage.test.ts`
- Modify: `src/config/defaults.test.ts`
- Modify: `src/config/load.test.ts`

- [ ] **Step 1: Write failing canonical-state tests**

Update `src/policy/triage-state.test.ts` so the first tests include `blocked`:

```ts
test("defaultTriageStateMap maps configured bucket labels", () => {
  assert.deepEqual(
    defaultTriageStateMap({
      ready: "ready-for-agent",
      needsInfo: "needs-info",
      unsuitable: "ready-for-human",
      blocked: "waiting-on-dependency",
    }),
    {
      "ready-for-agent": "agent-ready",
      "needs-info": "needs-info",
      "ready-for-human": "agent-unsuitable",
      "waiting-on-dependency": "blocked",
    },
  );
});

test("validateTriageStateMap accepts supported canonical buckets", () => {
  assert.deepEqual(
    validateTriageStateMap(
      {
        "ready-for-agent": "agent-ready",
        "needs-info": "needs-info",
        "ready-for-human": "agent-unsuitable",
        "waiting-on-dependency": "blocked",
      },
      "ready-for-agent",
    ),
    {
      "ready-for-agent": "agent-ready",
      "needs-info": "needs-info",
      "ready-for-human": "agent-unsuitable",
      "waiting-on-dependency": "blocked",
    },
  );
});
```

Update the unsupported-bucket error expectation in the same file:

```ts
/triage\.stateMap\.deferred must be one of agent-ready, needs-info, agent-unsuitable, blocked/;
```

Update `nonReadyStateLabels` and `canonicalBucketForLabels` expectations:

```ts
test("nonReadyStateLabels returns labels that should block run-once", () => {
  assert.deepEqual(
    nonReadyStateLabels({
      "ready-for-agent": "agent-ready",
      "needs-info": "needs-info",
      "ready-for-human": "agent-unsuitable",
      blocked: "blocked",
      wontfix: "agent-unsuitable",
    }),
    ["blocked", "needs-info", "ready-for-human", "wontfix"],
  );
});

// In canonicalBucketForLabels stateMap:
const stateMap = {
  "ready-for-agent": "agent-ready",
  "needs-info": "needs-info",
  "ready-for-human": "agent-unsuitable",
  blocked: "blocked",
} as const;

assert.equal(canonicalBucketForLabels(["bug", "blocked"], stateMap), "blocked");
```

Update the first assertion in `src/policy/triage.test.ts` so default policy
state maps include the configured blocked label:

```ts
assert.deepEqual(policy.stateMap, {
  "ready-for-bots": "agent-ready",
  "needs-clarification": "needs-info",
  "manual-only": "agent-unsuitable",
  waiting: "blocked",
});
```

- [ ] **Step 2: Run the failing policy tests**

Run:

```bash
node --test src/policy/triage-state.test.ts src/policy/triage.test.ts src/config/defaults.test.ts src/config/load.test.ts
```

Expected: failures show that `blocked` is not accepted as a canonical bucket and
default state maps do not include the blocked label.

- [ ] **Step 3: Update the canonical state implementation**

Change `src/policy/triage-state.ts` to include `blocked`:

```ts
export const TRIAGE_CANONICAL_BUCKETS = [
  "agent-ready",
  "needs-info",
  "agent-unsuitable",
  "blocked",
] as const;
```

Update `TriageStateMapLabels`:

```ts
type TriageStateMapLabels = {
  ready: string;
  needsInfo: string;
  unsuitable: string;
  blocked: string;
};
```

Update `defaultTriageStateMap`:

```ts
export function defaultTriageStateMap(
  labels: TriageStateMapLabels,
): PatchmillTriageStateMap {
  return {
    [labels.ready]: "agent-ready",
    [labels.needsInfo]: "needs-info",
    [labels.unsuitable]: "agent-unsuitable",
    [labels.blocked]: "blocked",
  };
}
```

- [ ] **Step 4: Update config/load expectations that fail after the
      implementation**

If `src/config/defaults.test.ts` or `src/config/load.test.ts` asserts the exact
default `triage.stateMap`, add:

```ts
blocked: "blocked",
```

or the configured blocked label equivalent, for example:

```ts
"waiting-on-dependency": "blocked",
```

- [ ] **Step 5: Run policy/config tests until they pass**

Run:

```bash
node --test src/policy/triage-state.test.ts src/policy/triage.test.ts src/config/defaults.test.ts src/config/load.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit canonical-state changes**

```bash
git add src/policy/triage-state.ts src/policy/triage-state.test.ts src/policy/triage.test.ts src/config/defaults.test.ts src/config/load.test.ts
git commit -m "feat(triage): add blocked canonical state"
```

## Task 2: Add `blockedBy` to dry-run previews and triage logs

**Files:**

- Modify: `src/cli/commands/triage/types.ts`
- Modify: `src/cli/commands/triage/dry-run-agent.ts`
- Modify: `src/cli/commands/triage/dry-run-agent.test.ts`
- Modify: `src/cli/commands/triage/reporting.ts`
- Modify: `src/cli/commands/triage/reporting.test.ts`

- [ ] **Step 1: Write failing dry-run parser tests**

In `src/cli/commands/triage/dry-run-agent.test.ts`, add a blocked preview test
after the existing valid-preview test:

```ts
test("validateTriagePreviewDocument accepts blocked previews with blocker numbers", () => {
  const previews = validateTriagePreviewDocument(
    {
      previews: [
        {
          issueNumber: 42,
          currentLabels: ["bug"],
          proposedLabels: ["blocked", "bug"],
          canonicalBucket: "blocked",
          blockedBy: [1, 2],
          rationale: "This issue must wait for the scaffold and model work.",
          wouldComment:
            "> _This was generated by AI during triage._\n\nBlocked by: #1, #2\n\nThis can run after the dependencies close.",
          wouldClose: false,
          questions: [],
        },
      ],
    },
    issues,
  );

  assert.deepEqual(previews[0]?.blockedBy, [1, 2]);
  assert.equal(previews[0]?.canonicalBucket, "blocked");
});
```

Add invalid blocked preview assertions to
`validateTriagePreviewDocument rejects invalid previews`:

```ts
assert.throws(
  () =>
    validateTriagePreviewDocument(
      {
        previews: [
          {
            issueNumber: 42,
            currentLabels: [],
            proposedLabels: ["blocked"],
            canonicalBucket: "blocked",
            blockedBy: [],
            rationale: "Blocked without blocker metadata.",
            wouldComment: null,
            wouldClose: false,
            questions: [],
          },
        ],
      },
      issues,
    ),
  /blockedBy for issue 42 must include at least one issue number/,
);

assert.throws(
  () =>
    validateTriagePreviewDocument(
      {
        previews: [
          {
            issueNumber: 42,
            currentLabels: [],
            proposedLabels: ["blocked"],
            canonicalBucket: "blocked",
            blockedBy: [42],
            rationale: "Self blocked.",
            wouldComment: null,
            wouldClose: false,
            questions: [],
          },
        ],
      },
      issues,
    ),
  /blockedBy for issue 42 must not include itself/,
);

assert.throws(
  () =>
    validateTriagePreviewDocument(
      {
        previews: [
          {
            issueNumber: 42,
            currentLabels: [],
            proposedLabels: ["agent-ready"],
            canonicalBucket: "agent-ready",
            blockedBy: [1],
            rationale: "Not blocked.",
            wouldComment: null,
            wouldClose: false,
            questions: [],
          },
        ],
      },
      issues,
    ),
  /blockedBy for issue 42 is only valid when canonicalBucket is blocked/,
);
```

- [ ] **Step 2: Write failing reporting tests**

In `src/cli/commands/triage/reporting.test.ts`, add `blocked` to the local state
map:

```ts
const stateMap = {
  "ready-for-agent": "agent-ready",
  "needs-info": "needs-info",
  "ready-for-human": "agent-unsuitable",
  blocked: "blocked",
  wontfix: "agent-unsuitable",
} as const;
```

Add a preview log test:

```ts
test("createPreviewEntries carries blockedBy into blocked log entries", () => {
  const previews: TriagePreview[] = [
    {
      issueNumber: 1,
      currentLabels: ["bug"],
      proposedLabels: ["blocked", "bug"],
      canonicalBucket: "blocked",
      blockedBy: [2, 3],
      rationale: "Blocked by prerequisite issues.",
      wouldComment:
        "> _This was generated by AI during triage._\n\nBlocked by: #2, #3",
      wouldClose: false,
      questions: [],
    },
  ];

  assert.deepEqual(createPreviewEntries([issue(1, ["bug"])], previews), [
    {
      issueNumber: 1,
      title: "Issue 1",
      previousLabels: ["bug"],
      finalLabels: ["blocked", "bug"],
      primaryBucket: "blocked",
      blockedBy: [2, 3],
      rationale: "Blocked by prerequisite issues.",
      questions: [],
      comment:
        "> _This was generated by AI during triage._\n\nBlocked by: #2, #3",
      wouldClose: false,
      mutationStatus: "preview",
    },
  ]);
});
```

- [ ] **Step 3: Run dry-run/reporting tests and confirm failure**

Run:

```bash
node --test src/cli/commands/triage/dry-run-agent.test.ts src/cli/commands/triage/reporting.test.ts
```

Expected: tests fail because `blockedBy` is not part of preview/log types or
validation.

- [ ] **Step 4: Update triage preview/log types**

In `src/cli/commands/triage/types.ts`, add `blockedBy`:

```ts
export type RawTriagePreview = {
  issueNumber: unknown;
  currentLabels: unknown;
  proposedLabels: unknown;
  canonicalBucket: unknown;
  blockedBy?: unknown;
  rationale: unknown;
  wouldComment?: unknown;
  wouldClose?: unknown;
  questions?: unknown;
};
```

```ts
export type TriagePreview = {
  issueNumber: number;
  currentLabels: string[];
  proposedLabels: string[];
  canonicalBucket: PatchmillTriageCanonicalBucket;
  blockedBy: number[];
  rationale: string;
  wouldComment: string | null;
  wouldClose: boolean;
  questions: string[];
};
```

```ts
export type TriageLogIssueEntry = {
  issueNumber: number;
  title: string;
  url?: string;
  previousLabels: string[];
  finalLabels: string[];
  primaryBucket?: PrimaryBucket;
  blockedBy?: number[];
  rationale?: string;
  questions: TriageQuestion[];
  comment: string | null;
  addedComments?: string[];
  previousState?: string;
  finalState?: string;
  wouldClose?: boolean;
  mutationStatus: "preview" | "observed" | "failed";
  error?: string;
};
```

- [ ] **Step 5: Update dry-run prompt and validation**

In `src/cli/commands/triage/dry-run-agent.ts`, add a number-array parser:

```ts
function asIssueNumberArray(value: unknown, context: string): number[] {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array`);
  const numbers = value.map((entry, index) => {
    if (!Number.isInteger(entry) || Number(entry) <= 0) {
      throw new Error(`${context}[${index}] must be a positive integer`);
    }
    return Number(entry);
  });
  return [...new Set(numbers)].sort((left, right) => left - right);
}
```

Add `blockedBy` to the JSON example in `buildTriageDryRunPrompt`:

```json
"canonicalBucket": "agent-ready",
"blockedBy": [],
"rationale": "Short reason for the dry-run report.",
```

Add rules below the existing `canonicalBucket` rule:

```ts
- blockedBy must be [] except when canonicalBucket is blocked.
- For blocked issues, blockedBy must list concrete same-repository issue numbers that block this issue.
- Use canonicalBucket needs-info instead of blocked when blocker issue numbers cannot be identified.
- Blocked comments must include a line like "Blocked by: #1" or "Blocked by: #1, #2".
```

Update `validateOnePreview` after validating `canonicalBucket`:

```ts
const blockedBy =
  raw.blockedBy === undefined
    ? []
    : asIssueNumberArray(raw.blockedBy, `blockedBy for issue ${issueNumber}`);
if (canonicalBucket === "blocked") {
  if (blockedBy.length === 0) {
    throw new Error(
      `blockedBy for issue ${issueNumber} must include at least one issue number`,
    );
  }
  if (blockedBy.includes(Number(issueNumber))) {
    throw new Error(
      `blockedBy for issue ${issueNumber} must not include itself`,
    );
  }
} else if (blockedBy.length > 0) {
  throw new Error(
    `blockedBy for issue ${issueNumber} is only valid when canonicalBucket is blocked`,
  );
}
```

Include `blockedBy` in the returned preview:

```ts
blockedBy,
```

- [ ] **Step 6: Update reporting**

In `src/cli/commands/triage/reporting.ts`, include preview blocker metadata:

```ts
      primaryBucket: preview.canonicalBucket,
      ...(preview.blockedBy.length > 0 ? { blockedBy: preview.blockedBy } : {}),
      rationale: preview.rationale,
```

For now, leave observed blocked metadata to Task 3 because it will use the
shared blocked-comment parser.

- [ ] **Step 7: Update existing test fixture previews**

Every existing `TriagePreview` object in tests must include `blockedBy: []`.
Every JSON preview emitted by test runners should include `blockedBy: []` for
non-blocked buckets. Example:

```ts
{
  issueNumber: 42,
  currentLabels: ["needs-triage"],
  proposedLabels: ["ready-for-agent"],
  canonicalBucket: "agent-ready",
  blockedBy: [],
  rationale: "Clear enough.",
  wouldComment: null,
  wouldClose: false,
  questions: [],
}
```

- [ ] **Step 8: Run triage contract tests**

Run:

```bash
node --test src/cli/commands/triage/dry-run-agent.test.ts src/cli/commands/triage/reporting.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 9: Commit dry-run contract changes**

```bash
git add src/cli/commands/triage/types.ts src/cli/commands/triage/dry-run-agent.ts src/cli/commands/triage/dry-run-agent.test.ts src/cli/commands/triage/reporting.ts src/cli/commands/triage/reporting.test.ts
git commit -m "feat(triage): record blocked issue dependencies"
```

## Task 3: Add blocked comment and label helpers

**Files:**

- Create: `src/cli/commands/triage/blocked.ts`
- Create: `src/cli/commands/triage/blocked.test.ts`
- Modify: `src/cli/commands/triage/reporting.ts`
- Modify: `src/cli/commands/triage/reporting.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `src/cli/commands/triage/blocked.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blockedByFromIssue,
  createBlockedComment,
  createUnblockedComment,
  isClosedIssue,
  replaceTriageStateLabels,
  resolveBlockedIssue,
} from "./blocked.ts";
import type { IssueSummary } from "./types.ts";

const stateMap = {
  "agent-ready": "agent-ready",
  "needs-info": "needs-info",
  "agent-unsuitable": "agent-unsuitable",
  blocked: "blocked",
} as const;

function issue(
  number: number,
  labels: string[],
  comments: unknown[] = [],
  state = "open",
): IssueSummary {
  return {
    number,
    title: `Issue ${number}`,
    body: "",
    labels,
    comments,
    state,
  };
}

test("createBlockedComment formats blocker references and rationale", () => {
  assert.equal(
    createBlockedComment(
      [1, 2],
      "The form depends on the scaffold and domain model.",
    ),
    [
      "> _This was generated by AI during triage._",
      "",
      "Blocked by: #1, #2",
      "",
      "The form depends on the scaffold and domain model.",
    ].join("\n"),
  );
});

test("createUnblockedComment leaves a new audit trail comment", () => {
  assert.equal(
    createUnblockedComment([1, 2]),
    [
      "> _This was generated by AI during triage._",
      "",
      "The blocking issues are now closed: #1, #2.",
      "",
      "This issue is now agent-ready.",
    ].join("\n"),
  );
});

test("blockedByFromIssue reads the newest Patchmill blocked comment", () => {
  const parsed = blockedByFromIssue(
    issue(
      3,
      ["blocked"],
      [
        {
          author: "bot",
          body: "> _This was generated by AI during triage._\n\nBlocked by: #1",
        },
        {
          author: "bot",
          body: "> _This was generated by AI during triage._\n\nBlocked by: #1, #2",
        },
      ],
    ),
  );

  assert.deepEqual(parsed, [1, 2]);
});

test("blockedByFromIssue ignores non-Patchmill comments", () => {
  assert.deepEqual(
    blockedByFromIssue(issue(3, ["blocked"], [{ body: "Blocked by: #1" }])),
    [],
  );
});

test("replaceTriageStateLabels removes stale triage labels and adds target label", () => {
  assert.deepEqual(
    replaceTriageStateLabels(
      ["bug", "blocked", "needs-info", "priority:high"],
      stateMap,
      "agent-ready",
    ),
    ["bug", "priority:high", "agent-ready"],
  );
});

test("isClosedIssue treats only closed state as closed", () => {
  assert.equal(isClosedIssue(issue(1, [], [], "closed")), true);
  assert.equal(isClosedIssue(issue(1, [], [], "CLOSED")), true);
  assert.equal(isClosedIssue(issue(1, [], [], "open")), false);
});

test("resolveBlockedIssue returns unblocked when all blockers are closed", async () => {
  const viewed: number[] = [];
  const host = {
    async viewIssue(issueNumber: number) {
      viewed.push(issueNumber);
      return issue(issueNumber, [], [], "closed");
    },
  };

  const result = await resolveBlockedIssue(
    host,
    issue(
      3,
      ["blocked"],
      [
        {
          body: "> _This was generated by AI during triage._\n\nBlocked by: #1, #2",
        },
      ],
    ),
  );

  assert.deepEqual(viewed, [1, 2]);
  assert.deepEqual(result, {
    status: "unblocked",
    blockedBy: [1, 2],
    openBlockers: [],
  });
});

test("resolveBlockedIssue reports open blockers", async () => {
  const host = {
    async viewIssue(issueNumber: number) {
      return issue(issueNumber, [], [], issueNumber === 1 ? "closed" : "open");
    },
  };

  const result = await resolveBlockedIssue(
    host,
    issue(
      3,
      ["blocked"],
      [
        {
          body: "> _This was generated by AI during triage._\n\nBlocked by: #1, #2",
        },
      ],
    ),
  );

  assert.deepEqual(result, {
    status: "still-blocked",
    blockedBy: [1, 2],
    openBlockers: [2],
  });
});

test("resolveBlockedIssue reports missing metadata", async () => {
  const host = {
    async viewIssue() {
      throw new Error("viewIssue should not be called");
    },
  };

  const result = await resolveBlockedIssue(host, issue(3, ["blocked"], []));

  assert.deepEqual(result, {
    status: "missing-blockers",
    blockedBy: [],
    openBlockers: [],
  });
});
```

- [ ] **Step 2: Run helper tests and confirm failure**

Run:

```bash
node --test src/cli/commands/triage/blocked.test.ts
```

Expected: fails because `blocked.ts` does not exist.

- [ ] **Step 3: Implement `blocked.ts`**

Create `src/cli/commands/triage/blocked.ts`:

```ts
import type { IssueSummary } from "./types.ts";
import type { PatchmillTriageStateMap } from "../../../policy/triage-state.ts";

export const TRIAGE_COMMENT_PREFIX =
  "> _This was generated by AI during triage._";

type BlockerHost = {
  viewIssue(issueNumber: number): Promise<IssueSummary>;
};

export type BlockedIssueResolution =
  | { status: "missing-blockers"; blockedBy: number[]; openBlockers: number[] }
  | { status: "still-blocked"; blockedBy: number[]; openBlockers: number[] }
  | { status: "unblocked"; blockedBy: number[]; openBlockers: number[] };

function issueRefs(issueNumbers: readonly number[]): string {
  return issueNumbers.map((issueNumber) => `#${issueNumber}`).join(", ");
}

function uniqueIssueNumbers(issueNumbers: readonly number[]): number[] {
  return [...new Set(issueNumbers)].sort((left, right) => left - right);
}

export function createBlockedComment(
  blockedBy: readonly number[],
  rationale: string,
): string {
  return [
    TRIAGE_COMMENT_PREFIX,
    "",
    `Blocked by: ${issueRefs(uniqueIssueNumbers(blockedBy))}`,
    "",
    rationale.trim(),
  ].join("\n");
}

export function createUnblockedComment(blockedBy: readonly number[]): string {
  return [
    TRIAGE_COMMENT_PREFIX,
    "",
    `The blocking issues are now closed: ${issueRefs(uniqueIssueNumbers(blockedBy))}.`,
    "",
    "This issue is now agent-ready.",
  ].join("\n");
}

function commentBody(comment: unknown): string | undefined {
  if (typeof comment === "string") return comment;
  if (comment && typeof comment === "object" && "body" in comment) {
    const body = (comment as Record<string, unknown>).body;
    if (typeof body === "string") return body;
  }
  return undefined;
}

function blockedByFromComment(comment: string): number[] {
  if (!comment.includes(TRIAGE_COMMENT_PREFIX)) return [];
  const blockedLine = comment
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => /^Blocked by:/iu.test(line));
  if (!blockedLine) return [];
  return uniqueIssueNumbers(
    [...blockedLine.matchAll(/#([1-9]\d*)/gu)].map((match) => Number(match[1])),
  );
}

export function blockedByFromIssue(
  issue: Pick<IssueSummary, "comments">,
): number[] {
  const comments = [...(issue.comments ?? [])].reverse();
  for (const comment of comments) {
    const body = commentBody(comment);
    if (!body) continue;
    const blockedBy = blockedByFromComment(body);
    if (blockedBy.length > 0) return blockedBy;
  }
  return [];
}

export function replaceTriageStateLabels(
  labels: readonly string[],
  stateMap: PatchmillTriageStateMap,
  nextLabel: string,
): string[] {
  const triageStateLabels = new Set(Object.keys(stateMap));
  return [
    ...labels.filter((label) => !triageStateLabels.has(label)),
    nextLabel,
  ];
}

export function isClosedIssue(issue: Pick<IssueSummary, "state">): boolean {
  return issue.state.toLowerCase() === "closed";
}

export async function resolveBlockedIssue(
  host: BlockerHost,
  issue: Pick<IssueSummary, "comments">,
): Promise<BlockedIssueResolution> {
  const blockedBy = blockedByFromIssue(issue);
  if (blockedBy.length === 0) {
    return { status: "missing-blockers", blockedBy: [], openBlockers: [] };
  }

  const blockerIssues = await Promise.all(
    blockedBy.map((issueNumber) => host.viewIssue(issueNumber)),
  );
  const openBlockers = blockerIssues
    .filter((blocker) => !isClosedIssue(blocker))
    .map((blocker) => blocker.number)
    .sort((left, right) => left - right);

  return openBlockers.length === 0
    ? { status: "unblocked", blockedBy, openBlockers }
    : { status: "still-blocked", blockedBy, openBlockers };
}
```

- [ ] **Step 4: Use the helper in observed reporting**

In `src/cli/commands/triage/reporting.ts`, import the parser:

```ts
import { blockedByFromIssue } from "./blocked.ts";
```

In `createObservedChangeEntries`, include `blockedBy` when the observed final
bucket is blocked:

```ts
const blockedBy = primaryBucket === "blocked" ? blockedByFromIssue(after) : [];
```

Add the property to the returned entry:

```ts
...(blockedBy.length > 0 ? { blockedBy } : {}),
```

- [ ] **Step 5: Add an observed reporting test**

In `src/cli/commands/triage/reporting.test.ts`, add:

```ts
test("createObservedChangeEntries extracts blockedBy from Patchmill blocked comments", () => {
  const before = [issue(3, ["bug"], [])];
  const blockedComment =
    "> _This was generated by AI during triage._\n\nBlocked by: #1, #2\n\nWaiting for prerequisites.";
  const after = [issue(3, ["blocked", "bug"], [{ body: blockedComment }])];

  assert.deepEqual(createObservedChangeEntries(before, after, stateMap), [
    {
      issueNumber: 3,
      title: "Issue 3",
      previousLabels: ["bug"],
      finalLabels: ["blocked", "bug"],
      primaryBucket: "blocked",
      blockedBy: [1, 2],
      questions: [],
      comment: blockedComment,
      addedComments: [blockedComment],
      previousState: "open",
      finalState: "open",
      mutationStatus: "observed",
    },
  ]);
});
```

- [ ] **Step 6: Run helper/reporting tests**

Run:

```bash
node --test src/cli/commands/triage/blocked.test.ts src/cli/commands/triage/reporting.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit helper changes**

```bash
git add src/cli/commands/triage/blocked.ts src/cli/commands/triage/blocked.test.ts src/cli/commands/triage/reporting.ts src/cli/commands/triage/reporting.test.ts
git commit -m "feat(triage): parse blocked issue metadata"
```

## Task 4: Re-evaluate blocked issues and auto-unblock closed dependencies

**Files:**

- Modify: `src/cli/commands/triage/pipeline.ts`
- Modify: `src/cli/commands/triage/pipeline-selection.test.ts`
- Modify: `src/cli/commands/triage/pipeline.test.ts`
- Modify: `src/cli/commands/triage/progress-output.test.ts`

- [ ] **Step 1: Replace the blocked default-skip test with default inclusion**

In `src/cli/commands/triage/pipeline-selection.test.ts`, replace
`runTriage skips blocked issues by default before applying limit` with:

```ts
test("runTriage includes blocked issues by default so they can be re-evaluated", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const mixedIssues = JSON.stringify([
    {
      index: 1,
      title: "Blocked",
      body: "Waiting on dependency",
      state: "open",
      labels: [{ name: "blocked" }],
    },
    {
      index: 2,
      title: "Untriaged",
      body: "Broken",
      state: "open",
      labels: [{ name: "bug" }],
    },
  ]);
  const runner = createStaticCommandRunner([
    { code: 0, stdout: mixedIssues, stderr: "" },
    {
      code: 0,
      stdout: JSON.stringify({
        index: 1,
        title: "Blocked",
        body: "Waiting on dependency",
        state: "open",
        labels: [{ name: "blocked" }],
        comments: [
          {
            body: "> _This was generated by AI during triage._\n\nBlocked by: #99",
          },
        ],
      }),
      stderr: "",
    },
    {
      code: 0,
      stdout: JSON.stringify({
        index: 99,
        title: "Prerequisite",
        body: "Still open",
        state: "open",
        labels: [],
        comments: [],
      }),
      stderr: "",
    },
  ]);

  const result = await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: true,
    execute: false,
    limit: 1,
    logDir,
    host: DEFAULT_PATCHMILL_CONFIG.host,
  });

  assert.equal(result.issueCount, 1);
  assert.equal(result.issues[0]?.issueNumber, 1);
  assert.equal(result.issues[0]?.primaryBucket, "blocked");
  assert.deepEqual(result.issues[0]?.blockedBy, [99]);
  assert.equal(
    runner.calls.some((call) => call.command === "pi"),
    false,
  );
});
```

- [ ] **Step 2: Add dry-run auto-unblock pipeline test**

In `src/cli/commands/triage/pipeline.test.ts`, add:

```ts
test("runTriage dry-run previews blocked issue auto-unblock when blockers are closed", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const runner = createStaticCommandRunner([
    {
      code: 0,
      stdout: JSON.stringify([
        {
          index: 3,
          title: "Create poll form",
          body: "Blocked by scaffold and model.",
          state: "open",
          labels: [{ name: "blocked" }, { name: "enhancement" }],
        },
      ]),
      stderr: "",
    },
    {
      code: 0,
      stdout: JSON.stringify({
        index: 3,
        title: "Create poll form",
        body: "Blocked by scaffold and model.",
        state: "open",
        labels: [{ name: "blocked" }, { name: "enhancement" }],
        comments: [
          {
            body: "> _This was generated by AI during triage._\n\nBlocked by: #1, #2\n\nWaiting on prerequisites.",
          },
        ],
      }),
      stderr: "",
    },
    {
      code: 0,
      stdout: JSON.stringify({
        index: 1,
        title: "Scaffold",
        body: "Done",
        state: "closed",
        labels: [],
        comments: [],
      }),
      stderr: "",
    },
    {
      code: 0,
      stdout: JSON.stringify({
        index: 2,
        title: "Model",
        body: "Done",
        state: "closed",
        labels: [],
        comments: [],
      }),
      stderr: "",
    },
  ]);

  const result = await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: true,
    execute: false,
    logDir,
    host: DEFAULT_PATCHMILL_CONFIG.host,
  });

  assert.equal(result.status, "dry-run");
  assert.deepEqual(result.issues[0], {
    issueNumber: 3,
    title: "Create poll form",
    previousLabels: ["blocked", "enhancement"],
    finalLabels: ["enhancement", "agent-ready"],
    primaryBucket: "agent-ready",
    blockedBy: [1, 2],
    rationale: "All blocking issues are closed: #1, #2.",
    questions: [],
    comment: [
      "> _This was generated by AI during triage._",
      "",
      "The blocking issues are now closed: #1, #2.",
      "",
      "This issue is now agent-ready.",
    ].join("\n"),
    wouldClose: false,
    mutationStatus: "preview",
  });
  assert.equal(
    runner.calls.some((call) => call.command === "pi"),
    false,
  );
});
```

- [ ] **Step 3: Add execute auto-unblock pipeline test**

In `src/cli/commands/triage/pipeline.test.ts`, add:

```ts
test("runTriage execute removes blocked and adds agent-ready when blockers are closed", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "triage-pipeline-"));
  const runner = {
    calls: [] as Array<{ command: string; args: string[]; cwd?: string }>,
    async run(command: string, args: string[], options = {}) {
      runner.calls.push({ command, args: [...args], cwd: options.cwd });

      if (command === "gh" && args.slice(0, 2).join(" ") === "issue list") {
        return {
          code: 0,
          stdout: JSON.stringify([
            {
              number: 3,
              title: "Create poll form",
              body: "Blocked by scaffold and model.",
              state: "OPEN",
              labels: [{ name: "blocked" }, { name: "enhancement" }],
              url: "https://example.test/issues/3",
            },
          ]),
          stderr: "",
        };
      }

      if (command === "gh" && args.slice(0, 3).join(" ") === "issue view 3") {
        const edited = runner.calls.some(
          (call) =>
            call.command === "gh" &&
            call.args.slice(0, 3).join(" ") === "issue edit 3",
        );
        const commented = runner.calls.some(
          (call) =>
            call.command === "gh" &&
            call.args.slice(0, 3).join(" ") === "issue comment 3",
        );
        return {
          code: 0,
          stdout: JSON.stringify({
            number: 3,
            title: "Create poll form",
            body: "Blocked by scaffold and model.",
            state: "OPEN",
            labels: edited
              ? [{ name: "agent-ready" }, { name: "enhancement" }]
              : [{ name: "blocked" }, { name: "enhancement" }],
            url: "https://example.test/issues/3",
            comments: commented
              ? [
                  {
                    body: "> _This was generated by AI during triage._\n\nBlocked by: #1, #2",
                  },
                  {
                    body: "> _This was generated by AI during triage._\n\nThe blocking issues are now closed: #1, #2.\n\nThis issue is now agent-ready.",
                  },
                ]
              : [
                  {
                    body: "> _This was generated by AI during triage._\n\nBlocked by: #1, #2",
                  },
                ],
          }),
          stderr: "",
        };
      }

      if (command === "gh" && args.slice(0, 3).join(" ") === "issue view 1") {
        return {
          code: 0,
          stdout: JSON.stringify({
            number: 1,
            title: "Scaffold",
            body: "Done",
            state: "CLOSED",
            labels: [],
            comments: [],
          }),
          stderr: "",
        };
      }

      if (command === "gh" && args.slice(0, 3).join(" ") === "issue view 2") {
        return {
          code: 0,
          stdout: JSON.stringify({
            number: 2,
            title: "Model",
            body: "Done",
            state: "CLOSED",
            labels: [],
            comments: [],
          }),
          stderr: "",
        };
      }

      if (command === "gh" && args.slice(0, 3).join(" ") === "issue edit 3") {
        assert.ok(args.includes("--add-label"));
        assert.ok(args.includes("agent-ready"));
        assert.ok(args.includes("--remove-label"));
        assert.ok(args.includes("blocked"));
        return { code: 0, stdout: "", stderr: "" };
      }

      if (
        command === "gh" &&
        args.slice(0, 3).join(" ") === "issue comment 3"
      ) {
        assert.match(
          args.join(" "),
          /The blocking issues are now closed: #1, #2\./,
        );
        return { code: 0, stdout: "", stderr: "" };
      }

      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    },
  };

  const result = await runTriage(runner, {
    repoRoot: "/repo",
    dryRun: false,
    execute: true,
    logDir,
    host: { provider: "github-gh", login: "" },
  });

  assert.equal(result.status, "applied");
  assert.equal(result.issues[0]?.primaryBucket, "agent-ready");
  assert.deepEqual(result.issues[0]?.blockedBy, [1, 2]);
  assert.equal(result.issues[0]?.comment?.includes("now closed"), true);
  assert.equal(
    runner.calls.some((call) => call.command === "pi"),
    false,
  );
});
```

- [ ] **Step 4: Run pipeline tests and confirm failures**

Run:

```bash
node --test src/cli/commands/triage/pipeline-selection.test.ts src/cli/commands/triage/pipeline.test.ts
```

Expected: blocked issues are still skipped by default and auto-unblock entries
are not created.

- [ ] **Step 5: Update default issue selection**

In `src/cli/commands/triage/pipeline.ts`, change the default excluded labels so
blocked issues are selected for re-evaluation:

```ts
const excludedLabels = new Set(
  triagePolicy.excludedLabels.filter(
    (label) => label !== triagePolicy.labels.blocked,
  ),
);
```

Update `HELP_TEXT` in `src/cli/commands/triage/main.ts` so it no longer says
default triage excludes blocked issues:

```ts
  --all               Re-triage selected open issues and include issues already carrying triage or protection labels such as in-progress.
```

- [ ] **Step 6: Add pipeline helpers for direct blocked entries**

In `src/cli/commands/triage/pipeline.ts`, import helpers:

```ts
import {
  createUnblockedComment,
  replaceTriageStateLabels,
  resolveBlockedIssue,
} from "./blocked.ts";
import { canonicalBucketForLabels } from "../../../policy/triage-state.ts";
import { planLabelChange } from "./labels.ts";
```

Add helper functions above `runTriage`:

```ts
function issueRefList(issueNumbers: readonly number[]): string {
  return issueNumbers.map((issueNumber) => `#${issueNumber}`).join(", ");
}

function blockedBucket(issue: IssueSummary, config: TriageConfig): boolean {
  const triagePolicy = config.triagePolicy ?? DEFAULT_TRIAGE_POLICY;
  return (
    canonicalBucketForLabels(issue.labels, triagePolicy.stateMap) === "blocked"
  );
}

function autoUnblockPreviewEntry(
  issue: IssueSummary,
  stateMap: TriageConfig["triagePolicy"]["stateMap"],
  readyLabel: string,
  blockedBy: number[],
): TriageLogIssueEntry {
  const comment = createUnblockedComment(blockedBy);
  return {
    issueNumber: issue.number,
    title: issue.title,
    ...(issue.url ? { url: issue.url } : {}),
    previousLabels: issue.labels,
    finalLabels: replaceTriageStateLabels(issue.labels, stateMap, readyLabel),
    primaryBucket: "agent-ready",
    blockedBy,
    rationale: `All blocking issues are closed: ${issueRefList(blockedBy)}.`,
    questions: [],
    comment,
    wouldClose: false,
    mutationStatus: "preview",
  };
}

function stillBlockedEntry(
  issue: IssueSummary,
  blockedBy: number[],
  openBlockers: number[],
  mutationStatus: "preview" | "observed",
): TriageLogIssueEntry {
  return {
    issueNumber: issue.number,
    title: issue.title,
    ...(issue.url ? { url: issue.url } : {}),
    previousLabels: issue.labels,
    finalLabels: issue.labels,
    primaryBucket: "blocked",
    blockedBy,
    rationale: `Still blocked by open issue${openBlockers.length === 1 ? "" : "s"}: ${issueRefList(openBlockers)}.`,
    questions: [],
    comment: null,
    mutationStatus,
  };
}
```

Use an explicit state map type if TypeScript rejects the indexed access above:

```ts
import type { PatchmillTriageStateMap } from "../../../policy/triage-state.ts";
```

then use:

```ts
stateMap: PatchmillTriageStateMap,
```

- [ ] **Step 7: Add direct blocked preprocessing in dry-run mode**

In the dry-run branch of `runTriage`, before calling `runTriageDryRunAgent`,
partition selected issues:

```ts
const directLogIssues: TriageLogIssueEntry[] = [];
const agentIssues: IssueSummary[] = [];
for (const issue of issues) {
  if (!blockedBucket(issue, config)) {
    agentIssues.push(issue);
    continue;
  }

  const resolution = await resolveBlockedIssue(host, issue);
  if (resolution.status === "unblocked") {
    directLogIssues.push(
      autoUnblockPreviewEntry(
        issue,
        triagePolicy.stateMap,
        triagePolicy.labels.ready,
        resolution.blockedBy,
      ),
    );
    continue;
  }

  if (resolution.status === "still-blocked") {
    directLogIssues.push(
      stillBlockedEntry(
        issue,
        resolution.blockedBy,
        resolution.openBlockers,
        "preview",
      ),
    );
    continue;
  }

  agentIssues.push(issue);
}
```

Call the agent only when needed:

```ts
const previews =
  agentIssues.length === 0
    ? []
    : await runTriageDryRunAgent(runner, config.repoRoot, {
        issues: agentIssues,
        projectPolicy,
        stateMap: triagePolicy.stateMap,
        skills: config.skills,
        thinking:
          config.triageThinking ?? DEFAULT_PATCHMILL_CONFIG.pi.triageThinking,
        onToolCall: config.onToolCall,
      });
const logIssues = [
  ...directLogIssues,
  ...createPreviewEntries(agentIssues, previews),
];
```

Keep progress reporting and `issueCount` based on the original `issues.length`.

- [ ] **Step 8: Add direct blocked preprocessing in execute mode**

Before `executeTriageIssues`, partition and apply direct unblock mutations:

```ts
const agentIssues: IssueSummary[] = [];
for (const issue of issues) {
  if (!blockedBucket(issue, config)) {
    agentIssues.push(issue);
    continue;
  }

  const resolution = await resolveBlockedIssue(host, issue);
  if (resolution.status === "unblocked") {
    const comment = createUnblockedComment(resolution.blockedBy);
    const finalLabels = replaceTriageStateLabels(
      issue.labels,
      triagePolicy.stateMap,
      triagePolicy.labels.ready,
    );
    await host.applyLabels(
      planLabelChange(issue.number, issue.labels, finalLabels),
    );
    await host.commentIssue(issue.number, comment);
    const entry: TriageLogIssueEntry = {
      issueNumber: issue.number,
      title: issue.title,
      ...(issue.url ? { url: issue.url } : {}),
      previousLabels: issue.labels,
      finalLabels,
      primaryBucket: "agent-ready",
      blockedBy: resolution.blockedBy,
      rationale: `All blocking issues are closed: ${issueRefList(resolution.blockedBy)}.`,
      questions: [],
      comment,
      addedComments: [comment],
      previousState: issue.state,
      finalState: issue.state,
      mutationStatus: "observed",
    };
    logIssues.push(entry);
    config.onProgress?.({
      type: "issue",
      issue: entry,
      completed: logIssues.length,
      total: issues.length,
    });
    continue;
  }

  if (resolution.status === "still-blocked") {
    const entry = stillBlockedEntry(
      issue,
      resolution.blockedBy,
      resolution.openBlockers,
      "observed",
    );
    logIssues.push(entry);
    config.onProgress?.({
      type: "issue",
      issue: entry,
      completed: logIssues.length,
      total: issues.length,
    });
    continue;
  }

  agentIssues.push(issue);
}
```

Then call `executeTriageIssues` only for `agentIssues`. Adjust progress
completion numbers inside `onIssue`:

```ts
const completedBeforeAgent = logIssues.length;
await executeTriageIssues({
  runner,
  repoRoot: config.repoRoot,
  host,
  hostConfig: config.host,
  issues: agentIssues,
  projectPolicy,
  stateMap: triagePolicy.stateMap,
  skills: config.skills,
  thinking: config.triageThinking ?? DEFAULT_PATCHMILL_CONFIG.pi.triageThinking,
  onToolCall: config.onToolCall,
  onIssue(entry, completed) {
    logIssues.push(entry);
    config.onProgress?.({
      type: "issue",
      issue: entry,
      completed: completedBeforeAgent + completed,
      total: issues.length,
    });
  },
});
```

If `agentIssues.length === 0`, skip `executeTriageIssues`.

- [ ] **Step 9: Run pipeline tests**

Run:

```bash
node --test src/cli/commands/triage/pipeline-selection.test.ts src/cli/commands/triage/pipeline.test.ts src/cli/commands/triage/main.test.ts
```

Expected: all selected tests pass. If progress output tests fail because issue
totals changed, update expected totals to count all selected issues, including
direct blocked entries.

- [ ] **Step 10: Commit pipeline changes**

```bash
git add src/cli/commands/triage/pipeline.ts src/cli/commands/triage/pipeline-selection.test.ts src/cli/commands/triage/pipeline.test.ts src/cli/commands/triage/main.ts src/cli/commands/triage/main.test.ts src/cli/commands/triage/progress-output.test.ts
git commit -m "feat(triage): auto-unblock closed dependencies"
```

## Task 5: Teach prompts, skill, docs, and fixtures about blocked triage

**Files:**

- Modify: `skills/patchmill-issue-triage/SKILL.md`
- Modify: `src/cli/commands/triage/dry-run-agent.test.ts`
- Modify: `src/cli/commands/triage/execute-agent.ts`
- Modify: `src/cli/commands/triage/execute-agent.test.ts`
- Modify: `docs/configuration.md`
- Modify: `docs/issue-agent-workflows.md`
- Modify: selected files under `fixtures/patchmill-test-repo/issues/`

- [ ] **Step 1: Add prompt/skill tests**

In `src/cli/commands/triage/dry-run-agent.test.ts`, extend the prompt test:

```ts
assert.match(prompt, /"blockedBy": \[\]/);
assert.match(
  prompt,
  /blockedBy must list concrete same-repository issue numbers/,
);
assert.match(prompt, /Use canonicalBucket needs-info instead of blocked/);
```

In `src/cli/commands/triage/execute-agent.test.ts`, add `blocked` to the local
state map:

```ts
const stateMap = {
  "ship-it": "agent-ready",
  "awaiting-reporter": "needs-info",
  "manual-only": "agent-unsuitable",
  "waiting-on-dependency": "blocked",
} as const;
```

Extend the execution prompt test:

```ts
assert.match(prompt, /"waiting-on-dependency": "blocked"/);
```

- [ ] **Step 2: Run prompt tests and confirm failures where expected**

Run:

```bash
node --test src/cli/commands/triage/dry-run-agent.test.ts src/cli/commands/triage/execute-agent.test.ts
```

Expected: dry-run prompt assertions fail until the prompt text is updated.
Execute prompt may already pass once state maps include `blocked`.

- [ ] **Step 3: Update the bundled triage skill**

In `skills/patchmill-issue-triage/SKILL.md`, add this bucket under `## Buckets`
after `agent-ready`:

```markdown
- `blocked`: clear work suitable for automation that cannot start yet because
  one or more concrete same-repository issues must close first. Apply the
  configured blocked label/state from the prompt. The triage comment must start
  with the required AI-generated prefix and include `Blocked by: #N` or
  `Blocked by: #N, #M` with the blocking issue numbers. Use `needs-info` instead
  when a dependency exists but the blocker issue numbers cannot be identified.
```

Under `## Questions and comments`, add:

```markdown
- For `blocked`, name concrete same-repository blocker issue numbers in both the
  structured preview `blockedBy` field and the comment body. Do not use
  `blocked` for vague external dependencies, missing reporter facts, or broad
  sequencing guesses without issue numbers; use `needs-info` instead.
```

- [ ] **Step 4: Add an execution prompt reminder**

Add this paragraph after `Configured triage state map:` in
`src/cli/commands/triage/execute-agent.ts`:

```ts
When the configured triage state map includes a blocked bucket, use blocked only for clear agent-suitable issues that are waiting on concrete same-repository issue numbers. Blocked comments must include a `Blocked by: #N` line so Patchmill can later re-evaluate the issue.
```

- [ ] **Step 5: Update docs**

In `docs/configuration.md`:

- add `"blocked": "blocked"` to complete example `triage.stateMap`;
- update the allowed state-map values sentence to include `blocked`;
- add a short subsection:

```markdown
### Blocked triage state

`blocked` means the issue is clear and suitable for automation but must wait for
specific same-repository issues to close. The triage agent must record those
blockers as issue numbers in `blockedBy` and in a comment line such as
`Blocked by: #1, #2`. Later triage runs re-check those blocker issues. When all
blockers are closed, Patchmill removes the blocked label, adds the ready label,
and posts a new unblock comment.
```

In `docs/issue-agent-workflows.md`, update the triage section to say triage can
classify issues as `blocked` and that default triage re-evaluates blocked issues
for auto-unblock.

- [ ] **Step 6: Update fixture issues with concrete dependencies**

Add explicit blocker references to fixture issue bodies so the test repository
demonstrates the new workflow. Use these exact additions near the top of each
body:

`fixtures/patchmill-test-repo/issues/03-create-poll-form.md`:

```markdown
This should wait until #1 and #2 are closed because the form needs the app shell
and poll data model.
```

`fixtures/patchmill-test-repo/issues/04-voting-flow.md`:

```markdown
This should wait until #3 is closed because voting needs an existing poll UI.
```

`fixtures/patchmill-test-repo/issues/05-results-view.md`:

```markdown
This should wait until #4 is closed because live results need votes to exist.
```

`fixtures/patchmill-test-repo/issues/06-local-persistence.md`:

```markdown
This should wait until #2 and #4 are closed because persistence needs the poll
model and vote updates.
```

`fixtures/patchmill-test-repo/issues/09-automated-tests.md`:

```markdown
This should wait until #3, #4, #5, and #6 are closed so the core flows exist to
test.
```

`fixtures/patchmill-test-repo/issues/12-votes-disappear.md`:

```markdown
This should wait until #6 is closed because the reported refresh behavior
depends on the local persistence layer.
```

Leave vague product-discovery issue `11-make-it-social.md` without blockers so
triage can continue treating it as `agent-unsuitable` or `needs-info`.

- [ ] **Step 7: Run prompt and docs-adjacent checks**

Run:

```bash
node --test src/cli/commands/triage/dry-run-agent.test.ts src/cli/commands/triage/execute-agent.test.ts src/cli/commands/setup-test-repo/*.test.ts
npm run lint:md
```

Expected: selected prompt/setup tests pass and markdownlint passes.

- [ ] **Step 8: Commit prompt/docs/fixture changes**

```bash
git add skills/patchmill-issue-triage/SKILL.md src/cli/commands/triage/dry-run-agent.test.ts src/cli/commands/triage/execute-agent.ts src/cli/commands/triage/execute-agent.test.ts docs/configuration.md docs/issue-agent-workflows.md fixtures/patchmill-test-repo/issues

git commit -m "docs(triage): document blocked issue workflow"
```

## Task 6: Final verification and cleanup

**Files:**

- Review all changed files.
- No new files beyond the ones listed above.

- [ ] **Step 1: Run the triage test suite**

Run:

```bash
npm run test:triage
```

Expected: all triage command tests pass.

- [ ] **Step 2: Run policy/config tests touched by the state-map change**

Run:

```bash
node --test src/policy/triage-state.test.ts src/policy/triage.test.ts src/config/defaults.test.ts src/config/load.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 3: Run setup fixture parser tests**

Run:

```bash
node --test src/cli/commands/setup-test-repo/*.test.ts
```

Expected: fixture issue parsing and setup-test-repo tests pass.

- [ ] **Step 4: Run full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Run lint and build**

Run:

```bash
npm run lint
npm run build
```

Expected: lint exits 0 and TypeScript build exits 0.

- [ ] **Step 6: Inspect final diff**

Run:

```bash
git status --short
git diff --stat HEAD~5..HEAD
git diff HEAD~5..HEAD -- src/cli/commands/triage src/policy src/config skills/patchmill-issue-triage docs/configuration.md docs/issue-agent-workflows.md fixtures/patchmill-test-repo/issues
```

Expected: only blocked-triage changes are present. The diff shows canonical
bucket changes, `blockedBy` preview/log support, blocked helper module, pipeline
auto-unblock behavior, prompt/skill/docs updates, and fixture dependency hints.

- [ ] **Step 7: Final commit if any verification-only formatting changed files**

If lint or build formatting changed files after the previous commits, commit
only those files:

```bash
git add <changed-files>
git commit -m "chore(triage): tidy blocked triage changes"
```

- [ ] **Step 8: Final status**

Run:

```bash
git status --short
```

Expected: clean working tree.
