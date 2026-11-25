import type { PatchmillConfig } from "../config/config.ts";
import { collectFacts } from "./facts.ts";
import { selectRunIssue } from "./issue-selection.ts";
import { sweepMergedIssues } from "./merged-cleanup-sweep.ts";
import type { RunOnceDeps } from "./run-once.ts";

export type InteractiveStart =
  | { kind: "ready"; issue: number }
  | { kind: "refused"; reason: string }
  | { kind: "none" }
  | { kind: "cancelled" };

/**
 * The checks that come before an interactive Issue run, in the terminal
 * console and in a Web session: sweep merged issues, sync, then select.
 */
export async function prepareInteractiveRun(input: {
  config: PatchmillConfig;
  deps: RunOnceDeps;
  issue?: number;
  report: (line: string) => void;
  signal?: AbortSignal;
  sweep?: typeof sweepMergedIssues;
}): Promise<InteractiveStart> {
  const { config, deps, report, signal } = input;
  await (input.sweep ?? sweepMergedIssues)({
    ...deps,
    config,
    report,
    ...(signal ? { signal } : {}),
  });
  if (signal?.aborted) return { kind: "cancelled" };
  await deps.workflow.sync(input.issue);
  const selection = await selectRunIssue({
    host: deps.host,
    workflow: deps.workflow,
    ...(input.issue !== undefined ? { issue: input.issue } : {}),
    readFacts: (issue) => collectFacts({ ...deps, config }, issue),
    warn: (issue, message) => report(`Warning: Issue #${issue}: ${message}`),
  });
  if (selection.kind === "refused")
    return { kind: "refused", reason: selection.reason };
  if (selection.kind === "none") return { kind: "none" };
  return { kind: "ready", issue: selection.issue.number };
}
