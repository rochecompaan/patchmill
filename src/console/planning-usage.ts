import fs from "node:fs/promises";
import { join } from "node:path";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { PhaseRun } from "../kernel/launch.ts";

export type ConsoleSession = Pick<SessionManager, "getEntries">;

/** Copy only assistant entries accrued by this launch, preserving Pi IDs for deduplication. */
export async function recordPlanningUsage(
  session: ConsoleSession | undefined,
  sessionDir: string,
  plan: () => Promise<PhaseRun>,
): Promise<PhaseRun> {
  const start = session?.getEntries().length ?? 0;
  const run = await plan();
  const entries =
    session
      ?.getEntries()
      .slice(start)
      .filter(
        (entry) =>
          entry.type === "message" && entry.message.role === "assistant",
      ) ?? [];
  if (entries.length > 0) {
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(
      join(sessionDir, "console-planning.jsonl"),
      entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    );
  }
  return run;
}
