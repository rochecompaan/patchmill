import { lstat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

export async function assertExecutionArtifactDestination(input: {
  repoRoot: string;
  issueNumber: number;
  kind: "spec" | "plan";
  path: string;
}): Promise<string> {
  const destination = resolve(input.repoRoot, input.path);
  const fail = (reason: string): never => {
    throw new Error(
      `Issue #${input.issueNumber} ${input.kind} artifact ${input.path} has an unsafe execution destination ${destination}: ${reason}`,
    );
  };
  const parts = input.path.split("/");
  if (
    isAbsolute(input.path) ||
    /^[a-z]:/iu.test(input.path) ||
    input.path.includes("\\") ||
    parts.some((part) => !part || part === "." || part === "..")
  )
    fail("path must stay inside the execution worktree");
  let parent = resolve(input.repoRoot);
  for (const [index, part] of parts.entries()) {
    parent = join(parent, part);
    try {
      const info = await lstat(parent);
      if (info.isSymbolicLink()) fail("symbolic links are not allowed");
      if (index === parts.length - 1 ? !info.isFile() : !info.isDirectory())
        fail(
          index === parts.length - 1
            ? "destination is not a regular file"
            : "parent is not a directory",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
  return destination;
}
