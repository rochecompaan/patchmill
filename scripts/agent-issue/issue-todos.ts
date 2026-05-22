import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type IssueTodoSummary = {
  total: number;
  done: number;
  openTitles: string[];
};

export type IssueTodoProgress = {
  current: number;
  total: number;
  label?: string;
};

export type IssueTodoTask = {
  number: number;
  total: number;
  title: string;
  label: string;
  done: boolean;
};

function issueTaskPattern(issueNumber: number): RegExp {
  return new RegExp(`^issue-${issueNumber}-task-(\\d{2})-(.+)$`);
}

function labelFromSlug(slug: string): string {
  return slug.replaceAll("-", " ").trim();
}

function todoStatusDone(status: string | undefined): boolean {
  return status === "closed" || status === "completed" || status === "done";
}

export async function readIssueTodoSummary(
  repoRoot: string,
  issueNumber: number,
): Promise<IssueTodoSummary> {
  const tasks = await readIssueTodoTasks(repoRoot, issueNumber);
  return {
    total: tasks.length,
    done: tasks.filter((task) => task.done).length,
    openTitles: tasks.filter((task) => !task.done).map((task) => task.title),
  };
}

export async function readIssueTodoTasks(
  repoRoot: string,
  issueNumber: number,
): Promise<IssueTodoTask[]> {
  let entries;
  try {
    entries = await readdir(join(repoRoot, ".pi", "todos"), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const pattern = issueTaskPattern(issueNumber);
  const tasks: Array<Omit<IssueTodoTask, "total">> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const content = await readFile(join(repoRoot, ".pi", "todos", entry.name), "utf8");
    const headerEnd = content.indexOf("}\n");
    if (headerEnd < 0) continue;
    let header: { title?: string; status?: string };
    try {
      header = JSON.parse(content.slice(0, headerEnd + 1)) as { title?: string; status?: string };
    } catch {
      continue;
    }
    const match = header.title?.match(pattern);
    if (!match) continue;
    tasks.push({
      number: Number(match[1]),
      title: header.title,
      label: labelFromSlug(match[2] ?? "task"),
      done: todoStatusDone(header.status),
    });
  }

  const sorted = tasks.sort((left, right) => left.number - right.number);
  const total = sorted.length;
  return sorted.map((task) => ({ ...task, total }));
}

export async function issueTodoProgress(
  repoRoot: string,
  issueNumber: number,
): Promise<IssueTodoProgress | undefined> {
  const tasks = await readIssueTodoTasks(repoRoot, issueNumber);
  if (tasks.length === 0) return undefined;
  const currentTask = tasks.find((task) => !task.done) ?? tasks.at(-1);
  if (!currentTask) return undefined;
  return {
    current: currentTask.number,
    total: tasks.length,
    label: currentTask.label,
  };
}

export async function assertIssueTodosComplete(
  repoRoot: string,
  issueNumber: number,
): Promise<void> {
  const summary = await readIssueTodoSummary(repoRoot, issueNumber);
  if (summary.total === 0 || summary.openTitles.length === 0) return;

  throw new Error(
    `Issue task todos remain open (${summary.done}/${summary.total} complete): ${summary.openTitles.join(", ")}`,
  );
}
