import type { ChildLifecycleState } from "./subagent-progress.ts";
import type { RestoredClosedWorkflow } from "./subagent-progress-workflow-restore.ts";

export type Child = {
  keys: Set<string>;
  agentSeen: boolean;
  unresolved: boolean;
  lastState?: ChildLifecycleState;
};
export type DirectRun = {
  toolCallId: string;
  runId: string;
  children: Map<number, Child>;
  async: boolean;
};
export type WorkflowRun = { toolCallId: string; children: Map<string, Child> };

export type CorrelationState = {
  directRuns: Map<string, DirectRun>;
  directOrigins: Map<string, string>;
  directRunsByOrigin: Map<string, string>;
  workflowRuns: Map<string, WorkflowRun>;
  closedWorkflows: Map<string, RestoredClosedWorkflow>;
  workflowOrigins: Map<string, string>;
  workflowRunsByOrigin: Map<string, string>;
  tupleKeys: Set<string>;
  transitionCounts: Map<string, number>;
  activeChildren: number;
  activeKeys: number;
  sessionEntries: number;
};

const cloneChild = (child: Child): Child => ({
  keys: new Set(child.keys),
  agentSeen: child.agentSeen,
  unresolved: child.unresolved,
  ...(child.lastState ? { lastState: child.lastState } : {}),
});

/** Clones mutable correlation state for an event-level limit preflight. */
export function cloneCorrelationState(
  state: CorrelationState,
): CorrelationState {
  return {
    ...state,
    directRuns: new Map(
      [...state.directRuns].map(([key, run]) => [
        key,
        {
          ...run,
          children: new Map(
            [...run.children].map(([id, child]) => [id, cloneChild(child)]),
          ),
        },
      ]),
    ),
    directOrigins: new Map(state.directOrigins),
    directRunsByOrigin: new Map(state.directRunsByOrigin),
    workflowRuns: new Map(
      [...state.workflowRuns].map(([key, run]) => [
        key,
        {
          ...run,
          children: new Map(
            [...run.children].map(([id, child]) => [id, cloneChild(child)]),
          ),
        },
      ]),
    ),
    closedWorkflows: new Map(
      [...state.closedWorkflows].map(([key, closed]) => [
        key,
        new Map([...closed].map(([id, child]) => [id, { ...child }])),
      ]),
    ),
    workflowOrigins: new Map(state.workflowOrigins),
    workflowRunsByOrigin: new Map(state.workflowRunsByOrigin),
    tupleKeys: new Set(state.tupleKeys),
    transitionCounts: new Map(state.transitionCounts),
  };
}
