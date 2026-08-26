export const SUBAGENT_PROGRESS_CUSTOM_TYPE = "patchmill-subagent-progress";
export const SUBAGENT_PROGRESS_LIMIT_ERROR =
  "PATCHMILL_SUBAGENT_PROGRESS_LIMIT_EXCEEDED";
export const SUBAGENT_PROGRESS_LIMITS = {
  maxToolCallIdCodeUnits: 1024,
  maxAgentCodeUnits: 256,
  maxModelCodeUnits: 512,
  maxThinkingCodeUnits: 128,
  maxWorkflowBytes: 256,
  maxWorkflowThinkingBytes: 32,
  maxWorkflowChildIdBytes: 128,
  maxResultRows: 1024,
  maxActiveParents: 256,
  maxChildrenPerParent: 1024,
  maxActiveChildren: 4096,
  maxActiveKeys: 16384,
  maxTransitionsPerChild: 32,
  maxEntriesPerSession: 65536,
} as const;

export type ChildLifecycleState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "paused"
  | "stopped"
  | "rejected"
  | "detached";

export type PersistedSubagentProgress =
  | {
      version: 1;
      kind: "direct";
      toolCallId: string;
      runId: string;
      childIndex: number;
      state?: ChildLifecycleState;
      agent?: string;
      model?: string;
      thinking?: string;
      unresolved?: true;
    }
  | {
      version: 1;
      kind: "workflow";
      toolCallId: string;
      workflowRunId: string;
      childId: string;
      state: ChildLifecycleState;
      agent?: string;
      model?: string;
      thinking?: string;
      unresolved?: true;
      inventoryClosed?: true;
    };

export type DirectSingleSnapshot = {
  runId: string;
  children: Array<{
    childIndex: number;
    state?: ChildLifecycleState;
    agent?: string;
    model?: string;
    thinking?: string;
  }>;
  pendingAsyncSingle: boolean;
};

export type DirectCompletionSnapshot = {
  runId: string;
  state?: ChildLifecycleState;
  child?: { agent?: string; model?: string; thinking?: string };
};

type WorkflowState =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "paused"
  | "stopped";

export type WorkflowChildSummarySource = {
  summary: WorkflowChildSummaryV1;
  fromCompletion: boolean;
  completionRunId?: string;
};

