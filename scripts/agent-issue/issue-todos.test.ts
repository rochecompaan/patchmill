import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { issueTodoProgress, readIssueTodoTasks } from "./issue-todos.ts";

async function writeTodo(repoRoot: string, id: string, title: string, status: string): Promise<void> {
  const dir = join(repoRoot, ".pi", "todos");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.md`), `${JSON.stringify({ id, title, status })}\n\nbody\n`, "utf8");
}

test("readIssueTodoTasks returns sorted implementation task labels", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "agent-issue-todos-"));
  await writeTodo(repoRoot, "b", "issue-19-task-02-dashboard-wiring", "open");
  await writeTodo(repoRoot, "a", "issue-19-task-01-date-range-model", "closed");
  await writeTodo(repoRoot, "other", "issue-20-task-01-ignore-me", "open");

  const tasks = await readIssueTodoTasks(repoRoot, 19);

  assert.deepEqual(tasks, [
    { number: 1, total: 2, title: "issue-19-task-01-date-range-model", label: "date range model", done: true },
    { number: 2, total: 2, title: "issue-19-task-02-dashboard-wiring", label: "dashboard wiring", done: false },
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
