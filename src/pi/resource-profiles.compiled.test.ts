import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findPackageRoot } from "../package-root.ts";
import type { PatchmillSkillsConfig } from "../workflow/skills.ts";

const require = createRequire(import.meta.url);
const sourceRoot = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
const tscPath = require.resolve("typescript/bin/tsc");

const skills: PatchmillSkillsConfig = {
  triage: "triage",
  planning: "planning",
  implementation: "implementation",
  developmentEnvironment: "development-environment",
  toolchain: "toolchain",
  review: "review",
  visualEvidence: "visual-evidence",
  landing: "landing",
};

test(
  "compiled resource profiles resolve and require package-owned extensions",
  { timeout: 60_000 },
  async () => {
    const packageRoot = await mkdtemp(
      join(tmpdir(), "patchmill-compiled-profile-"),
    );
    const compiledProfile = join(
      packageRoot,
      "dist",
      "src",
      "pi",
      "resource-profiles.js",
    );
    const todosExtension = join(packageRoot, "extensions", "todos.ts");

    try {
      await mkdir(dirname(todosExtension), { recursive: true });
      await copyFile(
        join(sourceRoot, "package.json"),
        join(packageRoot, "package.json"),
      );
      await copyFile(
        join(sourceRoot, "extensions", "todos.ts"),
        todosExtension,
      );
      await symlink(
        join(sourceRoot, "node_modules"),
        join(packageRoot, "node_modules"),
        process.platform === "win32" ? "junction" : "dir",
      );

      const build = spawnSync(
        process.execPath,
        [
          tscPath,
          "-p",
          join(sourceRoot, "tsconfig.build.json"),
          "--rootDir",
          sourceRoot,
          "--outDir",
          join(packageRoot, "dist"),
        ],
        {
          cwd: sourceRoot,
          encoding: "utf8",
          timeout: 45_000,
        },
      );
      assert.equal(build.error, undefined);
      assert.equal(build.status, 0, build.stderr || build.stdout);

      const compiled = await import(pathToFileURL(compiledProfile).href);
      const profile = compiled.runOncePlanningPiProfile(skills, packageRoot);
      assert.deepEqual(
        profile.additionalExtensionPaths.map((path: string) =>
          existsSync(path),
        ),
        [true, true],
      );
      assert.equal(
        profile.additionalExtensionPaths[1]
          ?.replaceAll("\\", "/")
          .endsWith("/extensions/todos.ts"),
        true,
      );

      const missingProfile = join(
        dirname(compiledProfile),
        "resource-profiles-missing.js",
      );
      await copyFile(compiledProfile, missingProfile);
      await rm(todosExtension);

      await assert.rejects(
        import(pathToFileURL(missingProfile).href),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
          assert.match(error.message, /extensions[\\/]todos\.ts/u);
          return true;
        },
      );

      await mkdir(todosExtension);
      const directoryProfile = join(
        dirname(compiledProfile),
        "resource-profiles-directory.js",
      );
      await copyFile(compiledProfile, directoryProfile);

      await assert.rejects(
        import(pathToFileURL(directoryProfile).href),
        new RegExp(
          `Patchmill extension is not a regular file: .*extensions[\\\\/]todos\\.ts`,
          "u",
        ),
      );
    } finally {
      await rm(packageRoot, { recursive: true, force: true });
    }
  },
);
