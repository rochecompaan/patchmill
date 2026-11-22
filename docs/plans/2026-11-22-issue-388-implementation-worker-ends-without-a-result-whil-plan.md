# Worker waits for its own subagents: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the sibling `executing-plans`
> skill to implement this plan inline, task by task. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** A worker waits for its own subagent runs before it ends its turn, the
Console agent never tells it to yield, and a `no result` outcome names a run
that was still running.

**Architecture:** The console worker's agent definition gains `bg_wait` and
`subagent_supervisor`. Instruction changes in the implementation skill, the run
envelope, and a Console tool's prompt guidelines. One new kernel module,
`src/kernel/unfinished-runs.ts`, reads the worker's own session files after a
`no result` session and adds the cause to the reason. `runOnce` calls it once
per phase session, for both launch modes.

**Tech Stack:** TypeScript on Node 24 (`node --test`), Pi session JSONL,
pi-subagents 0.80.0.

**Spec:**
[`docs/specs/2026-11-22-issue-388-implementation-worker-ends-without-a-result-whil-design.md`](../specs/2026-11-22-issue-388-implementation-worker-ends-without-a-result-whil-design.md)

**Inputs:** the spec above and its inline `## Visual explanation`. The spec has
no mockup and no HTML companion.

**Execution:** inline, through the sibling `executing-plans` skill. The final
whole-branch review uses the canonical `reviewer` agent, as the implementation
skill says.

## Global Constraints

- The reason keeps its `no result` prefix. The cause follows after a colon and a
  space.
- Reason text for one run with a known agent, verbatim:
  `no result: the worker ended its turn while its <agent> run <id> was still running`.
- Several runs:
  `no result: the worker ended its turn while its subagent runs <agent> <id>, <agent> <id> were still running`.
  A run with an unknown agent shows only `<id>`. One run with an unknown agent:
  `no result: the worker ended its turn while its subagent run <id> was still running`.
- The session status in run history stays `invalid`. The label stays
  `needs-info`.
- The envelope wait rule is absent from the interactive planning envelope.
- Worker tools line, verbatim:
  `tools: read, grep, find, ls, bash, edit, write, subagent, bg_wait, subagent_supervisor`.
- Do not change pi-subagents or the planning skill.
- Prose follows the sibling `simple-english` skill (pragmatic mode).

## Review Focus

- A forked worker session holds Console history with old timestamps. A run that
  the Console agent started in that history must not count. (Task 1 test
  `ignores entries copied from before the fork`.)
- A worker that waited with `bg_wait` and then still ended without a result must
  not get the new cause. (Task 1 test `bg_wait completion finishes a run`.)
- A broken or partial JSONL line must not throw and must not hide the existing
  `no result` reason. (Task 1 test `skips lines that are not JSON objects`.)
- A timed-out or aborted session keeps its existing reason. (Task 2 step 3: the
  call is skipped for those sessions; the existing timeout test still passes.)
- Child sessions in subdirectories of the session directory must not count.
  (Task 1 test `explainMissingResult reads only top-level session files`.)

---

### Task 1: Find unfinished subagent runs in a session

**Files:**

- Create: `src/kernel/unfinished-runs.ts`
- Test: `src/kernel/unfinished-runs.test.ts`

**Interfaces:**

- Consumes: `ParsedResult` from `src/kernel/result.ts`.
- Produces:
  - `export type UnfinishedRun = { runId: string; agent?: string }`
  - `export function unfinishedRuns(sessionText: string): UnfinishedRun[]`
  - `export async function explainMissingResult(result: ParsedResult, sessionDir: string): Promise<ParsedResult>`

- [ ] **Step 1: Write the failing tests**

