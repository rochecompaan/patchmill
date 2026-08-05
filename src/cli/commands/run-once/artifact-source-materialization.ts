import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  ResolvedIssueArtifactSource,
  ResolvedIssueArtifactSources,
} from "./artifact-sources.ts";
import type { CommandRunner } from "./types.ts";

type ArtifactEntry = {
  kind: "spec" | "plan";
  source: ResolvedIssueArtifactSource;
};

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

function artifactEntries(
  sources: ResolvedIssueArtifactSources,
): ArtifactEntry[] {
  return [
    ...(sources.spec ? [{ kind: "spec" as const, source: sources.spec }] : []),
    ...(sources.plan ? [{ kind: "plan" as const, source: sources.plan }] : []),
  ];
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

type ArtifactWrite = {
  entry: ArtifactEntry;
  content: string;
};

async function materializationWrites(input: {
  repoRoot: string;
  issueNumber: number;
  sources: ResolvedIssueArtifactSources;
}): Promise<ArtifactWrite[]> {
  const writes: ArtifactWrite[] = [];
  for (const entry of artifactEntries(input.sources)) {
    const content = withTrailingNewline(entry.source.content);
    const absolutePath = resolve(input.repoRoot, entry.source.path);
    const existing = await existingContent(absolutePath);
    if (existing !== undefined) {
      if (existing !== content) {
        throw new Error(
          `Issue #${input.issueNumber} artifact would overwrite existing ${entry.kind} artifact at ${entry.source.path}`,
        );
      }
      continue;
    }
    writes.push({
      entry: {
        kind: entry.kind,
        source: { ...entry.source, absolutePath },
      },
      content,
    });
  }
  return writes;
}

export async function assertIssueArtifactSourcesMaterializable(input: {
  repoRoot: string;
  issueNumber: number;
  sources: ResolvedIssueArtifactSources;
}): Promise<void> {
  await materializationWrites(input);
}

export async function materializeIssueArtifactSources(
  options: MaterializeIssueArtifactSourcesOptions,
): Promise<ResolvedIssueArtifactSources> {
  const entries = artifactEntries(options.sources);
  if (entries.length === 0) return options.sources;

  const writes = await materializationWrites(options);

  for (const { entry, content } of writes) {
    await mkdir(dirname(entry.source.absolutePath), { recursive: true });
    await writeFile(entry.source.absolutePath, content, "utf8");
  }

  const paths = entries.map((entry) => entry.source.path);
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
    ...(options.sources.spec
      ? { spec: { ...options.sources.spec, commit: commitSha } }
      : {}),
    ...(options.sources.plan
      ? { plan: { ...options.sources.plan, commit: commitSha } }
      : {}),
  };
}
