# Todo Terminal Status Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Patchmill-managed issue task todo terminal statuses consistent
across the Pi todo tool, prompt guidance, progress tracking, and final handoff
gates.

**Architecture:** Introduce a shared todo-status helper that owns default
terminal statuses, normalization, predicates, and Pi-extension environment
serialization. Wire Patchmill task-contract readers, Pi invocation, prompts, and
the bundled todo extension to that helper so the default workflow recognizes
`closed`, `completed`, `complete`, and `done`, while custom task-contract
`doneStatuses` remain authoritative when configured.

**Tech Stack:** TypeScript, Node.js `node:test`, TypeBox/Pi tool schemas,
Patchmill run-once policy and prompt code, bundled Pi extension runtime.

## Global Constraints

- Base the implementation on
  `docs/specs/2026-07-23-issue-109-todo-status-is-accepted-but-fails-the-final-handoff-gate-design.md`.
- Default Patchmill terminal statuses must be exactly `closed`, `completed`,
  `complete`, and `done`.
- Status matching must trim surrounding whitespace and compare
  case-insensitively.
- Existing todo files with `status: "complete"` must be treated as done without
  rewriting files.
- Project overrides of `projectPolicy.pi.taskContract.doneStatuses` remain
  authoritative for Patchmill issue task todos.
- The todo extension must default to the Patchmill default terminal set when no
  Patchmill environment is provided.
- The Pi todo tool status schema must be constrained to the active status
  vocabulary: `open` plus the resolved done statuses.
- UI close actions still write `closed`; reopen actions still write `open`.
- Do not change todo file location, title matching, tags, locking, assignment,
  or garbage-collection policy except where terminal-status recognition already
  participates.
- Do not change npm dependencies. If `package.json`, `package-lock.json`, or
  `npm-shrinkwrap.json` changes unexpectedly, stop and add a Nix build
  verification step per `AGENTS.md`.
- Testing Value Gate: this is a production regression in status parsing, prompt
  contracts, and final handoff behavior, so automated tests are required.

## File Structure

- Create `src/policy/todo-statuses.ts`: shared default status list,
  normalization, done predicate, environment variable name, serialization, and
  parsing helpers.
- Create `src/policy/todo-statuses.test.ts`: behavior tests for defaults,
  normalization, custom statuses, de-duplication, and invalid environment
  fallback.
- Modify `src/policy/task-contract.ts`: import the shared default list and
  predicate; make `DEFAULT_PI_TASK_CONTRACT.doneStatuses` use the shared
  default.
- Modify `src/policy/task-contract.test.ts` and `src/policy/defaults.test.ts`:
  update default expectations and add predicate normalization coverage.
- Modify `src/cli/commands/run-once/issue-todos.ts`: rely on the normalized
  shared predicate through `issueTodoStatusDone`.
- Modify `src/cli/commands/run-once/issue-todos.test.ts`: cover `complete`,
  whitespace/case normalization, progress advancement, and all default terminal
  statuses in the final gate.
- Modify `src/cli/commands/run-once/pipeline-landing.test.ts`: add a
  final-handoff regression where all issue task todos are `complete` and
  `pr-created` succeeds.
- Modify `src/cli/commands/run-once/pipeline-progress-scenarios.test.ts`: add or
  update a progress scenario proving `complete` advances implementation
  progress.
- Modify `src/cli/commands/run-once/pi.ts`: pass the resolved done-status list
  to Pi with a JSON string-array environment variable.
- Modify `src/cli/commands/run-once/pi.test.ts`: assert `PI_TODO_DONE_STATUSES`
  is passed and progress respects custom done statuses.
- Modify `src/cli/commands/run-once/prompts.ts`: render accepted terminal
  statuses in plan and implementation todo guidance and prefer setting completed
  work to `closed`.
- Modify `src/cli/commands/run-once/prompts.test.ts`: update default prompt
  assertions and add custom terminal-status prompt assertions.
- Modify `extensions/todos.ts`: import the shared helper, resolve active done
  statuses from the environment, constrain the status parameter schema, and use
  the shared predicate for grouping, sorting, assignment clearing, claiming, and
  garbage collection.
