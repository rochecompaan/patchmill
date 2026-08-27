# Enriched Subagent Run-Once Console Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render one stable run-once console line for each distinct
authoritative subagent child metadata tuple, or one canonical identity-only
unresolved fallback when no authoritative agent metadata arrives.

**Architecture:** Keep issue #125's validated `PersistedSubagentProgress` union,
exact-session stream, lifecycle history, and parent accounting unchanged. Add a
presentation-only branch and run-scoped child/tuple state to
`AgentIssueConsoleProgressReporter`, then exercise that production reporter from
the existing run-once pipeline scenario and keep final redirected JSON on a
separate stdout sink.

**Tech Stack:** Node.js 22.19+, TypeScript ESM, `node:test`, the existing
`PersistedSubagentProgress` v1 contract, run-once progress reporters, exact Pi
session test helpers, and the existing final-result output helper.

**Spec:**
`docs/specs/2026-08-27-issue-126-render-enriched-subagent-progress-in-the-run-once-console-design.md`

## Global Constraints

- Consume only issue #125's validated
  `{ type: "subagent-progress", progress: PersistedSubagentProgress }`
  observation; do not resolve, infer, normalize, or invent child metadata or
  identity.
- An authoritative console tuple requires `agent`; include available `model` and
  `thinking` in fixed `agent`, `model`, `thinking` order and omit absent fields
  cleanly.
- Preserve accepted metadata bytes exactly. Do not trim, split, normalize,
  truncate, remove provider prefixes, or strip nested model path segments.
- Deduplicate by the complete canonical child identity: direct children use
  `(kind, toolCallId, runId, childIndex)` and workflow children use
  `(kind, toolCallId, workflowRunId, childId)`.
- Deduplicate authoritative presentation by the fixed-position tuple
  `(agent, model-or-absent, thinking-or-absent)`. Lifecycle state,
  `inventoryClosed`, and `unresolved` are not tuple fields.
- Render a workflow unresolved fallback from `childId`; render a direct fallback
  from `runId` plus `childIndex`. Never use array position, parent arguments,
  task text, or a placeholder agent.
- Render an unresolved fallback only when that child has no authoritative tuple,
  and render it at most once. Identity-only non-fallback observations produce no
  line.
- Keep child progress visible outside an active step; use the existing
  three-space indentation only while a step is active.
- Preserve ordinary parent subagent summaries, subagent management calls,
  non-subagent tools, steps, token accounting, triage, and JSONL observations.
- Progress remains on stderr. Redirected stdout remains exactly one compact,
  parseable final JSON object written by `writeRunOnceResult()`.
- Do not change `src/pi`, `pi-subagents`, lifecycle correlation, session
  ownership, cancellation, inventory, accounting, triage, dependencies, or Nix
  packaging.
- Apply Patchmill's Testing Value Gate. The focused reporter and pipeline/output
  tests below are required because they protect operator-visible runtime
  behavior, metadata fidelity, canonical child identity, failure visibility,
  accounting, and stdout/stderr separation; each can fail for a meaningful
  regression and will remain useful to maintainers.
- No npm dependency change is planned. If `package.json`, `package-lock.json`,
  or `npm-shrinkwrap.json` changes unexpectedly, retain the change only when it
  is necessary and run `nix build .#patchmill --print-build-logs` as required by
  `AGENTS.md`.

---

## File Structure

- `src/cli/commands/run-once/console-progress.ts` remains the presentation
  boundary. It will format validated child progress and own one run-scoped map
  of authoritative tuple keys plus one set of unresolved child keys.
- `src/cli/commands/run-once/console-progress.test.ts` will directly drive the
  production reporter with direct and workflow v1 observations. Although this
  test module is already large, the new cases belong here because they test the
  same reporter API and share its event fixture; no new production abstraction
  is needed.
- `src/cli/commands/run-once/pipeline-progress-scenarios.test.ts` will extend
  the existing exact parent-session implementation scenario. It will attach the
  production console reporter, append real `patchmill-subagent-progress`
  entries, and compose captured console progress with redirected final output.
  The scenario file is large, but this is the same run-once progress
  responsibility and extending its existing mock runner avoids a second large
  pipeline fixture.
- `src/cli/commands/run-once/result-output.test.ts` is verification-only for
  this issue. The end-to-end scenario will call the production
  `writeRunOnceResult()` helper, while this focused suite continues to protect
  its complete existing output-mode contract.
- No new source module is warranted: the child key, tuple key, and formatter are
  small presentation helpers meaningful only beside the console reporter.

---

### Task 1: Render and Deduplicate Authoritative Child Metadata

**Files:**

