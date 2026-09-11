import { planLabelChange } from "../triage/labels.ts";
import type { RunOnceHostProvider } from "../../../host/types.ts";

function nextLabels(
  labels: readonly string[],
  remove: readonly string[],
  add: readonly string[],
): string[] {
  const excluded = new Set(remove);
  const next = labels.filter((label) => !excluded.has(label));
  for (const label of add) if (!next.includes(label)) next.push(label);
  return next;
}

export async function applyPlanningBlockedLabels(input: {
  host: Pick<RunOnceHostProvider, "viewIssue" | "applyLabels">;
  issueNumber: number;
  labels: { ready: string; inProgress: string; needsInfo: string };
}): Promise<void> {
  const current = await input.host.viewIssue(input.issueNumber);
  await input.host.applyLabels(
    planLabelChange(
      input.issueNumber,
      current.labels,
      nextLabels(
        current.labels,
        [input.labels.ready, input.labels.inProgress],
        [input.labels.needsInfo],
      ),
    ),
  );
}

export async function applyPlanningDoneLabels(input: {
  host: Pick<RunOnceHostProvider, "viewIssue" | "applyLabels">;
  issueNumber: number;
  labels: {
    ready: string;
    inProgress: string;
    needsInfo: string;
    done: string;
  };
}): Promise<void> {
  const current = await input.host.viewIssue(input.issueNumber);
  await input.host.applyLabels(
    planLabelChange(
      input.issueNumber,
      current.labels,
      nextLabels(
        current.labels,
        [input.labels.ready, input.labels.inProgress, input.labels.needsInfo],
        [input.labels.done],
      ),
    ),
  );
}