- Create `test-support/todos-extension.test.ts`: focused extension-harness tests
  for default `complete` closed grouping, claim blocking, schema vocabulary, and
  invalid environment fallback.

---

## Task 1: Shared todo-status helper and default task contract

**Files:**

- Create: `src/policy/todo-statuses.ts`
- Create: `src/policy/todo-statuses.test.ts`
- Modify: `src/policy/task-contract.ts`
- Modify: `src/policy/task-contract.test.ts`
- Modify: `src/policy/defaults.test.ts`

**Interfaces:**

- Consumes: current `PatchmillPiTaskContract.doneStatuses` arrays.
- Produces: `DEFAULT_TODO_DONE_STATUSES`, `PI_TODO_DONE_STATUSES_ENV`,
  `normalizeTodoStatus`, `normalizeTodoDoneStatuses`, `todoStatusIsDone`,
  `serializeTodoDoneStatuses`, and `parseTodoDoneStatusesEnv` for later tasks.

- [ ] **Step 1: Write failing shared-helper tests**

Create `src/policy/todo-statuses.test.ts` with these tests:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_TODO_DONE_STATUSES,
  parseTodoDoneStatusesEnv,
  serializeTodoDoneStatuses,
  todoStatusIsDone,
} from "./todo-statuses.ts";

test("default todo done statuses include compatibility aliases", () => {
  assert.deepEqual(DEFAULT_TODO_DONE_STATUSES, [
    "closed",
    "completed",
    "complete",
    "done",
  ]);
});

test("todoStatusIsDone trims and compares case-insensitively", () => {
  assert.equal(todoStatusIsDone(" COMPLETE "), true);
  assert.equal(todoStatusIsDone("Done"), true);
  assert.equal(todoStatusIsDone("open"), false);
  assert.equal(todoStatusIsDone(undefined), false);
});

test("custom done statuses are authoritative after normalization", () => {
  assert.equal(todoStatusIsDone(" shipped ", ["SHIPPED"]), true);
  assert.equal(todoStatusIsDone("complete", ["shipped"]), false);
});

test("todo done status env serialization parses valid arrays and falls back safely", () => {
  assert.deepEqual(
    parseTodoDoneStatusesEnv(
      serializeTodoDoneStatuses([" Shipped ", "shipped", ""]),
    ),
    ["shipped"],
  );
  assert.deepEqual(
    parseTodoDoneStatusesEnv("not json"),
    DEFAULT_TODO_DONE_STATUSES,
  );
  assert.deepEqual(
    parseTodoDoneStatusesEnv(JSON.stringify([])),
    DEFAULT_TODO_DONE_STATUSES,
  );
  assert.deepEqual(
    parseTodoDoneStatusesEnv(JSON.stringify(["", "  "])),
    DEFAULT_TODO_DONE_STATUSES,
  );
  assert.deepEqual(
    parseTodoDoneStatusesEnv(JSON.stringify(["done", 3])),
    DEFAULT_TODO_DONE_STATUSES,
  );
});
```

Run:

```sh
node --test src/policy/todo-statuses.test.ts
```

Expected: fail because `src/policy/todo-statuses.ts` does not exist.

- [ ] **Step 2: Implement the shared helper**

Create `src/policy/todo-statuses.ts` with this behavior:

```ts
export const DEFAULT_TODO_DONE_STATUSES = [
  "closed",
  "completed",
  "complete",
  "done",
] as const;

export const PI_TODO_DONE_STATUSES_ENV = "PI_TODO_DONE_STATUSES";

export function normalizeTodoStatus(status: string): string {
  return status.trim().toLowerCase();
}

export function normalizeTodoDoneStatuses(
  doneStatuses: readonly string[] = DEFAULT_TODO_DONE_STATUSES,
): string[] {
  const normalized: string[] = [];
  for (const status of doneStatuses) {
    const value = normalizeTodoStatus(status);
    if (!value || normalized.includes(value)) continue;
    normalized.push(value);
  }
  return normalized.length > 0 ? normalized : [...DEFAULT_TODO_DONE_STATUSES];
}