- Modify: `src/cli/commands/run-once/console-progress.test.ts:1-263`
- Modify: `src/cli/commands/run-once/console-progress.ts:1,16-88,90-160`

**Interfaces:**

- Consumes: `PersistedSubagentProgress` from `src/pi/subagent-progress.ts`,
  specifically observations whose `agent` is present.
- Produces these file-private helpers and reporter state:

  ```ts
  function childProgressKey(progress: PersistedSubagentProgress): string;
  function metadataTupleKey(progress: PersistedSubagentProgress): string;
  function formatAuthoritativeSubagentProgress(
    progress: PersistedSubagentProgress,
  ): string | undefined;

  private readonly subagentMetadataKeysByChild: Map<string, Set<string>>;
  ```

- The public `AgentIssueConsoleProgressReporter` constructor and
  `ProgressReporter.event()` interface remain unchanged.

- [ ] **Step 1: Add a typed child-progress event fixture**

  Import the persisted type and add this fixture beside the existing `event()`
  helper in `console-progress.test.ts`:

  ```ts
  import type { PersistedSubagentProgress } from "../../../pi/subagent-progress.ts";

  function childProgress(
    progress: PersistedSubagentProgress,
  ): AgentIssueProgressEvent {
    return event({
      level: "debug",
      stage: "pi-implementation",
      message: "subagent-progress",
      observation: { type: "subagent-progress", progress },
    });
  }
  ```

- [ ] **Step 2: Write failing authoritative formatting and deduplication tests**

  Add
  `test("console reporter renders each authoritative child metadata tuple once", ...)`.
  Start an implementation step and send these observations in order:

  ```ts
  const identity = {
    version: 1,
    kind: "workflow",
    toolCallId: "call-launch",
    workflowRunId: "workflow-1",
    childId: "review",
  } as const;
  const metadata = {
    agent: "reviewer",
    model: "openai/team/models/gpt-5.6-sol",
    thinking: "xhigh",
  } as const;

  for (const state of ["pending", "running", "completed"] as const) {
    reporter.event(childProgress({ ...identity, state, ...metadata }));
  }
  reporter.event(
    childProgress({ ...identity, state: "completed", ...metadata }),
  );
  reporter.event(
    childProgress({
      ...identity,
      state: "completed",
      inventoryClosed: true,
      ...metadata,
    }),
  );
  reporter.event(
    childProgress({
      ...identity,
      state: "completed",
      ...metadata,
      thinking: "high",
    }),
  );
  reporter.event(
    childProgress({
      ...identity,
      state: "completed",
      ...metadata,
      model: "openai/team/models/gpt-5.6-pro",
    }),
  );
  reporter.event(
    childProgress({
      ...identity,
      state: "completed",
      ...metadata,
      agent: "auditor",
    }),
  );
  reporter.event(
    childProgress({
      ...identity,
      childId: "audit",
      state: "failed",
      ...metadata,
    }),
  );
  ```

  Assert exact, lifecycle-only, and inventory-closure repeats for `review`
  collapse; each changed thinking, model, or agent value adds a line; and the
  distinct `audit` child independently emits the otherwise identical tuple:

  ```ts
  assert.deepEqual(lines, [
    "01 implement task",
    "   🤖 subagent (agent=reviewer, model=openai/team/models/gpt-5.6-sol, thinking=xhigh)",
    "   🤖 subagent (agent=reviewer, model=openai/team/models/gpt-5.6-sol, thinking=high)",
    "   🤖 subagent (agent=reviewer, model=openai/team/models/gpt-5.6-pro, thinking=xhigh)",
    "   🤖 subagent (agent=auditor, model=openai/team/models/gpt-5.6-sol, thinking=xhigh)",
    "   🤖 subagent (agent=reviewer, model=openai/team/models/gpt-5.6-sol, thinking=xhigh)",
  ]);
  ```

  Add
  `test("console reporter omits unavailable child metadata outside a step", ...)`
  without a step. Send three direct children under one `toolCallId` and `runId`:
  agent only, agent plus the nested model, and agent plus thinking:

  ```ts
  const direct = {
    version: 1,
    kind: "direct",
    toolCallId: "call-direct",
    runId: "run-1",
  } as const;
  reporter.event(childProgress({ ...direct, childIndex: 0, agent: "worker" }));
  reporter.event(
    childProgress({
      ...direct,
      childIndex: 1,
      agent: "worker",
      model: "provider/team/models/gpt-5.6-sol",
    }),
  );
  reporter.event(
    childProgress({
      ...direct,
      childIndex: 2,
      agent: "worker",
      thinking: "xhigh",
    }),
  );

  assert.deepEqual(lines, [
    "🤖 subagent (agent=worker)",
    "🤖 subagent (agent=worker, model=provider/team/models/gpt-5.6-sol)",
    "🤖 subagent (agent=worker, thinking=xhigh)",
  ]);
  ```

  These tests prove behavior rather than implementation shape: field order,
  omission, byte-preserving model output, same-child lifecycle deduplication,
  changed tuples, child isolation, and outside-step visibility are public
  console contracts.

