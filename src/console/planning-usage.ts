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
  const records =
    entries.length > 0
      ? entries
      : [
          {
            type: "usage",
            model: "No reply",
            usage: { input: 0, output: 0, cost: { total: 0 } },
          },
        ];
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    join(sessionDir, "console-planning.jsonl"),
    records.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  );
  return run;
}
