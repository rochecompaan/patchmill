import fs from "node:fs/promises";
import { join } from "node:path";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { PhaseRun } from "../kernel/launch.ts";

export type ConsoleSession = Pick<SessionManager, "getEntries">;

/** Retain only launch-local conversational evidence, preserving Pi usage and IDs. */
export async function recordPlanningUsage(
  session: ConsoleSession | undefined,
  sessionDir: string,
  plan: () => Promise<PhaseRun>,
  options: { prompt?: string; warn?: (message: string) => void } = {},
): Promise<PhaseRun> {
  const start = session?.getEntries().length ?? 0;
  const run = await plan();
  const entries =
    session
      ?.getEntries()
      .slice(start)
      .filter(
        (entry) =>
          entry.type === "message" &&
          ["user", "assistant", "toolResult"].includes(entry.message.role),
      ) ?? [];
  const records: unknown[] = entries.map((entry) => {
    if (entry.type !== "message" || !("content" in entry.message)) return entry;
    const content = entry.message.content;
    const text =
      typeof content === "string"
        ? content
        : content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n");
    return {
      ...entry,
      ...(entry.message.role === "user" &&
      options.prompt !== undefined &&
      text === options.prompt
        ? { patchmillPrompt: true }
        : {}),
      message: {
        ...entry.message,
        content:
          typeof content === "string"
            ? content
            : content.filter(
                (block) => block.type === "text" || block.type === "toolCall",
              ),
      },
    };
  });
  if (
    !entries.some(
      (entry) => entry.type === "message" && entry.message.role === "assistant",
    )
  )
    records.push({
      type: "usage",
      model: "No reply",
      usage: { input: 0, output: 0, cost: { total: 0 } },
    });
  try {
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(
      join(sessionDir, "console-planning.jsonl"),
      records.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    );
  } catch {
    try {
      (options.warn ?? console.warn)(
        "Could not retain optional planning transcript.",
      );
    } catch {
      /* Keep the accepted phase result. */
    }
  }
  return run;
}