- [ ] **Step 3: Run the focused tests and verify the red state**

  Run:

  ```sh
  node --test --test-name-pattern="authoritative|metadata" \
    src/cli/commands/run-once/console-progress.test.ts
  ```

  Expected: FAIL because the current reporter ignores every `subagent-progress`
  observation; no child metadata lines are present.

- [ ] **Step 4: Add fixed-position child and metadata keys**

  Import `PersistedSubagentProgress` in `console-progress.ts` and implement the
  keys with JSON arrays, not delimiter concatenation:

  ```ts
  function childProgressKey(progress: PersistedSubagentProgress): string {
    return progress.kind === "direct"
      ? JSON.stringify([
          "direct",
          progress.toolCallId,
          progress.runId,
          progress.childIndex,
        ])
      : JSON.stringify([
          "workflow",
          progress.toolCallId,
          progress.workflowRunId,
          progress.childId,
        ]);
  }

  function metadataTupleKey(progress: PersistedSubagentProgress): string {
    return JSON.stringify([
      progress.agent ?? null,
      progress.model ?? null,
      progress.thinking ?? null,
    ]);
  }
  ```

  Do not reuse issue #125's `subagentProgressKey()`: it intentionally includes
  lifecycle and closure fields that this presentation key must ignore.

- [ ] **Step 5: Format authoritative fields without generic argument handling**

  Add a dedicated formatter that returns no result when `agent` is absent:

  ```ts
  function formatAuthoritativeSubagentProgress(
    progress: PersistedSubagentProgress,
  ): string | undefined {
    if (!progress.agent) return undefined;
    const fields = [`agent=${progress.agent}`];
    if (progress.model) fields.push(`model=${progress.model}`);
    if (progress.thinking) fields.push(`thinking=${progress.thinking}`);
    return `🤖 subagent (${fields.join(", ")})`;
  }
  ```

  Do not call `formatArgumentValue()` or `truncate()` for child metadata; issue
  #125 has already validated and bounded every accepted field.

- [ ] **Step 6: Add run-scoped tuple state and the observation branch**

  Add `subagentMetadataKeysByChild` to the reporter and a private method with
  these semantics:

  ```ts
  private writeSubagentProgress(progress: PersistedSubagentProgress): void {
    const line = formatAuthoritativeSubagentProgress(progress);
    if (!line) return;

    const childKey = childProgressKey(progress);
    const tupleKey = metadataTupleKey(progress);
    const seen = this.subagentMetadataKeysByChild.get(childKey);
    if (seen?.has(tupleKey)) return;
    if (seen) seen.add(tupleKey);
    else this.subagentMetadataKeysByChild.set(childKey, new Set([tupleKey]));

    this.writeLine(this.currentStep ? `   ${line}` : line);
  }
  ```

  In `event()`, handle `subagent-progress` after assistant usage and before the
  existing ordinary `tool-call` branch:

  ```ts
  if (event.observation?.type === "subagent-progress") {
    this.writeSubagentProgress(event.observation.progress);
    return;
  }
  ```

  Leave the complete ordinary tool-call branch byte-for-byte unchanged so parent
  subagent arguments and management calls retain their current formatting.

- [ ] **Step 7: Run focused reporter tests and lint the changed files**

  Run:

  ```sh
  node --test src/cli/commands/run-once/console-progress.test.ts
  npx eslint \
    src/cli/commands/run-once/console-progress.ts \
    src/cli/commands/run-once/console-progress.test.ts \
    --max-warnings=0
  ```

  Expected: PASS. Existing parent subagent, management-call, ordinary tool,
  step, token, and final-result snapshot tests remain unchanged and green.

- [ ] **Step 8: Commit authoritative child rendering**

  ```sh
  git add \
    src/cli/commands/run-once/console-progress.ts \
    src/cli/commands/run-once/console-progress.test.ts
  git commit -m "feat(run-once): render authoritative child progress"
  ```

---

### Task 2: Render Canonical Unresolved Child Fallbacks

**Files:**

- Modify: `src/cli/commands/run-once/console-progress.test.ts`
- Modify: `src/cli/commands/run-once/console-progress.ts`

**Interfaces:**

- Consumes: Task 1's `childProgressKey()` and authoritative tuple map, plus
  issue #125 observations whose `unresolved === true` and `agent` is absent.