export function todoStatusIsDone(
  status: string | undefined,
  doneStatuses: readonly string[] = DEFAULT_TODO_DONE_STATUSES,
): boolean {
  if (status === undefined) return false;
  return normalizeTodoDoneStatuses(doneStatuses).includes(
    normalizeTodoStatus(status),
  );
}

export function serializeTodoDoneStatuses(
  doneStatuses: readonly string[],
): string {
  return JSON.stringify(normalizeTodoDoneStatuses(doneStatuses));
}

export function parseTodoDoneStatusesEnv(value: string | undefined): string[] {
  if (value === undefined || value.trim().length === 0) {
    return [...DEFAULT_TODO_DONE_STATUSES];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_TODO_DONE_STATUSES];
    if (!parsed.every((entry): entry is string => typeof entry === "string")) {
      return [...DEFAULT_TODO_DONE_STATUSES];
    }
    return normalizeTodoDoneStatuses(parsed);
  } catch {
    return [...DEFAULT_TODO_DONE_STATUSES];
  }
}
```

- [ ] **Step 3: Wire the task contract to the helper**

In `src/policy/task-contract.ts`, import the helper and change the default and
predicate:

```ts
import {
  DEFAULT_TODO_DONE_STATUSES,
  todoStatusIsDone,
} from "./todo-statuses.ts";
```

Use:

```ts
doneStatuses: [...DEFAULT_TODO_DONE_STATUSES],
```

and:

```ts
export function issueTodoStatusDone(
  contract: PatchmillPiTaskContract,
  status: string | undefined,
): boolean {
  return todoStatusIsDone(status, contract.doneStatuses);
}
```

- [ ] **Step 4: Update default policy tests**

Update `src/policy/task-contract.test.ts` and `src/policy/defaults.test.ts` so
default `doneStatuses` expectations are:

```ts
doneStatuses: ["closed", "completed", "complete", "done"],
```

Add this assertion to `src/policy/task-contract.test.ts` near the existing
`issueTodoStatusDone` checks:

```ts
assert.equal(issueTodoStatusDone(DEFAULT_PI_TASK_CONTRACT, " Complete "), true);
assert.equal(issueTodoStatusDone(DEFAULT_PI_TASK_CONTRACT, "DONE"), true);
```

- [ ] **Step 5: Run focused policy tests**

Run:

```sh
node --test src/policy/todo-statuses.test.ts src/policy/task-contract.test.ts src/policy/defaults.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit the helper**

Run:

```sh
git add src/policy/todo-statuses.ts src/policy/todo-statuses.test.ts src/policy/task-contract.ts src/policy/task-contract.test.ts src/policy/defaults.test.ts
git commit -m "fix: share todo terminal status vocabulary"
```

Expected: one conventional commit containing only the shared-helper and
default-contract changes.

## Task 2: Issue todo progress and final handoff compatibility

**Files:**

- Modify: `src/cli/commands/run-once/issue-todos.ts`
- Modify: `src/cli/commands/run-once/issue-todos.test.ts`
- Modify: `src/cli/commands/run-once/pipeline-landing.test.ts`
- Modify: `src/cli/commands/run-once/pipeline-progress-scenarios.test.ts`

**Interfaces:**

- Consumes: `issueTodoStatusDone(contract, status)` from Task 1.
- Produces: issue todo readers, progress, and final gates that recognize default
  `complete` todos and custom configured statuses consistently.

- [ ] **Step 1: Add issue-todo reader and gate tests for `complete`**

In `src/cli/commands/run-once/issue-todos.test.ts`, add a test that writes issue
19 todos with statuses `" complete "`, `"COMPLETED"`, `"Done"`, and `"closed"`,
then asserts all are done and the final gate accepts them:

```ts
test("issue todo readers treat every default terminal status as done", async () => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "agent-issue-complete-status-"),
  );
  await writeTodo(repoRoot, "a", "issue-19-task-01-first", " complete ");
  await writeTodo(repoRoot, "b", "issue-19-task-02-second", "COMPLETED");
  await writeTodo(repoRoot, "c", "issue-19-task-03-third", "Done");
  await writeTodo(repoRoot, "d", "issue-19-task-04-fourth", "closed");

  const tasks = await readIssueTodoTasks(repoRoot, 19);
  assert.deepEqual(
    tasks.map((task) => task.done),
    [true, true, true, true],
  );
  assert.deepEqual(await issueTodoProgress(repoRoot, 19), {
    current: 4,
    total: 4,
    label: "fourth",
  });
  await assertIssueTodosComplete(repoRoot, 19);
});
```

