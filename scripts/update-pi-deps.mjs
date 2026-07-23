#!/usr/bin/env node
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PI_PACKAGES,
  assertLockfilesMatchTargets,
  fetchLatestVersion,
  getRootPins,
  readJson,
  resolveUpgradeTarget,
  writeJson,
} from "./pi-dependency-upgrade-lib.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const packagePaths = {
  packageJson: join(rootDir, "package.json"),
  packageLock: join(rootDir, "package-lock.json"),
  shrinkwrap: join(rootDir, "npm-shrinkwrap.json"),
};
const validationCommands = [
  "node --test src/cli/commands/init/pi-dependency-contract.test.ts",
  "npm test",
  "node scripts/smoke-packed-artifact.mjs",
  "npm run lint",
  "scripts/update-npm-deps-hash.sh",
  "nix build .#patchmill --print-build-logs",
];

function parseArgs(args) {
  const options = {
    mode: "scheduled",
    manualVersions: {},
    skipNixHash: false,
    validateOnly: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = () => {
      index += 1;
      if (!args[index]) throw new Error(`${argument} requires a value`);
      return args[index];
    };
    switch (argument) {
      case "--mode":
        options.mode = value();
        break;
      case "--target-version":
        options.targetVersion = value();
        break;
      case "--pi-coding-agent-version":
        options.manualVersions[PI_PACKAGES[0]] = value();
        break;
      case "--pi-tui-version":
        options.manualVersions[PI_PACKAGES[1]] = value();
        break;
      case "--summary-json":
        options.summaryJson = value();
        break;
      case "--validate-only":
        options.validateOnly = true;
        break;
      case "--skip-nix-hash":
        options.skipNixHash = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!["scheduled", "manual"].includes(options.mode)) {
    throw new Error(
      `--mode must be scheduled or manual; found ${options.mode}`,
    );
  }
  if (options.targetVersion) {
    for (const name of PI_PACKAGES) {
      options.manualVersions[name] ??= options.targetVersion;
    }
  }
  return options;
}

function run(command, args) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: rootDir, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed: ${command} ${args.join(" ")}`));
    });
  });
}

async function updatePackageMetadata(packageJson, targets) {
  const tempDir = await mkdtemp(join(tmpdir(), "patchmill-pi-deps-"));
  const originalPaths = Object.fromEntries(
    Object.keys(packagePaths).map((name) => [
      name,
      join(tempDir, `${name}.json`),
    ]),
  );
  const requested = PI_PACKAGES.map((name) => `${name}=${targets[name]}`).join(
    ", ",
  );
  let originalsSaved = false;

  try {
    await Promise.all(
      Object.entries(packagePaths).map(([name, path]) =>
        copyFile(path, originalPaths[name]),
      ),
    );
    originalsSaved = true;

    packageJson.dependencies ??= {};
    for (const name of PI_PACKAGES)
      packageJson.dependencies[name] = targets[name];
    await writeJson(packagePaths.packageJson, packageJson);

    await run("npm", ["install", "--package-lock-only", "--ignore-scripts"]);
    const updatedShrinkwrap = join(tempDir, "updated-shrinkwrap.json");
    await copyFile(packagePaths.shrinkwrap, updatedShrinkwrap);
    await rm(packagePaths.shrinkwrap);
    await run("npm", ["install", "--package-lock-only", "--ignore-scripts"]);
    await copyFile(updatedShrinkwrap, packagePaths.shrinkwrap);
    await run("npx", [
      "prettier",
      "--write",
      "package.json",
      "package-lock.json",
      "npm-shrinkwrap.json",
    ]);
  } catch (error) {
    let restoreError;
    if (originalsSaved) {
      try {
        await Promise.all(
          Object.entries(packagePaths).map(([name, path]) =>
            copyFile(originalPaths[name], path),
          ),
        );
      } catch (failure) {
        restoreError = failure;
      }
    }
    const message = `Unable to resolve requested Pi dependency versions (${requested}): ${error.message}`;
    if (restoreError) {
      throw new Error(
        `${message}; additionally failed to restore original metadata: ${restoreError.message}`,
      );
    }
    throw new Error(message);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeSummary(options, summary) {
  if (!options.summaryJson) return;
  await mkdir(dirname(options.summaryJson), { recursive: true });
  await writeJson(options.summaryJson, summary);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function changedMetadataFiles() {
  const output = await new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      [
        "diff",
        "--name-only",
        "--",
        "package.json",
        "package-lock.json",
        "npm-shrinkwrap.json",
        "nix/package.nix",
      ],
      { cwd: rootDir },
    );
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error("Unable to inspect changed package metadata"));
    });
  });
  return output.trim() ? output.trim().split("\n") : [];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = {
    noUpdate: false,
    validateOnly: options.validateOnly,
    targets: {},
    warnings: [],
    changedFiles: [],
    validationCommands,
  };

  try {
    const packageJson = await readJson(packagePaths.packageJson);
    const currentPins = getRootPins(packageJson);
    const latestVersions =
      options.mode === "scheduled"
        ? Object.fromEntries(
            await Promise.all(
              PI_PACKAGES.map(async (name) => [
                name,
                await fetchLatestVersion(name),
              ]),
            ),
          )
        : undefined;
    const resolved = resolveUpgradeTarget({
      mode: options.mode,
      currentPins,
      latestVersions,
      manualVersions: options.manualVersions,
    });
    Object.assign(summary, {
      noUpdate: resolved.noUpdate,
      targets: resolved.targets,
      warnings: resolved.warnings,
    });

    console.log(
      `Current Pi pins: ${PI_PACKAGES.map((name) => `${name}=${currentPins[name]}`).join(", ")}`,
    );
    console.log(
      `Selected Pi targets: ${PI_PACKAGES.map((name) => `${name}=${resolved.targets[name]}`).join(", ")}`,
    );

    if (!resolved.noUpdate && !options.validateOnly) {
      await updatePackageMetadata(packageJson, resolved.targets);
    }

    const [updatedPackageJson, packageLock, shrinkwrap] = await Promise.all([
      readJson(packagePaths.packageJson),
      readJson(packagePaths.packageLock),
      readJson(packagePaths.shrinkwrap),
    ]);
    assertLockfilesMatchTargets({
      packageJson: updatedPackageJson,
      packageLock,
      shrinkwrap,
      targets: resolved.targets,
    });

    if (!resolved.noUpdate && !options.validateOnly && !options.skipNixHash) {
      await run("scripts/update-npm-deps-hash.sh", []);
    }
    summary.changedFiles = await changedMetadataFiles();
    console.log(
      `Changed metadata files: ${summary.changedFiles.join(", ") || "none"}`,
    );
    if (resolved.noUpdate) console.log("No Pi dependency update available");
    await writeSummary(options, summary);
  } catch (error) {
    summary.error = errorMessage(error);
    try {
      summary.changedFiles = await changedMetadataFiles();
    } catch {
      // Preserve the primary failure when Git cannot report changed metadata.
    }
    try {
      await writeSummary(options, summary);
    } catch (summaryError) {
      console.error(
        `Unable to write failure summary: ${errorMessage(summaryError)}`,
      );
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
