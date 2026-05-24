import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  compileIssueTodoTitlePattern,
  DEFAULT_PI_TASK_CONTRACT,
  issueTodoStatusDone,
  renderIssueTodoTags,
  resolveTodoRoot,
  todoTitlePatternIncludesIssueNumber,
  type PatchmillPiTaskContract,
} from "../../src/policy/task-contract.ts";

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

function labelFromSlug(slug: string): string {
  return slug.replaceAll("-", " ").trim();
}

function readCapture(
  match: RegExpMatchArray,
  groupName: string,
  index: number,
): string | undefined {
  return match.groups?.[groupName] ?? match[index];
}

function readTodoTags(tags: unknown): string[] {
  return Array.isArray(tags)
    ? tags.filter((tag): tag is string => typeof tag === "string")
    : [];
}

export async function readIssueTodoSummary(
  repoRoot: string,
  issueNumber: number,
  taskContract: PatchmillPiTaskContract = DEFAULT_PI_TASK_CONTRACT,
): Promise<IssueTodoSummary> {
  const tasks = await readIssueTodoTasks(repoRoot, issueNumber, taskContract);
  return {
    total: tasks.length,
    done: tasks.filter((task) => task.done).length,
    openTitles: tasks.filter((task) => !task.done).map((task) => task.title),
  };
}

export async function readIssueTodoTasks(
  repoRoot: string,
  issueNumber: number,
  taskContract: PatchmillPiTaskContract = DEFAULT_PI_TASK_CONTRACT,
): Promise<IssueTodoTask[]> {
  const todoRoot = resolveTodoRoot(repoRoot, taskContract);
  const requireIssueTags = !todoTitlePatternIncludesIssueNumber(taskContract);
  const requiredIssueTags = requireIssueTags
    ? renderIssueTodoTags(taskContract, issueNumber)
    : [];
  let entries;
  try {
    entries = await readdir(todoRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const pattern = compileIssueTodoTitlePattern(taskContract, issueNumber);
  const tasks: Array<Omit<IssueTodoTask, "total">> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const content = await readFile(join(todoRoot, entry.name), "utf8");
    const headerEnd = content.indexOf("}\n");
    if (headerEnd < 0) continue;
    let header: { title?: string; status?: string; tags?: unknown };
    try {
      header = JSON.parse(content.slice(0, headerEnd + 1)) as {
        title?: string;
        status?: string;
        tags?: unknown;
      };
    } catch {
      continue;
    }
    if (requireIssueTags) {
      const headerTags = new Set(readTodoTags(header.tags));
      if (!requiredIssueTags.every((tag) => headerTags.has(tag))) continue;
    }
    const match = header.title?.match(pattern);
    if (!match) continue;
    const taskNumber = readCapture(match, "taskNumber", 1);
    if (!taskNumber) continue;
    tasks.push({
      number: Number(taskNumber),
      title: header.title,
      label: labelFromSlug(readCapture(match, "taskSlug", 2) ?? "task"),
      done: issueTodoStatusDone(taskContract, header.status),
    });
  }

  const sorted = tasks.sort((left, right) => left.number - right.number);
  const total = sorted.length;
  return sorted.map((task) => ({ ...task, total }));
}

export async function issueTodoProgress(
  repoRoot: string,
  issueNumber: number,
  taskContract: PatchmillPiTaskContract = DEFAULT_PI_TASK_CONTRACT,
): Promise<IssueTodoProgress | undefined> {
  const tasks = await readIssueTodoTasks(repoRoot, issueNumber, taskContract);
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
  taskContract: PatchmillPiTaskContract = DEFAULT_PI_TASK_CONTRACT,
): Promise<void> {
  if (!taskContract.openTaskTodosBlockFinalHandoff) return;

  const summary = await readIssueTodoSummary(
    repoRoot,
    issueNumber,
    taskContract,
  );
  if (summary.total === 0 || summary.openTitles.length === 0) return;

  throw new Error(
    `Issue task todos remain open (${summary.done}/${summary.total} complete): ${summary.openTitles.join(", ")}`,
  );
}
