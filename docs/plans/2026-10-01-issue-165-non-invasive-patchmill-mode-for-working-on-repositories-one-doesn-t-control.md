# Non-invasive Patchmill Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a comment-backed issue-state provider so Patchmill can operate
without host-label control.

**Architecture:** Add a small issue-state layer between Patchmill workflow code
and host issue mutation. The label provider preserves current behavior. The
comment provider reads and writes trusted Patchmill front-matter comments.

**Tech Stack:** TypeScript, Node test runner, GitHub `gh`, Forgejo `tea`, and
existing Patchmill host providers.

**Spec:**
`docs/specs/2026-10-01-issue-165-non-invasive-patchmill-mode-for-working-on-repositories-one-doesn-t-control-design.md`

## Global Constraints

- Keep `issueState.provider: "labels"` as the default.
- Support `issueState.provider: "comments"` and optional
  `issueState.trustedAuthors`.
- Trust only configured authors or the authenticated host user.
- Resolve comment-backed state from the last trusted Patchmill state comment.
- Do not edit or delete old Patchmill state comments.
- Do not add npm dependencies.
- Do not change `patchmill init` prompts in this issue.
- Document the manual setup path after `patchmill init`.
- Apply the Testing Value Gate to each planned automated test.

## Review Focus

- Untrusted issue comments must not approve specs, plans, or workflow state.
- Malformed front matter must not crash selection or become authoritative.
- A repository with both labels and comments must use only the configured
  provider.
- Resume paths must not duplicate side effects beyond the current checkpoint
  model.
- GitHub and Forgejo comments must include enough author and order data for safe
  comment-mode state.

---

### Task 1: Add issue-state configuration and the shared role contract

**Files:**

- Modify: `src/config/types.ts`
- Modify: `src/config/defaults.ts`
- Modify: `src/config/partial.ts`
- Modify: `src/config/load.ts`
- Modify: `src/config/defaults.test.ts`
- Modify: `src/config/load.test.ts`
- Create: `src/issue-state/types.ts`
- Create: `src/issue-state/roles.ts`
- Create: `src/issue-state/labels.ts`
- Create: `src/issue-state/index.ts`
- Test: `src/issue-state/labels.test.ts`

**Interfaces:**

- Consumes: `PatchmillConfig`, `IssueSummary`, `IssueHostProvider`, and
  `WorkflowApprovalPolicy`.
- Produces: `PatchmillIssueStateConfig`, `IssueWorkflowRole`,
  `IssueStateProvider`, `createLabelIssueStateProvider()`, and
  `workflowRolesFromLabels()`.

- [ ] **Step 1: Write failing config tests**

Add tests that prove these behaviors:

```ts
test("default config uses label issue state", async () => {
  const config = await loadPatchmillConfig(tempRepoRoot);
  assert.deepEqual(config.issueState, { provider: "labels" });
});

test("config accepts comment issue state", async () => {
  await writeConfig({ issueState: { provider: "comments" } });
  const config = await loadPatchmillConfig(tempRepoRoot);
  assert.deepEqual(config.issueState, { provider: "comments" });
});

test("config accepts trusted comment authors", async () => {
  await writeConfig({
    issueState: { provider: "comments", trustedAuthors: ["jimfulton"] },
  });
  const config = await loadPatchmillConfig(tempRepoRoot);
  assert.deepEqual(config.issueState, {
    provider: "comments",
    trustedAuthors: ["jimfulton"],
  });
});
```

- [ ] **Step 2: Run config tests and make sure that they fail**

Run:

```bash
node --test src/config/defaults.test.ts src/config/load.test.ts
```

Expected: FAIL because `issueState` is not defined.

- [ ] **Step 3: Add `PatchmillIssueStateConfig`**

Add this union to `src/config/types.ts`:

```ts
export type PatchmillIssueStateConfig =
  | { provider: "labels" }
  | { provider: "comments"; trustedAuthors?: string[] | undefined };
```

Add `issueState: PatchmillIssueStateConfig` to `PatchmillConfig`.

- [ ] **Step 4: Add the default issue-state config**

Set this value in `DEFAULT_PATCHMILL_CONFIG`:

```ts
issueState: { provider: "labels" },
```

- [ ] **Step 5: Parse and merge `issueState`**

Update `PartialConfig`, `mergeConfig()`, `parseConfigFile()`, and
`absolutizePaths()` so these inputs are valid:

```json
{ "issueState": { "provider": "labels" } }
```

