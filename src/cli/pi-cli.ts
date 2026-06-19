import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";

export type PiCommandSpec = { command: string; argsPrefix: string[] };

type PackageJson = { bin?: unknown };

const require = createRequire(import.meta.url);

function bundledPiPackageJsonPathFrom(startDir: string): string | undefined {
  const root = parse(startDir).root;
  for (let dir = startDir; ; dir = dirname(dir)) {
    const candidate = join(
      dir,
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
      "package.json",
    );
    if (existsSync(candidate)) return candidate;
    if (dir === root) return undefined;
  }
}

function resolvePackageJsonPath(moduleUrl = import.meta.url): string {
  try {
    return require.resolve("@earendil-works/pi-coding-agent/package.json");
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED"
    ) {
      throw error;
    }
  }

  const packageJsonPath = bundledPiPackageJsonPathFrom(
    dirname(fileURLToPath(moduleUrl)),
  );
  if (packageJsonPath) return packageJsonPath;

  throw new Error("Could not locate bundled Pi package.json");
}

function piBinFromPackage(packageJsonPath: string): string {
  const packageJson = JSON.parse(
    readFileSync(packageJsonPath, "utf8"),
  ) as PackageJson;
  const bin = packageJson.bin;
  if (typeof bin === "string") return bin;
  if (bin && typeof bin === "object" && !Array.isArray(bin)) {
    const piBin = (bin as Record<string, unknown>).pi;
    if (typeof piBin === "string") return piBin;
  }
  return "dist/cli.js";
}

export function resolveBundledPiCommandFrom(moduleUrl: string): PiCommandSpec {
  const packageJsonPath = resolvePackageJsonPath(moduleUrl);
  return {
    command: process.execPath,
    argsPrefix: [
      join(dirname(packageJsonPath), piBinFromPackage(packageJsonPath)),
    ],
  };
}

export function resolveBundledPiCommand(): PiCommandSpec {
  return resolveBundledPiCommandFrom(import.meta.url);
}

export function piAgentCommandEnv(
  agentDir: string,
  extra: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return { ...extra, PI_CODING_AGENT_DIR: agentDir };
}

export function piCommandArgs(spec: PiCommandSpec, args: string[]): string[] {
  return [...spec.argsPrefix, ...args];
}
