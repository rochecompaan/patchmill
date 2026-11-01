import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

/** Choose by issue and file age only; conversation contents are not inputs. */
export async function openIssueConsoleSession(
  cwd: string,
  runsDir: string,
  issue: number,
): Promise<SessionManager> {
  const dir = resolve(cwd, runsDir, `issue-${issue}`, "console");
  const files = await readdir(dir, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const sessions = await Promise.all(
    files
      .filter((file) => file.isFile() && file.name.endsWith(".jsonl"))
      .map(async (file) => {
        const path = resolve(dir, file.name);
        return { path, modified: (await stat(path)).mtimeMs };
      }),
  );
  sessions.sort(
    (a, b) => b.modified - a.modified || b.path.localeCompare(a.path),
  );
  return sessions[0]
    ? SessionManager.open(sessions[0].path, dir, cwd)
    : SessionManager.create(cwd, dir);
}