Build JSONL with small helpers in the test file: `header(ts)`,
`call(ts, toolCallId, args)` (assistant message with one `toolCall` named
`subagent`), `receipt(ts, toolCallId, asyncId, text?)` (toolResult `subagent`
with `details.asyncId`), `notify(ts, runId)` (`custom_message`,
`customType: "subagent-notify"`, `details.runs: [{ runId }]`), and
`waited(ts, runId)` (toolResult `bg_wait`, `details.completions: [{ runId }]`).
Use the run id `c4856e0b-4247-4f52-9a9b-cf0f9b326737` from the evidence.

```ts
test("a resume receipt without a notice is unfinished", () => {
  const text = lines(
    header("2026-11-20T07:53:05.900Z"),
    call("2026-11-20T08:27:42.435Z", "c1", {
      action: "resume",
      id: "7afc4d89",
      async: false,
    }),
    receipt(
      "2026-11-20T08:27:42.542Z",
      "c1",
      RUN,
      "Revived foreground subagent from 7afc4d89.\nAgent: reviewer\n",
    ),
  );
  assert.deepEqual(unfinishedRuns(text), [{ runId: RUN, agent: "reviewer" }]);
});
test("a launch takes its agent from the tool call", ...);
// call args { agent: "reviewer", async: true }, receipt without an Agent line
// -> [{ runId, agent: "reviewer" }]
test("a subagent-notify message finishes a run", ...);   // -> []
test("bg_wait completion finishes a run", ...);           // -> []
test("a stop of the run finishes it", ...);
// call { action: "stop", id: RUN } with a non-error subagent result -> []
test("an error tool result starts no run", ...);          // isError: true -> []
test("ignores entries copied from before the fork", ...);
// receipt timestamp before the header timestamp -> []
test("without a header every entry counts", ...);         // -> one run
test("skips lines that are not JSON objects", ...);
// "not json", "[]", and "" lines around a receipt -> one run, no throw
test("explainMissingResult names the run in a no result reason", async () => {
  // temp dir with a.jsonl = the resume case above
  assert.deepEqual(
    await explainMissingResult({ ok: false, reason: "no result" }, dir),
    {
      ok: false,
      reason: `no result: the worker ended its turn while its reviewer run ${RUN} was still running`,
    },
  );
});
test("explainMissingResult lists several runs", ...);
// reviewer RUN and an unknown-agent run "1a2b" ->
// `no result: the worker ended its turn while its subagent runs reviewer ${RUN}, 1a2b were still running`
test("explainMissingResult keeps other results", ...);
// { ok: true, ... } and { ok: false, reason: "invalid JSON: x" } return the same object
test("explainMissingResult reads only top-level session files", ...);
// receipt only in dir/child/run-0/session.jsonl -> reason stays "no result"
test("explainMissingResult keeps no result for a missing directory", ...);
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `node --test src/kernel/unfinished-runs.test.ts`

Expected: FAIL, because `./unfinished-runs.ts` does not exist.

- [ ] **Step 3: Implement `unfinishedRuns` and `explainMissingResult`**

Follow the rules in the spec section "Outcome cause". Parse each line with
`JSON.parse` in a `try`; skip values that are not plain objects. Compare
timestamps with `Date.parse`; an entry without a parseable timestamp counts only
when the file has no header. Keep a `Map<toolCallId, args>` from assistant
`toolCall` content blocks (`type: "toolCall"`, `id`, `name`, `arguments`). Keep
started runs in a `Map<runId, UnfinishedRun>` in insertion order, and record a
known agent per run id for a later `resume`. Read the `Agent:` line with
`/^Agent: (\S+)$/m` from the text blocks of the tool result. In
`explainMissingResult`, use `fs.readdir(sessionDir, { withFileTypes: true })`
and read files whose name ends with `.jsonl`; catch read errors per file and for
the directory. Merge runs across files by run id.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `node --test src/kernel/unfinished-runs.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/kernel/unfinished-runs.ts src/kernel/unfinished-runs.test.ts
git commit -m "feat(kernel): find subagent runs a worker left running"
```

### Task 2: Name the cause in the run outcome

**Files:**

- Modify: `src/kernel/run-once.ts` (after the `launchPhase` call near line 350)
- Modify: `test-support/fake-pi.mjs` (session file write near line 27)
- Test: `src/kernel/run-once-failures.test.ts`

**Interfaces:**

- Consumes: `explainMissingResult` from Task 1.
- Produces: new fake Pi step field `sessionEntries: unknown[]`. The fake writes
  each entry as one JSON line to `fake.jsonl`, after the existing usage line.

- [ ] **Step 1: Write the failing test**

Run the implementation phase, as the `draft`/`dirty` tests in the same file do:
seed the spec and plan and add the `spec-approved` label before `c.run()`.

```ts
test("a worker that ends with a running reviewer names the cause", async (t) => {
  const run = "c4856e0b-4247-4f52-9a9b-cf0f9b326737";
  const c = await setupRun(t, [
    {
      stdout: "Awaiting the retained reviewer's completion.",
      sessionEntries: [
        // assistant toolCall: subagent resume, async false, id "c1"
        // toolResult subagent for "c1": details.asyncId = run,
        //   text "Revived foreground subagent ...\nAgent: reviewer\n"
      ],
    },
  ]);
  await c.seed({ [spec]: "spec", [plan]: "plan" });
  await c.mutate((s) => s.issues[0]!.labels.push("spec-approved"));
  await c.run();
  const issue = c.host.state().issues[0]!;
  assert.ok(issue.labels.includes("needs-info"));
  assert.match(
    issue.comments[0]!.body,
    new RegExp(
      `no result: the worker ended its turn while its reviewer run ${run} was still running`,
    ),
  );
  assert.equal((await c.records()).result.sessions[0].status, "invalid");
});
```

- [ ] **Step 2: Run the test to make sure it fails**

Run:
`node --test --test-name-pattern="running reviewer" src/kernel/run-once-failures.test.ts`

Expected: FAIL. The comment has `no result Log:` without the cause.

- [ ] **Step 3: Implement**

In `test-support/fake-pi.mjs`, append `step.sessionEntries` (when present) to
`fake.jsonl` as JSON lines. In `runOnce`, rename the `launchPhase` return value
to `launched`, then:

```ts
const run =
  launched.session.timedOut || launched.session.aborted
    ? launched
    : {
        ...launched,
        result: await explainMissingResult(launched.result, launch.sessionDir),
      };
