import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  ResolvedIssueArtifactSources,
  ResolvedIssueInlineArtifactSource,
} from "./artifact-sources.ts";
import type { CommandRunner } from "./types.ts";

export type MaterializeIssueArtifactSourcesOptions = {
  repoRoot: string;
  runner: CommandRunner;
  issueNumber: number;
  sources: ResolvedIssueArtifactSources;
};

function commandOutput(result: { stdout: string; stderr: string }): string {
  return (
    [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n") ||
    "no output"
  );
}

function inlineSources(
  sources: ResolvedIssueArtifactSources,
): ResolvedIssueInlineArtifactSource[] {
  return [sources.spec, sources.plan].filter(
    (source): source is ResolvedIssueInlineArtifactSource =>
      source?.sourceType === "inline",
  );
}

function withTrailingNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

async function existingContent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function materializeIssueArtifactSources(
  options: MaterializeIssueArtifactSourcesOptions,
): Promise<ResolvedIssueArtifactSources> {
  const sources = inlineSources(options.sources);
  if (sources.length === 0) return options.sources;

  const writes: Array<{
    source: ResolvedIssueInlineArtifactSource;
    content: string;
  }> = [];
  for (const source of sources) {
    const content = withTrailingNewline(source.content);
    const absolutePath = resolve(options.repoRoot, source.path);
    const existing = await existingContent(absolutePath);
    if (existing !== undefined) {
      if (existing !== content) {
        throw new Error(
          `Issue #${options.issueNumber} inline artifact would overwrite existing ${source.artifactKind} artifact at ${source.path}`,
        );
      }
      continue;
    }
    writes.push({ source: { ...source, absolutePath }, content });
  }

  for (const { source, content } of writes) {
    await mkdir(dirname(source.absolutePath), { recursive: true });
    await writeFile(source.absolutePath, content, "utf8");
  }

  const paths = sources.map((source) => source.path);
  const add = await options.runner.run("git", ["add", ...paths], {
    cwd: options.repoRoot,
  });
  if (add.code !== 0) {
    throw new Error(
      `git add failed while materializing issue #${options.issueNumber} artifacts: ${commandOutput(add)}`,
    );
  }

  const diff = await options.runner.run(
    "git",
    ["diff", "--cached", "--quiet", "--", ...paths],
    { cwd: options.repoRoot },
  );
  if (diff.code !== 0 && diff.code !== 1) {
    throw new Error(
      `git diff failed while materializing issue #${options.issueNumber} artifacts: ${commandOutput(diff)}`,
    );
  }

  if (diff.code === 1) {
    const commit = await options.runner.run(
      "git",
      [
        "commit",
        "-m",
        `docs(workflow): materialize issue ${options.issueNumber} artifacts`,
        "--",
        ...paths,
      ],
      { cwd: options.repoRoot },
    );
    if (commit.code !== 0) {
      throw new Error(
        `git commit failed while materializing issue #${options.issueNumber} artifacts: ${commandOutput(commit)}`,
      );
    }
  }

  const rev = await options.runner.run("git", ["rev-parse", "HEAD"], {
    cwd: options.repoRoot,
  });
  if (rev.code !== 0) {
    throw new Error(
      `git rev-parse failed after materializing issue #${options.issueNumber} artifacts: ${commandOutput(rev)}`,
    );
  }
  const commitSha = rev.stdout.trim();

  return {
    ...options.sources,
    ...(options.sources.spec?.sourceType === "inline"
      ? { spec: { ...options.sources.spec, commit: commitSha } }
      : {}),
    ...(options.sources.plan?.sourceType === "inline"
      ? { plan: { ...options.sources.plan, commit: commitSha } }
      : {}),
  };
}
