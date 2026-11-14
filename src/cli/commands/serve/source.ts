import { loadConfig } from "../../../config/config.ts";
import { createHost } from "../../../host/factory.ts";
import { createKernelGit } from "../../../kernel/git.ts";
import type { CommandRunner } from "../../../process/command.ts";
import { createFileRunDataSource } from "../../../web/file-run-data.ts";
import { createSampleRunDataSource } from "../../../web/sample-data.ts";
import type { RunDataSource } from "../../../web/run-data.ts";

export async function createServeSource(input: {
  sample: boolean;
  repoRoot: string;
  runner: CommandRunner;
  warn: (message: string) => void;
}): Promise<RunDataSource> {
  if (input.sample) return createSampleRunDataSource();
  const config = await loadConfig(input.repoRoot);
  const host = createHost(config, input.runner, input.repoRoot);
  const repository = await host.repository();
  const slug = `${repository.owner}/${repository.repo}`;
  const target = await host.getRepository({ ...repository, slug });
  if (!target) throw Error("Could not resolve the repository URL.");
  const pushSlug = await host.pushRepository();
  const [owner, repo] = pushSlug.split("/") as [string, string];
  const pushed =
    slug.toLowerCase() === pushSlug.toLowerCase()
      ? target
      : await host.getRepository({ owner, repo, slug: pushSlug });
  if (!pushed) throw Error("Could not resolve the push repository URL.");
  const baseBranch =
    config.git.baseBranch ??
    (await createKernelGit(
      input.runner,
      input.repoRoot,
    ).remoteDefaultBranch()) ??
    repository.defaultBranch;
  return createFileRunDataSource({
    ...input,
    config,
    host,
    now: () => new Date(),
    metadata: {
      repository: { name: slug, url: target.publicUrl },
      baseBranch,
      pushRepository: { slug: pushSlug, url: pushed.publicUrl },
    },
  });
}