- Produces:

  ```ts
  function formatUnresolvedSubagentProgress(
    progress: PersistedSubagentProgress,
  ): string;

  private readonly unresolvedSubagentChildren: Set<string>;
  ```

- Authoritative progress keeps precedence: if an observation contains `agent`,
  Task 1's tuple path handles it even if malformed future input also carries
  `unresolved: true`.

- [ ] **Step 1: Write failing workflow and direct fallback tests**

  Add `test("console reporter renders unresolved child fallbacks once", ...)`.
  Begin an active step and send a workflow identity-only observation, its first
  unresolved seal, an exact and lifecycle-changed repeat, an authoritative child
  followed by a seal, and one direct fallback:

  ```ts
  const workflow = {
    version: 1,
    kind: "workflow",
    toolCallId: "call-workflow",
    workflowRunId: "workflow-1",
    childId: "review-step",
  } as const;
  reporter.event(
    childProgress({
      ...workflow,
      state: "pending",
      model: "not-authoritative",
    }),
  );
  const unresolved = {
    ...workflow,
    state: "failed",
    model: "must-not-render",
    thinking: "must-not-render",
    unresolved: true,
  } as const;
  reporter.event(childProgress(unresolved));
  reporter.event(childProgress(unresolved));
  reporter.event(childProgress({ ...unresolved, state: "stopped" }));

  const authoritative = { ...workflow, childId: "known-child" } as const;
  reporter.event(
    childProgress({ ...authoritative, state: "running", agent: "reviewer" }),
  );
  reporter.event(
    childProgress({
      ...authoritative,
      state: "failed",
      unresolved: true,
    }),
  );
  reporter.event(
    childProgress({
      version: 1,
      kind: "direct",
      toolCallId: "call-direct",
      runId: "run-123",
      childIndex: 0,
      state: "failed",
      unresolved: true,
    }),
  );

  assert.deepEqual(lines, [
    "01 final review",
    "   🤖 subagent (child=review-step, unresolved=true)",
    "   🤖 subagent (agent=reviewer)",
    "   🤖 subagent (runId=run-123, childIndex=0, unresolved=true)",
  ]);
  assert.equal(
    lines.some((line) => line.includes("model=must-not-render")),
    false,
  );
  assert.equal(
    lines.some((line) => line.includes("thinking=must-not-render")),
    false,
  );
  ```

  This proves identity-only non-fallback suppression, one fallback despite
  lifecycle repeats, no metadata invention/leakage, and fallback suppression
  after an authoritative tuple.

- [ ] **Step 2: Write a failing canonical scope and outside-step test**

  Add
  `test("console reporter keeps unresolved fallback identities scoped outside a step", ...)`.
  Without starting a step, send two workflow unresolved entries that share
  `childId: "review-step"` but differ in both `toolCallId` and `workflowRunId`:

  ```ts
  for (const suffix of ["a", "b"]) {
    reporter.event(
      childProgress({
        version: 1,
        kind: "workflow",
        toolCallId: `call-${suffix}`,
        workflowRunId: `workflow-${suffix}`,
        childId: "review-step",
        state: "failed",
        unresolved: true,
      }),
    );
  }

  assert.deepEqual(lines, [
    "🤖 subagent (child=review-step, unresolved=true)",
    "🤖 subagent (child=review-step, unresolved=true)",
  ]);
  ```

  The duplicate visible text is intentional: the two canonical workflow child
  identities are distinct even though the fallback display is bounded to
  `childId`.

- [ ] **Step 3: Run fallback tests and verify the red state**

  Run:

  ```sh
  node --test --test-name-pattern="fallback|unresolved" \
    src/cli/commands/run-once/console-progress.test.ts
  ```

  Expected: FAIL because Task 1 deliberately ignores observations without an
  authoritative `agent`.

- [ ] **Step 4: Add the identity-only fallback formatter**

  Implement the formatter directly from the validated union:

  ```ts
  function formatUnresolvedSubagentProgress(
    progress: PersistedSubagentProgress,
  ): string {
    return progress.kind === "workflow"
      ? `🤖 subagent (child=${progress.childId}, unresolved=true)`
      : `🤖 subagent (runId=${progress.runId}, childIndex=${progress.childIndex}, unresolved=true)`;
  }
  ```

  Do not include `toolCallId` or `workflowRunId` in displayed output; they scope
  only the internal key. Do not inspect parent tool arguments or any raw Pi
  result to obtain display fields.

