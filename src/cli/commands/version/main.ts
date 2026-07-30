import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  findPackageRoot,
  PackageRootNotFoundError,
} from "../../../package-root.ts";

export const HELP_TEXT = `Usage:
  patchmill version

Print the Patchmill CLI version.
`;

export type VersionOutput = {
  stdout: (line: string) => void;
};

const DEFAULT_OUTPUT: VersionOutput = {
  stdout: (line) => console.log(line),
};

type PackageJson = {
  version?: unknown;
};

export function readPackageVersion(moduleUrl = import.meta.url): string {
  let packageRoot: string;
  try {
    packageRoot = findPackageRoot(dirname(fileURLToPath(moduleUrl)));
  } catch (error) {
    if (error instanceof PackageRootNotFoundError) {
      throw new Error("Could not locate Patchmill package.json", {
        cause: error,
      });
    }
    throw error;
  }

  const packageJsonPath = join(packageRoot, "package.json");
  const packageJson = JSON.parse(
    readFileSync(packageJsonPath, "utf8"),
  ) as PackageJson;

  if (typeof packageJson.version !== "string") {
    throw new Error(
      `package.json at ${packageJsonPath} does not contain a string version`,
    );
  }
  return packageJson.version;
}

export function runVersion(
  args: string[],
  output: VersionOutput = DEFAULT_OUTPUT,
  readVersion = readPackageVersion,
): number {
  if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    output.stdout(HELP_TEXT);
    return 0;
  }

  if (args.length > 0) {
    throw new Error("patchmill version does not accept arguments");
  }

  output.stdout(readVersion());
  return 0;
}

export function main(args = process.argv.slice(2)): number {
  return runVersion(args);
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  process.exitCode = main();
}
