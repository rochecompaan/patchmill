import {
  parseDirectCompletionSnapshots,
  parseDirectSingleSnapshot,
  parsePersistedSubagentProgress,
  parseWorkflowChildSummarySources,
  SUBAGENT_PROGRESS_CUSTOM_TYPE,
  SUBAGENT_PROGRESS_LIMIT_ERROR,
  SUBAGENT_PROGRESS_LIMITS,
  subagentProgressKey,
  type ChildLifecycleState,
  type PersistedSubagentProgress,
  type WorkflowChildSummarySource,
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
  runId: string;
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
  let directRuns = new Map<string, DirectRun>();
  // Async completions carry only a run ID, so retain both directions while a
  // direct run is active. This prevents a contradictory launch from assigning
  // one completion to more than one parent.
  let directOrigins = new Map<string, string>();
  let directRunsByOrigin = new Map<string, string>();
  let workflowRuns = new Map<string, WorkflowRun>();
  let closedWorkflows = new Map<string, ClosedWorkflow>();
  // Retain both directions so one originating parent cannot be silently
  // rebound to a contradictory workflow run by status or management output.
  let workflowOrigins = new Map<string, string>();
  let workflowRunsByOrigin = new Map<string, string>();
  let tupleKeys = new Set<string>();
  let transitionCounts = new Map<string, number>();
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
    chargeActiveKeys = true,
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
      (chargeActiveKeys &&
        activeKeys + newKeys.size > SUBAGENT_PROGRESS_LIMITS.maxActiveKeys) ||
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
      run = { toolCallId, runId, children: new Map(), async };
      directRuns.set(key, run);
      directOrigins.set(runId, toolCallId);
      directRunsByOrigin.set(toolCallId, runId);
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
    if (directOrigins.get(run.runId) === run.toolCallId)
      directOrigins.delete(run.runId);
    if (directRunsByOrigin.get(run.toolCallId) === run.runId)
      directRunsByOrigin.delete(run.toolCallId);
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
      const directOrigin = directOrigins.get(snapshot.runId);
      const directRun = directRunsByOrigin.get(event.toolCallId);
      if (
        (directOrigin !== undefined && directOrigin !== event.toolCallId) ||
        (directRun !== undefined && directRun !== snapshot.runId)
      )
        return;
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
      const terminalFallbacks =
        !snapshot.pendingAsyncSingle && event.phase === "end"
          ? rows
              .filter((row) => {
                const child = existing?.children.get(row.childIndex);
                return !row.agent && !child?.agentSeen && !child?.unresolved;
              })
              .map(
                (row): PersistedSubagentProgress => ({
                  version: 1,
                  kind: "direct",
                  toolCallId: event.toolCallId,
                  runId: snapshot.runId,
                  childIndex: row.childIndex,
                  ...(row.state ? { state: row.state } : {}),
                  unresolved: true,
                }),
              )
          : [];
      preflight(
        [...previews, ...terminalFallbacks],
        children,
        newParent,
        newChildren,
      );
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
          for (const progress of terminalFallbacks) {
            const child = run.children.get(progress.childIndex);
            if (child) append(progress, child);
          }
          releaseDirect(key, run);
        }
      }
    }
    for (const completion of parseDirectCompletionSnapshots(event.result)) {
      const origin = directOrigins.get(completion.runId);
      if (origin === undefined) continue;
      const key = directKey(origin, completion.runId);
      const run = directRuns.get(key);
      if (!run?.async) continue;
      {
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
    source: WorkflowChildSummarySource,
    event: SubagentProgressCorrelationEvent,
    launchEvent: boolean,
  ) => {
    const { summary } = source;
    const key = workflowKey(summary.parentToolCallId, summary.workflowRunId);
    const origin = workflowOrigins.get(summary.workflowRunId);
    const originRun = workflowRunsByOrigin.get(summary.parentToolCallId);
    const sourceCloses =
      summary.inventoryComplete ||
      ["completed", "failed", "stopped"].includes(summary.workflowState);
    const statusSummary =
      !source.fromCompletion &&
      event.toolName === "subagent" &&
      typeof event.result === "object" &&
      event.result !== null &&
      !Array.isArray(event.result) &&
      typeof (event.result as { details?: { mode?: unknown } }).details
        ?.mode === "string" &&
      (event.result as { details?: { mode?: unknown } }).details?.mode ===
        "single";
    // A current status call has a new Pi event ID. Its v1 summary preserves
    // the originating parent ID, including when the initial empty workflow
    // left no persisted child entry to restore. Other cold adoption remains
    // restricted to a terminal completion whose documented runId agrees.
    if (
      (launchEvent && summary.parentToolCallId !== event.toolCallId) ||
      (origin !== undefined && origin !== summary.parentToolCallId) ||
      (originRun !== undefined && originRun !== summary.workflowRunId) ||
      (source.fromCompletion &&
        source.completionRunId !== summary.workflowRunId) ||
      (!launchEvent &&
        origin === undefined &&
        !statusSummary &&
        (!source.fromCompletion ||
          source.completionRunId !== summary.workflowRunId ||
          !sourceCloses))
    )
      return;
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
      const replays = summary.children.map((row) => {
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
        return { child, progress };
      });
      // Closed inventories retain no active tuple keys. Preflight the whole
      // replay batch before appending any row, without charging those rows
      // against the active-key ceiling.
      preflight(
        replays.map(({ progress }) => progress),
        [],
        0,
        0,
        false,
      );
      for (const { child, progress } of replays)
        if (append(progress, child, false)) {
          closed.set(progress.childId, {
            agentSeen: child.agentSeen,
            unresolved: child.unresolved,
            ...(child.lastState ? { lastState: child.lastState } : {}),
          });
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
    const seal = closes
      ? [...summary.children]
          .sort((left, right) =>
            left.childId < right.childId
              ? -1
              : left.childId > right.childId
                ? 1
                : 0,
          )
          .slice(0, 1)
          .map(
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
              inventoryClosed: true,
            }),
          )
      : [];
    preflight(
      [...previews, ...fallbackRows, ...seal],
      knownChildren,
      newParent,
      newRows.length,
    );
    workflowOrigins.set(summary.workflowRunId, summary.parentToolCallId);
    workflowRunsByOrigin.set(summary.parentToolCallId, summary.workflowRunId);
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
    for (const progress of seal) {
      const child = run.children.get(progress.childId);
      if (child) append(progress, child);
    }
    releaseWorkflow(key, run);
  };

  return {
    restore(entries) {
      // Build an entirely separate snapshot. A limit failure must not leave a
      // partially restored inventory that can evade a later preflight.
      const restoredDirectRuns = new Map<string, DirectRun>();
      const restoredDirectOrigins = new Map<string, string>();
      const restoredDirectRunsByOrigin = new Map<string, string>();
      const restoredWorkflowRuns = new Map<string, WorkflowRun>();
      const restoredClosedWorkflows = new Map<string, ClosedWorkflow>();
      const restoredOrigins = new Map<string, string>();
      const restoredRunsByOrigin = new Map<string, string>();
      const restoredTupleKeys = new Set<string>();
      const restoredTransitionCounts = new Map<string, number>();
      let restoredEntries = 0;
      const valid: PersistedSubagentProgress[] = [];
      for (const entry of entries) {
        if (!matchingEntry(entry)) continue;
        restoredEntries += 1;
        if (restoredEntries > SUBAGENT_PROGRESS_LIMITS.maxEntriesPerSession)
          failLimit();
        const progress = parsePersistedSubagentProgress(entry.data);
        if (!progress) continue;
        const tuple = subagentProgressKey(progress);
        if (restoredTupleKeys.has(tuple)) continue;
        restoredTupleKeys.add(tuple);
        const identity = childKey(progress);
        const count = (restoredTransitionCounts.get(identity) ?? 0) + 1;
        if (count > SUBAGENT_PROGRESS_LIMITS.maxTransitionsPerChild)
          failLimit();
        restoredTransitionCounts.set(identity, count);
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
      const resumableDirectGroups = new Set<string>();
      for (const [key, group] of directGroups) {
        // Only the structured async-single launch identity can be resumed:
        // it always has child index zero and its launch transition is pending.
        // Other valid historical tuples stay in session deduplication history,
        // but cannot claim an active parent or completion ownership.
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
        const first = group[0] as Extract<
          PersistedSubagentProgress,
          { kind: "direct" }
        >;
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
        const first = group[0] as Extract<
          PersistedSubagentProgress,
          { kind: "workflow" }
        >;
        const add = (groups: Map<string, Set<string>>, id: string) => {
          const keys = groups.get(id) ?? new Set<string>();
          keys.add(key);
          groups.set(id, keys);
        };
        add(workflowGroupsByRun, first.workflowRunId);
        add(workflowGroupsByParent, first.toolCallId);
      }
      // Ownership is bijective. A conflict poisons every group on either
      // side, rather than accepting the first row encountered during replay.
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
        const first = group[0] as Extract<
          PersistedSubagentProgress,
          { kind: "direct" }
        >;
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
        for (const progress of group as Extract<
          PersistedSubagentProgress,
          { kind: "direct" }
        >[]) {
          let child = run.children.get(progress.childIndex);
          if (!child) {
            if (
              run.children.size >=
                SUBAGENT_PROGRESS_LIMITS.maxChildrenPerParent ||
              restoredChildren >= SUBAGENT_PROGRESS_LIMITS.maxActiveChildren
            )
              failLimit();
            child = newChild();
            run.children.set(progress.childIndex, child);
            restoredChildren += 1;
          }
          hydrate(child, progress);
        }
      }
      for (const [key, group] of workflowGroups) {
        const first = group[0] as Extract<
          PersistedSubagentProgress,
          { kind: "workflow" }
        >;
        // A corrupt persisted parent/run pair is not made active or eligible
        // for management adoption, while its valid immutable tuples stay
        // deduplicated for the session.
        if (conflictedWorkflowGroups.has(key)) continue;
        restoredOrigins.set(first.workflowRunId, first.toolCallId);
        restoredRunsByOrigin.set(first.toolCallId, first.workflowRunId);
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
        if (byChild.size > SUBAGENT_PROGRESS_LIMITS.maxChildrenPerParent)
          failLimit();
        const seals = group.filter(
          (progress) => progress.inventoryClosed === true,
        );
        const firstChildId = [...byChild.keys()].sort()[0];
        // A closed inventory is only durable after its one deterministic seal
        // (on the lexicographically first child) and every agentless child has
        // its recoverable unresolved fallback. Partial closure writes remain
        // active so replay can append the missing fallback before releasing.
        const closed =
          seals.length === 1 &&
          seals[0]?.childId === firstChildId &&
          [...byChild.values()].every(
            (rows) =>
              rows.some((progress) => progress.agent !== undefined) ||
              rows.some((progress) => progress.unresolved),
          );
        if (closed) {
          restoredClosedWorkflows.set(
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
            run.children.size >=
              SUBAGENT_PROGRESS_LIMITS.maxChildrenPerParent ||
            restoredChildren >= SUBAGENT_PROGRESS_LIMITS.maxActiveChildren
          )
            failLimit();
          const child = newChild();
          run.children.set(id, child);
          restoredChildren += 1;
          for (const progress of rows) hydrate(child, progress);
        }
      }
      for (const run of [
        ...restoredDirectRuns.values(),
        ...restoredWorkflowRuns.values(),
      ])
        for (const child of run.children.values())
          restoredKeys += child.keys.size;
      if (restoredKeys > SUBAGENT_PROGRESS_LIMITS.maxActiveKeys) failLimit();

      directRuns = restoredDirectRuns;
      directOrigins = new Map(
        [...restoredDirectOrigins].filter(([runId, toolCallId]) =>
          restoredDirectRuns.has(directKey(toolCallId, runId)),
        ),
      );
      directRunsByOrigin = new Map(
        [...restoredDirectRunsByOrigin].filter(([toolCallId, runId]) =>
          restoredDirectRuns.has(directKey(toolCallId, runId)),
        ),
      );
      workflowRuns = restoredWorkflowRuns;
      closedWorkflows = restoredClosedWorkflows;
      workflowOrigins = restoredOrigins;
      workflowRunsByOrigin = restoredRunsByOrigin;
      tupleKeys = restoredTupleKeys;
      transitionCounts = restoredTransitionCounts;
      activeChildren = restoredChildren;
      activeKeys = restoredKeys;
      sessionEntries = restoredEntries;
    },
    observe(event) {
      if (
        (event.toolName !== "subagent" && event.toolName !== "subagent_wait") ||
        typeof event.toolCallId !== "string" ||
        event.toolCallId.trim().length === 0 ||
        event.toolCallId.length >
          SUBAGENT_PROGRESS_LIMITS.maxToolCallIdCodeUnits
      )
        return;
      observeDirect(event);
      const sources = parseWorkflowChildSummarySources(event.result);
      const launchEvent =
        event.toolName === "subagent" &&
        typeof event.result === "object" &&
        event.result !== null &&
        !Array.isArray(event.result) &&
        typeof (event.result as { details?: unknown }).details === "object" &&
        (event.result as { details?: { mode?: unknown } }).details?.mode ===
          "workflow";
      for (const source of sources) observeWorkflow(source, event, launchEvent);
    },
  };
}