```

Keep every later use of `run`, `session`, and `result` unchanged.

- [ ] **Step 4: Run the tests to make sure they pass**

Run:
`node --test src/kernel/run-once-failures.test.ts src/kernel/run-once.test.ts`

Expected: PASS, with the existing `invalid` and `timeout` tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/kernel/run-once.ts test-support/fake-pi.mjs src/kernel/run-once-failures.test.ts
git commit -m "feat(kernel): say when a worker ended while its subagent ran"
```

### Task 3: Give the console worker its wait tools

**Files:**

- Modify: `src/cli/commands/init/agent-dir.ts` (`IMPLEMENTATION_AGENT`)
- Test: `src/cli/commands/init/agent-dir.test.ts` (test
  `provisioning writes and repairs the implementation worker without rewriting it`)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: the provisioned `patchmill-implementation.md` agent with the tools
  line from Global Constraints.

- [ ] **Step 1: Change the test assertion**

Change the `tools:` regex in the existing test to the verbatim tools line from
Global Constraints. Also check the variant with skills: the `tools: read`
replacement in `provisionAgentDir` keeps the new tools after it.

- [ ] **Step 2: Run the test to make sure it fails**

Run: `node --test src/cli/commands/init/agent-dir.test.ts`

Expected: FAIL on the `tools:` assertion.

- [ ] **Step 3: Change `IMPLEMENTATION_AGENT`**

Append `, bg_wait, subagent_supervisor` to its `tools:` line.

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `node --test src/cli/commands/init/agent-dir.test.ts src/console/*.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/init/agent-dir.ts src/cli/commands/init/agent-dir.test.ts
git commit -m "fix(console): let the worker wait for and answer its subagents"
```

