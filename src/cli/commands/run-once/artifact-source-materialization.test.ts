import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedIssueArtifactSources } from "./artifact-sources.ts";
import { materializeIssueArtifactSources } from "./artifact-source-materialization.ts";
import type { CommandRunner } from "./types.ts";

type Call = { command: string; args: string[]; cwd?: string };

function runner(calls: Call[]): CommandRunner {
  return {
    async run(command, args, options) {
      calls.push({ command, args, cwd: options?.cwd });
      if (command === "git" && args[0] === "diff") {
        return { code: 1, stdout: "", stderr: "" };
      }
      if (command === "git" && args[0] === "rev-parse") {
        return { code: 0, stdout: "abc123\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

test("materializeIssueArtifactSources writes and commits inline artifacts", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-materialize-"));
  const sources: ResolvedIssueArtifactSources = {
    spec: {
      artifactKind: "spec",
      sourceType: "inline",
      path: "docs/specs/2026-07-04-issue-65-design.md",
      absolutePath: join(
        repoRoot,
        "docs",
        "specs",
        "2026-07-04-issue-65-design.md",
      ),
      content: "# Spec\nUse source resolution.",
      evidence: "## Spec",
    },
    plan: {
      artifactKind: "plan",
      sourceType: "inline",
      path: "docs/plans/2026-07-04-issue-65.md",
      absolutePath: join(repoRoot, "docs", "plans", "2026-07-04-issue-65.md"),
      content: "# Plan\n- [ ] Implement source resolution.",
      evidence: "## Plan",
    },
  };
  const calls: Call[] = [];

  const materialized = await materializeIssueArtifactSources({
    repoRoot,
    runner: runner(calls),
    issueNumber: 65,
    sources,
  });

  assert.equal(
    await readFile(join(repoRoot, sources.spec!.path), "utf8"),
    "# Spec\nUse source resolution.\n",
  );
  assert.equal(
    await readFile(join(repoRoot, sources.plan!.path), "utf8"),
    "# Plan\n- [ ] Implement source resolution.\n",
  );
  assert.equal(materialized.spec?.commit, "abc123");
  assert.equal(materialized.plan?.commit, "abc123");
  assert.deepEqual(
    calls.filter((call) => call.command === "git").map((call) => call.args[0]),
    ["add", "diff", "commit", "rev-parse"],
  );
});

test("materializeIssueArtifactSources reuses HEAD when inline artifacts are already materialized", async () => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "patchmill-materialize-existing-"),
  );
  const path = "docs/specs/2026-07-04-issue-65-design.md";
  const absolutePath = join(repoRoot, path);
  await mkdir(join(repoRoot, "docs", "specs"), { recursive: true });
  await writeFile(absolutePath, "# Spec\nAlready there.\n", "utf8");
  const sources: ResolvedIssueArtifactSources = {
    spec: {
      artifactKind: "spec",
      sourceType: "inline",
      path,
      absolutePath,
      content: "# Spec\nAlready there.",
      evidence: "## Spec",
    },
  };
  const calls: Call[] = [];
  const materialized = await materializeIssueArtifactSources({
    repoRoot,
    runner: {
      async run(command, args, options) {
        calls.push({ command, args, cwd: options?.cwd });
        if (command === "git" && args[0] === "commit") {
          return { code: 1, stdout: "", stderr: "nothing to commit" };
        }
        if (command === "git" && args[0] === "rev-parse") {
          return { code: 0, stdout: "existing123\n", stderr: "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    },
    issueNumber: 65,
    sources,
  });

  assert.equal(
    await readFile(absolutePath, "utf8"),
    "# Spec\nAlready there.\n",
  );
  assert.equal(materialized.spec?.commit, "existing123");
  assert.deepEqual(
    calls.filter((call) => call.command === "git").map((call) => call.args[0]),
    ["add", "diff", "rev-parse"],
  );
});

test("materializeIssueArtifactSources leaves path sources unchanged", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-materialize-path-"));
  const sources: ResolvedIssueArtifactSources = {
    spec: {
      artifactKind: "spec",
      sourceType: "path",
      path: "docs/specs/existing.md",
      absolutePath: join(repoRoot, "docs", "specs", "existing.md"),
      evidence: "Spec: docs/specs/existing.md",
    },
  };
  const calls: Call[] = [];

  const materialized = await materializeIssueArtifactSources({
    repoRoot,
    runner: runner(calls),
    issueNumber: 65,
    sources,
  });

  assert.equal(materialized.spec?.path, "docs/specs/existing.md");
  assert.equal(materialized.spec?.commit, undefined);
  assert.equal(calls.length, 0);
});
