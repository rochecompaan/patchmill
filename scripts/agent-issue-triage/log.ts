import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TriageLog } from "./types.ts";

function safeTimestamp(timestamp: string): string {
  return timestamp.replaceAll(":", "-").replaceAll(".", "-");
}

export async function writeTriageLog(logDir: string, log: TriageLog): Promise<string> {
  await mkdir(logDir, { recursive: true });
  const path = join(logDir, `triage-${safeTimestamp(log.createdAt)}.json`);
  await writeFile(path, `${JSON.stringify(log, null, 2)}\n`, "utf8");
  return path;
}
