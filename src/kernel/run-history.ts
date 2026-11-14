import fs from "node:fs/promises";
import { join } from "node:path";
import type { RunProgress } from "./run-progress.ts";
import type { Phase } from "./phase.ts";
import type { WorkflowStage } from "./planning-workspace.ts";

type Payload =
  | { kind: "snapshot"; progress: RunProgress }
  | { kind: "session"; number: number; phase: Phase; stage: WorkflowStage }
  | { kind: "progress"; stream: "stdout" | "stderr"; text: string };

/** Best-effort diagnostics only. The kernel never reads this history to decide work. */
export function createRunHistory(input: {
  issue: number;
  runId: string;
  runDir: string;
  now: () => Date;
  warn: (message: string) => void;
}) {
  let sequence = 0;
  let pending = Promise.resolve();
  function append(payload: Payload): Promise<void> {
    const record = {
      schemaVersion: 1,
      issue: input.issue,
      runId: input.runId,
      sequence: ++sequence,
      at: input.now().toISOString(),
      ...payload,
    };
    pending = pending.then(async () => {
      try {
        await fs.mkdir(input.runDir, { recursive: true });
        await fs.appendFile(
          join(input.runDir, "history.jsonl"),
          JSON.stringify(record) + "\n",
        );
      } catch {
        try {
          input.warn("Could not retain optional run history.");
        } catch {
          /* Diagnostic sinks cannot change execution. */
        }
      }
    });
    return pending;
  }
  return {
    snapshot: (progress: RunProgress) => append({ kind: "snapshot", progress }),
    session: (session: {
      number: number;
      phase: Phase;
      stage: WorkflowStage;
    }) => append({ kind: "session", ...session }),
    progress: (stream: "stdout" | "stderr", text: string) =>
      append({ kind: "progress", stream, text }),
  };
}