- [ ] **Step 5: Extend the reporter state machine with one fallback per child**

  Add `unresolvedSubagentChildren = new Set<string>()`. Refactor
  `writeSubagentProgress()` to use the complete authoritative and fallback
  paths:

  ```ts
  private writeSubagentProgress(progress: PersistedSubagentProgress): void {
    const authoritativeLine = formatAuthoritativeSubagentProgress(progress);
    if (authoritativeLine) {
      const childKey = childProgressKey(progress);
      const tupleKey = metadataTupleKey(progress);
      const seen = this.subagentMetadataKeysByChild.get(childKey);
      if (seen?.has(tupleKey)) return;
      if (seen) seen.add(tupleKey);
      else this.subagentMetadataKeysByChild.set(childKey, new Set([tupleKey]));
      this.writeLine(
        this.currentStep ? `   ${authoritativeLine}` : authoritativeLine,
      );
      return;
    }
    if (!progress.unresolved) return;

    const childKey = childProgressKey(progress);
    if (
      this.subagentMetadataKeysByChild.has(childKey) ||
      this.unresolvedSubagentChildren.has(childKey)
    ) {
      return;
    }
    this.unresolvedSubagentChildren.add(childKey);
    const fallbackLine = formatUnresolvedSubagentProgress(progress);
    this.writeLine(this.currentStep ? `   ${fallbackLine}` : fallbackLine);
  }
  ```

  Keep the authoritative branch first. This guarantees a validated agent tuple
  is never downgraded to an identity fallback and a later unresolved seal cannot
  add a fallback for a child already shown authoritatively.

- [ ] **Step 6: Run all focused reporter tests and run-once unit coverage**

  Run:

  ```sh
  node --test src/cli/commands/run-once/console-progress.test.ts
  npm run test:run-once
  ```

  Expected: PASS. Failed and stopped no-agent children remain visible once,
  authoritative children remain tuple-based, and all existing run-once output
  behavior stays green.

- [ ] **Step 7: Commit unresolved fallback rendering**

  ```sh
  git add \
    src/cli/commands/run-once/console-progress.ts \
    src/cli/commands/run-once/console-progress.test.ts
  git commit -m "feat(run-once): render unresolved child fallbacks"
  ```

---

### Task 3: Prove Exact-Session Operator Output and Stdout/Stderr Separation

**Files:**

- Modify:
  `src/cli/commands/run-once/pipeline-progress-scenarios.test.ts:1-24,289-601`
- Verify unchanged: `src/cli/commands/run-once/result-output.ts`
- Verify unchanged: `src/cli/commands/run-once/result-output.test.ts`
- Verify unchanged: `src/cli/commands/run-once/pipeline-progress.ts`

**Interfaces:**

- Consumes: Tasks 1-2's production reporter, the existing
  `subagentProgressEntry()` helper, exact parent `--session` allocation,
  `compositeProgressReporter()`, `summarizeResult()`, and
  `writeRunOnceResult()`.
- Produces: one pipeline scenario that proves parent-session custom entries
  reach the console, lifecycle-only repeats collapse only at presentation,
  changed tuples remain ordered, failed and unresolved children remain visible,
  sibling/nested sessions stay excluded, parent tool accounting is unchanged,
  and redirected stdout remains compact JSON.
- No production output or result module API changes are expected.

- [ ] **Step 1: Attach the production console reporter to the existing streamed
      implementation scenario**

  In `pipeline-progress-scenarios.test.ts`, change the existing `node:path`
  import to `import { dirname, join } from "node:path";`, add `piSessionPath` to
  the existing mock-runner import block, and add these run-once imports:

  ```ts
  import { AgentIssueConsoleProgressReporter } from "./console-progress.ts";
  import { compositeProgressReporter } from "./progress.ts";
  import { summarizeResult } from "./result-summary.ts";
  import { writeRunOnceResult } from "./result-output.ts";
  ```

  In the existing
  `runOneIssue moves streamed tool calls under the active implementation task`
  scenario, rename the test to mention child outcomes. Replace the single
  collector reporter with a composite that retains event assertions and captures
  the production console sink as stderr evidence:

  ```ts
  const collected = collectProgressEvents();
  const stderrLines: string[] = [];
  const consoleProgress = new AgentIssueConsoleProgressReporter({
    writeLine: (line) => stderrLines.push(line),
    startedAt: NOW,
  });
  const progress = compositeProgressReporter([
    collected.progress,
    consoleProgress,
  ]);
  const events = collected.events;
  ```

