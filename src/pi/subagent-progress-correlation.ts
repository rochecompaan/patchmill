import {
  parseDirectCompletionSnapshots,
  parseDirectSingleSnapshot,
  parsePersistedSubagentProgress,
  parseWorkflowChildSummaries,
  SUBAGENT_PROGRESS_CUSTOM_TYPE,
  SUBAGENT_PROGRESS_LIMIT_ERROR,
  SUBAGENT_PROGRESS_LIMITS,
  subagentProgressKey,
  type ChildLifecycleState,
  type PersistedSubagentProgress,
  type WorkflowChildSummaryV1,
} from "./subagent-progress.ts";

export const SUBAGENT_PROGRESS_APPEND_ERROR =
  "PATCHMILL_SUBAGENT_PROGRESS_APPEND_FAILED";

export type SubagentProgressCorrelationEvent = {
  phase: "update" | "end";
  toolName: string;
  toolCallId: string;
  result: unknown;
};

export type SubagentProgressCorrelator = {
  restore(entries: readonly unknown[]): void;
  observe(event: SubagentProgressCorrelationEvent): void;
};

type Child = {
  keys: Set<string>;
  agentSeen: boolean;
  unresolved: boolean;
  lastState?: ChildLifecycleState;
};
type DirectRun = {
  toolCallId: string;
  children: Map<number, Child>;
  async: boolean;
};
type WorkflowRun = {
  toolCallId: string;
  children: Map<string, Child>;
  closed: boolean;
};

function failLimit(): never {
  throw new Error(SUBAGENT_PROGRESS_LIMIT_ERROR);
}
function directKey(toolCallId: string, runId: string) {
  return JSON.stringify([toolCallId, runId]);
}
function workflowKey(toolCallId: string, runId: string) {
  return JSON.stringify([toolCallId, runId]);
}
function matchingEntry(
  entry: unknown,
): entry is { type: string; customType: string; data: unknown } {
  return (
    typeof entry === "object" &&
    entry !== null &&
    !Array.isArray(entry) &&
    (entry as Record<string, unknown>).type === "custom" &&
    (entry as Record<string, unknown>).customType ===
      SUBAGENT_PROGRESS_CUSTOM_TYPE
  );
}