export type WorkflowChildSummaryV1 = {
  version: 1;
  parentToolCallId: string;
  workflowRunId: string;
  inventoryComplete: boolean;
  workflowState: WorkflowState;
  children: Array<{
    childId: string;
    state: ChildLifecycleState;
    agent?: string;
    model?: string;
    thinking?: string;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bounded(value: unknown, max: number): value is string {
  return (
    typeof value === "string" && value.length <= max && value.trim().length > 0
  );
}

function boundedBytes(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    new TextEncoder().encode(value).byteLength <= max &&
    value.trim().length > 0
  );
}

function optional(value: unknown, max: number): string | undefined {
  return bounded(value, max) ? value : undefined;
}

function optionalBytes(value: unknown, max: number): string | undefined {
  return boundedBytes(value, max) ? value : undefined;
}

const childStates = new Set<ChildLifecycleState>([
  "pending",
  "running",
  "completed",
  "failed",
  "paused",
  "stopped",
  "rejected",
  "detached",
]);
const workflowStates = new Set<WorkflowState>([
  "queued",
  "running",
  "completed",
  "failed",
  "paused",
  "stopped",
]);

export function directLifecycleState(
  row: Record<string, unknown>,
): ChildLifecycleState | undefined {
  if (row.detached === true) return "detached";
  if (row.stopped === true) return "stopped";
  if (row.interrupted === true) return "paused";
  if (isRecord(row.acceptance) && row.acceptance.status === "rejected")
    return "rejected";
  if (typeof row.exitCode === "number")
    return row.exitCode === 0 ? "completed" : "failed";
  return undefined;
}

function completionState(
  row: Record<string, unknown>,
): ChildLifecycleState | undefined {
  if (typeof row.state === "string") {
    if (row.state === "complete") return "completed";
    if (childStates.has(row.state as ChildLifecycleState))
      return row.state as ChildLifecycleState;
  }
  return directLifecycleState(row);
}

function directChild(
  row: Record<string, unknown>,
): DirectSingleSnapshot["children"][number] | undefined {
  if (
    typeof row.index !== "number" ||
    !Number.isSafeInteger(row.index) ||
    row.index < 0
  )
    return undefined;
  const child: DirectSingleSnapshot["children"][number] = {
    childIndex: row.index,
  };
  const state = directLifecycleState(row);
  if (state) child.state = state;
  const agent = optional(row.agent, SUBAGENT_PROGRESS_LIMITS.maxAgentCodeUnits);
  const model = optional(row.model, SUBAGENT_PROGRESS_LIMITS.maxModelCodeUnits);
  const thinking = optional(
    row.thinking,
    SUBAGENT_PROGRESS_LIMITS.maxThinkingCodeUnits,
  );
  if (agent) child.agent = agent;
  if (model) child.model = model;
  if (thinking) child.thinking = thinking;
  return child;
}

/** Parses only the documented structured single result surface. */
export function parseDirectSingleSnapshot(
  result: unknown,
): DirectSingleSnapshot | undefined {
  if (
    !isRecord(result) ||
    !isRecord(result.details) ||
    result.details.mode !== "single"
  )
    return undefined;
  const details = result.details;
  if (!Array.isArray(details.results)) return undefined;
  if (details.results.length > SUBAGENT_PROGRESS_LIMITS.maxResultRows)
    throw new Error(SUBAGENT_PROGRESS_LIMIT_ERROR);
  if (details.results.length === 0) {
    if (
      !bounded(details.asyncId, SUBAGENT_PROGRESS_LIMITS.maxToolCallIdCodeUnits)
    )
      return undefined;
    return { runId: details.asyncId, children: [], pendingAsyncSingle: true };
  }
  if (!bounded(details.runId, SUBAGENT_PROGRESS_LIMITS.maxToolCallIdCodeUnits))
    return undefined;
  const children: DirectSingleSnapshot["children"] = [];
  const childIndexes = new Set<number>();
  for (const row of details.results) {
    if (!isRecord(row)) continue;
    const child = directChild(row);
    if (!child) continue;
    // A result row's documented index is its identity, not its position.
    // Reject the entire bounded container so no caller can append a
    // contradictory partial transition set.
    if (childIndexes.has(child.childIndex)) return undefined;
    childIndexes.add(child.childIndex);
    children.push(child);
  }
  return { runId: details.runId, children, pendingAsyncSingle: false };
}

/** Parses documented completion rows; row order is never used for identity. */
export function parseDirectCompletionSnapshots(
  result: unknown,
): DirectCompletionSnapshot[] {
  if (
    !isRecord(result) ||
    !isRecord(result.details) ||
    !Array.isArray(result.details.completions)
  )
    return [];
  if (
    result.details.completions.length > SUBAGENT_PROGRESS_LIMITS.maxResultRows
  )
    throw new Error(SUBAGENT_PROGRESS_LIMIT_ERROR);
  const snapshots: DirectCompletionSnapshot[] = [];
  for (const completion of result.details.completions) {
    if (
      !isRecord(completion) ||
      !bounded(
        completion.runId,
        SUBAGENT_PROGRESS_LIMITS.maxToolCallIdCodeUnits,
      )
    )
      continue;
    if (
      Array.isArray(completion.results) &&
      completion.results.length > SUBAGENT_PROGRESS_LIMITS.maxResultRows
    )
      throw new Error(SUBAGENT_PROGRESS_LIMIT_ERROR);
    const snapshot: DirectCompletionSnapshot = { runId: completion.runId };
    const state = completionState(completion);
    if (state) snapshot.state = state;
    if (
      Array.isArray(completion.results) &&
      completion.results.length === 1 &&
      isRecord(completion.results[0])
    ) {
      const row = completion.results[0];
      const child: NonNullable<DirectCompletionSnapshot["child"]> = {};
      const agent = optional(
        row.agent,
        SUBAGENT_PROGRESS_LIMITS.maxAgentCodeUnits,
      );
      const model = optional(
        row.model,
        SUBAGENT_PROGRESS_LIMITS.maxModelCodeUnits,
      );
      const thinking = optional(
        row.thinking,
        SUBAGENT_PROGRESS_LIMITS.maxThinkingCodeUnits,
      );
      if (agent) child.agent = agent;
      if (model) child.model = model;
      if (thinking) child.thinking = thinking;
      if (Object.keys(child).length > 0) snapshot.child = child;
    }
    snapshots.push(snapshot);
  }
  return snapshots;
}

function parseWorkflowSummary(
  value: unknown,
): WorkflowChildSummaryV1 | undefined {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !boundedBytes(
      value.parentToolCallId,
      SUBAGENT_PROGRESS_LIMITS.maxWorkflowBytes,
    ) ||
    !boundedBytes(
      value.workflowRunId,
      SUBAGENT_PROGRESS_LIMITS.maxWorkflowBytes,
    ) ||
    typeof value.inventoryComplete !== "boolean" ||
    typeof value.workflowState !== "string" ||
    !workflowStates.has(value.workflowState as WorkflowState) ||
    !Array.isArray(value.children)
  )
    return undefined;
  if (value.children.length > SUBAGENT_PROGRESS_LIMITS.maxResultRows)
    throw new Error(SUBAGENT_PROGRESS_LIMIT_ERROR);
  const children: WorkflowChildSummaryV1["children"] = [];
  const ids = new Set<string>();
  for (const row of value.children) {
    if (
      !isRecord(row) ||
      !boundedBytes(
        row.childId,
        SUBAGENT_PROGRESS_LIMITS.maxWorkflowChildIdBytes,
      ) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(row.childId) ||
      typeof row.state !== "string" ||
      !childStates.has(row.state as ChildLifecycleState) ||
      ids.has(row.childId)
    )
      return undefined;
    ids.add(row.childId);
    const child: WorkflowChildSummaryV1["children"][number] = {
      childId: row.childId,
      state: row.state as ChildLifecycleState,
    };
    const agent = optionalBytes(
      row.agent,
      SUBAGENT_PROGRESS_LIMITS.maxWorkflowBytes,
    );
    const model = optionalBytes(
      row.model,
      SUBAGENT_PROGRESS_LIMITS.maxWorkflowBytes,
    );
    const thinking = optionalBytes(
      row.thinking,
      SUBAGENT_PROGRESS_LIMITS.maxWorkflowThinkingBytes,
    );
    if (agent) child.agent = agent;
    if (model) child.model = model;
    if (thinking) child.thinking = thinking;
    children.push(child);
  }
  return {
    version: 1,
    parentToolCallId: value.parentToolCallId,
    workflowRunId: value.workflowRunId,
    inventoryComplete: value.inventoryComplete,
    workflowState: value.workflowState as WorkflowState,
    children,
  };
}