```json
{
  "issueState": {
    "provider": "comments",
    "trustedAuthors": ["jimfulton"]
  }
}
```

Reject unknown providers, non-array `trustedAuthors`, empty trusted-author
strings, and unknown keys under `issueState`.

- [ ] **Step 6: Define issue-state roles and the provider interface**

Create `src/issue-state/types.ts` with this interface:

```ts
export type IssueWorkflowRole =
  | "agent-ready"
  | "needs-info"
  | "agent-unsuitable"
  | "blocked"
  | "in-progress"
  | "agent-done"
  | "spec-review"
  | "spec-approved"
  | "plan-review"
  | "plan-approved";

export type IssueWorkflowRoles = {
  roles: IssueWorkflowRole[];
};

export type IssueStateTransition = {
  issue: IssueSummary;
  roles: IssueWorkflowRole[];
  message?: string | undefined;
};

export type IssueStateProvider = {
  resolveRoles(issue: IssueSummary): IssueWorkflowRoles;
  setRoles(transition: IssueStateTransition): Promise<void>;
};
```

Import `IssueSummary` from `src/issue/types.ts`.

- [ ] **Step 7: Implement the label issue-state provider**

Create `src/issue-state/labels.ts` with these functions:

```ts
export function workflowRolesFromLabels(
  labels: readonly string[],
  options: LabelIssueStateOptions,
): IssueWorkflowRole[];

export function createLabelIssueStateProvider(
  host: Pick<IssueHostProvider, "applyLabels">,
  options: LabelIssueStateOptions,
): IssueStateProvider;
```

`LabelIssueStateOptions` must include the triage policy and approval policy. Map
configured labels to these roles:

- ready label to `agent-ready`
- needs-info label to `needs-info`
- unsuitable label to `agent-unsuitable`
- blocked label to `blocked`
- in-progress label to `in-progress`
- done label to `agent-done`
- spec review label to `spec-review`
- spec approved label to `spec-approved`
- plan review label to `plan-review`
- plan approved label to `plan-approved`

`setRoles()` must compute labels from roles, preserve non-Patchmill labels, then
call `host.applyLabels(planLabelChange(...))`.

- [ ] **Step 8: Add label provider tests**

Add tests that prove:

- role precedence is not applied in the provider
- non-Patchmill labels are preserved
- changing from `agent-ready` to `in-progress` removes only Patchmill state
  labels
- spec and plan approval labels map to roles

- [ ] **Step 9: Run task tests and make sure that they pass**

Run:

```bash
node --test src/config/defaults.test.ts src/config/load.test.ts \
  src/issue-state/labels.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/config src/issue-state
git commit -m "feat: add issue state configuration"
```

### Task 2: Add the comment issue-state provider

**Files:**

- Create: `src/issue-state/comments.ts`
- Test: `src/issue-state/comments.test.ts`
- Modify: `src/issue-state/index.ts`
- Modify: `src/issue-state/types.ts`

**Interfaces:**

- Consumes: `IssueCommentSummary`, `IssueSummary`, `IssueHostProvider`, and
  `PatchmillIssueStateConfig`.
- Produces: `parsePatchmillStateComment()`,
  `resolveCommentIssueWorkflowRoles()`, `formatPatchmillStateComment()`, and
  `createCommentIssueStateProvider()`.

- [ ] **Step 1: Write failing parser and resolver tests**

Add tests that prove these behaviors:

```ts
test("accepts scalar Patchmill front matter", () => {
  assert.deepEqual(
    parsePatchmillStateComment("---\nPatchmill: agent-ready\n---\n"),
    ["agent-ready"],
  );
});

test("accepts YAML-list Patchmill front matter", () => {
  assert.deepEqual(
    parsePatchmillStateComment(
      "---\nPatchmill:\n  - spec-approved\n  - plan-review\n---\n",
    ),
    ["spec-approved", "plan-review"],
  );
});

test("ignores malformed comments", () => {
  assert.equal(parsePatchmillStateComment("Patchmill: agent-ready"), undefined);
});
```

Add resolver tests for untrusted authors, creation-time ordering, returned-order
fallback, and unsupported roles.

- [ ] **Step 2: Run comment issue-state tests and make sure that they fail**

Run:

