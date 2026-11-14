import type { RunDataSnapshot, RunDataSource } from "./run-data.ts";
import { sampleBoard } from "./samples/board.ts";
import { sampleArtifacts } from "./samples/artifacts.ts";
import { sampleThreads } from "./samples/threads.ts";

function freeze(value: unknown): void {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
}

/** A deterministic read-only projection; no host, filesystem, or run access. */
export function createSampleRunDataSource(): RunDataSource {
  const snapshot: RunDataSnapshot = {
    repository: {
      name: "rochecompaan/patchmill",
      url: "https://github.com/rochecompaan/patchmill",
    },
    source: "sample",
    revision: "sample-v1",
    syncedAt: null,
    issues: sampleBoard,
    details: Object.fromEntries(
      sampleBoard.map((summary) => [
        String(summary.number),
        {
          summary,
          ...sampleThreads[String(summary.number)]!,
          artifacts: sampleArtifacts[String(summary.number)] ?? [],
        },
      ]),
    ),
  };
  freeze(snapshot);
  return { snapshot: async () => snapshot, subscribe: () => () => {} };
}
