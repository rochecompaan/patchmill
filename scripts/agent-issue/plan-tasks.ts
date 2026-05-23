import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  compilePlanTaskHeadingPattern,
  DEFAULT_PI_TASK_CONTRACT,
  type PatchmillPiTaskContract,
} from "../../src/policy/task-contract.ts";

export type PlanTaskLabel = {
  number: number;
  label: string;
};

function normalizeLabel(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function readCapture(match: RegExpMatchArray, groupName: string, index: number): string | undefined {
  return match.groups?.[groupName] ?? match[index];
}

export async function readPlanTaskLabels(
  repoRoot: string,
  planPath: string,
  taskContract: PatchmillPiTaskContract = DEFAULT_PI_TASK_CONTRACT,
): Promise<PlanTaskLabel[]> {
  const absolutePath = isAbsolute(planPath) ? planPath : join(repoRoot, planPath);
  let content: string;
  try {
    content = await readFile(absolutePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const tasks: PlanTaskLabel[] = [];
  const headingPattern = compilePlanTaskHeadingPattern(taskContract);
  for (const match of content.matchAll(headingPattern)) {
    const taskNumber = readCapture(match, "taskNumber", 1);
    if (!taskNumber) continue;
    tasks.push({
      number: Number(taskNumber),
      label: normalizeLabel(readCapture(match, "taskLabel", 2) ?? "task"),
    });
  }
  return tasks.sort((left, right) => left.number - right.number);
}
