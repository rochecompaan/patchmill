import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

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

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function packageJsonCandidates(moduleUrl = import.meta.url): string[] {
  const moduleDir = dirname(fileURLToPath(moduleUrl));
  return [
    join(moduleDir, "../../../../package.json"),
    join(moduleDir, "../../../../../package.json"),
  ];
}

export function readPackageVersion(moduleUrl = import.meta.url): string {
  for (const packageJsonPath of packageJsonCandidates(moduleUrl)) {
    let packageJson: PackageJson;
    try {
      packageJson = JSON.parse(
        readFileSync(packageJsonPath, "utf8"),
      ) as PackageJson;
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) continue;
      throw error;
    }

    if (typeof packageJson.version !== "string") {
      throw new Error(
        `package.json at ${packageJsonPath} does not contain a string version`,
      );
    }
    return packageJson.version;
  }

  throw new Error("Could not locate Patchmill package.json");
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