```bash
node --test src/issue-state/comments.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement `parsePatchmillStateComment()`**

Parse only comments that start with a front-matter block. Accept a scalar value
or a simple YAML list under the `Patchmill` key. Return `undefined` for unknown
roles, duplicate roles, extra front-matter keys, missing closing `---`, or text
before the opening `---`.

- [ ] **Step 4: Implement `resolveCommentIssueWorkflowRoles()`**

Use only comments whose `authorLogin` is in the trusted-author set. Choose the
last valid trusted state comment by `created` time. If either selected comment
has no parseable time, use returned comment order.

- [ ] **Step 5: Implement `formatPatchmillStateComment()`**

Return scalar front matter for one role:

```md
---
Patchmill: in-progress
---
```

If `message` is set, add one blank line and then the message body. If more than
one role is set, return a YAML-list front matter.

- [ ] **Step 6: Implement `createCommentIssueStateProvider()`**

The provider must resolve roles from `issue.comments`. `setRoles()` must call
`host.commentIssue(issue.number, body)` and must not call `applyLabels()`.

If `trustedAuthors` is omitted, load trusted authors from
`host.trustedTriageCommentAuthors()`. If that returns an empty list, throw an
error that tells the user to set `issueState.trustedAuthors` or authenticate the
host CLI.

- [ ] **Step 7: Run task tests and make sure that they pass**

Run:

```bash
node --test src/issue-state/comments.test.ts src/issue-state/labels.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/issue-state
git commit -m "feat: add comment issue state provider"
```

### Task 3: Resolve run-once workflow state from issue-state roles

**Files:**

- Modify: `src/cli/commands/run-once/types.ts`
- Modify: `src/cli/commands/run-once/workflow-state.ts`
- Modify: `src/cli/commands/run-once/selection.ts`
- Modify: `src/cli/commands/run-once/pipeline-selection.ts`
- Modify: `src/cli/commands/run-once/planning-selection.ts`
- Modify: `src/cli/commands/run-once/pipeline-lifecycle.ts`
- Modify: `src/cli/commands/run-once/main.ts`
- Test: `src/cli/commands/run-once/workflow-state.test.ts`
- Test: `src/cli/commands/run-once/selection.test.ts`
- Test: `src/cli/commands/run-once/pipeline-selection.test.ts`
- Test: `src/cli/commands/run-once/planning-selection.test.ts`

**Interfaces:**

- Consumes: `IssueStateProvider.resolveRoles(issue)` from Tasks 1 and 2.
- Produces: role-based selection and approval-state resolution for run-once.

- [ ] **Step 1: Write failing workflow-state tests**

Change `resolveWorkflowState()` tests to pass roles instead of labels. Add tests
that prove this precedence:

1. `plan-approved`
2. `plan-review`
3. `spec-approved`
4. `spec-review`
5. `agent-ready`
6. `not-actionable`

Keep the `ApprovalRequiredError` behavior for review states.

- [ ] **Step 2: Write failing selection tests for comment roles**

Add tests that use a stub `IssueStateProvider` and prove:

- `agent-ready`, `spec-approved`, and `plan-approved` are selected
- `needs-info`, `agent-unsuitable`, `blocked`, `in-progress`, and `agent-done`
  reject automatic selection
- priority labels still order selected issues
- issue-number selection uses roles and raises approval errors for review roles

- [ ] **Step 3: Run selection tests and make sure that they fail**

Run:

```bash
node --test src/cli/commands/run-once/workflow-state.test.ts \
  src/cli/commands/run-once/selection.test.ts \
  src/cli/commands/run-once/pipeline-selection.test.ts \
  src/cli/commands/run-once/planning-selection.test.ts
```

Expected: FAIL because selection still reads labels directly.

- [ ] **Step 4: Update `workflow-state.ts` to use roles**

Change these functions to accept `IssueWorkflowRole[]`:

- `resolveWorkflowState()`
- `assertExplicitWorkflowState()`
- `decidePlanApprovalGate()`
- `cleanupLabelsForSpecReview()` replacement
- `cleanupLabelsForPlanReview()` replacement
- `cleanupLabelsForImplementation()` replacement
- `retryableLabelsAfterDevelopmentEnvironmentFailure()` replacement

Rename label-cleanup helpers to role-transition helpers. Return role arrays, not
labels.

- [ ] **Step 5: Add the issue-state provider to run-once config**

Add `issueStateProvider: IssueStateProvider` to `AgentIssueConfig` in
`src/cli/commands/run-once/types.ts`. Create the provider in `main.ts` from
`config.issueState.provider`.

- [ ] **Step 6: Update selection modules**

Update `selection.ts`, `pipeline-selection.ts`, and `planning-selection.ts` to
call `issueStateProvider.resolveRoles(issue).roles`. Keep labels only for
priority ordering and human diagnostics.

- [ ] **Step 7: Hydrate comments when comment mode is configured**

Before selection in run-once, call `host.hydrateIssueComments()` for candidate
issues when the selected provider is `comments`. Do this for both automatic
selection and `--issue` selection.

- [ ] **Step 8: Run task tests and make sure that they pass**

Run:

```bash
node --test src/cli/commands/run-once/workflow-state.test.ts \
  src/cli/commands/run-once/selection.test.ts \
  src/cli/commands/run-once/pipeline-selection.test.ts \
  src/cli/commands/run-once/planning-selection.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/cli/commands/run-once src/issue-state
