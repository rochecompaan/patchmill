import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PlanningStateV1 } from "../../src/workflow/planning-state-store.ts";
import type { PlanningScenarioPull } from "./planning-provider-scenario-types.ts";

const run = promisify(execFile);

type GitResult = Readonly<{ code: number; stdout: string; stderr: string }>;
type ScenarioPaths = Readonly<{
  repoRoot: string;
  worktreeDir: string;
  specsDir: string;
  plansDir: string;
}>;

export async function git(cwd: string, args: string[]): Promise<GitResult> {
  try {
    const result = await run("git", args, { cwd, encoding: "utf8" });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failure.code ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

/** Owns the temporary repository and bare remote used by provider scenarios. */
export async function createPlanningScenarioRepository(paths: ScenarioPaths) {
  const remote = join(paths.repoRoot, "remote.git");
  await mkdir(paths.worktreeDir, { recursive: true });
  await git(paths.repoRoot, ["init", "--initial-branch=main"]);
  await git(paths.repoRoot, ["config", "user.email", "test@example.test"]);
  await git(paths.repoRoot, ["config", "user.name", "Test"]);
  await writeFile(join(paths.repoRoot, "README.md"), "# test\n", "utf8");
  await writeFile(join(paths.specsDir, ".gitkeep"), "", "utf8");
  await writeFile(join(paths.plansDir, ".gitkeep"), "", "utf8");
  await git(paths.repoRoot, ["add", "README.md", "docs"]);
  await git(paths.repoRoot, ["commit", "-m", "initial"]);
  await git(paths.repoRoot, ["init", "--bare", remote]);
  await git(paths.repoRoot, ["remote", "add", "origin", remote]);
  await git(paths.repoRoot, ["push", "-u", "origin", "main"]);
  return {
    remote,
    remoteRefs: async () => {
      const result = await git(remote, [
        "for-each-ref",
        "--format=%(refname:strip=2) %(objectname)",
        "refs/heads",
      ]);
      assert.equal(result.code, 0, result.stderr);
      return Object.fromEntries(
        result.stdout
          .trim()
          .split("\n")
          .filter((line) => line !== "")
          .map((line) => line.split(" ") as [string, string]),
      );
    },
    cleanup: () => rm(paths.repoRoot, { recursive: true, force: true }),
  };
}

export async function mergePlanningPull(input: {
  repoRoot: string;
  pulls: PlanningScenarioPull[];
  editArtifact?: (content: string) => string;
}) {
  const pull = input.pulls.find((item) => item.number !== 99 && !item.merged);
  assert.ok(pull, "an open planning pull request must exist");
  const merged = await git(input.repoRoot, [
    "merge",
    "--no-ff",
    `origin/${pull.branch}`,
    "-m",
    "merge planning",
  ]);
  assert.equal(merged.code, 0, merged.stderr);
  if (input.editArtifact !== undefined) {
    const paths = (
      await git(input.repoRoot, ["diff", "--name-only", "HEAD^1", "HEAD"])
    ).stdout
      .split("\n")
      .filter((path) =>
        pull.body.includes("phase=spec")
          ? path.startsWith("docs/specs/")
          : path.startsWith("docs/plans/"),
      );
    assert.equal(paths.length, 1, "planning pull must contain one artifact");
    const path = paths[0]!;
    const before = await readFile(join(input.repoRoot, path), "utf8");
    await writeFile(
      join(input.repoRoot, path),
      input.editArtifact(before),
      "utf8",
    );
    const added = await git(input.repoRoot, ["add", path]);
    assert.equal(added.code, 0, added.stderr);
    const amended = await git(input.repoRoot, [
      "commit",
      "--amend",
      "--no-edit",
    ]);
    assert.equal(amended.code, 0, amended.stderr);
  }
  pull.mergeOid = (
    await git(input.repoRoot, ["rev-parse", "HEAD"])
  ).stdout.trim();
  pull.merged = true;
  await git(input.repoRoot, ["push", "origin", "main"]);
}

export async function recordCarriedArtifacts(
  cwd: string,
  carriedArtifacts: Map<string, string>,
) {
  const paths = (
    await git(cwd, ["ls-files", "docs/specs", "docs/plans"])
  ).stdout
    .split("\n")
    .filter((path) => path !== "" && !path.endsWith(".gitkeep"));
  for (const path of paths)
    carriedArtifacts.set(path, await readFile(join(cwd, path), "utf8"));
}

export async function remoteArtifactContents(
  repoRoot: string,
  state: PlanningStateV1 | undefined,
) {
  const artifacts =
    state?.phases.flatMap((phase) =>
      "artifacts" in phase ? phase.artifacts : [],
    ) ?? [];
  assert.equal(
    new Set(artifacts.map((artifact) => artifact.kind)).size,
    artifacts.length,
    "each artifact kind must have one durable source",
  );
  return Object.fromEntries(
    await Promise.all(
      artifacts.map(async (artifact) => {
        const result = await git(repoRoot, [
          "show",
          `${artifact.commitOid}:${artifact.path}`,
        ]);
        assert.equal(result.code, 0, result.stderr);
        return [artifact.path, result.stdout] as const;
      }),
    ),
  );
}
