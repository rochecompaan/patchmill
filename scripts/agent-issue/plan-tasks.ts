import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export type PlanTaskLabel = {
  number: number;
  label: string;
};

function normalizeLabel(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function readPlanTaskLabels(
  repoRoot: string,
  planPath: string,
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
  const headingPattern = /^#{2,}\s+Task\s+(\d+)\s*:\s*(.+)$/gim;
  for (const match of content.matchAll(headingPattern)) {
    tasks.push({ number: Number(match[1]), label: normalizeLabel(match[2] ?? "task") });
  }
  return tasks.sort((left, right) => left.number - right.number);
}
