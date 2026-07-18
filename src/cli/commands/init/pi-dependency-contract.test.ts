import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as piCodingAgent from "@earendil-works/pi-coding-agent";

const EXPECTED_PI_VERSION = "0.80.10";

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

test("resolved Pi packages use the validated exact version", () => {
  assert.equal(
    packageJson("@earendil-works/pi-coding-agent").version,
    EXPECTED_PI_VERSION,
  );
  assert.equal(
    packageJson("@earendil-works/pi-tui").version,
    EXPECTED_PI_VERSION,
  );
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
