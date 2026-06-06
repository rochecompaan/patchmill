import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  copyFixtureToRepository,
  loadSetupIssues,
  resolveFixtureDirectory,
  validateFixtureDirectory,
} from "./fixtures.ts";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "patchmill-fixture-test-"));
}

test("resolveFixtureDirectory finds fixtures from the package root", async () => {
  const fixtureDir = await resolveFixtureDirectory(process.cwd());
  assert.match(fixtureDir, /fixtures\/patchmill-test-repo$/u);
});

test("validateFixtureDirectory rejects missing project brief", async () => {
  const root = await tempDir();
  await mkdir(join(root, "issues"), { recursive: true });
  await writeFile(join(root, "README.md"), "# Demo\n");

  await assert.rejects(
    () => validateFixtureDirectory(root),
    /missing PROJECT_BRIEF\.md/,
  );

  await rm(root, { recursive: true, force: true });
});

test("loadSetupIssues reads fixture issues in filename order", async () => {
  const fixtureDir = await resolveFixtureDirectory(process.cwd());
  const issues = await loadSetupIssues(fixtureDir);

  assert.equal(issues.length, 12);
  assert.equal(issues[0]?.fileName, "01-project-scaffold.md");
  assert.equal(issues[11]?.fileName, "12-votes-disappear.md");
});

test("copyFixtureToRepository copies docs and issue prompts", async () => {
  const fixtureDir = await resolveFixtureDirectory(process.cwd());
  const destination = await tempDir();

  await copyFixtureToRepository(fixtureDir, destination);

  assert.match(
    await readFile(join(destination, "README.md"), "utf8"),
    /Team Lunch Poll/u,
  );
  assert.match(
    await readFile(join(destination, "PROJECT_BRIEF.md"), "utf8"),
    /Product goals/u,
  );
  assert.match(
    await readFile(
      join(destination, "issues", "01-project-scaffold.md"),
      "utf8",
    ),
    /Create the Team Lunch Poll app scaffold/u,
  );

  await rm(destination, { recursive: true, force: true });
});
