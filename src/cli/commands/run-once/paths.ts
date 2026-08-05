import { access, stat } from "node:fs/promises";

function isMissingPathError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw new Error(`Failed to access path ${path}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

export async function pathIsRegularFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw new Error(`Failed to inspect path ${path}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}
