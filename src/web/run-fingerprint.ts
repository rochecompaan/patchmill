import { join, resolve } from "node:path";
import type { PatchmillConfig } from "../config/config.ts";
import { probeIssueLock } from "../kernel/lock.ts";
import { runFiles } from "./run-files.ts";
import { runName } from "./file-run-records.ts";

/** Metadata only. Never opens a transcript or trusts paths from record contents. */
export async function issueFingerprint(input: {
  repoRoot: string;
  config: PatchmillConfig;
  issue: number;
  warn(message: string): void;
}): Promise<string> {
  const root = resolve(input.repoRoot, input.config.paths.runsDir);
  const dir = join(root, `issue-${input.issue}`);
  const files = runFiles(root, input.warn);
  const parts: unknown[] = [];
  const add = async (path: string) => {
    parts.push([path, await files.metadata(path)]);
  };
  await add(join(dir, "progress.json"));
  const lock = join(dir, "lock");
  await add(lock);
  if (await files.metadata(lock)) parts.push(await probeIssueLock(lock));
  for (const attempt of await files.list(dir)) {
    if (!attempt.isDirectory() || !runName.test(attempt.name)) continue;
    const run = join(dir, attempt.name);
    await add(join(run, "result.json"));
    await add(join(run, "history.jsonl"));
    for (const session of await files.list(join(run, "sessions"))) {
      if (!session.isDirectory() || !/^[1-9]\d*$/.test(session.name)) continue;
      const sessionDir = join(run, "sessions", session.name);
      for (const log of await files.list(sessionDir))
        if (log.isFile() && log.name.endsWith(".jsonl"))
          await add(join(sessionDir, log.name));
    }
  }
  return JSON.stringify(parts);
}
