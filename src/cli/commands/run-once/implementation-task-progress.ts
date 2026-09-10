import { issueTodoProgress, readIssueTodoTasks } from "./issue-todos.ts";
import { readPlanTaskLabels } from "./plan-tasks.ts";
import type { AgentIssueProgressEvent } from "./progress.ts";
import type { PatchmillPiTaskContract } from "../../../policy/task-contract.ts";

export type ImplementationTaskProgressInput = {
  repoRoot: string;
  worktreeRoot: string;
  issueNumber: number;
  planPath: string;
  taskContract: PatchmillPiTaskContract;
  stepStart: (label: string) => Promise<void>;
  stepComplete: (label: string) => Promise<void>;
};

export type ImplementationTaskProgress = {
  start: () => Promise<void>;
  observe: (
    observation: AgentIssueProgressEvent["observation"],
  ) => Promise<void>;
  update: (progress: {
    current: number;
    total: number;
    label?: string;
  }) => Promise<void>;
  finish: () => Promise<void>;
};

/** Tracks Pi's dynamic implementation tasks without retaining workflow state. */
export async function createImplementationTaskProgress(
  input: ImplementationTaskProgressInput,
): Promise<ImplementationTaskProgress> {
  const labels = await readPlanTaskLabels(
    input.repoRoot,
    input.planPath,
    input.taskContract,
  );
  let active: { current: number; total: number; label: string } | undefined;
  let finalActive = false;
  const finalLabel = "final review and landing";
  const labelFor = (current: number, runtimeLabel?: string) =>
    labels.find((task) => task.number === current)?.label ??
    runtimeLabel ??
    `task ${current}`;
  const update = async (progress: {
    current: number;
    total: number;
    label?: string;
  }): Promise<void> => {
    const current =
      labels.length === 0
        ? progress.current
        : Math.min(Math.max(progress.current, 1), labels.length);
    const total = labels.length === 0 ? progress.total : labels.length;
    const label = labelFor(current, progress.label);
    if (
      finalActive ||
      (active?.current === current &&
        active.total === total &&
        active.label === label)
    )
      return;
    if (active)
      await input.stepComplete(
        `implement task ${active.current}/${active.total} ${active.label}`,
      );
    active = { current, total, label };
    await input.stepStart(`implement task ${current}/${total} ${label}`);
  };
  const tasksComplete = async () => {
    const tasks = await readIssueTodoTasks(
      input.worktreeRoot,
      input.issueNumber,
      input.taskContract,
    );
    return tasks.length > 0 && tasks.every((task) => task.done);
  };
  const startFinal = async () => {
    if (finalActive) return;
    if (active)
      await input.stepComplete(
        `implement task ${active.current}/${active.total} ${active.label}`,
      );
    active = undefined;
    finalActive = true;
    await input.stepStart(finalLabel);
  };
  const refresh = async (startFinalWhenComplete = false) => {
    if (startFinalWhenComplete && (await tasksComplete())) return startFinal();
    const progress = await issueTodoProgress(
      input.worktreeRoot,
      input.issueNumber,
      input.taskContract,
    );
    if (progress) await update(progress);
  };
  return {
    start: async () => {
      if (labels.length > 0)
        await update({
          current: 1,
          total: labels.length,
          ...(labels[0]?.label === undefined ? {} : { label: labels[0].label }),
        });
    },
    observe: async (observation) => {
      if (
        observation?.type === "tool-call" ||
        observation?.type === "subagent-progress"
      )
        await refresh(true);
    },
    update,
    finish: async () => {
      await refresh();
      if (active)
        await input.stepComplete(
          `implement task ${active.current}/${active.total} ${active.label}`,
        );
      active = undefined;
      if (finalActive) await input.stepComplete(finalLabel);
      finalActive = false;
    },
  };
}
