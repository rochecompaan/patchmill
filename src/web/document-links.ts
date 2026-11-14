import { isAbsolute, relative, resolve, sep } from "node:path";
import type { PatchmillConfig } from "../config/config.ts";
import type { HostProviderId } from "../host/types.ts";
import { isArtifactFile } from "../kernel/names.ts";
import { createKernelGit } from "../kernel/git.ts";
import type { CommandRunner } from "../process/command.ts";
import type { DocumentLink } from "./api-types.ts";

type RepositoryInput = {
  repoRoot: string;
  config: PatchmillConfig;
  baseBranch: string;
  repositoryUrl: string;
  provider: HostProviderId;
  runner: CommandRunner;
};

/** Cache repository-wide Git observations for one snapshot, not one host period. */
export function createDocumentLinkReader(input: RepositoryInput) {
  const git = createKernelGit(input.runner, input.repoRoot);
  const commits = new Map<string, Promise<string | null>>();
  const trees = new Map<string, Promise<string[]>>();
  return async (
    issue: number,
    branches: readonly string[],
  ): Promise<readonly DocumentLink[]> => {
    const origin = new URL(input.repositoryUrl);
    if (
      !["https:", "http:"].includes(origin.protocol) ||
      origin.username ||
      origin.password
    )
      throw Error("Invalid repository URL.");
    const directories = (["spec", "plan"] as const).map((kind) => {
      const path = relative(
        input.repoRoot,
        resolve(
          input.repoRoot,
          kind === "spec"
            ? input.config.paths.specsDir
            : input.config.paths.plansDir,
        ),
      );
      if (
        !path ||
        path === ".." ||
        path.startsWith(`..${sep}`) ||
        isAbsolute(path)
      )
        throw Error("Artifact directory is outside the repository.");
      return { kind, path: path.split(sep).join("/") };
    });
    const refs = [...new Set([...branches, input.baseBranch])];
    const selected: string[] = [];
    for (const branch of refs) {
      if (!branch || /[\s~^:?*[\\]|\.\./.test(branch)) continue;
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
        const encoded = `${path}/${name}`
          .split("/")
          .map(encodeURIComponent)
          .join("/");
        links.push({
          kind,
          url: `${origin.href.replace(/\/$/, "")}/${input.provider === "github-gh" ? "blob" : "src/commit"}/${commit}/${encoded}`,
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
