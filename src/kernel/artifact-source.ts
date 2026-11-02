import fs from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isArtifactFile, type ArtifactKind } from "./names.ts";
import type { KernelGit } from "./git.ts";

// Artifacts come from the worktree when it exists, otherwise from the ref
// provisioning would check out, so observing never creates either.
type ArtifactSource = {
  find(directory: string, kind: ArtifactKind): Promise<string | undefined>;
  sameFile(a: string, b: string): Promise<boolean>;
  matchBase(base: string, paths: string[]): Promise<boolean>;
};

function assertContained(root: string, path: string): void {
  const delta = relative(root, path);
  if (delta === ".." || delta.startsWith(`..${sep}`) || isAbsolute(delta))
    throw new Error(`Artifact directory outside the worktree: ${path}`);
}

function newest(
  names: string[],
  kind: ArtifactKind,
  issue: number,
): string | undefined {
  return names
    .filter((name) => isArtifactFile(kind, issue, name))
    .sort()
    .at(-1);
}

export function worktreeArtifacts(
  git: KernelGit,
  worktree: string,
  issue: number,
): ArtifactSource {
  return {
    async find(directory, kind) {
      const path = resolve(worktree, directory);
      assertContained(worktree, path);
      const root = await fs.realpath(worktree);
      try {
        assertContained(root, await fs.realpath(path));
        const entries = await fs.readdir(path, { withFileTypes: true });
        const name = newest(
          entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
          kind,
          issue,
        );
        return name === undefined
          ? undefined
          : relative(worktree, join(path, name));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return undefined;
        throw error;
      }
    },
    async sameFile(a, b) {
      const [first, second] = await Promise.all(
        [a, b].map((path) => fs.stat(join(worktree, path))),
      );
      return first!.dev === second!.dev && first!.ino === second!.ino;
    },
    matchBase: (base, paths) =>
      git.baseArtifactsMatch({ worktree }, base, paths),
  };
}

export function refArtifacts(
  git: KernelGit,
  worktree: string,
  ref: string,
  issue: number,
): ArtifactSource {
  return {
    async find(directory, kind) {
      const path = resolve(worktree, directory);
      assertContained(worktree, path);
      const tree = relative(worktree, path);
      const name = newest(await git.treeFiles(ref, tree), kind, issue);
      return name === undefined ? undefined : join(tree, name);
    },
    // Git trees cannot hardlink two paths to one file.
    sameFile: async () => false,
    matchBase: (base, paths) => git.baseArtifactsMatch({ ref }, base, paths),
  };
}