- [ ] **Step 2: Append representative authoritative lifecycle history**

  Replace the scenario's simple workflow progress rows with these exact-session
  entries while mocked Pi is still pending:

  ```ts
  const runtime = {
    agent: "worker",
    model: "openai/team/models/gpt-5.6-sol",
    thinking: "high",
  } as const;

  await appendPiSessionEntry(
    call,
    subagentProgressEntry({
      version: 1,
      kind: "workflow",
      toolCallId: "call-1",
      workflowRunId: "workflow",
      childId: "build",
      state: "running",
      ...runtime,
    }),
  );
  await appendPiSessionEntry(
    call,
    subagentProgressEntry({
      version: 1,
      kind: "workflow",
      toolCallId: "call-1",
      workflowRunId: "workflow",
      childId: "shadow-build",
      state: "running",
      ...runtime,
    }),
  );
  await appendPiSessionEntry(
    call,
    subagentProgressEntry({
      version: 1,
      kind: "workflow",
      toolCallId: "call-1",
      workflowRunId: "workflow",
      childId: "review",
      state: "pending",
    }),
  );
  ```

  After the existing wait for task 2 to begin, append:

  ```ts
  await appendPiSessionEntry(
    call,
    subagentProgressEntry({
      version: 1,
      kind: "workflow",
      toolCallId: "call-1",
      workflowRunId: "workflow",
      childId: "build",
      state: "completed",
      ...runtime,
    }),
  );
  await appendPiSessionEntry(
    call,
    subagentProgressEntry({
      version: 1,
      kind: "workflow",
      toolCallId: "call-1",
      workflowRunId: "workflow",
      childId: "build",
      state: "completed",
      ...runtime,
      thinking: "xhigh",
    }),
  );
  await appendPiSessionEntry(
    call,
    subagentProgressEntry({
      version: 1,
      kind: "workflow",
      toolCallId: "call-1",
      workflowRunId: "workflow",
      childId: "review",
      state: "failed",
      agent: "reviewer",
      model: "gpt-5.6-sol",
    }),
  );
  await appendPiSessionEntry(
    call,
    subagentProgressEntry({
      version: 1,
      kind: "workflow",
      toolCallId: "call-1",
      workflowRunId: "workflow",
      childId: "unresolved-review",
      state: "failed",
      unresolved: true,
    }),
  );
  ```

  This supplies a lifecycle-only repeat, a changed tuple, two distinct children
  with identical tuples, a failed authoritative child, an unresolved workflow
  child, and a nested model path without changing issue #125's persisted
  history.

- [ ] **Step 3: Add direct unresolved and foreign-session fixtures**

  Append one ordinary direct parent tool call, wait until it is observed, then
  append its identity-only lifecycle and unresolved seal:

  ```ts
  await appendPiSessionEntry(
    call,
    assistantToolCall("call-direct", "subagent", {}),
  );
  await waitForCondition(
    () =>
      events.some((event) => event.observation?.toolCallId === "call-direct"),
    () => "waiting for call-direct observation",
  );
  await appendPiSessionEntry(
    call,
    subagentProgressEntry({
      version: 1,
      kind: "direct",
      toolCallId: "call-direct",
      runId: "run-direct",
      childIndex: 0,
      state: "running",
    }),
  );
  await appendPiSessionEntry(
    call,
    subagentProgressEntry({
      version: 1,
      kind: "direct",
      toolCallId: "call-direct",
      runId: "run-direct",
      childIndex: 0,
      state: "failed",
      unresolved: true,
    }),
  );
  ```

  Write matching foreign entries beside, but not into, the exact parent session:

  ```ts
  const parentSessionPath = await piSessionPath(call);
  const invocationDir = dirname(parentSessionPath);
  await mkdir(join(invocationDir, "nested"), { recursive: true });
  for (const [path, childId] of [
    [join(invocationDir, "sibling.jsonl"), "foreign-sibling"],
    [join(invocationDir, "nested", "child.jsonl"), "foreign-nested"],
  ] as const) {
    await writeFile(
      path,
      `${JSON.stringify(
        subagentProgressEntry({
          version: 1,
          kind: "workflow",
          toolCallId: "foreign-call",
          workflowRunId: "foreign-workflow",
          childId,
          state: "failed",
          unresolved: true,
        }),
      )}\n`,
      "utf8",
    );
  }
  ```

  The production exact-session streamer must never discover these sibling or
  nested paths.

