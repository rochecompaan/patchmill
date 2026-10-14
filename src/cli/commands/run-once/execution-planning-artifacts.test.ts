import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { materializeIssueArtifactSources } from "./artifact-source-materialization.ts";
import { materializeExecutionPlanningArtifacts } from "./execution-planning-artifacts.ts";
import type { ResolvedIssueArtifactSources } from "./artifact-sources.ts";

for (const content of [
  "# Existing approved plan\n",
  "# Existing approved plan",
]) {
  test(`execution verification preserves the source snapshot and saved commit (trailing newline: ${content.endsWith("\n")})`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "execution-artifact-receipt-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const repoRoot = join(root, "execution");
    const path = "docs/plans/issue-140.md";
    await mkdir(dirname(join(repoRoot, path)), { recursive: true });
    await writeFile(join(repoRoot, path), content);
    const source = {
      path,
      absolutePath: join(root, "source", path),
      content,
      evidence: "selected repository fallback",
      commit: "a".repeat(40),
    };
    const sources: ResolvedIssueArtifactSources = { plan: source };
    let gitCalls = 0;
    const policy = {
      kind: "implementation-resume" as const,
      primary: {
        repoRoot,
        specsDir: join(repoRoot, "docs/specs"),
        plansDir: join(repoRoot, "docs/plans"),
        source: "resume-worktree" as const,
      },
      fallbacks: [],
      saved: { planPath: path, planCommit: "b".repeat(40) },
    };
    const materialized = await materializeExecutionPlanningArtifacts({
      repoRoot,
      issueNumber: 140,
      policy,
      sources: {},
      approvedArtifactPreflight: {
        policy,
        artifacts: {
          spec: {
            exists: false,
            created: false,
            generated: false,
            fromState: false,
          },
          plan: {
            path,
            source,
            exists: true,
            created: false,
            generated: false,
            fromState: true,
          },
        },
        sources,
      },
      runner: {
        async run() {
          gitCalls++;
          return { code: 0, stdout: "c".repeat(40), stderr: "" };
        },
      },
    });
    assert.equal(gitCalls, 0);
    assert.equal(materialized.plan?.absolutePath, join(repoRoot, path));
    assert.equal(materialized.plan?.commit, "b".repeat(40));
    assert.equal(source.absolutePath, join(root, "source", path));
    assert.equal(source.commit, "a".repeat(40));
  });
}

test("resume identity mismatch blocks before writing or staging an explicit artifact", async (t) => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "execution-artifact-identity-"),
  );
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  let gitCalls = 0;
  const path = "docs/plans/unrelated-plan.md";
  await assert.rejects(
    materializeExecutionPlanningArtifacts({
      repoRoot,
      issueNumber: 140,
      policy: {
        kind: "implementation-resume",
        primary: {
          repoRoot,
          specsDir: join(repoRoot, "docs/specs"),
          plansDir: join(repoRoot, "docs/plans"),
          source: "resume-worktree",
        },
        fallbacks: [],
        saved: { planPath: "docs/plans/approved-plan.md" },
      },
      sources: {
        plan: {
          path,
          absolutePath: join(repoRoot, path),
          content: "# Unrelated\n",
          evidence: "explicit issue comment",
        },
      },
      runner: {
        async run() {
          gitCalls++;
          return { code: 0, stdout: "", stderr: "" };
        },
      },
    }),
    /Explicit plan artifact.*does not match saved plan/,
  );
  assert.equal(gitCalls, 0);
  await assert.rejects(readFile(join(repoRoot, path)), { code: "ENOENT" });
});

for (const kind of ["spec", "plan"] as const) {
  for (const escape of ["file", "directory"] as const) {
    test(`materialization rejects a ${escape} symlink for the selected ${kind} without touching external content`, async (t) => {
      const root = await mkdtemp(join(tmpdir(), "execution-artifact-"));
      t.after(() => rm(root, { recursive: true, force: true }));
      const repoRoot = join(root, "execution");
      const outside = join(root, "outside");
      const path = `docs/${kind}s/issue-140.md`;
      const content = `# Approved ${kind}\n`;
      await mkdir(repoRoot);
      await mkdir(join(outside, `${kind}s`), { recursive: true });
      const external = join(outside, `${kind}s`, "issue-140.md");
      await writeFile(external, content);
      if (escape === "directory")
        await symlink(outside, join(repoRoot, "docs"), "dir");
      else {
        await mkdir(dirname(join(repoRoot, path)), { recursive: true });
        await symlink(external, join(repoRoot, path));
      }
      let gitCalls = 0;
      await assert.rejects(
        materializeIssueArtifactSources({
          repoRoot,
          issueNumber: 140,
          runner: {
            async run() {
              gitCalls++;
              return { code: 0, stdout: "a".repeat(40), stderr: "" };
            },
          },
          sources: {
            [kind]: {
              path,
              absolutePath: external,
              content,
              evidence: "approved selection",
            },
          },
        }),
        new RegExp(`Issue #140.*${kind}.*(?:symlink|symbolic link|outside)`),
      );
      assert.equal(gitCalls, 0);
      assert.equal(await readFile(external, "utf8"), content);
    });
  }
}
