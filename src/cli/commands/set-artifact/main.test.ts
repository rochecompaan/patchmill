import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runSetArtifactCommand } from "./main.ts";

type PublishedComment = { issueNumber: number; body: string };

async function repoFixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-set-artifact-"));
  await mkdir(join(repoRoot, "docs", "specs"), { recursive: true });
  await mkdir(join(repoRoot, "docs", "plans"), { recursive: true });
  await writeFile(
    join(repoRoot, "docs", "specs", "design.md"),
    "# Design\n\nSpec body\n",
    "utf8",
  );
  await writeFile(
    join(repoRoot, "docs", "plans", "work.md"),
    "# Plan\n\n- [ ] Build\n",
    "utf8",
  );
  return repoRoot;
}

test("runSetArtifactCommand publishes a spec file as a deterministic issue comment", async () => {
  const repoRoot = await repoFixture();
  const published: PublishedComment[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];

  const code = await runSetArtifactCommand(
    "spec",
    ["--issue", "99", "docs/specs/design.md"],
    {
      repoRoot,
      output: {
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line),
      },
      publishComment: async (issueNumber, body) => {
        published.push({ issueNumber, body });
      },
    },
  );

  assert.equal(code, 0);
  assert.deepEqual(stderr, []);
  assert.deepEqual(stdout, [
    "Set spec for issue #99 from docs/specs/design.md.",
  ]);
  assert.equal(published.length, 1);
  assert.equal(published[0]?.issueNumber, 99);
  assert.match(published[0]?.body ?? "", /## Spec attached to this issue/);
  assert.match(published[0]?.body ?? "", /# Design\n\nSpec body/);
  assert.match(published[0]?.body ?? "", /"path":"docs\/specs\/design\.md"/);
});

test("runSetArtifactCommand publishes a plan file as a deterministic issue comment", async () => {
  const repoRoot = await repoFixture();
  const published: PublishedComment[] = [];

  const code = await runSetArtifactCommand(
    "plan",
    ["--issue", "99", "docs/plans/work.md"],
    {
      repoRoot,
      output: { stdout: () => undefined, stderr: () => undefined },
      publishComment: async (issueNumber, body) => {
        published.push({ issueNumber, body });
      },
    },
  );

  assert.equal(code, 0);
  assert.match(
    published[0]?.body ?? "",
    /## Implementation plan attached to this issue/,
  );
  assert.match(
    published[0]?.body ?? "",
    /<summary>Implementation plan content<\/summary>/,
  );
  assert.match(published[0]?.body ?? "", /"kind":"plan"/);
});

test("runSetArtifactCommand requires the artifact path to be inside the configured directory", async () => {
  const repoRoot = await repoFixture();

  await assert.rejects(
    runSetArtifactCommand("plan", ["--issue", "99", "docs/specs/design.md"], {
      repoRoot,
      output: { stdout: () => undefined, stderr: () => undefined },
      publishComment: async () => undefined,
    }),
    /plan path must be inside configured plansDir/,
  );
});

test("runSetArtifactCommand prints command-specific help", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(
    await runSetArtifactCommand("spec", ["--help"], {
      output: {
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line),
      },
    }),
    0,
  );

  assert.match(stdout[0] ?? "", /patchmill set-spec --issue <number> <path>/);
  assert.deepEqual(stderr, []);
});
