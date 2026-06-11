import { constants } from "node:fs";
import { access, chmod, cp, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseIssueFile, type SetupIssue } from "./issue-parser.ts";

const FIXTURE_RELATIVE_PATH = join("fixtures", "patchmill-test-repo");

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function findPackageRoot(startDir: string): Promise<string> {
  let current = resolve(startDir);
  for (;;) {
    if (await exists(join(current, "package.json"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error("Could not find package root");
    current = parent;
  }
}

export async function resolveFixtureDirectory(
  startDir = dirname(fileURLToPath(import.meta.url)),
): Promise<string> {
  const packageRoot = await findPackageRoot(startDir);
  return join(packageRoot, FIXTURE_RELATIVE_PATH);
}

export async function validateFixtureDirectory(
  fixtureDir: string,
): Promise<void> {
  const required = ["README.md", "PROJECT_BRIEF.md", "issues"];
  for (const entry of required) {
    if (!(await exists(join(fixtureDir, entry)))) {
      throw new Error(`Fixture directory is missing ${entry}`);
    }
  }
}

export async function loadSetupIssues(
  fixtureDir: string,
): Promise<SetupIssue[]> {
  await validateFixtureDirectory(fixtureDir);
  const issueDir = join(fixtureDir, "issues");
  const files = (await readdir(issueDir))
    .filter((file) => file.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b));

  return Promise.all(
    files.map(async (file) =>
      parseIssueFile(file, await readFile(join(issueDir, file), "utf8")),
    ),
  );
}

export async function copyFixtureToRepository(
  fixtureDir: string,
  destination: string,
): Promise<void> {
  await validateFixtureDirectory(fixtureDir);
  await cp(join(fixtureDir, "README.md"), join(destination, "README.md"));
  await cp(
    join(fixtureDir, "PROJECT_BRIEF.md"),
    join(destination, "PROJECT_BRIEF.md"),
  );
  await cp(join(fixtureDir, "issues"), join(destination, "issues"), {
    recursive: true,
  });
  await makeWritable(join(destination, "issues"));
}

async function makeWritable(path: string): Promise<void> {
  const info = await stat(path);
  await chmod(path, info.mode | 0o200);
  if (!info.isDirectory()) return;

  for (const entry of await readdir(path))
    await makeWritable(join(path, entry));
}
