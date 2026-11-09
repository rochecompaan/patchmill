import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { stateDir } from "./store.ts";

/** Check the nearest existing ancestor without creating local state. */
export async function checkStateWritable(repoRoot: string): Promise<void> {
  let path = stateDir(repoRoot);
  for (;;) {
    try {
      if (!(await stat(path)).isDirectory())
        throw new Error(`Not a directory: ${path}`);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      path = dirname(path);
    }
  }
  try {
    await access(path, constants.W_OK);
  } catch {
    throw new Error(`Not writable: ${path}`);
  }
}