Run:

```sh
node --test src/cli/commands/run-once/issue-todos.test.ts
```

Expected before Task 1 integration is fully wired: fail on `complete` or
normalized values. Expected after Task 1: pass.

- [ ] **Step 2: Add a final handoff regression for `complete` todos**

In `src/cli/commands/run-once/pipeline-landing.test.ts`, add a test based on
`runOneIssue blocks completed handoff when issue task todos remain open`, but
create two issue #24 task todos with status `"complete"`, return a `pr-created`
Pi result, and assert the pipeline returns `pr-created` instead of blocked:

```ts
test("runOneIssue accepts pr-created handoff when issue task todos are complete", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(
    24,
    ["agent-ready", "bug"],
    "Accept complete todo status",
  );
  const existingPlanPath = join(
    config.plansDir,
    "2026-05-01-issue-24-accept-complete-todo-status.md",
  );
  const worktreePath =
    ".worktrees/patchmill-issue-24-accept-complete-todo-status";
  const worktreeRoot = join(config.repoRoot, worktreePath);
  await mkdir(worktreeRoot, { recursive: true });
  await writeFile(existingPlanPath, "# plan\n", "utf8");
  await writeTodo(
    worktreeRoot,
    "task-1",
    "issue-24-task-01-status-helper",
    "complete",
  );
  await writeTodo(
    worktreeRoot,
    "task-2",
    "issue-24-task-02-final-gate",
    "complete",
  );

  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: `worktree ${worktreeRoot}\n`, stderr: "" };
    }
    if (
      call.command === "git" &&
      call.args[0] === "-C" &&
      call.args[2] === "branch"
    ) {
      return {
        code: 0,
        stdout: "agent/issue-24-accept-complete-todo-status\n",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "log") {
      return { code: 0, stdout: "abc123 implementation\n", stderr: "" };
    }
    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }
    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "pi") {
      return {
        code: 0,
        stdout:
          '{"status":"pr-created","prUrl":"https://forgejo.example/pr/24","branch":"agent/issue-24-accept-complete-todo-status","commits":["abc123"],"validation":["git diff --check ok"],"reviewSummary":"reviewed"}',
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created", JSON.stringify(result));
});
```

Run:

```sh
node --test src/cli/commands/run-once/pipeline-landing.test.ts
```

Expected: pass after Task 1 predicate wiring.

- [ ] **Step 3: Add a progress regression for `complete` todos**

In `src/cli/commands/run-once/pipeline-progress-scenarios.test.ts`, add or adapt
a heartbeat/progress case so an issue worktree has task 1 status `"complete"`
and task 2 status `"open"`. Assert the progress event for implementation reports
task 2 instead of staying on task 1. Use the existing `collectProgressEvents`
helper and the existing `writeTodo` helper in that file.

Use assertions in this shape:

```ts
assert.equal(
  events.some((event) =>
    event.message.includes("implement task 2/2 second task"),
  ),
  true,
);
assert.equal(
  events.some((event) =>
    event.message.includes("implement task 1/2 first task"),
  ),
  false,
);
```

Run:

```sh
node --test src/cli/commands/run-once/pipeline-progress-scenarios.test.ts
```

Expected: pass after Task 1 predicate wiring.

- [ ] **Step 4: Confirm no extra issue-todo implementation is needed**

Inspect `src/cli/commands/run-once/issue-todos.ts`. If it already delegates
through `issueTodoStatusDone`, do not add duplicate normalization there. If any
direct `doneStatuses.includes` call remains in run-once issue-todo code, replace
it with `issueTodoStatusDone`.

Run:

```sh
rg "doneStatuses\.includes|status\.toLowerCase\(\)" src/cli/commands/run-once/issue-todos.ts
```

Expected: no output.

- [ ] **Step 5: Run focused run-once todo tests**

Run:

```sh
node --test src/cli/commands/run-once/issue-todos.test.ts src/cli/commands/run-once/pipeline-landing.test.ts src/cli/commands/run-once/pipeline-progress-scenarios.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit the final-gate and progress regression coverage**

Run:

```sh
git add src/cli/commands/run-once/issue-todos.ts src/cli/commands/run-once/issue-todos.test.ts src/cli/commands/run-once/pipeline-landing.test.ts src/cli/commands/run-once/pipeline-progress-scenarios.test.ts
git commit -m "fix: treat complete todos as done in handoff gates"
```

Expected: one conventional commit containing the run-once reader, gate,
progress, and regression-test changes.

## Task 3: Pi invocation environment and prompt guidance

**Files:**

- Modify: `src/cli/commands/run-once/pi.ts`
- Modify: `src/cli/commands/run-once/pi.test.ts`
- Modify: `src/cli/commands/run-once/prompts.ts`
- Modify: `src/cli/commands/run-once/prompts.test.ts`

**Interfaces:**

- Consumes: `PI_TODO_DONE_STATUSES_ENV` and `serializeTodoDoneStatuses` from
  Task 1.
- Produces: Pi child processes receive the same resolved terminal vocabulary as
  Patchmill, and generated prompts tell agents to set finished task todos to
  `closed` while listing all accepted terminal statuses.

- [ ] **Step 1: Add failing Pi environment tests**

In `src/cli/commands/run-once/pi.test.ts`, extend
`runPiPrompt passes the configured todo root to Pi` or add a sibling test
asserting the env contains the serialized done statuses:

```ts
test("runPiPrompt passes resolved todo done statuses to Pi", async () => {
  const runner = createMockRunner((call) => {
    assert.equal(call.env?.PI_TODO_DONE_STATUSES, JSON.stringify(["shipped"]));
    return {
      code: 0,
      stdout: '{"status":"plan-created","planPath":"docs/plans/p.md"}',
      stderr: "",
    };
  });

  await runPiPrompt(runner, "/repo", "prompt", {
    stage: "pi-plan",
    taskContract: {
      ...DEFAULT_PI_TASK_CONTRACT,
      doneStatuses: [" Shipped ", "shipped"],
    },
  });
});
```

Also update `runPiPrompt passes the local Pi agent dir to Pi` to assert the
default env:

```ts
assert.equal(
  call.env?.PI_TODO_DONE_STATUSES,
  JSON.stringify(["closed", "completed", "complete", "done"]),
);
```

Run:

```sh
node --test src/cli/commands/run-once/pi.test.ts
```

Expected: fail because `PI_TODO_DONE_STATUSES` is not passed yet.

- [ ] **Step 2: Pass the resolved terminal vocabulary to Pi**

In `src/cli/commands/run-once/pi.ts`, import the helper:

```ts
import {
  PI_TODO_DONE_STATUSES_ENV,
  serializeTodoDoneStatuses,
} from "../../../policy/todo-statuses.ts";
```

Change the `piAgentCommandEnv` call to include both todo env values:

```ts
env: piAgentCommandEnv(options?.piAgentDir ?? localPiAgentDir(cwd), {
  PI_TODO_PATH:
    options?.taskContract?.todoRoot ?? DEFAULT_PI_TASK_CONTRACT.todoRoot,
  [PI_TODO_DONE_STATUSES_ENV]: serializeTodoDoneStatuses(
    options?.taskContract?.doneStatuses ??
      DEFAULT_PI_TASK_CONTRACT.doneStatuses,
  ),
}),
```

Run:

```sh
node --test src/cli/commands/run-once/pi.test.ts
```

Expected: pass.

- [ ] **Step 3: Add prompt tests for default and custom terminal statuses**

In `src/cli/commands/run-once/prompts.test.ts`, update implementation guidance
assertions so they expect wording like:

```ts
assert.match(
  prompt,
  /Set a task todo status to `closed` only after code, tests, review, fixes, and verification/,
);
assert.match(
  prompt,
  /This contract treats `closed`, `completed`, `complete`, and `done` as terminal/,
);
```

Add or update the custom task-contract prompt assertion near the existing custom
contract tests:

```ts
assert.match(prompt, /This contract treats `shipped` as terminal/);
assert.doesNotMatch(prompt, /`complete`, and `done` as terminal/);
```

Update plan-stage guidance assertions so the plan prompt names the status
vocabulary and says to set plan-related task todos to `closed` after the plan
commit:

```ts
assert.match(
  prompt,
  /After the plan document is committed, set the plan-related task todo status to `closed`/,
);
assert.match(
  prompt,
  /This contract treats `closed`, `completed`, `complete`, and `done` as terminal/,
);
```

Run:

```sh
node --test src/cli/commands/run-once/prompts.test.ts
```

Expected: fail until prompt rendering is updated.

- [ ] **Step 4: Render terminal statuses in prompt guidance**

In `src/cli/commands/run-once/prompts.ts`, add a helper near
`renderConjoinedList`:

```ts
function renderTerminalStatuses(taskContract: PatchmillPiTaskContract): string {
  return renderConjoinedList(
    taskContract.doneStatuses.map((status) => `\`${status}\``),
  );
}
```

Add a shared line in `renderTaskContractTodoWorkflowLines`:

```ts
const terminalStatusLine = `- This contract treats ${renderTerminalStatuses(taskContract)} as terminal.`;
```

For plan-stage lines, replace the ambiguous completion sentence with:

```ts
terminalStatusLine,
"- After the plan document is committed, set the plan-related task todo status to `closed` so they reflect the committed plan state.",
```

For implementation-stage lines, replace the ambiguous completion sentence with:

```ts
`- Set a task todo status to \`closed\` only after code, tests, review, fixes, and verification for that task are done.`,
terminalStatusLine,
```

- [ ] **Step 5: Run focused Pi and prompt tests**

Run:

```sh
node --test src/cli/commands/run-once/pi.test.ts src/cli/commands/run-once/prompts.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit Pi environment and prompt changes**