git commit -m "feat: select run-once issues from issue state"
```

### Task 4: Apply run-once lifecycle transitions through issue-state providers

**Files:**

- Modify: `src/cli/commands/run-once/automation-labels.ts`
- Modify: `src/cli/commands/run-once/pipeline-failures.ts`
- Modify: `src/cli/commands/run-once/planning-pipeline.ts`
- Modify: `src/cli/commands/run-once/planning-lifecycle-labels.ts`
- Modify: `src/cli/commands/run-once/pipeline-finish.ts`
- Modify: `src/cli/commands/run-once/pipeline-legacy.ts`
- Modify: `src/cli/commands/run-once/development-environment-stage.ts`
- Modify: `src/cli/commands/run-once/stage-advancement.ts`
- Modify: `src/cli/commands/run-once/planning-finish-effects.ts`
- Modify: `src/cli/commands/run-once/planning-cleanup-pending.ts`
- Test: matching `*.test.ts` files for the modules above

**Interfaces:**

- Consumes: `IssueStateProvider.setRoles()` from Tasks 1 and 2.
- Produces: all run-once claim, review-stop, retry, failure, and completion
  transitions through the configured issue-state provider.

- [ ] **Step 1: Write failing lifecycle tests**

Add or update tests that prove comment mode appends comments instead of labels
for these transitions:

- claim writes `in-progress`
- spec review stop writes `spec-review`
- plan review stop writes `plan-review`
- development-environment retry restores `agent-ready`, `spec-approved`, or
  `plan-approved`
- failure that needs human input writes `needs-info`
- successful completion writes `agent-done`

Each test must assert that `applyLabels()` is not called in comment mode.

- [ ] **Step 2: Run lifecycle tests and make sure that they fail**

Run:

```bash
node --test src/cli/commands/run-once/pipeline-failures.test.ts \
  src/cli/commands/run-once/planning-lifecycle-labels.test.ts \
  src/cli/commands/run-once/pipeline-finish.test.ts \
  src/cli/commands/run-once/stage-advancement.test.ts \
  src/cli/commands/run-once/development-environment-stage.test.ts \
  src/cli/commands/run-once/planning-finish.test.ts \
  src/cli/commands/run-once/planning-cleanup-pending.test.ts
```

Expected: FAIL because the modules still call label helpers.

- [ ] **Step 3: Replace lifecycle label helpers**

Keep `automation-labels.ts` for the label provider only. Add a small helper in
`src/issue-state/index.ts` or `src/issue-state/transitions.ts`:

```ts
export async function setIssueWorkflowRoles(
  provider: IssueStateProvider,
  transition: IssueStateTransition,
): Promise<void>;
```

Use this helper where run-once now calls `ensureAutomationLabel()` and
`host.applyLabels()` for Patchmill-owned state.

- [ ] **Step 4: Preserve label creation only for the label provider**

When the selected provider is labels, keep the current label-creation behavior.
When the selected provider is comments, skip `ensureAutomationLabel()`.

- [ ] **Step 5: Preserve state-transition messages**

Pass the existing explanatory comment text to `IssueStateTransition.message`
when the existing flow already comments on the issue. Do not duplicate a
separate explanatory comment unless the old flow used one for non-state data.

- [ ] **Step 6: Update recovery checkpoints**

Keep existing checkpoint names. Make the side effect behind each checkpoint
provider-neutral. For example, `doneLabelApplied` can remain the checkpoint
name, but the effect must be `agent-done` in comment mode.

- [ ] **Step 7: Run task tests and make sure that they pass**

Run the command from Step 2 again.

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/cli/commands/run-once src/issue-state
git commit -m "feat: apply run-once state through issue state providers"
```

### Task 5: Apply issue-state providers to triage execution

**Files:**

