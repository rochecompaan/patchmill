export type RunCostModelUsage = {
  model: string;
  promptTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};
export type RunCostStageUsage = {
  stage: string;
  models: RunCostModelUsage[];
  promptTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};
export type RunCostReport = {
  stages: RunCostStageUsage[];
  promptTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};
export type RunCostSessionFile = {
  relativePath: string;
  startedAtMs: number;
  content: string;
};

export class RunCostReportError extends Error {
  readonly name = "RunCostReportError";
}

const STAGE_ORDER = [
  "pi-artifact-extraction",
  "pi-plan",
  "pi-development-environment",
  "pi-implementation",
] as const;
type Usage = {
  id: string;
  fingerprint: string;
  model: string;
  promptTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};
function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function amount(value: unknown, field: string, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new RunCostReportError(`Invalid assistant usage ${field} in ${path}`);
  return value;
}
function assistantUsage(entry: unknown, path: string): Usage | undefined {
  const item = record(entry);
  const message = record(item?.message);
  if (item?.type !== "message" || message?.role !== "assistant")
    return undefined;
  if (typeof item.id !== "string" || item.id.trim().length === 0)
    throw new RunCostReportError(
      `Assistant entry missing stable id in ${path}`,
    );
  const usage = record(message.usage);
  const cost = record(usage?.cost);
  if (!usage || !cost)
    throw new RunCostReportError(`Invalid assistant usage in ${path}`);
  const input = amount(usage.input, "input", path);
  const cacheRead = amount(usage.cacheRead, "cacheRead", path);
  const cacheWrite = amount(usage.cacheWrite, "cacheWrite", path);
  const outputTokens = amount(usage.output, "output", path);
  const estimatedCostUsd = amount(cost.total, "cost.total", path);
  const model =
    typeof message.model === "string" && message.model.trim()
      ? message.model.trim()
      : "Unknown model";
  const promptTokens = input + cacheRead + cacheWrite;
  return {
    id: item.id,
    model,
    promptTokens,
    outputTokens,
    estimatedCostUsd,
    fingerprint: JSON.stringify({
      model,
      promptTokens,
      outputTokens,
      estimatedCostUsd,
    }),
  };
}
function total(
  rows: readonly RunCostModelUsage[],
): Omit<RunCostModelUsage, "model"> {
  return rows.reduce(
    (sum, row) => ({
      promptTokens: sum.promptTokens + row.promptTokens,
      outputTokens: sum.outputTokens + row.outputTokens,
      estimatedCostUsd: sum.estimatedCostUsd + row.estimatedCostUsd,
    }),
    { promptTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
  );
}
export function aggregateRunCost(files: RunCostSessionFile[]): RunCostReport {
  const entries = new Map<string, Usage & { stage: string }>();
  for (const file of [...files].sort(
    (a, b) =>
      a.startedAtMs - b.startedAtMs ||
      a.relativePath.localeCompare(b.relativePath),
  )) {
    const stage = file.relativePath.split(/[\\/]/u)[0] || "unknown";
    for (const [index, line] of file.content.split(/\r?\n/u).entries()) {
      if (!line.trim()) continue;
      let entry: unknown;
      try {
        entry = JSON.parse(line);
      } catch (cause) {
        throw new RunCostReportError(
          `Malformed Pi session JSON in ${file.relativePath}:${index + 1}`,
          { cause },
        );
      }
      const usage = assistantUsage(entry, `${file.relativePath}:${index + 1}`);
      if (!usage) continue;
      const old = entries.get(usage.id);
      if (old && old.fingerprint !== usage.fingerprint)
        throw new RunCostReportError(
          `Conflicting Pi session entry ${usage.id}`,
        );
      if (!old) entries.set(usage.id, { ...usage, stage });
    }
  }
  if (!entries.size)
    throw new RunCostReportError("No assistant usage records found");
  const groups = new Map<string, Map<string, RunCostModelUsage>>();
  for (const entry of entries.values()) {
    const models =
      groups.get(entry.stage) ?? new Map<string, RunCostModelUsage>();
    const prior = models.get(entry.model) ?? {
      model: entry.model,
      promptTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    };
    models.set(entry.model, {
      model: entry.model,
      promptTokens: prior.promptTokens + entry.promptTokens,
      outputTokens: prior.outputTokens + entry.outputTokens,
      estimatedCostUsd: prior.estimatedCostUsd + entry.estimatedCostUsd,
    });
    groups.set(entry.stage, models);
  }
  const stages = [...groups.keys()]
    .sort((a, b) => {
      const ai = STAGE_ORDER.indexOf(a as (typeof STAGE_ORDER)[number]);
      const bi = STAGE_ORDER.indexOf(b as (typeof STAGE_ORDER)[number]);
      return (
        (ai < 0 ? STAGE_ORDER.length : ai) -
          (bi < 0 ? STAGE_ORDER.length : bi) || a.localeCompare(b)
      );
    })
    .map((stage) => {
      const models = [...groups.get(stage)!.values()].sort((a, b) =>
        a.model.localeCompare(b.model),
      );
      return { stage, models, ...total(models) };
    });
  return { stages, ...total(stages) };
}
function validNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function sameTotals(
  left: Omit<RunCostModelUsage, "model">,
  right: Omit<RunCostModelUsage, "model">,
): boolean {
  return (
    left.promptTokens === right.promptTokens &&
    left.outputTokens === right.outputTokens &&
    left.estimatedCostUsd === right.estimatedCostUsd
  );
}
export function parseRunCostReport(value: unknown): RunCostReport | undefined {
  const raw = record(value);
  if (
    !raw ||
    !Array.isArray(raw.stages) ||
    raw.stages.length === 0 ||
    !validNumber(raw.promptTokens) ||
    !validNumber(raw.outputTokens) ||
    !validNumber(raw.estimatedCostUsd)
  )
    return undefined;
  const stages: RunCostStageUsage[] = [];
  for (const rawStage of raw.stages) {
    const stage = record(rawStage);
    if (
      !stage ||
      typeof stage.stage !== "string" ||
      !Array.isArray(stage.models) ||
      stage.models.length === 0 ||
      !validNumber(stage.promptTokens) ||
      !validNumber(stage.outputTokens) ||
      !validNumber(stage.estimatedCostUsd)
    )
      return undefined;
    const models: RunCostModelUsage[] = [];
    for (const rawModel of stage.models) {
      const model = record(rawModel);
      if (
        !model ||
        typeof model.model !== "string" ||
        !validNumber(model.promptTokens) ||
        !validNumber(model.outputTokens) ||
        !validNumber(model.estimatedCostUsd)
      )
        return undefined;
      models.push({
        model: model.model,
        promptTokens: model.promptTokens,
        outputTokens: model.outputTokens,
        estimatedCostUsd: model.estimatedCostUsd,
      });
    }
    const totals = total(models);
    if (
      !sameTotals(totals, stage as Omit<RunCostStageUsage, "stage" | "models">)
    )
      return undefined;
    stages.push({ stage: stage.stage, models, ...totals });
  }
  const totals = total(stages);
  return sameTotals(totals, raw as Omit<RunCostReport, "stages">)
    ? { stages, ...totals }
    : undefined;
}
