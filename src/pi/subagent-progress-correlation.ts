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
type WorkflowRun = { toolCallId: string; children: Map<string, Child> };
type ClosedWorkflow = Map<
  string,
  Pick<Child, "agentSeen" | "unresolved" | "lastState">
>;

function failLimit(): never {
  throw new Error(SUBAGENT_PROGRESS_LIMIT_ERROR);
}
function directKey(toolCallId: string, runId: string): string {
  return JSON.stringify([toolCallId, runId]);
}
function workflowKey(toolCallId: string, runId: string): string {
  return JSON.stringify([toolCallId, runId]);
}
function childKey(progress: PersistedSubagentProgress): string {
  return progress.kind === "direct"
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
}
function terminal(state: ChildLifecycleState | undefined): boolean {
  return (
    state === "completed" ||
    state === "failed" ||
    state === "stopped" ||
    state === "rejected" ||
    state === "detached"
  );
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

/** Correlates only the bounded persisted projection; raw upstream rows never escape this module. */
export function createSubagentProgressCorrelator(options: {
  append(progress: PersistedSubagentProgress): void;
}): SubagentProgressCorrelator {
  const directRuns = new Map<string, DirectRun>();
  const workflowRuns = new Map<string, WorkflowRun>();
  const closedWorkflows = new Map<string, ClosedWorkflow>();
  const workflowOrigins = new Map<string, string>();
  const tupleKeys = new Set<string>();
  const transitionCounts = new Map<string, number>();
  let activeChildren = 0;
  let activeKeys = 0;
  let sessionEntries = 0;

  const newChild = (): Child => ({
    keys: new Set(),
    agentSeen: false,
    unresolved: false,
  });
  const updateChild = (
    child: Child,
    progress: PersistedSubagentProgress,
    key: string,
    active: boolean,
  ) => {
    child.keys.add(key);
    if (progress.agent) child.agentSeen = true;
    if (progress.unresolved) child.unresolved = true;
    if (progress.state) child.lastState = progress.state;
    if (active) activeKeys += 1;
  };

  const preflight = (
    progresses: readonly PersistedSubagentProgress[],
    children: readonly Child[],
    newParents: number,
    newChildren: number,
  ): void => {
    const newKeys = new Set<string>();
    const increments = new Map<string, number>();
    for (const progress of progresses) {
      const key = subagentProgressKey(progress);
      if (tupleKeys.has(key) || newKeys.has(key)) continue;
      newKeys.add(key);
      const identity = childKey(progress);
      increments.set(identity, (increments.get(identity) ?? 0) + 1);
    }
    if (
      directRuns.size + workflowRuns.size + newParents >
        SUBAGENT_PROGRESS_LIMITS.maxActiveParents ||
      activeChildren + newChildren >
        SUBAGENT_PROGRESS_LIMITS.maxActiveChildren ||
      activeKeys + newKeys.size > SUBAGENT_PROGRESS_LIMITS.maxActiveKeys ||
      sessionEntries + newKeys.size >
        SUBAGENT_PROGRESS_LIMITS.maxEntriesPerSession
    )
      failLimit();
    // Per-child ceilings are keyed by the persisted identity below. Do not
    // charge every summary row to every existing child.
    void children;
    for (const [identity, additions] of increments) {
      if (
        (transitionCounts.get(identity) ?? 0) + additions >
        SUBAGENT_PROGRESS_LIMITS.maxTransitionsPerChild
      )
        failLimit();
    }
  };

  const append = (
    progress: PersistedSubagentProgress,
    child: Child,
    active = true,
  ): boolean => {
    const key = subagentProgressKey(progress);
    if (tupleKeys.has(key)) return false;
    try {
      options.append(progress);
    } catch (cause) {
      throw new Error(SUBAGENT_PROGRESS_APPEND_ERROR, { cause });
    }
    tupleKeys.add(key);
    sessionEntries += 1;
    transitionCounts.set(
      childKey(progress),
      (transitionCounts.get(childKey(progress)) ?? 0) + 1,
    );
    updateChild(child, progress, key, active);
    return true;
  };

  const ensureDirect = (
    toolCallId: string,
    runId: string,
    index: number,
    async: boolean,
  ): { run: DirectRun; child: Child } => {
    const key = directKey(toolCallId, runId);
    let run = directRuns.get(key);
    if (!run) {
      run = { toolCallId, children: new Map(), async };
      directRuns.set(key, run);
    }
    let child = run.children.get(index);
    if (!child) {
      child = newChild();
      run.children.set(index, child);
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
    closedWorkflows.set(
      key,
      new Map(
        [...run.children].map(([id, child]) => [
          id,
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
      const key = directKey(event.toolCallId, snapshot.runId);
      const existing = directRuns.get(key);
      const rows = snapshot.pendingAsyncSingle
        ? [{ childIndex: 0, state: "pending" as const }]
        : snapshot.children;
      const newParent = existing ? 0 : 1;
      const newChildren = rows.filter(
        (row) => !existing?.children.has(row.childIndex),
      ).length;
      if (
        (existing?.children.size ?? 0) + newChildren >
        SUBAGENT_PROGRESS_LIMITS.maxChildrenPerParent
      )
        failLimit();
      const previews = rows.map(
        (row): PersistedSubagentProgress => ({
          version: 1,
          kind: "direct",
          toolCallId: event.toolCallId,
          runId: snapshot.runId,
          childIndex: row.childIndex,
          ...(row.state ? { state: row.state } : {}),
          ...(row.agent ? { agent: row.agent } : {}),
          ...(row.model ? { model: row.model } : {}),
          ...(row.thinking ? { thinking: row.thinking } : {}),
        }),
      );
      const children = rows.flatMap((row) =>
        existing?.children.get(row.childIndex)
          ? [existing.children.get(row.childIndex)!]
          : [],
      );
      preflight(previews, children, newParent, newChildren);
      for (const progress of previews) {
        const { child } = ensureDirect(
          event.toolCallId,
          snapshot.runId,
          progress.childIndex,
          snapshot.pendingAsyncSingle,
        );
        append(progress, child);
      }
      if (!snapshot.pendingAsyncSingle && event.phase === "end") {
        const run = directRuns.get(key);
        if (run) {
          const fallbacks = [...run.children]
            .filter(([, child]) => !child.agentSeen && !child.unresolved)
            .map(([index, child]) => ({ index, child }));
          preflight(
            fallbacks.map(({ index, child }) => ({
              version: 1,
              kind: "direct",
              toolCallId: event.toolCallId,
              runId: snapshot.runId,
              childIndex: index,
              ...(child.lastState ? { state: child.lastState } : {}),
              unresolved: true,
            })),
            fallbacks.map(({ child }) => child),
            0,
            0,
          );
          for (const { index, child } of fallbacks)
            fallbackDirect(event.toolCallId, snapshot.runId, index, child);
          releaseDirect(key, run);
        }
      }
    }
    for (const completion of parseDirectCompletionSnapshots(event.result)) {
      for (const [key, run] of directRuns) {
        if (!run.async || key !== directKey(run.toolCallId, completion.runId))
          continue;
        const child = run.children.get(0);
        if (!child) continue;
        const progress: PersistedSubagentProgress | undefined =
          completion.state || completion.child
            ? {
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
              }
            : undefined;
        const fallback =
          !child.agentSeen &&
          !child.unresolved &&
          completion.child?.agent === undefined;
        preflight(
          [
            ...(progress ? [progress] : []),
            ...(fallback
              ? [
                  {
                    version: 1,
                    kind: "direct" as const,
                    toolCallId: run.toolCallId,
                    runId: completion.runId,
                    childIndex: 0,
                    ...(completion.state ? { state: completion.state } : {}),
                    unresolved: true as const,
                  },
                ]
              : []),
          ],
          [child],
          0,
          0,
        );
        if (progress) append(progress, child);
        fallbackDirect(run.toolCallId, completion.runId, 0, child);
        releaseDirect(key, run);
      }
    }
  };

  const observeWorkflow = (
    summary: WorkflowChildSummaryV1,
    event: SubagentProgressCorrelationEvent,
  ) => {
    const key = workflowKey(summary.parentToolCallId, summary.workflowRunId);
    const origin = workflowOrigins.get(summary.workflowRunId);
    if (event.toolName === "subagent") {
      if (
        summary.parentToolCallId !== event.toolCallId ||
        (origin && origin !== event.toolCallId)
      )
        return;
    } else if (origin !== summary.parentToolCallId) return;
    const closed = closedWorkflows.get(key);
    if (closed) {
      const sameChildren =
        closed.size === summary.children.length &&
        summary.children.every((child) => closed.has(child.childId));
      if (
        !sameChildren ||
        (!summary.inventoryComplete &&
          !["completed", "failed", "stopped"].includes(summary.workflowState))
      )
        return;
      for (const row of summary.children) {
        const prior = closed.get(row.childId)!;
        const child: Child = {
          keys: new Set(),
          agentSeen: prior.agentSeen,
          unresolved: prior.unresolved,
          ...(prior.lastState ? { lastState: prior.lastState } : {}),
        };
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
        preflight([progress], [], 0, 0);
        if (append(progress, child, false)) {
          closed.set(row.childId, {
            agentSeen: child.agentSeen,
            unresolved: child.unresolved,
            ...(child.lastState ? { lastState: child.lastState } : {}),
          });
        }
      }
      return;
    }
    const existing = workflowRuns.get(key);
    const newParent = existing ? 0 : 1;
    if (
      existing &&
      [...existing.children.keys()].some(
        (childId) =>
          !summary.children.some((child) => child.childId === childId),
      )
    )
      return;
    const newRows = summary.children.filter(
      (row) => !existing?.children.has(row.childId),
    );
    if (
      (existing?.children.size ?? 0) + newRows.length >
      SUBAGENT_PROGRESS_LIMITS.maxChildrenPerParent
    )
      failLimit();
    const previews = summary.children.map(
      (row): PersistedSubagentProgress => ({
        version: 1,
        kind: "workflow",
        toolCallId: summary.parentToolCallId,
        workflowRunId: summary.workflowRunId,
        childId: row.childId,
        state: row.state,
        ...(row.agent ? { agent: row.agent } : {}),
        ...(row.model ? { model: row.model } : {}),
        ...(row.thinking ? { thinking: row.thinking } : {}),
      }),
    );
    const knownChildren = summary.children.flatMap((row) =>
      existing?.children.get(row.childId)
        ? [existing.children.get(row.childId)!]
        : [],
    );
    const closes =
      summary.inventoryComplete ||
      ["completed", "failed", "stopped"].includes(summary.workflowState);
    const fallbackRows = closes
      ? summary.children
          .filter(
            (row) =>
              !(existing?.children.get(row.childId)?.agentSeen || row.agent),
          )
          .map(
            (row): PersistedSubagentProgress => ({
              version: 1,
              kind: "workflow",
              toolCallId: summary.parentToolCallId,
              workflowRunId: summary.workflowRunId,
              childId: row.childId,
              state: row.state,
              unresolved: true,
            }),
          )
      : [];
    preflight(
      [...previews, ...fallbackRows],
      knownChildren,
      newParent,
      newRows.length,
    );
    workflowOrigins.set(summary.workflowRunId, summary.parentToolCallId);
    let run = existing;
    if (!run) {
      run = { toolCallId: summary.parentToolCallId, children: new Map() };
      workflowRuns.set(key, run);
    }
    for (const progress of previews) {
      let child = run.children.get(progress.childId);
      if (!child) {
        child = newChild();
        run.children.set(progress.childId, child);
        activeChildren += 1;
      }
      append(progress, child);
    }
    if (!closes) return;
    for (const progress of fallbackRows) {
      const child = run.children.get(progress.childId);
      if (child && !child.agentSeen && !child.unresolved)
        append(progress, child);
    }
    releaseWorkflow(key, run);
  };

  return {
    restore(entries) {
      directRuns.clear();
      workflowRuns.clear();
      closedWorkflows.clear();
      workflowOrigins.clear();
      tupleKeys.clear();
      transitionCounts.clear();
      activeChildren = 0;
      activeKeys = 0;
      sessionEntries = 0;
      const valid: PersistedSubagentProgress[] = [];
      for (const entry of entries) {
        if (!matchingEntry(entry)) continue;
        sessionEntries += 1;
        if (sessionEntries > SUBAGENT_PROGRESS_LIMITS.maxEntriesPerSession)
          failLimit();
        const progress = parsePersistedSubagentProgress(entry.data);
        if (!progress) continue;
        const tuple = subagentProgressKey(progress);
        if (tupleKeys.has(tuple)) continue;
        tupleKeys.add(tuple);
        transitionCounts.set(
          childKey(progress),
          (transitionCounts.get(childKey(progress)) ?? 0) + 1,
        );
        valid.push(progress);
      }
      const directGroups = new Map<string, PersistedSubagentProgress[]>();
      const workflowGroups = new Map<string, PersistedSubagentProgress[]>();
      for (const progress of valid) {
        const groups =
          progress.kind === "direct" ? directGroups : workflowGroups;
        const key =
          progress.kind === "direct"
            ? directKey(progress.toolCallId, progress.runId)
            : workflowKey(progress.toolCallId, progress.workflowRunId);
        groups.set(key, [...(groups.get(key) ?? []), progress]);
      }
      for (const [key, group] of directGroups) {
        // Persisted direct history has no surface marker. Only the documented
        // pending async identity is safely resumable; paused/end snapshots are
        // historical terminal observations.
        if (
          group.some(
            (progress) =>
              progress.unresolved ||
              progress.state !== "pending" ||
              progress.agent !== undefined,
          )
        )
          continue;
        const first = group[0] as Extract<
          PersistedSubagentProgress,
          { kind: "direct" }
        >;
        if (
          directRuns.size + workflowRuns.size >=
          SUBAGENT_PROGRESS_LIMITS.maxActiveParents
        )
          failLimit();
        const run: DirectRun = {
          toolCallId: first.toolCallId,
          children: new Map(),
          async: true,
        };
        directRuns.set(key, run);
        for (const progress of group as Extract<
          PersistedSubagentProgress,
          { kind: "direct" }
        >[]) {
          let child = run.children.get(progress.childIndex);
          if (!child) {
            if (
              run.children.size >=
                SUBAGENT_PROGRESS_LIMITS.maxChildrenPerParent ||
              activeChildren >= SUBAGENT_PROGRESS_LIMITS.maxActiveChildren
            )
              failLimit();
            child = newChild();
            run.children.set(progress.childIndex, child);
            activeChildren += 1;
          }
          updateChild(child, progress, subagentProgressKey(progress), true);
        }
      }
      for (const [key, group] of workflowGroups) {
        const first = group[0] as Extract<
          PersistedSubagentProgress,
          { kind: "workflow" }
        >;
        workflowOrigins.set(first.workflowRunId, first.toolCallId);
        const byChild = new Map<
          string,
          Extract<PersistedSubagentProgress, { kind: "workflow" }>[]
        >();
        for (const progress of group as Extract<
          PersistedSubagentProgress,
          { kind: "workflow" }
        >[])
          byChild.set(progress.childId, [
            ...(byChild.get(progress.childId) ?? []),
            progress,
          ]);
        const closed =
          group.some((progress) => progress.unresolved) ||
          [...byChild.values()].every(
            (rows) =>
              rows.some((progress) => progress.agent) &&
              terminal(rows.at(-1)?.state),
          );
        if (closed) {
          closedWorkflows.set(
            key,
            new Map(
              [...byChild].map(([id, rows]) => {
                const last = rows.at(-1)!;
                return [
                  id,
                  {
                    agentSeen: rows.some(
                      (progress) => progress.agent !== undefined,
                    ),
                    unresolved: rows.some((progress) => progress.unresolved),
                    ...(last.state ? { lastState: last.state } : {}),
                  },
                ];
              }),
            ),
          );
          continue;
        }
        if (
          directRuns.size + workflowRuns.size >=
          SUBAGENT_PROGRESS_LIMITS.maxActiveParents
        )
          failLimit();
        const run: WorkflowRun = {
          toolCallId: first.toolCallId,
          children: new Map(),
        };
        workflowRuns.set(key, run);
        for (const [id, rows] of byChild) {
          if (
            run.children.size >=
              SUBAGENT_PROGRESS_LIMITS.maxChildrenPerParent ||
            activeChildren >= SUBAGENT_PROGRESS_LIMITS.maxActiveChildren
          )
            failLimit();
          const child = newChild();
          run.children.set(id, child);
          activeChildren += 1;
          for (const progress of rows)
            updateChild(child, progress, subagentProgressKey(progress), true);
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
        observeWorkflow(summary, event);
    },
  };
}
