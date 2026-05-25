import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertIssueTodosComplete,
  issueTodoProgress,
  readIssueTodoTasks,
} from "./issue-todos.ts";
import { DEFAULT_PI_TASK_CONTRACT } from "../../../policy/task-contract.ts";

async function writeTodo(
  repoRoot: string,
  id: string,
  title: string,
  status: string,
  tags?: string[],
): Promise<void> {
  const dir = join(repoRoot, ".pi", "todos");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${id}.md`),
    `${JSON.stringify({ id, title, status, tags })}\n\nbody\n`,
    "utf8",
  );
}

test("readIssueTodoTasks returns sorted implementation task labels", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "agent-issue-todos-"));
  await writeTodo(repoRoot, "b", "issue-19-task-02-dashboard-wiring", "open");
  await writeTodo(repoRoot, "a", "issue-19-task-01-date-range-model", "closed");
  await writeTodo(repoRoot, "other", "issue-20-task-01-ignore-me", "open");

  const tasks = await readIssueTodoTasks(repoRoot, 19);

  assert.deepEqual(tasks, [
    {
      number: 1,
      total: 2,
      title: "issue-19-task-01-date-range-model",
      label: "date range model",
      done: true,
    },
    {
      number: 2,
      total: 2,
      title: "issue-19-task-02-dashboard-wiring",
      label: "dashboard wiring",
      done: false,
    },
  ]);
});

test("issueTodoProgress includes the current task label", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "agent-issue-progress-"));
  await writeTodo(repoRoot, "a", "issue-19-task-01-date-range-model", "closed");
  await writeTodo(repoRoot, "b", "issue-19-task-02-dashboard-wiring", "open");

  assert.deepEqual(await issueTodoProgress(repoRoot, 19), {
    current: 2,
    total: 2,
    label: "dashboard wiring",
  });
});

test("issue todo readers accept a custom task contract", async () => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "agent-issue-custom-progress-"),
  );
  const contract = {
    ...DEFAULT_PI_TASK_CONTRACT,
    todoRoot: ".patchmill/todos",
    todoTitlePattern: "work-<number>-step-<two-digit-number>-<slug>",
    doneStatuses: ["shipped"],
    openTaskTodosBlockFinalHandoff: false,
  };
  await mkdir(join(repoRoot, ".patchmill", "todos"), { recursive: true });
  await writeFile(
    join(repoRoot, ".patchmill", "todos", "a.md"),
    `${JSON.stringify({ id: "a", title: "work-19-step-01-date-range-model", status: "shipped" })}\n\nbody\n`,
    "utf8",
  );
  await writeFile(
    join(repoRoot, ".patchmill", "todos", "b.md"),
    `${JSON.stringify({ id: "b", title: "work-19-step-02-dashboard-wiring", status: "started" })}\n\nbody\n`,
    "utf8",
  );

  assert.deepEqual(await readIssueTodoTasks(repoRoot, 19, contract), [
    {
      number: 1,
      total: 2,
      title: "work-19-step-01-date-range-model",
      label: "date range model",
      done: true,
    },
    {
      number: 2,
      total: 2,
      title: "work-19-step-02-dashboard-wiring",
      label: "dashboard wiring",
      done: false,
    },
  ]);
  assert.deepEqual(await issueTodoProgress(repoRoot, 19, contract), {
    current: 2,
    total: 2,
    label: "dashboard wiring",
  });
  await assertIssueTodosComplete(repoRoot, 19, contract);
});

test("readIssueTodoTasks supports reordered custom todo title placeholders", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "agent-issue-custom-order-"));
  const contract = {
    ...DEFAULT_PI_TASK_CONTRACT,
    todoTitlePattern: "issue-<number>-<slug>-task-<two-digit-number>",
  };
  await writeTodo(repoRoot, "a", "issue-19-date-range-model-task-01", "closed");
  await writeTodo(repoRoot, "b", "issue-19-dashboard-wiring-task-02", "open");

  assert.deepEqual(await readIssueTodoTasks(repoRoot, 19, contract), [
    {
      number: 1,
      total: 2,
      title: "issue-19-date-range-model-task-01",
      label: "date range model",
      done: true,
    },
    {
      number: 2,
      total: 2,
      title: "issue-19-dashboard-wiring-task-02",
      label: "dashboard wiring",
      done: false,
    },
  ]);
});

test("readIssueTodoTasks requires matching issue tags when the todo title omits the issue number", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "agent-issue-tag-filter-"));
  const contract = {
    ...DEFAULT_PI_TASK_CONTRACT,
    todoTitlePattern: "task-<two-digit-number>-<slug>",
  };

  await writeTodo(repoRoot, "a", "task-01-date-range-model", "closed", [
    "agent-issue",
    "issue-19",
  ]);
  await writeTodo(repoRoot, "b", "task-02-dashboard-wiring", "open", [
    "agent-issue",
    "issue-19",
  ]);
  await writeTodo(repoRoot, "c", "task-01-date-range-model", "open", [
    "agent-issue",
    "issue-20",
  ]);

  assert.deepEqual(await readIssueTodoTasks(repoRoot, 19, contract), [
    {
      number: 1,
      total: 2,
      title: "task-01-date-range-model",
      label: "date range model",
      done: true,
    },
    {
      number: 2,
      total: 2,
      title: "task-02-dashboard-wiring",
      label: "dashboard wiring",
      done: false,
    },
  ]);
  assert.deepEqual(await issueTodoProgress(repoRoot, 19, contract), {
    current: 2,
    total: 2,
    label: "dashboard wiring",
  });
});
