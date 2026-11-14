import { isAbsolute, relative, resolve, sep } from "node:path";
import type { PatchmillConfig } from "../config/config.ts";
import type { HostProviderId } from "../host/types.ts";
import { isArtifactFile } from "../kernel/names.ts";
import { createKernelGit } from "../kernel/git.ts";
import type { CommandRunner } from "../process/command.ts";
import type { DocumentLink } from "./api-types.ts";

export async function readDocumentLinks(input: {
  repoRoot: string;
  config: PatchmillConfig;
  issue: number;
  branches: readonly string[];
  baseBranch: string;
  repositoryUrl: string;
  provider: HostProviderId;
  runner: CommandRunner;
}): Promise<readonly DocumentLink[]> {
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
  const git = createKernelGit(input.runner, input.repoRoot);
  const refs = [...new Set([...input.branches, input.baseBranch])];
  const commits: string[] = [];
  for (const branch of refs) {
    if (!branch || /[\s~^:?*[\\]|\.\./.test(branch)) continue;
    const result = await input.runner(
      "git",
      ["rev-parse", "--verify", `refs/remotes/origin/${branch}^{commit}`],
      { cwd: input.repoRoot },
    );
    const sha = result.stdout.trim();
    if (result.code === 0 && /^[a-f0-9]{40,64}$/.test(sha)) commits.push(sha);
  }
  const links: DocumentLink[] = [];
  for (const { kind, path } of directories) {
    for (const commit of commits) {
      const files = await git.treeFiles(commit, path);
      const name = files
        .filter(
          (name) =>
            !name.includes("/") && isArtifactFile(kind, input.issue, name),
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
}