/** Stateful bridge; it stores only the allowlisted persisted projection. */
export function createSubagentProgressCorrelator(options: {
  append(progress: PersistedSubagentProgress): void;
}): SubagentProgressCorrelator {
  const directRuns = new Map<string, DirectRun>();
  const workflowRuns = new Map<string, WorkflowRun>();
  const closedWorkflowChildren = new Map<
    string,
    Map<string, Pick<Child, "agentSeen" | "unresolved" | "lastState">>
  >();
  const tupleKeys = new Set<string>();
  let activeChildren = 0;
  let activeKeys = 0;
  let sessionEntries = 0;

  const append = (
    progress: PersistedSubagentProgress,
    child: Child,
  ): boolean => {
    const key = subagentProgressKey(progress);
    if (tupleKeys.has(key)) return false;
    if (
      child.keys.size >= SUBAGENT_PROGRESS_LIMITS.maxTransitionsPerChild ||
      activeKeys >= SUBAGENT_PROGRESS_LIMITS.maxActiveKeys ||
      sessionEntries >= SUBAGENT_PROGRESS_LIMITS.maxEntriesPerSession
    )
      failLimit();
    try {
      options.append(progress);
    } catch (cause) {
      throw new Error(SUBAGENT_PROGRESS_APPEND_ERROR, { cause });
    }
    tupleKeys.add(key);
    child.keys.add(key);
    activeKeys += 1;
    sessionEntries += 1;
    if (progress.agent) child.agentSeen = true;
    if (progress.unresolved) child.unresolved = true;
    if (progress.state) child.lastState = progress.state;
    return true;
  };

  const newChild = (): Child => ({
    keys: new Set(),
    agentSeen: false,
    unresolved: false,
  });
  const ensureDirect = (
    toolCallId: string,
    runId: string,
    index: number,
    async: boolean,
  ): { run: DirectRun; child: Child } => {
    const key = directKey(toolCallId, runId);
    let run = directRuns.get(key);
    if (!run) {
      if (
        directRuns.size + workflowRuns.size >=
        SUBAGENT_PROGRESS_LIMITS.maxActiveParents
      )
        failLimit();
      run = { toolCallId, children: new Map(), async };
      directRuns.set(key, run);
    }
    let child = run.children.get(index);
    if (!child) {
      if (
        run.children.size >= SUBAGENT_PROGRESS_LIMITS.maxChildrenPerParent ||
        activeChildren >= SUBAGENT_PROGRESS_LIMITS.maxActiveChildren
      )
        failLimit();
      child = newChild();
      run.children.set(index, child);
      activeChildren += 1;
    }
    return { run, child };
  };
  const ensureWorkflow = (
    summary: WorkflowChildSummaryV1,
    childId: string,
  ): { run: WorkflowRun; child: Child } | undefined => {
    const key = workflowKey(summary.parentToolCallId, summary.workflowRunId);
    const knownClosed = closedWorkflowChildren.get(key);
    if (
      knownClosed &&
      (!knownClosed.has(childId) ||
        knownClosed.size !== summary.children.length)
    )
      return undefined;
    let run = workflowRuns.get(key);
    if (!run) {
      if (
        workflowRuns.size + directRuns.size >=
        SUBAGENT_PROGRESS_LIMITS.maxActiveParents
      )
        failLimit();
      run = {
        toolCallId: summary.parentToolCallId,
        children: new Map(),
        closed: false,
      };
      workflowRuns.set(key, run);
    }
    let child = run.children.get(childId);
    if (!child) {
      if (
        run.children.size >= SUBAGENT_PROGRESS_LIMITS.maxChildrenPerParent ||
        activeChildren >= SUBAGENT_PROGRESS_LIMITS.maxActiveChildren
      )
        failLimit();
      const prior = knownClosed?.get(childId);
      child = {
        ...newChild(),
        ...(prior
          ? {
              agentSeen: prior.agentSeen,
              unresolved: prior.unresolved,
              ...(prior.lastState ? { lastState: prior.lastState } : {}),
            }
          : {}),
      };
      run.children.set(childId, child);
      activeChildren += 1;
    }
    return { run, child };
  };
  const releaseDirect = (key: string, run: DirectRun) => {
    for (const child of run.children.values()) {
      activeChildren -= 1;
      activeKeys -= child.keys.size;
    }
    directRuns.delete(key);
  };
  const releaseWorkflow = (key: string, run: WorkflowRun) => {
    closedWorkflowChildren.set(
      key,
      new Map(
        [...run.children].map(([childId, child]) => [
          childId,
          {
            agentSeen: child.agentSeen,
            unresolved: child.unresolved,
            ...(child.lastState ? { lastState: child.lastState } : {}),
          },
        ]),
      ),
    );
    for (const child of run.children.values()) {
      activeChildren -= 1;
      activeKeys -= child.keys.size;
    }
    workflowRuns.delete(key);
  };
  const fallbackDirect = (
    toolCallId: string,
    runId: string,
    index: number,
    child: Child,
  ) => {
    if (child.agentSeen || child.unresolved) return;
    append(
      {
        version: 1,
        kind: "direct",
        toolCallId,
        runId,
        childIndex: index,
        ...(child.lastState ? { state: child.lastState } : {}),
        unresolved: true,
      },
      child,
    );
  };

  const observeDirect = (event: SubagentProgressCorrelationEvent) => {
    const snapshot = parseDirectSingleSnapshot(event.result);
    if (snapshot) {
      if (snapshot.pendingAsyncSingle) {
        const { child } = ensureDirect(
          event.toolCallId,
          snapshot.runId,
          0,
          true,
        );
        append(
          {
            version: 1,
            kind: "direct",
            toolCallId: event.toolCallId,
            runId: snapshot.runId,
            childIndex: 0,
            state: "pending",
          },
          child,
        );
      } else {
        for (const row of snapshot.children) {
          const { child } = ensureDirect(
            event.toolCallId,
            snapshot.runId,
            row.childIndex,
            false,
          );
          const progress: PersistedSubagentProgress = {
            version: 1,
            kind: "direct",
            toolCallId: event.toolCallId,
            runId: snapshot.runId,
            childIndex: row.childIndex,
            ...(row.state ? { state: row.state } : {}),
            ...(row.agent ? { agent: row.agent } : {}),
            ...(row.model ? { model: row.model } : {}),
            ...(row.thinking ? { thinking: row.thinking } : {}),
          };
          append(progress, child);
        }
        if (event.phase === "end") {
          const key = directKey(event.toolCallId, snapshot.runId);
          const run = directRuns.get(key);
          if (run) {
            for (const [index, child] of run.children)
              fallbackDirect(event.toolCallId, snapshot.runId, index, child);
            releaseDirect(key, run);
          }
        }
      }
    }
    for (const completion of parseDirectCompletionSnapshots(event.result)) {
      for (const [key, run] of directRuns) {
        if (!run.async || key !== directKey(run.toolCallId, completion.runId))
          continue;
        const child = run.children.get(0);
        if (!child) continue;
        if (completion.state || completion.child) {
          const progress: PersistedSubagentProgress = {
            version: 1,
            kind: "direct",
            toolCallId: run.toolCallId,
            runId: completion.runId,
            childIndex: 0,
            ...(completion.state ? { state: completion.state } : {}),
            ...(completion.child?.agent
              ? { agent: completion.child.agent }
              : {}),
            ...(completion.child?.model
              ? { model: completion.child.model }
              : {}),
            ...(completion.child?.thinking
              ? { thinking: completion.child.thinking }
              : {}),
          };
          append(progress, child);
        }
        fallbackDirect(run.toolCallId, completion.runId, 0, child);
        releaseDirect(key, run);
      }
    }
  };

  const observeWorkflowSummary = (summary: WorkflowChildSummaryV1) => {
    const key = workflowKey(summary.parentToolCallId, summary.workflowRunId);
    const closedIds = closedWorkflowChildren.get(key);
    if (
      closedIds &&
      (closedIds.size !== summary.children.length ||
        summary.children.some((child) => !closedIds.has(child.childId)))
    )
      return;
    for (const row of summary.children) {
      const state = ensureWorkflow(summary, row.childId);
      if (!state) return;
      const progress: PersistedSubagentProgress = {
        version: 1,
        kind: "workflow",
        toolCallId: summary.parentToolCallId,
        workflowRunId: summary.workflowRunId,
        childId: row.childId,
        state: row.state,
        ...(row.agent ? { agent: row.agent } : {}),
        ...(row.model ? { model: row.model } : {}),
        ...(row.thinking ? { thinking: row.thinking } : {}),
      };
      append(progress, state.child);
    }
    const closes =
      summary.inventoryComplete ||
      summary.workflowState === "completed" ||
      summary.workflowState === "failed" ||
      summary.workflowState === "stopped";
    if (!closes) return;
    const run = workflowRuns.get(key);
    if (!run) return;
    for (const [childId, child] of run.children) {
      if (child.agentSeen || child.unresolved) continue;
      append(
        {
          version: 1,
          kind: "workflow",
          toolCallId: run.toolCallId,
          workflowRunId: summary.workflowRunId,
          childId,
          state: child.lastState ?? "pending",
          unresolved: true,
        },
        child,
      );
    }
    releaseWorkflow(key, run);
  };

  return {
    restore(entries) {
      directRuns.clear();
      workflowRuns.clear();
      closedWorkflowChildren.clear();
      tupleKeys.clear();
      activeChildren = 0;
      activeKeys = 0;
      sessionEntries = 0;
      for (const entry of entries) {
        if (!matchingEntry(entry)) continue;
        sessionEntries += 1;
        if (sessionEntries > SUBAGENT_PROGRESS_LIMITS.maxEntriesPerSession)
          failLimit();
        const progress = parsePersistedSubagentProgress(entry.data);
        if (!progress) continue;
        const key = subagentProgressKey(progress);
        tupleKeys.add(key);
        if (progress.kind === "direct") {
          const { child } = ensureDirect(
            progress.toolCallId,
            progress.runId,
            progress.childIndex,
            true,
          );
          child.keys.add(key);
          child.agentSeen ||= progress.agent !== undefined;
          child.unresolved ||= progress.unresolved === true;
          child.lastState = progress.state ?? child.lastState;
          activeKeys += 1;
        } else {
          const summary = {
            version: 1 as const,
            parentToolCallId: progress.toolCallId,
            workflowRunId: progress.workflowRunId,
            inventoryComplete: false,
            workflowState: "running" as const,
            children: [{ childId: progress.childId, state: progress.state }],
          };
          const state = ensureWorkflow(summary, progress.childId);
          if (!state) continue;
          state.child.keys.add(key);
          state.child.agentSeen ||= progress.agent !== undefined;
          state.child.unresolved ||= progress.unresolved === true;
          state.child.lastState = progress.state;
          activeKeys += 1;
        }
      }
    },
    observe(event) {
      if (
        (event.toolName !== "subagent" && event.toolName !== "subagent_wait") ||
        typeof event.toolCallId !== "string"
      )
        return;
      observeDirect(event);
      for (const summary of parseWorkflowChildSummaries(event.result))
        observeWorkflowSummary(summary);
    },
  };
}
