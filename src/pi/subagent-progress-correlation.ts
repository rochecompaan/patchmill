import {
  parseDirectCompletionSnapshots,
  parseDirectSingleSnapshot,
  parseWorkflowChildSummarySources,
  SUBAGENT_PROGRESS_LIMIT_ERROR,
  SUBAGENT_PROGRESS_LIMITS,
  subagentProgressKey,
  type DirectCompletionSnapshot,
  type DirectSingleSnapshot,
  type PersistedSubagentProgress,
  parseSubagentResultMode,
  type WorkflowChildSummarySource,
} from "./subagent-progress.ts";
import { type RestoredClosedWorkflow } from "./subagent-progress-workflow-restore.ts";
import {
  buildRestoredCorrelationState,
  childProgressIdentity,
  cloneCorrelationState,
  directRunKey,
  newCorrelationChild,
  workflowRunKey,
  type Child,
  type CorrelationState,
  type DirectRun,
  type WorkflowRun,
} from "./subagent-progress-correlation-state.ts";

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
type DirectProgress = Extract<PersistedSubagentProgress, { kind: "direct" }>;
type WorkflowProgress = Extract<
  PersistedSubagentProgress,
  { kind: "workflow" }
>;

function failLimit(): never {
  throw new Error(SUBAGENT_PROGRESS_LIMIT_ERROR);
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
  let closedWorkflows = new Map<string, RestoredClosedWorkflow>();
  // Retain both directions so one originating parent cannot be silently
  // rebound to a contradictory workflow run by status or management output.
  let workflowOrigins = new Map<string, string>();
  let workflowRunsByOrigin = new Map<string, string>();
  let tupleKeys = new Set<string>();
  let transitionCounts = new Map<string, number>();
  let activeChildren = 0;
  let activeKeys = 0;
  let sessionEntries = 0;
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
      const identity = childProgressIdentity(progress);
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
    appendEffect: (progress: PersistedSubagentProgress) => void,
  ): boolean => {
    const key = subagentProgressKey(progress);
    if (tupleKeys.has(key)) return false;
    try {
      appendEffect(progress);
    } catch (cause) {
      throw new Error(SUBAGENT_PROGRESS_APPEND_ERROR, { cause });
    }
    tupleKeys.add(key);
    sessionEntries += 1;
    transitionCounts.set(
      childProgressIdentity(progress),
      (transitionCounts.get(childProgressIdentity(progress)) ?? 0) + 1,
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
    const key = directRunKey(toolCallId, runId);
    let run = directRuns.get(key);
    if (!run) {
      run = { toolCallId, runId, children: new Map(), async };
      directRuns.set(key, run);
      directOrigins.set(runId, toolCallId);
      directRunsByOrigin.set(toolCallId, runId);
    }
    let child = run.children.get(index);
    if (!child) {
      child = newCorrelationChild();
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
  const releaseWorkflow = (
    key: string,
    workflowRunId: string,
    run: WorkflowRun,
  ) => {
    if (run.children.size === 0) {
      // An empty terminal inventory has no durable seal or child identity.
      // Keep neither side of its active-only ownership relation.
      closedWorkflows.delete(key);
      if (workflowOrigins.get(workflowRunId) === run.toolCallId)
        workflowOrigins.delete(workflowRunId);
      if (workflowRunsByOrigin.get(run.toolCallId) === workflowRunId)
        workflowRunsByOrigin.delete(run.toolCallId);
    } else {
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
    }
    for (const child of run.children.values()) {
      activeChildren -= 1;
      activeKeys -= child.keys.size;
    }
    workflowRuns.delete(key);
  };
  const currentState = (): CorrelationState => ({
    directRuns,
    directOrigins,
    directRunsByOrigin,
    workflowRuns,
    closedWorkflows,
    workflowOrigins,
    workflowRunsByOrigin,
    tupleKeys,
    transitionCounts,
    activeChildren,
    activeKeys,
    sessionEntries,
  });
  const applyState = (state: CorrelationState) => {
    directRuns = state.directRuns;
    directOrigins = state.directOrigins;
    directRunsByOrigin = state.directRunsByOrigin;
    workflowRuns = state.workflowRuns;
    closedWorkflows = state.closedWorkflows;
    workflowOrigins = state.workflowOrigins;
    workflowRunsByOrigin = state.workflowRunsByOrigin;
    tupleKeys = state.tupleKeys;
    transitionCounts = state.transitionCounts;
    activeChildren = state.activeChildren;
    activeKeys = state.activeKeys;
    sessionEntries = state.sessionEntries;
  };

  const fallbackDirect = (
    toolCallId: string,
    runId: string,
    index: number,
    child: Child,
    appendEffect: (progress: PersistedSubagentProgress) => void,
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
      true,
      appendEffect,
    );
  };

  const observeDirect = (
    event: SubagentProgressCorrelationEvent,
    snapshot: DirectSingleSnapshot | undefined,
    completions: readonly DirectCompletionSnapshot[],
    appendEffect: (progress: PersistedSubagentProgress) => void,
  ) => {
    if (snapshot) {
      const key = directRunKey(event.toolCallId, snapshot.runId);
      const directOrigin = directOrigins.get(snapshot.runId);
      const directRun = directRunsByOrigin.get(event.toolCallId);
      if (
        (directOrigin !== undefined && directOrigin !== event.toolCallId) ||
        (directRun !== undefined && directRun !== snapshot.runId)
      )
        return;
      const existing = directRuns.get(key);
      // A direct run's launch mode is immutable: async runs only resolve
      // through their documented completion, while foreground runs end here.
      // Reject contradictory snapshots before they can add children or release
      // an active async run.
      if (existing && existing.async !== snapshot.pendingAsyncSingle) return;
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
        (row): DirectProgress => ({
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
          ? [
              ...new Set([
                ...(existing ? [...existing.children.keys()] : []),
                ...rows.map((row) => row.childIndex),
              ]),
            ]
              .filter((childIndex) => {
                const row = rows.find((item) => item.childIndex === childIndex);
                const child = existing?.children.get(childIndex);
                return !row?.agent && !child?.agentSeen && !child?.unresolved;
              })
              .map((childIndex): DirectProgress => {
                const row = rows.find((item) => item.childIndex === childIndex);
                const child = existing?.children.get(childIndex);
                const state = row?.state ?? child?.lastState;
                return {
                  version: 1,
                  kind: "direct",
                  toolCallId: event.toolCallId,
                  runId: snapshot.runId,
                  childIndex,
                  ...(state ? { state } : {}),
                  unresolved: true,
                };
              })
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
        append(progress, child, true, appendEffect);
      }
      if (!snapshot.pendingAsyncSingle && event.phase === "end") {
        const run = directRuns.get(key);
        if (run) {
          for (const progress of terminalFallbacks) {
            const child = run.children.get(progress.childIndex);
            if (child) append(progress, child, true, appendEffect);
          }
          releaseDirect(key, run);
        }
      }
    }
    for (const completion of completions) {
      const origin = directOrigins.get(completion.runId);
      if (origin === undefined) continue;
      const key = directRunKey(origin, completion.runId);
      const run = directRuns.get(key);
      if (!run?.async) continue;
      {
        const child = run.children.get(0);
        if (!child) continue;
        const progress: DirectProgress | undefined =
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
        const fallbackProgress: DirectProgress | undefined = fallback
          ? {
              version: 1,
              kind: "direct",
              toolCallId: run.toolCallId,
              runId: completion.runId,
              childIndex: 0,
              ...(completion.state ? { state: completion.state } : {}),
              unresolved: true,
            }
          : undefined;
        preflight(
          [
            ...(progress ? [progress] : []),
            ...(fallbackProgress ? [fallbackProgress] : []),
          ],
          [child],
          0,
          0,
        );
        if (progress) append(progress, child, true, appendEffect);
        fallbackDirect(
          run.toolCallId,
          completion.runId,
          0,
          child,
          appendEffect,
        );
        releaseDirect(key, run);
      }
    }
  };

  const observeWorkflow = (
    source: WorkflowChildSummarySource,
    event: SubagentProgressCorrelationEvent,
    launchEvent: boolean,
    appendEffect: (progress: PersistedSubagentProgress) => void,
  ) => {
    const { summary } = source;
    const key = workflowRunKey(summary.parentToolCallId, summary.workflowRunId);
    const origin = workflowOrigins.get(summary.workflowRunId);
    const originRun = workflowRunsByOrigin.get(summary.parentToolCallId);
    const sourceCloses =
      summary.inventoryComplete ||
      ["completed", "failed", "stopped"].includes(summary.workflowState);
    const statusSummary =
      !source.fromCompletion &&
      event.toolName === "subagent" &&
      parseSubagentResultMode(event.result) === "single";
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
        if (append(progress, child, false, appendEffect)) {
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
      (row): WorkflowProgress => ({
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
              !(
                existing?.children.get(row.childId)?.agentSeen ||
                existing?.children.get(row.childId)?.unresolved ||
                row.agent
              ),
          )
          .map(
            (row): WorkflowProgress => ({
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
            (row): WorkflowProgress => ({
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
        child = newCorrelationChild();
        run.children.set(progress.childId, child);
        activeChildren += 1;
      }
      append(progress, child, true, appendEffect);
    }
    if (!closes) return;
    for (const progress of fallbackRows) {
      const child = run.children.get(progress.childId);
      if (child && !child.agentSeen && !child.unresolved)
        append(progress, child, true, appendEffect);
    }
    let durablySealed = false;
    for (const progress of seal) {
      const child = run.children.get(progress.childId);
      if (child)
        durablySealed =
          append(progress, child, true, appendEffect) || durablySealed;
    }
    // A nonempty inventory releases only after its ordered seal persisted.
    if (durablySealed || seal.length === 0)
      releaseWorkflow(key, summary.workflowRunId, run);
  };

  return {
    restore(entries) {
      applyState(buildRestoredCorrelationState(entries));
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
      // Parse every bounded projection before any append can mutate the
      // correlator. Then simulate the full lifecycle event against a private
      // snapshot so a later documented sibling cannot fail a state limit after
      // an earlier direct completion has appended or released its run.
      const directSnapshot = parseDirectSingleSnapshot(event.result);
      const directCompletions = parseDirectCompletionSnapshots(event.result);
      const sources = parseWorkflowChildSummarySources(event.result);
      const launchEvent =
        event.toolName === "subagent" &&
        parseSubagentResultMode(event.result) === "workflow";
      const observeParsed = (
        appendEffect: (progress: PersistedSubagentProgress) => void,
      ) => {
        observeDirect(event, directSnapshot, directCompletions, appendEffect);
        for (const source of sources)
          observeWorkflow(source, event, launchEvent, appendEffect);
      };
      // Retain the live references, clone them once for the limit sandbox, and
      // make append effects explicit. The dry run cannot change live state or
      // temporarily rewire the append callback.
      const saved = currentState();
      applyState(cloneCorrelationState(saved));
      try {
        observeParsed(() => {});
      } finally {
        applyState(saved);
      }
      observeParsed(options.append);
    },
  };
}
