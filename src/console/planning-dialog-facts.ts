import fs from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { PhaseLaunch } from "../kernel/launch.ts";
import { worktreeArtifacts } from "../kernel/artifact-source.ts";
import { createKernelGit } from "../kernel/git.ts";
import { CommandFailedError, runCommand } from "../process/command.ts";
import type { PlanningDialogFacts } from "./planning-dialog.ts";

/** Observe the committed worktree at submission, not the pre-planning paths. */
export async function collectPlanningDialogFacts(
  launch: PhaseLaunch,
): Promise<PlanningDialogFacts | undefined> {
  const review = launch.planningReview;
  if (!review) return undefined;
  const source = worktreeArtifacts(
    createKernelGit(runCommand, launch.worktree),
    launch.worktree,
    review.issue.number,
  );
  const [specPath, planPath, head] = await Promise.all([
    source.find(review.specsDir, "spec"),
    source.find(review.plansDir, "plan"),
    runCommand("git", ["rev-parse", "--short", "HEAD"], {
      cwd: launch.worktree,
    }),
  ]);
  if (head.code !== 0)
    throw new CommandFailedError("git", ["rev-parse", "--short", "HEAD"], head);
  const mockupPath = specPath
    ? await linkedMockup(launch.worktree, specPath)
    : undefined;
  return {
    issue: review.issue,
    stage: review.stage,
    branch: review.branch,
    commit: head.stdout.trim(),
    specPath,
    planPath,
    mockupPath,
    ...(review.earlierStage ? { earlierStage: review.earlierStage } : {}),
  };
}

async function linkedMockup(
  worktree: string,
  spec: string,
): Promise<string | undefined> {
  const content = await fs.readFile(resolve(worktree, spec), "utf8");
  const root = await fs.realpath(worktree);
  for (const match of content.matchAll(/\]\(([^\s)]+\.html?)\)/g)) {
    const target = match[1]!;
    if (isAbsolute(target) || /^[a-z]+:/i.test(target)) continue;
    try {
      const path = await fs.realpath(resolve(worktree, dirname(spec), target));
      const delta = relative(root, path);
      if (delta === ".." || delta.startsWith(`..${sep}`) || isAbsolute(delta))
        continue;
      if ((await fs.stat(path)).isFile()) return delta;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return undefined;
}
