import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

interface LockPackage {
  version?: string;
  resolved?: string;
  integrity?: string;
  link?: boolean;
}

interface NpmShrinkwrap {
  packages?: Record<string, LockPackage>;
}

function isGitResolvedUrl(resolved: string): boolean {
  return /^(?:git(?:\+ssh|\+https|\+file|):|github:)/u.test(resolved);
}

test("npm-shrinkwrap records integrity for non-git dependencies", async () => {
  const shrinkwrap = JSON.parse(
    await readFile(new URL("../npm-shrinkwrap.json", import.meta.url), "utf8"),
  ) as NpmShrinkwrap;

  const missingIntegrity = Object.entries(shrinkwrap.packages ?? {})
    .filter(([path]) => path !== "")
    .filter(([, packageEntry]) => packageEntry.link !== true)
    .filter(([, packageEntry]) => packageEntry.version !== undefined)
    .filter(([, packageEntry]) => packageEntry.resolved !== undefined)
    .filter(
      ([, packageEntry]) =>
        !isGitResolvedUrl(packageEntry.resolved ?? "") &&
        packageEntry.integrity === undefined,
    )
    .map(([path, packageEntry]) => `${path}@${packageEntry.version}`);

  assert.deepEqual(missingIntegrity, []);
});
