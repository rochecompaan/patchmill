import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiSessionObservationStreamer } from "../run-once/pi-session-stream.ts";
import type { TriageToolCallHandler } from "./types.ts";

export async function runWithToolCallObservation<T>(
  onToolCall: TriageToolCallHandler | undefined,
  run: (sessionDir: string | undefined) => Promise<T>,
): Promise<T> {
  if (!onToolCall) return run(undefined);

  const sessionDir = await mkdtemp(join(tmpdir(), "patchmill-triage-pi-"));
  const pendingToolCalls: Promise<void>[] = [];
  const streamer = createPiSessionObservationStreamer(sessionDir, (event) => {
    if (event.type !== "tool-call") return;
    pendingToolCalls.push(
      Promise.resolve()
        .then(() => onToolCall(event))
        .then(() => undefined),
    );
  });

  streamer.start();
  try {
    return await run(sessionDir);
  } finally {
    try {
      await streamer.stop();
      await Promise.all(pendingToolCalls);
    } finally {
      await rm(sessionDir, { recursive: true, force: true });
    }
  }
}