- [ ] **Step 4: Assert exact console outcomes and unchanged parent accounting**

  Normalize only indentation for selecting child lines, not metadata values:

  ```ts
  const robotLines = stderrLines
    .map((line) => (line.startsWith("   ") ? line.slice(3) : line))
    .filter((line) => line.startsWith("🤖 subagent"));
  const stableRuntime =
    "🤖 subagent (agent=worker, model=openai/team/models/gpt-5.6-sol, thinking=high)";

  assert.equal(robotLines.filter((line) => line === stableRuntime).length, 2);
  assert.equal(
    robotLines.filter(
      (line) =>
        line ===
        "🤖 subagent (agent=worker, model=openai/team/models/gpt-5.6-sol, thinking=xhigh)",
    ).length,
    1,
  );
  assert.equal(
    robotLines.filter(
      (line) => line === "🤖 subagent (agent=reviewer, model=gpt-5.6-sol)",
    ).length,
    1,
  );
  assert.ok(
    robotLines.includes(
      "🤖 subagent (child=unresolved-review, unresolved=true)",
    ),
  );
  assert.ok(
    robotLines.includes(
      "🤖 subagent (runId=run-direct, childIndex=0, unresolved=true)",
    ),
  );
  assert.equal(
    stderrLines.some((line) => line.includes("foreign-sibling")),
    false,
  );
  assert.equal(
    stderrLines.some((line) => line.includes("foreign-nested")),
    false,
  );
  ```

  Replace the scenario's old exact `['build', 'review', 'build', 'review']`
  child-ID assertion with assertions over the richer progress history:

  ```ts
  const childProgressEvents = events.flatMap((event) =>
    event.observation?.type === "subagent-progress"
      ? [event.observation.progress]
      : [],
  );
  assert.ok(
    childProgressEvents.some(
      (progress) =>
        progress.kind === "workflow" &&
        progress.childId === "review" &&
        progress.state === "failed" &&
        progress.agent === "reviewer",
    ),
  );
  assert.ok(
    childProgressEvents.some(
      (progress) =>
        progress.kind === "direct" &&
        progress.runId === "run-direct" &&
        progress.childIndex === 0 &&
        progress.unresolved === true,
    ),
  );
  ```

  Retain the existing ordered step/tool assertions and add `tool:call-direct` in
  its emitted position. Update task 2's expected `toolCalls` from 2 to 3 for
  `call-2`, `call-status`, and the newly added parent `call-direct`. Do not
  count any child transition. The failed-event assertion ties the rendered
  reviewer line to a failed child, not only to fixture text.

- [ ] **Step 5: Compose redirected final output on a distinct stdout sink**

  After `runOneIssue()` resolves, pass its production summary to the existing
  final writer:

  ```ts
  const summary = summarizeResult(result);
  const stdoutChunks: string[] = [];
  await writeRunOnceResult(summary, {
    stdout: {
      isTTY: false,
      write: (chunk) => stdoutChunks.push(String(chunk)),
    },
    env: {},
  });

  assert.equal(stdoutChunks.join(""), `${JSON.stringify(summary)}\n`);
  assert.doesNotMatch(stdoutChunks.join(""), /🤖 subagent|unresolved=true/u);
  assert.deepEqual(
    JSON.parse(stdoutChunks.join("")),
    JSON.parse(JSON.stringify(summary)),
  );
  ```

  The `stderrLines` reporter sink must contain every expected child outcome,
  while stdout remains one machine-readable result object. Do not modify
  `result-output.ts` or `main.ts` to make this test pass.

- [ ] **Step 6: Run the focused scenario and output suites**

  Run:

  ```sh
  node --test \
    src/cli/commands/run-once/console-progress.test.ts \
    src/cli/commands/run-once/pipeline-progress-scenarios.test.ts \
    src/cli/commands/run-once/result-output.test.ts
  ```

  Expected: PASS. The console reporter emits stable child lines, the pipeline
  retains lifecycle history and parent accounting, foreign sessions remain
  absent, and redirected output is exactly compact JSON.

- [ ] **Step 7: Commit the operator-output regression**

  ```sh
  git add src/cli/commands/run-once/pipeline-progress-scenarios.test.ts
  git commit -m "test(run-once): cover enriched child progress output"
  ```

---

### Task 4: Complete Full Verification and Scope Review

**Files:**

- Verify: `src/cli/commands/run-once/console-progress.ts`
- Verify: `src/cli/commands/run-once/console-progress.test.ts`
- Verify: `src/cli/commands/run-once/pipeline-progress-scenarios.test.ts`
- Verify unchanged: `src/cli/commands/run-once/result-output.ts`
- Verify unchanged: all `src/pi/**`, package metadata, Nix files, and triage
  code

**Interfaces:**

- Consumes: the three completed implementation commits and the approved spec.
- Produces: fresh focused, run-once, repository, lint, build, dependency/Nix
  condition, and scope evidence. This task creates no validation-only commit.

- [ ] **Step 1: Run the approved focused regression command**

  Run exactly:

  ```sh
  node --test \
    src/cli/commands/run-once/console-progress.test.ts \
    src/cli/commands/run-once/pipeline-progress-scenarios.test.ts \
    src/cli/commands/run-once/result-output.test.ts
  ```

  Expected: PASS with no failed, cancelled, or skipped issue-specific tests.

