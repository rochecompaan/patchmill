import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { PackageRootNotFoundError } from "../../../package-root.ts";
import { readPackageVersion } from "./main.ts";

type PackageTree = {
  moduleUrl: string;
  packageRoot: string;
};

async function withPackageJson(
  contents: string,
  run: (tree: PackageTree) => void,
): Promise<void> {
  const packageRoot = await mkdtemp(join(tmpdir(), "patchmill-version-"));
  const moduleDirectory = join(
    packageRoot,
    "dist",
    "deep",
    "src",
    "cli",
    "commands",
    "version",
  );

  try {
    await mkdir(moduleDirectory, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), contents, "utf8");
    run({
      moduleUrl: pathToFileURL(join(moduleDirectory, "main.js")).href,
      packageRoot,
    });
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
}

function systemError(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

test("readPackageVersion finds the nearest package from arbitrary nesting", async () => {
  await withPackageJson('{"version":"9.8.7"}\n', ({ moduleUrl }) => {
    assert.equal(readPackageVersion(moduleUrl), "9.8.7");
  });
});

test("readPackageVersion preserves malformed JSON failures", async () => {
  await withPackageJson("{", ({ moduleUrl }) => {
    assert.throws(() => readPackageVersion(moduleUrl), SyntaxError);
  });
});

test("readPackageVersion rejects a non-string version", async () => {
  await withPackageJson('{"version":123}\n', ({ moduleUrl, packageRoot }) => {
    assert.throws(
      () => readPackageVersion(moduleUrl),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(
          error.message,
          `package.json at ${join(packageRoot, "package.json")} does not contain a string version`,
        );
        return true;
      },
    );
  });
});

test("readPackageVersion preserves its public missing-root error", (context) => {
  context.mock.method(fs, "statSync", () => {
    throw systemError("ENOENT");
  });
  const moduleUrl = pathToFileURL(
    resolve("virtual", "without-package", "main.js"),
  ).href;

  assert.throws(
    () => readPackageVersion(moduleUrl),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Could not locate Patchmill package.json");
      assert.ok(error.cause instanceof PackageRootNotFoundError);
      return true;
    },
  );
});

test("readPackageVersion propagates package-root access failures", (context) => {
  const expected = systemError("EACCES");
  context.mock.method(fs, "statSync", () => {
    throw expected;
  });
  const moduleUrl = pathToFileURL(resolve("virtual", "main.js")).href;

  assert.throws(
    () => readPackageVersion(moduleUrl),
    (error: unknown) => error === expected,
  );
});