### Task 4: Tell the worker and the Console agent how to wait

**Files:**

- Modify: `skills/patchmill-implementation/SKILL.md`
- Modify: `.patchmill/skills/patchmill-implementation/SKILL.md` and
  `.patchmill/skills/patchmill-skill-pack.json` (through `skills update`)
- Modify: `src/kernel/run-envelope.md`, `src/kernel/envelope.ts`
- Modify: `src/kernel/fixtures/envelope-implementation.txt`,
  `src/kernel/fixtures/envelope-planning.txt`
- Modify: `src/console/tools.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: template value `waitRules` in `renderRunEnvelope`.

Testing Value Gate: these are prose and static prompt changes. Verify them by
inspection and by the existing envelope fixture test. Do not add text-assertion
tests.

- [ ] **Step 1: Change the skill**

Add `## Wait for your own subagents` before `## Independent review`, with the
points of the spec section "Worker instructions", including the rule to repeat
the result block after a late completion notice. In `## Independent review`,
replace "Run the reviewer in the foreground (`async: false`) and read its whole
result before you continue. Do not end the session with a reviewer still
running." with: launch the reviewer with `async: true`, wait for it as the new
section says, and read its whole result before you continue. Name the `resume`
workaround: a `resume` always runs in the background, so wait for its new run id
with `bg_wait`.

- [ ] **Step 2: Refresh the installed skill copy**

Run: `node bin/patchmill.ts skills update`

Expected: `.patchmill/skills/patchmill-implementation/SKILL.md` equals
`skills/patchmill-implementation/SKILL.md`, and the manifest hash for it
changes. Check with
`diff skills/patchmill-implementation/SKILL.md .patchmill/skills/patchmill-implementation/SKILL.md`
(no output) and `git diff --stat .patchmill/skills` (only those two files).

- [ ] **Step 3: Add the envelope rule**

In `src/kernel/run-envelope.md`, change the first hard-rule line to
`- {{commitRules}}{{waitRules}}`, so the rule comes before "End with the JSON
block". In `renderRunEnvelope`, set `waitRules` to `""` when
`interactivePlanning` is true. Otherwise set it to `"\n- "` followed by the rule
text in the spec section "Envelope rule", on one line.

- [ ] **Step 4: Update the envelope fixtures and run the envelope tests**

Add the rule line to both fixture files after the first hard-rule line (the
commit rule). Run: `node --test src/kernel/envelope.test.ts`

Expected: PASS. Then run
`node --test src/kernel/interactive-planning.test.ts src/console/*.test.ts` and
expect PASS (the interactive planning envelope has no rule line).

- [ ] **Step 5: Add the Console agent guidance**

In `registerConsoleTools`, add `promptGuidelines` with the two bullets of the
spec section "Console agent guidance" to the `patchmill_run_status` tool. Run
`npm run check:types` and expect no errors.

- [ ] **Step 6: Commit**

```bash
git add skills/patchmill-implementation/SKILL.md .patchmill/skills src/kernel/run-envelope.md src/kernel/envelope.ts src/kernel/fixtures src/console/tools.ts
git commit -m "fix(skills): make workers wait for their own subagents"
```

### Final validation

- [ ] Run `npm test`, `npm run lint`, and `npm run build`. Expect all to pass.
      No npm dependency changes, so the Nix build is not required.

## Visual explanation

The tree shows task order and ownership. Tasks 1, 3, and 4 are independent. Task
2 needs Task 1. Task 4 tells the worker to use the tools that Task 3 gives it,
so land Task 3 first or in the same pull request.

