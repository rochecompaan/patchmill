import fs from "node:fs/promises";
import { join } from "node:path";

type RecordedOutcome = {
  status?: unknown;
  label?: unknown;
  summary?: unknown;
  publicationErrors?: unknown;
};

/**
 * The outcome in the newest earlier `result.json` of an issue, other than the
 * run `runId`. Newest is the latest `finishedAt`, then the latest file change.
 * Unreadable results are skipped.
 */
async function previousOutcome(
  issueDir: string,
  runId: string,
): Promise<RecordedOutcome | undefined> {
  const entries = await fs
    .readdir(issueDir, { withFileTypes: true })
    .catch(() => []);
  let newest:
    | { finishedAt: string; mtimeMs: number; outcome: RecordedOutcome }
    | undefined;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === runId) continue;
    const path = join(issueDir, entry.name, "result.json");
    try {
      const [text, stat] = await Promise.all([
        fs.readFile(path, "utf8"),
        fs.stat(path),
      ]);
      const record = JSON.parse(text) as {
        finishedAt?: unknown;
        outcome?: unknown;
      };
      if (
        typeof record.finishedAt !== "string" ||
        typeof record.outcome !== "object" ||
        record.outcome === null
      )
        continue;
      const candidate = {
        finishedAt: record.finishedAt,
        mtimeMs: stat.mtimeMs,
        outcome: record.outcome as RecordedOutcome,
      };
      if (
        !newest ||
        candidate.finishedAt > newest.finishedAt ||
        (candidate.finishedAt === newest.finishedAt &&
          candidate.mtimeMs > newest.mtimeMs)
      )
        newest = candidate;
    } catch {
      // A missing or unreadable result is not evidence of a publication.
    }
  }
  return newest?.outcome;
}

/**
 * Whether the previous run of the issue already published this gate wait:
 * a stopped In Progress outcome with the same summary and no failed
 * publication.
 */
export async function gateWaitPublished(input: {
  issueDir: string;
  runId: string;
  summary: string;
}): Promise<boolean> {
  const previous = await previousOutcome(input.issueDir, input.runId);
  return (
    previous?.status === "stopped" &&
    previous.label === "inProgress" &&
    previous.summary === input.summary &&
    !(
      Array.isArray(previous.publicationErrors) &&
      previous.publicationErrors.length > 0
    )
  );
}
