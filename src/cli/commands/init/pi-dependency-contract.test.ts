import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as piCodingAgent from "@earendil-works/pi-coding-agent";

const PI_PACKAGES = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
] as const;

const ROOT_PACKAGE_JSON = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../package.json",
);

const REQUIRED_INIT_RUNTIME_EXPORTS = [
  "ModelRuntime",
  "ModelRegistry",
  "readStoredCredential",
  "getAgentDir",
] as const;

type PackageJson = {
  version: string;
  dependencies?: Record<string, string>;
};

function isExactVersion(spec: string | undefined): spec is string {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
    spec ?? "",
  );
}

function rootPiPins(): Record<(typeof PI_PACKAGES)[number], string> {
  const rootPackage = JSON.parse(
    readFileSync(ROOT_PACKAGE_JSON, "utf8"),
  ) as PackageJson;
  const dependencies = rootPackage.dependencies ?? {};
  const pins = {} as Record<(typeof PI_PACKAGES)[number], string>;

  for (const name of PI_PACKAGES) {
    const spec = dependencies[name];
    assert.equal(
      isExactVersion(spec),
      true,
      `${name} must be pinned to an exact version in package.json; found ${spec ?? "missing"}`,
    );
    pins[name] = spec;
  }

  return pins;
}

function packageJson(name: string): PackageJson {
  let packageDir = dirname(fileURLToPath(import.meta.resolve(name)));
  while (packageDir !== dirname(packageDir)) {
    const packagePath = join(packageDir, "package.json");
    try {
      return JSON.parse(readFileSync(packagePath, "utf8")) as PackageJson;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }
    packageDir = dirname(packageDir);
  }
  throw new Error(`Could not locate package.json for ${name}`);
}

test("resolved Pi packages use the package.json exact pins", () => {
  const pins = rootPiPins();

  for (const name of PI_PACKAGES) {
    const resolved = packageJson(name);
    assert.equal(
      resolved.version,
      pins[name],
      `${name} resolved ${resolved.version} but package.json pins ${pins[name]}`,
    );
  }
});

test("resolved pi-coding-agent exports the runtime symbols used by patchmill init", () => {
  for (const exportName of REQUIRED_INIT_RUNTIME_EXPORTS) {
    assert.equal(
      exportName in piCodingAgent,
      true,
      `@earendil-works/pi-coding-agent must export ${exportName}`,
    );
    assert.notEqual(
      piCodingAgent[exportName],
      undefined,
      `@earendil-works/pi-coding-agent export ${exportName} must be defined`,
    );
  }

  assert.equal(typeof piCodingAgent.ModelRuntime.create, "function");
  assert.equal(typeof piCodingAgent.ModelRegistry, "function");
});

test("patchmill no longer requires the removed AuthStorage root export", () => {
  assert.equal(
    "AuthStorage" in piCodingAgent,
    false,
    "Patchmill must not rely on the removed root AuthStorage export",
  );
});