```text
Task 1  src/kernel/unfinished-runs.ts      (kernel: transcript check)
  └─ Task 2  src/kernel/run-once.ts         (kernel: outcome reason)
             test-support/fake-pi.mjs       (test: session entries)
Task 3  src/cli/commands/init/agent-dir.ts (console worker tools)
Task 4  skills/patchmill-implementation/    (worker instructions)
        src/kernel/run-envelope.md, envelope.ts (worker envelope)
        src/console/tools.ts                (Console agent guidance)
```

## Companion artifacts

None.

## Planning review

### Pass 1: initial (combined spec and plan)

- **Scope:** this plan and the specification
  `docs/specs/2026-11-22-issue-388-implementation-worker-ends-without-a-result-whil-design.md`,
  reviewed together at stage `implementation` (no gate).
- **Reviewer:** canonical `reviewer` agent, model
  `claude-bridge/claude-opus-5-5`, thinking `high`, base revision `12f871a`.
- **Reviewed body SHA-256:** not recorded for this pass. The planner computed
  hashes only after the corrections.
- **Survey:** the reviewer traced `no result` from `parseJsonBlock` through
  `runOnce` and `verifyOutcome`, the session file location in both launch modes,
  the pi-subagents record shapes in the evidence session, the RPC
  background-work wait, and the worker agent definition.
- **Findings and dispositions:**
  - B1 (blocker): the console worker lacks `bg_wait` and `subagent_supervisor`
    (`toolsRemoved` on line 197 of the evidence session). Accepted: new "Worker
    tools" section, goal, acceptance row, and plan Task 3.
  - B2 (blocker): "nothing wakes you later" is false for RPC workers. Accepted:
    the envelope rule drops it, Intent explains the difference, and the skill
    point is limited to Interactive Issue runs.
  - S1: possible RPC double wake after `bg_wait`. Accepted: listed under Risks,
    and the skill tells the worker to repeat its result block.
  - S2: a stopped run would show as still running. Accepted: a non-error `stop`
    result finishes the run.
  - S3: leftover runs in a resumed console worker. Accepted: the spec states
    that they still count.
  - S4: later readers must match the `no result` prefix. Accepted.
  - S5: the run-once test ran the planning phase. Accepted: it seeds the spec
    and plan and runs implementation.
  - S6: assert mainly on `explainMissingResult`. Rejected: `unfinishedRuns` is a
    pure function with its own contract; both are tested.
- **Inspection limits:** no tests or runtime executed; RPC `hasUI` behavior and
  S1 inferred from source.

### Pass 2: scoped confirmation

- **Reviewer:** canonical `reviewer` agent, model
  `claude-bridge/claude-opus-5-5`, thinking `high`, base revision `12f871a`.
- **Reviewed body SHA-256:** specification
  `e72237076c6dd006d609ecc8cfd23d256d3b6faeae1d8324ffab3e8648006e1c`; plan
  `554e2c8c52233a0baea3eb4f73606931310608a2260da2a14881c7c89e536a71`.
- **Result:** B1, B2, and S1–S5 resolved; S6 rejection accepted; no new blocker.
  Checked against pi-subagents 0.80.0 source (`child-tool-plan.js`,
  `subagent-wait.js`, `async-stop-action.js`) and the evidence session.
- **New suggestions:**
  - N1: put the wait rule before "End with the JSON block". Accepted in the plan
    only (Task 4 step 3 uses `{{commitRules}}{{waitRules}}`); the specification
    is unchanged.
  - N2: a stop by id prefix stays "unfinished". Declined: it affects only the
    wording of a diagnostic.
- **Inspection limits:** no runtime check that the new tools register in a
  forked console worker; S1 not verified at runtime.
- **Final body SHA-256:** specification
  `e72237076c6dd006d609ecc8cfd23d256d3b6faeae1d8324ffab3e8648006e1c`; plan
  `78788e8c51865941208ac9d006cde0d7f40fe69f55ace79342501684e359a255`.
- **Compared specification body SHA-256:**
  `e72237076c6dd006d609ecc8cfd23d256d3b6faeae1d8324ffab3e8648006e1c`.
- **Outcome:** `ready`.