Run:

```sh
git add src/cli/commands/run-once/pi.ts src/cli/commands/run-once/pi.test.ts src/cli/commands/run-once/prompts.ts src/cli/commands/run-once/prompts.test.ts
git commit -m "fix: pass todo terminal statuses to pi"
```

Expected: one conventional commit containing only Pi invocation and prompt
guidance changes.

## Task 4: Bundled todo extension status vocabulary

**Files:**

- Modify: `extensions/todos.ts`
- Create: `test-support/todos-extension.test.ts`

**Interfaces:**

- Consumes: `parseTodoDoneStatusesEnv`, `todoStatusIsDone`, and
  `PI_TODO_DONE_STATUSES_ENV` from Task 1.
- Produces: the bundled Pi `todo` tool and `/todos` UI use the same active
  terminal-status vocabulary as Patchmill for grouping, sorting, assignment
  clearing, claim blocking, garbage collection, and schema guidance.

- [ ] **Step 1: Add a focused extension harness test**

Create `test-support/todos-extension.test.ts` with a minimal mock Pi extension
API. The test must register `extensions/todos.ts`, execute the registered `todo`
tool in a temporary cwd, create one `complete` todo and one `open` todo, call
`list-all`, and assert the `complete` todo is returned in the serialized
`closed` group and cannot be claimed.

Use this harness shape:

```ts
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import todosExtension from "../extensions/todos.ts";
import { PI_TODO_DONE_STATUSES_ENV } from "../src/policy/todo-statuses.ts";

type RegisteredTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    onUpdate: () => void,
    ctx: { cwd: string; sessionManager: { getSessionId: () => string } },
  ) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
};

function registerTodoTool(): RegisteredTool {
  let tool: RegisteredTool | undefined;
  todosExtension({
    on: () => undefined,
    registerCommand: () => undefined,
    registerTool: (registered: RegisteredTool) => {
      tool = registered;
    },
  } as never);
  assert.ok(tool);
  return tool;
}

test("todo extension groups complete todos as closed and blocks claims", async () => {
  const previous = process.env[PI_TODO_DONE_STATUSES_ENV];
  delete process.env[PI_TODO_DONE_STATUSES_ENV];
  try {
    const tool = registerTodoTool();
    const cwd = await mkdtemp(join(tmpdir(), "patchmill-todos-extension-"));
    await mkdir(join(cwd, ".pi", "todos"), { recursive: true });
    const ctx = { cwd, sessionManager: { getSessionId: () => "session-a" } };
    const signal = new AbortController().signal;

    const closedCreate = await tool.execute(
      "call-1",
      { action: "create", title: "finished", status: "complete" },
      signal,
      () => undefined,
      ctx,
    );
    await tool.execute(
      "call-2",
      { action: "create", title: "still open", status: "open" },
      signal,
      () => undefined,
      ctx,
    );
    const listed = await tool.execute(
      "call-3",
      { action: "list-all" },
      signal,
      () => undefined,
      ctx,
    );

    const closedTodo = JSON.parse(closedCreate.content[0].text) as {
      id: string;
    };
    const groups = JSON.parse(listed.content[0].text) as {
      open: Array<{ title: string }>;
      closed: Array<{ title: string }>;
    };
    assert.deepEqual(
      groups.closed.map((todo) => todo.title),
      ["finished"],
    );
    assert.deepEqual(
      groups.open.map((todo) => todo.title),
      ["still open"],
    );

    const claim = await tool.execute(
      "call-4",
      { action: "claim", id: closedTodo.id },
      signal,
      () => undefined,
      ctx,
    );
    assert.match(claim.content[0].text, /closed/);
  } finally {
    if (previous === undefined) delete process.env[PI_TODO_DONE_STATUSES_ENV];
    else process.env[PI_TODO_DONE_STATUSES_ENV] = previous;
  }
});
```

Run:

```sh
node --test test-support/todos-extension.test.ts
```

Expected: fail because `complete` is currently open in extension grouping.

- [ ] **Step 2: Resolve the active terminal vocabulary in the extension**

In `extensions/todos.ts`, import helpers from the shared source:

```ts
import {
  parseTodoDoneStatusesEnv,
  PI_TODO_DONE_STATUSES_ENV,
  todoStatusIsDone,
} from "../src/policy/todo-statuses.ts";
```

Add module-level active status helpers:

```ts
function activeTodoDoneStatuses(): string[] {
  return parseTodoDoneStatusesEnv(process.env[PI_TODO_DONE_STATUSES_ENV]);
}

function activeTodoStatusVocabulary(): string[] {
  const statuses = ["open", ...activeTodoDoneStatuses()];
  return statuses.filter((status, index) => statuses.indexOf(status) === index);
}
```

Replace `isTodoClosed` with:

```ts
function isTodoClosed(status: string): boolean {
  return todoStatusIsDone(status, activeTodoDoneStatuses());
}
```

- [ ] **Step 3: Constrain the status parameter schema and update tool guidance**

Replace the top-level static `TodoParams` with a function that builds parameters
at registration time:

```ts
function todoParams() {
  const statusVocabulary = activeTodoStatusVocabulary();
  return Type.Object({
    action: StringEnum([
      "list",
      "list-all",
      "get",
      "create",
      "update",
      "append",
      "delete",
      "claim",
      "release",
    ] as const),
    id: Type.Optional(
      Type.String({ description: "Todo id (TODO-<hex> or raw hex filename)" }),
    ),
    title: Type.Optional(
      Type.String({ description: "Short summary shown in lists" }),
    ),
    status: Type.Optional(
      StringEnum(statusVocabulary as [string, ...string[]], {
        description: `Todo status. Use open for unfinished work. Prefer closed when work is complete. Terminal statuses: ${activeTodoDoneStatuses().join(", ")}.`,
      }),
    ),
    tags: Type.Optional(Type.Array(Type.String({ description: "Todo tag" }))),
    body: Type.Optional(
      Type.String({
        description:
          "Long-form details (markdown). Update replaces; append adds.",
      }),
    ),
    force: Type.Optional(
      Type.Boolean({ description: "Override another session's assignment" }),
    ),
  });
}
```

Change registration to:

```ts
parameters: todoParams(),
```

Update the registered tool description to include:

```ts
`Prefer status \`closed\` when work is complete. Accepted terminal statuses: ${activeTodoDoneStatuses().join(", ")}.`;
```

- [ ] **Step 4: Verify extension behavior and add schema/custom-env assertions**

Extend `test-support/todos-extension.test.ts` with a second test that sets
`process.env.PI_TODO_DONE_STATUSES` to `JSON.stringify(["shipped"])`, registers
the tool, and asserts the description mentions `shipped` and a todo with status
`shipped` appears in the closed group.

Use this assertion shape:

```ts
assert.match(tool.description, /Accepted terminal statuses: shipped/);
```

Run:

```sh
node --test test-support/todos-extension.test.ts
```

Expected: pass.

- [ ] **Step 5: Search for stale hard-coded terminal checks**

Run:

```sh
rg '"closed", "done"|\["closed", "done"\]|status\.toLowerCase\(\)' extensions/todos.ts src
```

Expected: no stale todo terminal-status checks except tests that intentionally
assert old behavior is gone. If `status.toLowerCase()` appears for unrelated
display or non-terminal logic, verify it is not a todo completion check before
keeping it.

- [ ] **Step 6: Commit extension changes**

Run:

```sh
git add extensions/todos.ts test-support/todos-extension.test.ts
git commit -m "fix: align todo extension terminal statuses"
```

Expected: one conventional commit containing only extension status vocabulary
and tests.

## Task 5: Final validation and cleanup

**Files:**

- Read: `AGENTS.md`
- Read:
  `docs/specs/2026-07-23-issue-109-todo-status-is-accepted-but-fails-the-final-handoff-gate-design.md`
- Verify: all files changed by Tasks 1-4

**Interfaces:**

- Consumes: all code and tests from Tasks 1-4.
- Produces: final verification evidence that the todo tool, prompt guidance, UI
  grouping, progress tracking, and final handoff gate share one terminal-status
  vocabulary.

- [ ] **Step 1: Run narrow affected tests**

Run:

```sh
node --test src/policy/todo-statuses.test.ts src/policy/task-contract.test.ts src/policy/defaults.test.ts
node --test src/cli/commands/run-once/issue-todos.test.ts
node --test src/cli/commands/run-once/pi.test.ts src/cli/commands/run-once/prompts.test.ts
node --test src/cli/commands/run-once/pipeline-landing.test.ts src/cli/commands/run-once/pipeline-progress-scenarios.test.ts
node --test test-support/todos-extension.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run repository validation**

Run:

```sh
npm run lint
npm test
```

Expected: both pass. `npm run lint` includes Markdown formatting checks,
TypeScript linting for `src`, `bin`, and `test-support`, and Markdown linting.
`npm test` runs the repository Node test suite.

- [ ] **Step 3: Confirm dependency policy does not require Nix**

Run:

```sh
git diff --name-only HEAD~4..HEAD | rg '(^|/)(package\.json|package-lock\.json|npm-shrinkwrap\.json)$' || true
```

Expected: no output. If the command prints a dependency file, run the repository
Nix build before final handoff because `AGENTS.md` requires it when npm
dependencies change.

- [ ] **Step 4: Confirm shared vocabulary is used consistently**

Run:

```sh
rg '"closed", "completed", "done"|"closed", "done"|doneStatuses\.includes|status\.toLowerCase\(\)' src extensions test-support
```

Expected: no stale terminal-status implementation remains. Test fixtures may
still contain literal status examples; inspect any matches and ensure completion
logic goes through `todoStatusIsDone` or the extension `isTodoClosed` wrapper.

- [ ] **Step 5: Review final diff**

Run:

```sh
git status --short
git diff --stat HEAD~4..HEAD
git diff HEAD~4..HEAD -- src/policy src/cli/commands/run-once extensions/todos.ts test-support/todos-extension.test.ts
```

Expected: only issue #109 implementation files are changed, with no `.pi/todos`
files staged or committed.

- [ ] **Step 6: Commit final validation notes if code changed during
      validation**

If validation required code or test fixes, commit those fixes with:

```sh
git add <fixed-files>
git commit -m "fix: complete todo terminal status validation"
```

If no files changed during validation, do not create an empty commit.

- [ ] **Step 7: Prepare final handoff evidence**

Record the exact validation commands and pass/fail outcomes in the final
response. No npm dependency changes are expected, so the Nix build is not
required unless Step 3 printed a dependency file.