- Modify: `src/cli/commands/triage/types.ts`
- Modify: `src/cli/commands/triage/pipeline.ts`
- Modify: `src/cli/commands/triage/blocked-preprocessor.ts`
- Modify: `src/cli/commands/triage/execute-issues.ts`
- Modify: `src/cli/commands/triage/main.ts`
- Test: `src/cli/commands/triage/pipeline.test.ts`
- Test: `src/cli/commands/triage/pipeline-blocked.test.ts`
- Test: `src/cli/commands/triage/command.test.ts`

**Interfaces:**

- Consumes: `IssueStateProvider` and `PatchmillTriageStateMap`.
- Produces: triage execution that writes workflow state through comments or
  labels according to `issueState.provider`.

- [ ] **Step 1: Write failing triage tests**

Add tests that prove:

- executed triage classification writes `agent-ready`, `needs-info`,
  `agent-unsuitable`, or `blocked` through the issue-state provider
- auto-unblock writes `agent-ready` in comment mode without applying labels
- dry-run behavior remains read-only
- label mode preserves current label mutation behavior

- [ ] **Step 2: Run triage tests and make sure that they fail**

Run:

```bash
node --test src/cli/commands/triage/pipeline.test.ts \
  src/cli/commands/triage/pipeline-blocked.test.ts \
  src/cli/commands/triage/command.test.ts
```

Expected: FAIL because triage still mutates labels directly.

- [ ] **Step 3: Add issue-state provider construction to triage**

Add `issueStateProvider` to `TriageConfig`. In `triage/main.ts`, construct it
from `config.issueState.provider` and the host.

- [ ] **Step 4: Replace triage label writes**

Replace calls to `host.applyLabels(planLabelChange(...))` that represent
Patchmill workflow state with `issueStateProvider.setRoles(...)`. Keep host
comments that explain blocked dependency updates when they are not Patchmill
state comments.

- [ ] **Step 5: Keep triage selection compatible**

For this issue, triage candidate selection can continue to use labels for
repository context. Add no new automatic comment-backed triage intake unless a
test proves it is necessary for the spec.

- [ ] **Step 6: Run task tests and make sure that they pass**

Run the command from Step 2 again.

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/triage src/issue-state
git commit -m "feat: write triage state through issue state providers"
```

### Task 6: Validate host support and doctor behavior for comment mode

**Files:**

- Modify: `src/host/types.ts`
- Modify: `src/host/github-gh.ts`
- Modify: `src/host/github-gh.test.ts`
- Modify: `src/host/forgejo-tea.ts`
- Modify: `src/cli/commands/triage/forgejo.ts`
- Modify: `src/cli/commands/triage/forgejo.test.ts`
- Modify: `src/cli/commands/doctor/checks.ts`
- Modify: `src/cli/commands/doctor/checks.test.ts`

**Interfaces:**

- Consumes: host-provider comment payloads and `PatchmillConfig.issueState`.
- Produces: normalized comment author and ordering data for comment mode, plus
  doctor checks that match the selected provider.

- [ ] **Step 1: Write failing host normalization tests**

Add tests that prove GitHub and Forgejo normalize each comment with:

- `body`
- `authorLogin`
- `created`

Add a Forgejo test for returned-order preservation if Forgejo does not expose a
created timestamp in a fixture.

- [ ] **Step 2: Write failing doctor tests**

Add tests that prove:

- label mode checks required labels as it does today
- comment mode skips required-label existence checks
- comment mode checks that trusted authors can resolve
- comment mode checks that `commentIssue()` can be called only through a safe
  permission probe or reports the host error without changing labels

If a true non-mutating comment permission probe is not available, make doctor
validate trusted-author resolution and document that actual comment permission
is verified on first state write.

- [ ] **Step 3: Run host and doctor tests and make sure that they fail**

Run:

```bash
node --test src/host/github-gh.test.ts \
  src/cli/commands/triage/forgejo.test.ts \
  src/cli/commands/doctor/checks.test.ts
```

Expected: FAIL until doctor and Forgejo normalization are updated.

- [ ] **Step 4: Update normalized comment support**

Keep GitHub parsing in `github-gh.ts` if tests show that it already returns
`authorLogin` and `created`. Update Forgejo parsing in
`src/cli/commands/triage/forgejo.ts` so comment hydration returns matching
fields.

- [ ] **Step 5: Update doctor checks**

Branch the current labels check on `config.issueState.provider`:

- `labels`: keep current required-label validation
- `comments`: resolve trusted authors and report a pass, warning, or failure
  named `issue-state`

Do not create labels or comments in doctor.

- [ ] **Step 6: Run task tests and make sure that they pass**

Run the command from Step 3 again.

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/host src/cli/commands/triage/forgejo.ts \
  src/cli/commands/triage/forgejo.test.ts \
  src/cli/commands/doctor/checks.ts \
  src/cli/commands/doctor/checks.test.ts
git commit -m "feat: validate comment issue state support"
```

