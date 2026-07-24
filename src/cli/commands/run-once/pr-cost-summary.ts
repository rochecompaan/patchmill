import type { RunCostReport } from "./run-cost.ts";
const START_MARKER = "<!-- patchmill-run-cost:start -->";
const END_MARKER = "<!-- patchmill-run-cost:end -->";
const TOKEN_FORMAT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
  useGrouping: true,
});
export class PrCostSummaryError extends Error {
  readonly name = "PrCostSummaryError";
}
function escapeCell(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replace(/[\r\n]+/gu, " ")
    .trim();
}
function stageLabel(stage: string): string {
  const known: Record<string, string> = {
    "pi-artifact-extraction": "Artifact extraction",
    "pi-plan": "Planning",
    "pi-development-environment": "Development environment",
    "pi-implementation": "Implementation",
  };
  const fallback = stage.replace(/^pi-/u, "").replace(/[-_]+/gu, " ").trim();
  const label = known[stage] ?? (fallback || "Unknown stage");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}
function row(
  stage: string,
  model: string,
  prompt: number,
  output: number,
  cost: number,
): string {
  return `| ${stage} | ${model} | ${TOKEN_FORMAT.format(prompt)} | ${TOKEN_FORMAT.format(output)} | $${cost.toFixed(4)} |`;
}
export function renderRunCostSection(report: RunCostReport): string {
  const rows = report.stages.flatMap((stage) => {
    const stageRows = stage.models.map((model) =>
      row(
        escapeCell(stageLabel(stage.stage)),
        escapeCell(model.model),
        model.promptTokens,
        model.outputTokens,
        model.estimatedCostUsd,
      ),
    );
    if (stage.models.length > 1)
      stageRows.push(
        `| **${escapeCell(stageLabel(stage.stage))} subtotal** |  | **${TOKEN_FORMAT.format(stage.promptTokens)}** | **${TOKEN_FORMAT.format(stage.outputTokens)}** | **$${stage.estimatedCostUsd.toFixed(4)}** |`,
      );
    return stageRows;
  });
  return [
    START_MARKER,
    "",
    "## Patchmill run cost",
    "",
    "| Stage | Model | Prompt tokens | Output tokens | Estimated cost (USD) |",
    "| ----- | ----- | ------------: | ------------: | -------------------: |",
    ...rows,
    `| **Total** |  | **${TOKEN_FORMAT.format(report.promptTokens)}** | **${TOKEN_FORMAT.format(report.outputTokens)}** | **$${report.estimatedCostUsd.toFixed(4)}** |`,
    "",
    "_Prompt tokens include uncached input, cache reads, and cache writes. Cost is an estimate based on Pi's recorded model pricing and includes parent and subagent sessions._",
    "",
    END_MARKER,
  ].join("\n");
}
function occurrences(body: string, marker: string): number {
  return body.split(marker).length - 1;
}
export function upsertRunCostSection(
  body: string,
  report: RunCostReport,
): string {
  const starts = occurrences(body, START_MARKER),
    ends = occurrences(body, END_MARKER),
    section = renderRunCostSection(report);
  if (starts === 0 && ends === 0)
    return `${body}${body.length === 0 || body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n"}${section}`;
  if (starts !== 1 || ends !== 1)
    throw new PrCostSummaryError("Malformed Patchmill run-cost markers");
  const start = body.indexOf(START_MARKER),
    end = body.indexOf(END_MARKER);
  if (end < start)
    throw new PrCostSummaryError("Malformed Patchmill run-cost markers");
  return `${body.slice(0, start)}${section}${body.slice(end + END_MARKER.length)}`;
}
