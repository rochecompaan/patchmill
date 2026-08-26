import {
  parsePersistedSubagentProgress,
  subagentProgressKey,
  SUBAGENT_PROGRESS_CUSTOM_TYPE,
  SUBAGENT_PROGRESS_LIMIT_ERROR,
  SUBAGENT_PROGRESS_LIMITS,
  type ChildLifecycleState,
  type PersistedSubagentProgress,
} from "./subagent-progress.ts";
import {
  recoverClosedWorkflow,
  type RestoredClosedWorkflow,
} from "./subagent-progress-workflow-restore.ts";

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
type DirectProgress = Extract<PersistedSubagentProgress, { kind: "direct" }>;
type WorkflowProgress = Extract<
  PersistedSubagentProgress,
  { kind: "workflow" }
>;

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

export const directRunKey = (toolCallId: string, runId: string): string =>
  JSON.stringify([toolCallId, runId]);
export const workflowRunKey = (toolCallId: string, runId: string): string =>
  JSON.stringify([toolCallId, runId]);
export const childProgressIdentity = (
  progress: PersistedSubagentProgress,
): string =>
  progress.kind === "direct"
    ? JSON.stringify([
        "direct",
        progress.toolCallId,
        progress.runId,
        progress.childIndex,
      ])
    : JSON.stringify([
        "workflow",
        progress.toolCallId,
        progress.workflowRunId,
        progress.childId,
      ]);
export const newCorrelationChild = (): Child => ({
  keys: new Set(),
  agentSeen: false,
  unresolved: false,
});

const failLimit = (): never => {
  throw new Error(SUBAGENT_PROGRESS_LIMIT_ERROR);
};
const isPersistedProgressEntry = (
  entry: unknown,
): entry is { type: string; customType: string; data: unknown } =>
  typeof entry === "object" &&
  entry !== null &&
  !Array.isArray(entry) &&
  (entry as Record<string, unknown>).type === "custom" &&
  (entry as Record<string, unknown>).customType ===
    SUBAGENT_PROGRESS_CUSTOM_TYPE;

