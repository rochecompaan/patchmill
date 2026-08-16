export const SUBAGENT_PROGRESS_CUSTOM_TYPE = "patchmill-subagent-progress";
export const SUBAGENT_PROGRESS_LIMIT_ERROR =
  "PATCHMILL_SUBAGENT_PROGRESS_LIMIT_EXCEEDED";
export const SUBAGENT_PROGRESS_LIMITS = {
  maxToolCallIdCodeUnits: 1024,
  maxAgentCodeUnits: 256,
  maxModelCodeUnits: 512,
  maxThinkingCodeUnits: 128,
  maxResultRows: 1024,
  maxActiveParents: 256,
  maxChildrenPerParent: 1024,
  maxActiveChildren: 4096,
  maxActiveKeys: 16384,
  maxTransitionsPerChild: 32,
  maxEntriesPerSession: 65536,
} as const;

export type SubagentProgress = {
  toolCallId: string;
  childIndex: number;
  agent: string;
  model?: string;
  thinking?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedNonblankString(
  value: unknown,
  maxCodeUnits: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxCodeUnits &&
    value.trim().length > 0
  );
}

export function parseSubagentProgressResults(
  result: unknown,
  toolCallId: string,
): SubagentProgress[] {
  if (
    !isBoundedNonblankString(
      toolCallId,
      SUBAGENT_PROGRESS_LIMITS.maxToolCallIdCodeUnits,
    ) ||
    !isRecord(result)
  ) {
    return [];
  }

  const details = result.details;
  if (!isRecord(details) || !Array.isArray(details.results)) return [];
  if (details.results.length > SUBAGENT_PROGRESS_LIMITS.maxResultRows) {
    throw new Error(SUBAGENT_PROGRESS_LIMIT_ERROR);
  }

  const projections: SubagentProgress[] = [];
  for (const row of details.results) {
    if (!isRecord(row)) continue;
    if (
      typeof row.index !== "number" ||
      !Number.isSafeInteger(row.index) ||
      row.index < 0 ||
      !isBoundedNonblankString(
        row.agent,
        SUBAGENT_PROGRESS_LIMITS.maxAgentCodeUnits,
      )
    ) {
      continue;
    }

    const projection: SubagentProgress = {
      toolCallId,
      childIndex: row.index,
      agent: row.agent,
    };
    if (
      isBoundedNonblankString(
        row.model,
        SUBAGENT_PROGRESS_LIMITS.maxModelCodeUnits,
      )
    ) {
      projection.model = row.model;
    }
    if (
      isBoundedNonblankString(
        row.thinking,
        SUBAGENT_PROGRESS_LIMITS.maxThinkingCodeUnits,
      )
    ) {
      projection.thinking = row.thinking;
    }
    projections.push(projection);
  }
  return projections;
}

export function subagentProgressKey(progress: SubagentProgress): string {
  return JSON.stringify([
    progress.toolCallId,
    progress.childIndex,
    progress.agent,
    progress.model ?? null,
    progress.thinking ?? null,
  ]);
}
