import type { Issue, PullRequest as HostPullRequest } from "../host/types.ts";
import { DEFAULT_CONFIG, type LabelsConfig } from "../config/config.ts";
import { isIssueBranch, planningBranchName } from "../kernel/names.ts";
import type { WorkflowStatus } from "../kernel/workflow-state.ts";
import type { RunObservation } from "./file-run-observations.ts";
import type {
  IssueSummary,
  PullRequest as WebPullRequest,
  DocumentLink,
  ColumnId,
  PhaseId,
} from "./api-types.ts";

export type AssociatedPullRequests = {
  pullRequests: readonly WebPullRequest[];
  branches: readonly string[];
};
export function associatePullRequests(input: {
  issue: number;
  candidates: readonly HostPullRequest[];
  observed: HostPullRequest | null;
  historical?: readonly HostPullRequest[];
  pushRepository: string;
  baseBranch: string;
}): AssociatedPullRequests {
  const candidates = [...input.candidates.filter((p) => p.state === "open")];
  for (const observed of [input.observed, ...(input.historical ?? [])]) {
    if (
      observed &&
      observed.state !== "open" &&
      !candidates.some((p) => p.number === observed.number)
    )
      candidates.push(observed);
  }
  const accepted = new Map<number, HostPullRequest>();
  for (const pr of candidates) {
    if (
      pr.headRepository?.toLowerCase() !== input.pushRepository.toLowerCase() ||
      pr.baseBranch !== input.baseBranch ||
      !isIssueBranch(input.issue, pr.headBranch)
    )
      continue;
    try {
      const url = new URL(pr.url);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        continue;
    } catch {
      continue;
    }
    accepted.set(pr.number, pr);
  }
  const prs = [...accepted.values()].sort((a, b) => a.number - b.number);
  return {
    branches: [...new Set(prs.map((p) => p.headBranch))],
    pullRequests: prs.map((pr) => {
      const kind =
        pr.headBranch === planningBranchName(input.issue, "spec")
          ? "spec"
          : pr.headBranch === planningBranchName(input.issue, "plan")
            ? "plan"
            : "implementation";
      return {
        number: pr.number,
        url: pr.url,
        state: pr.state,
        kind,
        label: `${kind === "spec" ? "Spec PR" : kind === "plan" ? "Plan PR" : "PR"} #${pr.number}`,
      };
    }),
  };
}

export function projectBoardIssue(input: {
  issue: Issue;
  roles: readonly WorkflowStatus[];
  run: RunObservation;
  pullRequests: readonly WebPullRequest[];
  documentLinks: readonly DocumentLink[];
  labels?: LabelsConfig;
}): IssueSummary | null {
  const { issue, roles, run, pullRequests, documentLinks } = input;
  if (roles.includes("unsuitable")) return null;
  const open = pullRequests.filter((pr) => pr.state === "open");
  let column: ColumnId = "triage";
  if (roles.includes("ready")) column = "ready";
  if (
    roles.includes("inProgress") ||
    (run.live && ["deriving", "planning"].includes(run.state ?? ""))
  )
    column = "planning";
  if (open.some((pr) => pr.kind !== "implementation")) column = "review";
  if (run.live && run.state === "implementation") column = "implementing";
  const paused = !run.live && !!run.paused;
  if (paused && run.phase === "implementation") column = "implementing";
  const done = roles.includes("done");
  if (done || open.some((pr) => pr.kind === "implementation")) column = "code";
  if (
    run.incomplete ||
    run.state === "blocked" ||
    run.outcomeRole === "needsInfo"
  )
    column = "blocked";
  let phase: PhaseId | null =
    run.live && run.state === "implementation"
      ? "implement"
      : run.live &&
          ["deriving", "planning"].includes(run.state ?? "") &&
          run.stage === "spec"
        ? "spec"
        : run.live &&
            ["deriving", "planning"].includes(run.state ?? "") &&
            run.stage === "plan"
          ? "plan"
          : null;
  if (column === "review")
    phase = open.some((pr) => pr.kind === "plan")
      ? "plan-review"
      : "spec-review";
  if (column === "code") phase = "code-review";
  const status =
    column === "blocked"
      ? "blocked"
      : done
        ? "done"
        : run.live
          ? ["planning", "implementation"].includes(run.state ?? "")
            ? "working"
            : "idle"
          : paused
            ? "paused"
            : "none";
  const names = input.labels ?? DEFAULT_CONFIG.labels;
  return {
    number: issue.number,
    title: issue.title,
    url: issue.url,
    column,
    status,
    live: run.live,
    terminal: run.live && run.interactive === false,
    phase,
    step:
      run.step ??
      (run.live
        ? run.state === "implementation"
          ? "Implementation"
          : run.state === "planning"
            ? "Planning"
            : null
        : null),
    elapsedSeconds: run.elapsedSeconds ?? null,
    blockedReason:
      column === "blocked"
        ? run.incomplete
          ? "Run ended before recording a result."
          : "The run needs attention."
        : null,
    labels: issue.labels.map((name) => ({
      name,
      tone:
        name === names.ready
          ? "ready"
          : name === names.needsInfo
            ? "info"
            : "neutral",
    })),
    pullRequests,
    documentLinks,
    artifacts: [],
  };
}
