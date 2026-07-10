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

test("materializeIssueArtifactSources writes and commits artifacts", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-materialize-"));
  const sources: ResolvedIssueArtifactSources = {
    spec: {
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

test("materializeIssueArtifactSources reuses HEAD when artifacts are already materialized", async () => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "patchmill-materialize-existing-"),
  );
  const path = "docs/specs/2026-07-04-issue-65-design.md";
  const absolutePath = join(repoRoot, path);
  await mkdir(join(repoRoot, "docs", "specs"), { recursive: true });
  await writeFile(absolutePath, "# Spec\nAlready there.\n", "utf8");
  const sources: ResolvedIssueArtifactSources = {
    spec: {
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

test("materializeIssueArtifactSources preflights all artifacts before writing", async () => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "patchmill-materialize-atomic-"),
  );
  const specPath = "docs/specs/2026-07-04-issue-65-design.md";
  const specAbsolutePath = join(repoRoot, specPath);
  const planPath = "docs/plans/2026-07-04-issue-65.md";
  const planAbsolutePath = join(repoRoot, planPath);
  await mkdir(join(repoRoot, "docs", "plans"), { recursive: true });
  await writeFile(
    planAbsolutePath,
    "# Approved Plan\nDo not replace.\n",
    "utf8",
  );
  const calls: Call[] = [];

  await assert.rejects(
    materializeIssueArtifactSources({
      repoRoot,
      runner: runner(calls),
      issueNumber: 65,
      sources: {
        spec: {
          path: specPath,
          absolutePath: specAbsolutePath,
          content: "# New Spec\nDo not write if plan conflicts.",
          evidence: "spec block",
        },
        plan: {
          path: planPath,
          absolutePath: planAbsolutePath,
          content: "# New Plan\nDifferent issue content.",
          evidence: "plan block",
        },
      },
    }),
    /would overwrite existing plan artifact at docs\/plans\/2026-07-04-issue-65\.md/,
  );

  await assert.rejects(readFile(specAbsolutePath, "utf8"), /ENOENT/);
  assert.equal(
    await readFile(planAbsolutePath, "utf8"),
    "# Approved Plan\nDo not replace.\n",
  );
  assert.equal(calls.length, 0);
});

test("materializeIssueArtifactSources rejects mismatched existing artifacts without overwriting", async () => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "patchmill-materialize-mismatch-"),
  );
  const path = "docs/plans/2026-07-04-issue-65.md";
  const absolutePath = join(repoRoot, path);
  await mkdir(join(repoRoot, "docs", "plans"), { recursive: true });
  await writeFile(absolutePath, "# Approved Plan\nDo not replace.\n", "utf8");
  const calls: Call[] = [];

  await assert.rejects(
    materializeIssueArtifactSources({
      repoRoot,
      runner: runner(calls),
      issueNumber: 65,
      sources: {
        plan: {
          path,
          absolutePath,
          content: "# New Plan\nDifferent issue content.",
          evidence: "plan block",
        },
      },
    }),
    /would overwrite existing plan artifact at docs\/plans\/2026-07-04-issue-65\.md/,
  );

  assert.equal(
    await readFile(absolutePath, "utf8"),
    "# Approved Plan\nDo not replace.\n",
  );
  assert.equal(calls.length, 0);
});