- [ ] **Step 2: Run the complete run-once suite**

  Run:

  ```sh
  npm run test:run-once
  ```

  Expected: PASS. Existing management-call, non-child progress, session
  ownership, accounting, result output, and triage-adjacent run-once behavior
  remain unchanged.

- [ ] **Step 3: Run repository tests, lint, and build**

  Run in this order:

  ```sh
  npm test
  npm run lint
  npm run build
  ```

  Expected: every command exits 0 with no test failures, ESLint or markdown
  errors, Prettier drift, or TypeScript build errors.

- [ ] **Step 4: Enforce the AGENTS.md dependency/Nix condition**

  Run:

  ```sh
  if git diff --quiet origin/main...HEAD -- \
    package.json package-lock.json npm-shrinkwrap.json; then
    echo "Nix build skipped: npm dependency metadata unchanged"
  else
    nix build .#patchmill --print-build-logs
  fi
  ```

  Expected for this issue: the skip message. If implementation unexpectedly
  retained an npm dependency metadata change, the Nix build must run and exit 0
  before completion.

- [ ] **Step 5: Review the final diff against the issue boundary**

  Run:

  ```sh
  git diff --check
  git status --short
  git diff --stat origin/main...HEAD
  git diff origin/main...HEAD -- \
    src/cli/commands/run-once/console-progress.ts \
    src/cli/commands/run-once/console-progress.test.ts \
    src/cli/commands/run-once/pipeline-progress-scenarios.test.ts
  git diff --quiet origin/main...HEAD -- \
    src/pi package.json package-lock.json npm-shrinkwrap.json nix
  ```

  Expected: `git diff --check` and the final quiet diff command exit 0; the
  worktree is clean; production changes are limited to the console reporter;
  test changes are limited to focused reporter and pipeline/output regression
  coverage; no lifecycle, correlation, accounting, dependency, Nix, TUI, or
  triage code changed.

- [ ] **Step 6: Record verification evidence without a new commit**

  Update the Task 4 issue todo body with the exact commands and outcomes, plus
  any residual risks found during review, then set it to the configured terminal
  status. Do not amend a feature commit or create a validation-only commit when
  the worktree has no source changes.

---

## Testing Value Gate Notes

- `console-progress.test.ts` additions are warranted because they protect an
  operator-visible formatter contract, canonical per-child deduplication,
  metadata fidelity, omission rules, failure visibility, and fallback privacy.
  Each assertion can fail under realistic regressions such as global tuple
  deduplication, lifecycle spam, provider-path truncation, or invented fallback
  metadata.
- `pipeline-progress-scenarios.test.ts` is warranted because pure formatter
  tests cannot prove exact parent-session entries survive the real pipeline,
  remain independent from sibling/nested sessions, preserve parent accounting,
  and reach the production console sink before final output.
- Existing `result-output.test.ts` plus the composed pipeline scenario are
  sufficient for stdout/stderr separation. No duplicate test or production
  result-output change is planned.
- No tests are added for spec text, plan text, static dependency versions,
  package lock contents, or Nix source. Plan/spec prose is reviewed directly;
  dependency changes are detected with `git diff`; and the Nix build runs only
  if npm dependency metadata actually changes.

## Self-Review Notes

- **Spec coverage:** Task 1 covers authoritative field order, omission, nested
  model preservation, same-child lifecycle deduplication, changed tuples,
  distinct-child independence, and outside-step output. Task 2 covers
  identity-only suppression, workflow/direct fallback identity, one fallback per
  canonical child, no inference, and authoritative precedence. Task 3 covers
  real exact-session delivery, failed children, foreign-session exclusion,
  parent accounting, stderr progress, and compact stdout JSON. Task 4 covers all
  requested validation and scope gates.
- **Module boundaries:** Presentation keys and formatting remain private to the
  201-line console reporter, which has one run-once console responsibility.
  Issue #125 parsing, streaming, correlation, and accounting modules stay
  unchanged. Large existing test modules are extended only within their current
  reporter/scenario responsibilities.
- **Type consistency:** Every task uses the merged `PersistedSubagentProgress`
  fields exactly: direct `toolCallId`, `runId`, and `childIndex`; workflow
  `toolCallId`, `workflowRunId`, `childId`, and required `state`; optional
  `agent`, `model`, `thinking`, and literal `unresolved: true`.
- **Placeholder scan:** Every code-changing task identifies exact files,
  interfaces, red/green commands, expected failures, implementation behavior,
  and a Conventional Commit message. No requirement is deferred to an
  unspecified implementation step.
