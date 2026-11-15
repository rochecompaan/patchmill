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
  const issues = sampleBoard.map((summary) => ({
    ...summary,
    live: summary.status === "working",
    documentLinks: [],
    artifacts: (sampleArtifacts[String(summary.number)] ?? []).map(
      ({ id, kind, title }) => ({ id, kind, title }),
    ),
  }));
  const snapshot: RunDataSnapshot = {
    repository: {
      name: "rochecompaan/patchmill",
      url: "https://github.com/rochecompaan/patchmill",
    },
    source: "sample",
    revision: "sample-v1",
    syncedAt: null,
    issues,
    details: Object.fromEntries(
      issues.map((summary) => {
        const thread = sampleThreads[String(summary.number)];
        if (!thread)
          throw new Error(
            `Missing sample thread for issue #${summary.number}.`,
          );
        return [
          String(summary.number),
          {
            summary,
            body: null,
            run: null,
            ...thread,
            artifacts: sampleArtifacts[String(summary.number)] ?? [],
          },
        ];
      }),
    ),
  };
  freeze(snapshot);
  return {
    snapshot: async () => snapshot,
    subscribe: ({ issue }, listener) => {
      const detail = snapshot.details[String(issue)];
      listener(
        detail
          ? {
              kind: "reset",
              id: "00000000-1",
              issue: { schemaVersion: 1, ...snapshot, issue: detail },
            }
          : { kind: "unavailable", id: "00000000-1" },
      );
      return () => {};
    },
  };
}