### Task 7: Preserve approval-artifact safety for comment approvals

**Files:**

- Modify: `src/cli/commands/run-once/approval-artifact-preflight.ts`
- Modify: `src/cli/commands/run-once/artifact-sources.ts`
- Modify: `src/cli/commands/run-once/planning-artifacts.ts`
- Modify: `src/cli/commands/run-once/stage-advancement.ts`
- Test: `src/cli/commands/run-once/approval-artifact-preflight.test.ts`
- Test: `src/cli/commands/run-once/artifact-sources.test.ts`
- Test: `src/cli/commands/run-once/planning-artifacts.test.ts`
- Test: `src/cli/commands/run-once/stage-advancement.test.ts`

**Interfaces:**

- Consumes: role-based `spec-approved` and `plan-approved` states.
- Produces: the same approved-artifact preflight safety for labels and comments.

- [ ] **Step 1: Write failing approval tests**

Add tests that prove:

- trusted `spec-approved` comments require one resolved spec artifact
- trusted `plan-approved` comments require one resolved plan artifact
- untrusted approval comments do not satisfy approval
- ambiguous approved artifacts fail safely

- [ ] **Step 2: Run approval tests and make sure that they fail**

Run:

```bash
node --test src/cli/commands/run-once/approval-artifact-preflight.test.ts \
  src/cli/commands/run-once/artifact-sources.test.ts \
  src/cli/commands/run-once/planning-artifacts.test.ts \
  src/cli/commands/run-once/stage-advancement.test.ts
```

Expected: FAIL until approved states use roles instead of labels.

- [ ] **Step 3: Update approval preflight inputs**

Pass `RunOnceWorkflowState` or `IssueWorkflowRole[]` to approval preflight code
instead of raw labels. Keep artifact extraction from issue body and comments
unchanged.

- [ ] **Step 4: Keep approved artifacts immutable**

When the state is `spec-approved` or `plan-approved`, require the existing
unique artifact. Do not create replacement artifacts in these paths.

- [ ] **Step 5: Run task tests and make sure that they pass**

Run the command from Step 2 again.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/run-once
git commit -m "feat: enforce comment-backed approval artifacts"
```

### Task 8: Document comment mode setup and run final validation

**Files:**

- Modify: `site/src/content/docs/getting-started/configuration.md`
- Modify: `site/src/content/docs/reference/environment-and-config.md`
- Modify: `site/src/content/docs/using-patchmill/run-once.md`
- Test: existing markdown, type, lint, build, and test suites

**Interfaces:**

- Consumes: implemented configuration and behavior from prior tasks.
- Produces: user-facing setup instructions and release-ready validation.

- [ ] **Step 1: Update configuration docs**

Document this setup path:

1. Run `patchmill init` without `--yes`.
2. Answer `no` when asked to create missing labels.
3. Edit `patchmill.config.json` to set `issueState.provider` to `comments`.
4. Add `issueState.trustedAuthors` when more than the authenticated host user
   must be trusted.

- [ ] **Step 2: Update run-once docs**

Explain that comment mode stores Patchmill workflow state in issue comments and
that priority labels still affect ordering when they exist.

- [ ] **Step 3: Run focused validation**

Run:

```bash
node --test src/config/defaults.test.ts src/config/load.test.ts
node --test src/issue-state/*.test.ts
npm run test:triage
npm run test:run-once
node --test src/host/github-gh.test.ts src/cli/commands/triage/forgejo.test.ts
node --test src/cli/commands/doctor/checks.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run full validation**

Run:

```bash
npm run check:types
npm run lint
npm run build
npm test
```

Expected: PASS.

No Nix build is required because this plan does not change `package.json`,
`package-lock.json`, or `npm-shrinkwrap.json`.

- [ ] **Step 5: Commit**

```bash
git add site/src/content/docs/getting-started/configuration.md \
  site/src/content/docs/reference/environment-and-config.md \
  site/src/content/docs/using-patchmill/run-once.md
git commit -m "docs: explain comment issue state setup"
```