/** Builds isolated bounded correlation state from durable custom entries. */
export function buildRestoredCorrelationState(
  entries: readonly unknown[],
): CorrelationState {
  const restoredDirectRuns = new Map<string, DirectRun>();
  const restoredDirectOrigins = new Map<string, string>();
  const restoredDirectRunsByOrigin = new Map<string, string>();
  const restoredWorkflowRuns = new Map<string, WorkflowRun>();
  const restoredClosedWorkflows = new Map<string, RestoredClosedWorkflow>();
  const restoredOrigins = new Map<string, string>();
  const restoredRunsByOrigin = new Map<string, string>();
  const restoredTupleKeys = new Set<string>();
  const restoredTransitionCounts = new Map<string, number>();
  let restoredEntries = 0;
  const valid: PersistedSubagentProgress[] = [];
  for (const entry of entries) {
    if (!isPersistedProgressEntry(entry)) continue;
    restoredEntries += 1;
    if (restoredEntries > SUBAGENT_PROGRESS_LIMITS.maxEntriesPerSession)
      failLimit();
    const progress = parsePersistedSubagentProgress(entry.data);
    if (!progress) continue;
    // Preserve every safe persisted occurrence for closure-order recovery.
    // Session-wide tuple deduplication and transition accounting remain
    // unique-key based, so a replacement seal with the same tuple can be
    // recognized in its later persisted position without double charging.
    valid.push(progress);
    const tuple = subagentProgressKey(progress);
    if (restoredTupleKeys.has(tuple)) continue;
    restoredTupleKeys.add(tuple);
    const identity = childProgressIdentity(progress);
    const count = (restoredTransitionCounts.get(identity) ?? 0) + 1;
    if (count > SUBAGENT_PROGRESS_LIMITS.maxTransitionsPerChild) failLimit();
    restoredTransitionCounts.set(identity, count);
  }
  const directGroups = new Map<string, DirectProgress[]>();
  const workflowGroups = new Map<string, WorkflowProgress[]>();
  for (const progress of valid) {
    if (progress.kind === "direct") {
      const key = directRunKey(progress.toolCallId, progress.runId);
      const group = directGroups.get(key);
      if (group) group.push(progress);
      else directGroups.set(key, [progress]);
      continue;
    }
    const key = workflowRunKey(progress.toolCallId, progress.workflowRunId);
    const group = workflowGroups.get(key);
    if (group) group.push(progress);
    else workflowGroups.set(key, [progress]);
  }
  const resumableDirectGroups = new Set<string>();
  for (const [key, group] of directGroups) {
    // Only the structured async-single launch identity can be resumed: it
    // always has child index zero and its launch transition is pending.
    if (
      group.every(
        (progress) =>
          progress.childIndex === 0 &&
          !progress.unresolved &&
          progress.agent === undefined,
      ) &&
      group.some((progress) => progress.state === "pending")
    )
      resumableDirectGroups.add(key);
  }
  const conflictedDirectRunIds = new Set<string>();
  const conflictedDirectOrigins = new Set<string>();
  for (const [key, group] of directGroups) {
    if (!resumableDirectGroups.has(key)) continue;
    const first = group[0]!;
    const origin = restoredDirectOrigins.get(first.runId);
    const runId = restoredDirectRunsByOrigin.get(first.toolCallId);
    if (origin !== undefined && origin !== first.toolCallId)
      conflictedDirectRunIds.add(first.runId);
    if (runId !== undefined && runId !== first.runId)
      conflictedDirectOrigins.add(first.toolCallId);
    restoredDirectOrigins.set(first.runId, first.toolCallId);
    restoredDirectRunsByOrigin.set(first.toolCallId, first.runId);
  }
  const workflowGroupsByRun = new Map<string, Set<string>>();
  const workflowGroupsByParent = new Map<string, Set<string>>();
  for (const [key, group] of workflowGroups) {
    const first = group[0]!;
    const add = (groups: Map<string, Set<string>>, id: string) => {
      const keys = groups.get(id) ?? new Set<string>();
      keys.add(key);
      groups.set(id, keys);
    };
    add(workflowGroupsByRun, first.workflowRunId);
    add(workflowGroupsByParent, first.toolCallId);
  }
  // Ownership is bijective. A conflict poisons every group on either side.
  const conflictedWorkflowGroups = new Set<string>();
  for (const groups of [
    ...workflowGroupsByRun.values(),
    ...workflowGroupsByParent.values(),
  ])
    if (groups.size > 1)
      for (const key of groups) conflictedWorkflowGroups.add(key);

  let restoredChildren = 0;
  let restoredKeys = 0;
  const hydrate = (child: Child, progress: PersistedSubagentProgress) => {
    child.keys.add(subagentProgressKey(progress));
    if (progress.agent !== undefined) child.agentSeen = true;
    if (progress.unresolved) child.unresolved = true;
    if (progress.state) child.lastState = progress.state;
  };
  for (const [key, group] of directGroups) {
    const first = group[0]!;
    if (
      !resumableDirectGroups.has(key) ||
      conflictedDirectRunIds.has(first.runId) ||
      conflictedDirectOrigins.has(first.toolCallId)
    )
      continue;
    if (
      restoredDirectRuns.size + restoredWorkflowRuns.size >=
      SUBAGENT_PROGRESS_LIMITS.maxActiveParents
    )
      failLimit();
    const run: DirectRun = {
      toolCallId: first.toolCallId,
      runId: first.runId,
      children: new Map(),
      async: true,
    };
    restoredDirectRuns.set(key, run);
    restoredDirectOrigins.set(first.runId, first.toolCallId);
    restoredDirectRunsByOrigin.set(first.toolCallId, first.runId);
    for (const progress of group) {
      let child = run.children.get(progress.childIndex);
      if (!child) {
        if (
          run.children.size >= SUBAGENT_PROGRESS_LIMITS.maxChildrenPerParent ||
          restoredChildren >= SUBAGENT_PROGRESS_LIMITS.maxActiveChildren
        )
          failLimit();
        child = newCorrelationChild();
        run.children.set(progress.childIndex, child);
        restoredChildren += 1;
      }
      hydrate(child, progress);
    }
  }
  for (const [key, group] of workflowGroups) {
    const first = group[0]!;
    if (conflictedWorkflowGroups.has(key)) continue;
    restoredOrigins.set(first.workflowRunId, first.toolCallId);
    restoredRunsByOrigin.set(first.toolCallId, first.workflowRunId);
    const byChild = new Map<
      string,
      Extract<PersistedSubagentProgress, { kind: "workflow" }>[]
    >();
    for (const progress of group) {
      const rows = byChild.get(progress.childId);
      if (rows) rows.push(progress);
      else byChild.set(progress.childId, [progress]);
    }
    const { closed, nonDurableSealKeys } = recoverClosedWorkflow(
      group as Extract<PersistedSubagentProgress, { kind: "workflow" }>[],
    );
    if (
      (closed?.size ?? byChild.size) >
      SUBAGENT_PROGRESS_LIMITS.maxChildrenPerParent
    )
      failLimit();
    for (const tuple of nonDurableSealKeys) {
      if (!restoredTupleKeys.delete(tuple)) continue;
      const seal = group.find(
        (progress) => subagentProgressKey(progress) === tuple,
      )!;
      const identity = childProgressIdentity(seal);
      const count = restoredTransitionCounts.get(identity)!;
      if (count === 1) restoredTransitionCounts.delete(identity);
      else restoredTransitionCounts.set(identity, count - 1);
    }
    if (closed) {
      restoredClosedWorkflows.set(key, closed);
      continue;
    }
    if (
      restoredDirectRuns.size + restoredWorkflowRuns.size >=
      SUBAGENT_PROGRESS_LIMITS.maxActiveParents
    )
      failLimit();
    const run: WorkflowRun = {
      toolCallId: first.toolCallId,
      children: new Map(),
    };
    restoredWorkflowRuns.set(key, run);
    for (const [id, rows] of byChild) {
      if (
        run.children.size >= SUBAGENT_PROGRESS_LIMITS.maxChildrenPerParent ||
        restoredChildren >= SUBAGENT_PROGRESS_LIMITS.maxActiveChildren
      )
        failLimit();
      const child = newCorrelationChild();
      run.children.set(id, child);
      restoredChildren += 1;
      for (const progress of rows)
        if (!nonDurableSealKeys.has(subagentProgressKey(progress)))
          hydrate(child, progress);
    }
  }
  for (const run of [
    ...restoredDirectRuns.values(),
    ...restoredWorkflowRuns.values(),
  ])
    for (const child of run.children.values()) restoredKeys += child.keys.size;
  if (restoredKeys > SUBAGENT_PROGRESS_LIMITS.maxActiveKeys) failLimit();

  return {
    directRuns: restoredDirectRuns,
    directOrigins: new Map(
      [...restoredDirectOrigins].filter(([runId, toolCallId]) =>
        restoredDirectRuns.has(directRunKey(toolCallId, runId)),
      ),
    ),
    directRunsByOrigin: new Map(
      [...restoredDirectRunsByOrigin].filter(([toolCallId, runId]) =>
        restoredDirectRuns.has(directRunKey(toolCallId, runId)),
      ),
    ),
    workflowRuns: restoredWorkflowRuns,
    closedWorkflows: restoredClosedWorkflows,
    workflowOrigins: restoredOrigins,
    workflowRunsByOrigin: restoredRunsByOrigin,
    tupleKeys: restoredTupleKeys,
    transitionCounts: restoredTransitionCounts,
    activeChildren: restoredChildren,
    activeKeys: restoredKeys,
    sessionEntries: restoredEntries,
  };
}

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
