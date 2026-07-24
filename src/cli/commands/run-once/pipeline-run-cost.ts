import { summarizeRunCost } from "./run-cost-files.ts";
import { parseRunCostReport, type RunCostReport } from "./run-cost.ts";
export type ResolvePipelineRunCostOptions = {
  implementationKind: "implemented" | "already-implemented";
  implementationStatus: "pr-created" | "merged";
  piSessionPath?: string;
  persistedReport?: unknown;
  calculate?: (piSessionPath: string) => Promise<RunCostReport>;
  warn(message: string, error?: unknown): void | Promise<void>;
};
export async function resolvePipelineRunCost(
  options: ResolvePipelineRunCostOptions,
): Promise<RunCostReport | undefined> {
  if (options.implementationStatus !== "pr-created") return undefined;
  if (options.implementationKind === "already-implemented") {
    const report = parseRunCostReport(options.persistedReport);
    if (!report)
      await options.warn(
        "Patchmill cannot publish a run-cost summary from legacy or invalid saved state",
      );
    return report;
  }
  if (!options.piSessionPath) {
    await options.warn("Patchmill could not calculate the PR run-cost summary");
    return undefined;
  }
  try {
    return await (options.calculate ?? summarizeRunCost)(options.piSessionPath);
  } catch (error) {
    await options.warn(
      "Patchmill could not calculate the PR run-cost summary",
      error,
    );
    return undefined;
  }
}
