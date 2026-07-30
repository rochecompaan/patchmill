import fs from "node:fs";
import { dirname, join, resolve } from "node:path";

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function isAbsentPathError(error: unknown): boolean {
  return hasErrorCode(error, "ENOENT") || hasErrorCode(error, "ENOTDIR");
}

export class PackageRootNotFoundError extends Error {
  readonly startDir: string;

  constructor(startDir: string) {
    super(`Could not find package root walking up from ${startDir}`);
    this.name = "PackageRootNotFoundError";
    this.startDir = startDir;
  }
}

export function findPackageRoot(startDir: string): string {
  const normalizedStart = resolve(startDir);
  let current = normalizedStart;

  for (;;) {
    const packageJsonPath = join(current, "package.json");
    try {
      const stats = fs.statSync(packageJsonPath);
      if (!stats.isFile()) {
        throw new Error(`${packageJsonPath} is not a regular file`);
      }
      return current;
    } catch (error) {
      if (!isAbsentPathError(error)) throw error;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new PackageRootNotFoundError(normalizedStart);
    }
    current = parent;
  }
}