/** Reads exactly details.workflowChildren and completion workflowChildren slots. */
export function parseWorkflowChildSummarySources(
  result: unknown,
): WorkflowChildSummarySource[] {
  if (!isRecord(result) || !isRecord(result.details)) return [];
  const summaries: WorkflowChildSummarySource[] = [];
  const top = parseWorkflowSummary(result.details.workflowChildren);
  if (top) summaries.push({ summary: top, fromCompletion: false });
  if (!Array.isArray(result.details.completions)) return summaries;
  if (
    result.details.completions.length > SUBAGENT_PROGRESS_LIMITS.maxResultRows
  )
    throw new Error(SUBAGENT_PROGRESS_LIMIT_ERROR);
  for (const completion of result.details.completions) {
    if (!isRecord(completion)) continue;
    const summary = parseWorkflowSummary(completion.workflowChildren);
    if (!summary) continue;
    const completionRunId = boundedBytes(
      completion.runId,
      SUBAGENT_PROGRESS_LIMITS.maxWorkflowBytes,
    )
      ? completion.runId
      : undefined;
    summaries.push({
      summary,
      fromCompletion: true,
      ...(completionRunId ? { completionRunId } : {}),
    });
  }
  return summaries;
}

export function parseWorkflowChildSummaries(
  result: unknown,
): WorkflowChildSummaryV1[] {
  return parseWorkflowChildSummarySources(result).map(({ summary }) => summary);
}

