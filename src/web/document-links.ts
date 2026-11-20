import { isArtifactFile } from "../kernel/names.ts";
import { createKernelGit } from "../kernel/git.ts";
import type { DocumentLink } from "./api-types.ts";
import {
  artifactDirectories,
  hostFileUrl,
  validBranchName,
  type DocumentRepositoryInput,
} from "./issue-documents.ts";

type RepositoryInput = DocumentRepositoryInput;

/** Cache repository-wide Git observations for one snapshot, not one host period. */
export function createDocumentLinkReader(input: RepositoryInput) {
  const git = createKernelGit(input.runner, input.repoRoot);
  const commits = new Map<string, Promise<string | null>>();
  const trees = new Map<string, Promise<string[]>>();
  return async (
    issue: number,
    branches: readonly string[],
  ): Promise<readonly DocumentLink[]> => {
    hostFileUrl({ ...input, commit: "0", path: "x" });
    const directories = artifactDirectories(input.repoRoot, input.config);
    const refs = [...new Set([...branches, input.baseBranch])];
    const selected: string[] = [];
    for (const branch of refs) {
      if (!validBranchName(branch)) continue;
      if (!commits.has(branch))
        commits.set(
          branch,
          input
            .runner(
              "git",
              [
                "rev-parse",
                "--verify",
                `refs/remotes/origin/${branch}^{commit}`,
              ],
              { cwd: input.repoRoot },
            )
            .then((result) => {
              const sha = result.stdout.trim();
              return result.code === 0 && /^[a-f0-9]{40,64}$/.test(sha)
                ? sha
                : null;
            }),
        );
      const commit = await commits.get(branch)!;
      if (commit) selected.push(commit);
    }
    const links: DocumentLink[] = [];
    for (const { kind, path } of directories) {
      for (const commit of selected) {
        const key = `${commit}:${path}`;
        if (!trees.has(key)) trees.set(key, git.treeFiles(commit, path));
        const files = await trees.get(key)!;
        const name = files
          .filter(
            (name) => !name.includes("/") && isArtifactFile(kind, issue, name),
          )
          .sort()
          .at(-1);
        if (!name) continue;
        links.push({
          kind,
          url: hostFileUrl({ ...input, commit, path: `${path}/${name}` }),
        });
        break;
      }
    }
    return links;
  };
}

/** Convenience for a single issue; board providers share a snapshot-bound reader. */
export function readDocumentLinks(
  input: RepositoryInput & { issue: number; branches: readonly string[] },
): Promise<readonly DocumentLink[]> {
  return createDocumentLinkReader(input)(input.issue, input.branches);
}
