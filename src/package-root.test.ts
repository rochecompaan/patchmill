import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { findPackageRoot, PackageRootNotFoundError } from "./package-root.ts";

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "patchmill-package-root-"));
}

async function writePackageJson(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "package.json"), "{}\n", "utf8");
}

function systemError(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

test("findPackageRoot walks up from source and arbitrarily nested dist layouts", async () => {
  const packageRoot = await temporaryDirectory();
  const sourceDirectory = join(packageRoot, "src", "pi");
  const distDirectory = join(packageRoot, "dist", "src", "pi", "nested");

  try {
    await writePackageJson(packageRoot);
    await mkdir(sourceDirectory, { recursive: true });
    await mkdir(distDirectory, { recursive: true });

    assert.equal(findPackageRoot(sourceDirectory), packageRoot);
    assert.equal(findPackageRoot(distDirectory), packageRoot);
    assert.equal(
      findPackageRoot(relative(process.cwd(), distDirectory)),
      packageRoot,
    );
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
});

test("findPackageRoot returns the nearest package boundary", async () => {
  const outerRoot = await temporaryDirectory();
  const innerRoot = join(outerRoot, "packages", "inner");
  const startDirectory = join(innerRoot, "dist", "src", "feature");

  try {
    await writePackageJson(outerRoot);
    await writePackageJson(innerRoot);
    await mkdir(startDirectory, { recursive: true });

    assert.equal(findPackageRoot(startDirectory), innerRoot);
  } finally {
    await rm(outerRoot, { recursive: true, force: true });
  }
});

test("findPackageRoot rejects a non-file package boundary", async () => {
  const packageRoot = await temporaryDirectory();
  const startDirectory = join(packageRoot, "src", "feature");

  try {
    await mkdir(join(packageRoot, "package.json"), { recursive: true });
    await mkdir(startDirectory, { recursive: true });

    assert.throws(
      () => findPackageRoot(startDirectory),
      /package\.json is not a regular file/u,
    );
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
});

for (const code of ["ENOENT", "ENOTDIR"] as const) {
  test(`findPackageRoot continues after ${code}`, (context) => {
    const startDirectory = resolve("virtual", "package", "nested");
    const expectedRoot = dirname(startDirectory);
    let calls = 0;

    context.mock.method(fs, "statSync", () => {
      calls += 1;
      if (calls === 1) throw systemError(code);
      return {
        isFile: () => true,
      } as ReturnType<typeof fs.statSync>;
    });

    assert.equal(findPackageRoot(startDirectory), expectedRoot);
    assert.equal(calls, 2);
  });
}

for (const code of ["EACCES", "ELOOP"] as const) {
  test(`findPackageRoot propagates ${code}`, (context) => {
    const expected = systemError(code);
    context.mock.method(fs, "statSync", () => {
      throw expected;
    });

    assert.throws(
      () => findPackageRoot(resolve("virtual", "nested")),
      (error: unknown) => error === expected,
    );
  });
}

test("findPackageRoot throws a typed error with the normalized start", (context) => {
  const startDirectory = resolve("virtual", "without-package", "nested");
  context.mock.method(fs, "statSync", () => {
    throw systemError("ENOENT");
  });

  assert.throws(
    () => findPackageRoot(startDirectory),
    (error: unknown) => {
      assert.ok(error instanceof PackageRootNotFoundError);
      assert.equal(error.startDir, startDirectory);
      assert.equal(
        error.message,
        `Could not find package root walking up from ${startDirectory}`,
      );
      return true;
    },
  );
});
