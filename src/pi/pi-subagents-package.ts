import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const require = createRequire(import.meta.url);
export const PI_SUBAGENTS_PACKAGE_NAME = "pi-subagents";

export type PiSubagentsPackageManifest = {
  name?: string;
  version: string;
  pi?: {
    extensions?: string[];
    skills?: string[];
    prompts?: string[];
  };
};

export function isExactNpmVersion(spec: string | undefined): spec is string {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
    spec ?? "",
  );
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function readRootPiSubagentsPin(
  rootPackageJsonPath = resolve("package.json"),
): string {
  const packageJson = readJson<{ dependencies?: Record<string, string> }>(
    rootPackageJsonPath,
  );
  const spec = packageJson.dependencies?.[PI_SUBAGENTS_PACKAGE_NAME];
  if (!isExactNpmVersion(spec)) {
    throw new Error(
      `${PI_SUBAGENTS_PACKAGE_NAME} must be pinned to an exact version; found ${spec ?? "missing"}`,
    );
  }
  return spec;
}

/**
 * Finds the package directory through the public package entry. pi-subagents
 * intentionally does not export package.json, so resolving that subpath would
 * violate its export map.
 */
export function resolvePiSubagentsPackageRoot(): string {
  return dirname(require.resolve(PI_SUBAGENTS_PACKAGE_NAME));
}

export function resolvePiSubagentsPackageJson(): string {
  return joinPackageRoot("package.json");
}

function joinPackageRoot(entry: string): string {
  const packageRoot = resolvePiSubagentsPackageRoot();
  const candidate = resolve(packageRoot, entry);
  const relativePath = relative(packageRoot, candidate);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(
      `${PI_SUBAGENTS_PACKAGE_NAME} path escapes package root: ${entry}`,
    );
  }
  return candidate;
}

export function readInstalledPiSubagentsManifest(): PiSubagentsPackageManifest {
  return readJson<PiSubagentsPackageManifest>(resolvePiSubagentsPackageJson());
}

export function piSubagentsExtensionFiles(): string[] {
  const manifest = readInstalledPiSubagentsManifest();
  const extensions = manifest.pi?.extensions ?? [];
  if (extensions.length === 0) {
    throw new Error(
      `${PI_SUBAGENTS_PACKAGE_NAME} manifest declares no Pi extensions`,
    );
  }
  return extensions.map((entry) => {
    const extensionPath = joinPackageRoot(entry);
    if (!statSync(extensionPath).isFile()) {
      throw new Error(
        `${PI_SUBAGENTS_PACKAGE_NAME} extension is not a regular file: ${extensionPath}`,
      );
    }
    return extensionPath;
  });
}

export function assertInstalledPiSubagentsMatchesRootPin(
  rootPackageJsonPath = resolve("package.json"),
): void {
  const expected = readRootPiSubagentsPin(rootPackageJsonPath);
  const manifest = readInstalledPiSubagentsManifest();
  if (manifest.version !== expected) {
    throw new Error(
      `${PI_SUBAGENTS_PACKAGE_NAME} resolved ${manifest.version} but package.json pins ${expected}`,
    );
  }
}