export function parsePersistedSubagentProgress(
  value: unknown,
): PersistedSubagentProgress | undefined {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    (value.unresolved !== undefined && value.unresolved !== true) ||
    (value.inventoryClosed !== undefined && value.inventoryClosed !== true) ||
    (value.unresolved === true && value.inventoryClosed === true)
  )
    return undefined;
  if (value.kind === "direct") {
    if (
      value.inventoryClosed !== undefined ||
      !bounded(
        value.toolCallId,
        SUBAGENT_PROGRESS_LIMITS.maxToolCallIdCodeUnits,
      ) ||
      !bounded(value.runId, SUBAGENT_PROGRESS_LIMITS.maxToolCallIdCodeUnits) ||
      typeof value.childIndex !== "number" ||
      !Number.isSafeInteger(value.childIndex) ||
      value.childIndex < 0
    )
      return undefined;
    if (
      value.state !== undefined &&
      (typeof value.state !== "string" ||
        !childStates.has(value.state as ChildLifecycleState))
    )
      return undefined;
    const progress: PersistedSubagentProgress = {
      version: 1,
      kind: "direct",
      toolCallId: value.toolCallId,
      runId: value.runId,
      childIndex: value.childIndex,
    };
    if (value.state) progress.state = value.state as ChildLifecycleState;
    const agent = optional(
      value.agent,
      SUBAGENT_PROGRESS_LIMITS.maxAgentCodeUnits,
    );
    const model = optional(
      value.model,
      SUBAGENT_PROGRESS_LIMITS.maxModelCodeUnits,
    );
    const thinking = optional(
      value.thinking,
      SUBAGENT_PROGRESS_LIMITS.maxThinkingCodeUnits,
    );
    if (agent) progress.agent = agent;
    if (model) progress.model = model;
    if (thinking) progress.thinking = thinking;
    if (value.unresolved) progress.unresolved = true;
    return progress;
  }
  if (
    value.kind !== "workflow" ||
    !boundedBytes(
      value.toolCallId,
      SUBAGENT_PROGRESS_LIMITS.maxWorkflowBytes,
    ) ||
    !boundedBytes(
      value.workflowRunId,
      SUBAGENT_PROGRESS_LIMITS.maxWorkflowBytes,
    ) ||
    !boundedBytes(
      value.childId,
      SUBAGENT_PROGRESS_LIMITS.maxWorkflowChildIdBytes,
    ) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value.childId) ||
    typeof value.state !== "string" ||
    !childStates.has(value.state as ChildLifecycleState)
  )
    return undefined;
  const progress: PersistedSubagentProgress = {
    version: 1,
    kind: "workflow",
    toolCallId: value.toolCallId,
    workflowRunId: value.workflowRunId,
    childId: value.childId,
    state: value.state as ChildLifecycleState,
  };
  const agent = optionalBytes(
    value.agent,
    SUBAGENT_PROGRESS_LIMITS.maxWorkflowBytes,
  );
  const model = optionalBytes(
    value.model,
    SUBAGENT_PROGRESS_LIMITS.maxWorkflowBytes,
  );
  const thinking = optionalBytes(
    value.thinking,
    SUBAGENT_PROGRESS_LIMITS.maxWorkflowThinkingBytes,
  );
  if (agent) progress.agent = agent;
  if (model) progress.model = model;
  if (thinking) progress.thinking = thinking;
  if (value.unresolved) progress.unresolved = true;
  if (value.inventoryClosed) progress.inventoryClosed = true;
  return progress;
}

/** Fixed-position JSON prevents separator collisions and includes every tuple field. */
export function subagentProgressKey(
  progress: PersistedSubagentProgress,
): string {
  return progress.kind === "direct"
    ? JSON.stringify([
        "direct",
        progress.toolCallId,
        progress.runId,
        progress.childIndex,
        progress.state ?? null,
        progress.agent ?? null,
        progress.model ?? null,
        progress.thinking ?? null,
        progress.unresolved === true,
      ])
    : JSON.stringify([
        "workflow",
        progress.toolCallId,
        progress.workflowRunId,
        progress.childId,
        progress.state,
        progress.agent ?? null,
        progress.model ?? null,
        progress.thinking ?? null,
        progress.unresolved === true,
        progress.inventoryClosed === true,
      ]);
}
