#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { repairMissingLockfileIntegrities } from "./lockfile-integrity.mjs";
import {
  PI_SUBAGENTS_PACKAGE,
  assertLockfilesMatchPiSubagentsTarget,
  fetchLatestPiSubagentsVersion,
  fetchPiSubagentsReleaseNotes,
  getCurrentPiSubagentsVersion,
  resolvePiSubagentsUpgrade,
} from "./pi-subagents-upgrade-lib.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const packagePaths = {
  packageJson: join(rootDir, "package.json"),
  packageLock: join(rootDir, "package-lock.json"),
  shrinkwrap: join(rootDir, "npm-shrinkwrap.json"),
};
const trackedMetadataPaths = {
  ...packagePaths,
  nixPackage: join(rootDir, "nix/package.nix"),
};
const validationCommands = [
  "node --test src/pi/pi-subagents-dependency-contract.test.ts",
  "bun scripts/verify-pi-subagents-bun-workflow.mjs",
  "npm test",
  "node scripts/smoke-packed-artifact.mjs",
  "npm run lint",
  "scripts/update-npm-deps-hash.sh",
  "nix build .#patchmill --print-build-logs",
  "(cd result/share/patchmill && node --test --test-name-pattern='pi loads the resolved pi-subagents extension package without model execution' src/pi/pi-subagents-dependency-contract.test.ts)",
  "nix flake check --accept-flake-config --print-build-logs",
];

function summaryPathFromArgs(args) {
  for (let index = args.length - 2; index >= 0; index -= 1) {
    if (args[index] === "--summary-json" && !args[index + 1].startsWith("--"))
      return args[index + 1];
  }
  return undefined;
}

function parseArgs(args) {
  const options = {
    mode: "scheduled",
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
      case "--pi-subagents-version":
        options.piSubagentsVersion = value();
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
  if (options.mode === "scheduled" && options.piSubagentsVersion) {
    throw new Error("--pi-subagents-version requires --mode manual");
  }
  return options;
}

function readJson(path) {
  return readFile(path, "utf8").then(JSON.parse);
}

function writeJson(path, value) {
  return writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
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

async function updatePackageMetadata(packageJson, targetVersion) {
  const tempDir = await mkdtemp(join(tmpdir(), "patchmill-pi-subagents-"));
  const originalPaths = Object.fromEntries(
    Object.keys(packagePaths).map((name) => [
      name,
      join(tempDir, `${name}.json`),
    ]),
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
    packageJson.dependencies[PI_SUBAGENTS_PACKAGE] = targetVersion;
    await writeJson(packagePaths.packageJson, packageJson);

    await run("npm", ["install", "--package-lock-only", "--ignore-scripts"]);
    const updatedShrinkwrap = join(tempDir, "updated-shrinkwrap.json");
    await copyFile(packagePaths.shrinkwrap, updatedShrinkwrap);
    await rm(packagePaths.shrinkwrap);
    await run("npm", ["install", "--package-lock-only", "--ignore-scripts"]);
    await copyFile(updatedShrinkwrap, packagePaths.shrinkwrap);
    const [packageLock, shrinkwrap] = await Promise.all([
      readJson(packagePaths.packageLock),
      readJson(packagePaths.shrinkwrap),
    ]);
    await repairMissingLockfileIntegrities([
      { label: "package-lock.json", lockfile: packageLock },
      { label: "npm-shrinkwrap.json", lockfile: shrinkwrap },
    ]);
    await Promise.all([
      writeJson(packagePaths.packageLock, packageLock),
      writeJson(packagePaths.shrinkwrap, shrinkwrap),
    ]);
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
    const message = `Unable to resolve requested ${PI_SUBAGENTS_PACKAGE} version ${targetVersion}: ${errorMessage(error)}`;
    if (restoreError) {
      throw new Error(
        `${message}; additionally failed to restore original metadata: ${errorMessage(restoreError)}`,
      );
    }
    throw new Error(message);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function snapshotMetadataFiles() {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(trackedMetadataPaths).map(async ([name, path]) => [
        name,
        await readFile(path),
      ]),
    ),
  );
}

async function changedMetadataFiles(snapshot) {
  if (!snapshot) return [];
  const current = await snapshotMetadataFiles();
  return Object.entries(trackedMetadataPaths)
    .filter(([name]) => !snapshot[name].equals(current[name]))
    .map(([, path]) => path.slice(rootDir.length + 1));
}

async function writeSummary(options, summary) {
  if (!options.summaryJson) return;
  await mkdir(dirname(options.summaryJson), { recursive: true });
  await writeJson(options.summaryJson, summary);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const args = process.argv.slice(2);
  const options = {
    summaryJson: summaryPathFromArgs(args),
    validateOnly: false,
  };
  const summary = {
    currentVersion: undefined,
    targetVersion: undefined,
    noUpdate: false,
    validateOnly: false,
    changedFiles: [],
    releaseNotes: [],
    validationCommands,
  };
  let metadataSnapshot;

  try {
    Object.assign(options, parseArgs(args));
    summary.validateOnly = options.validateOnly;
    metadataSnapshot = await snapshotMetadataFiles();
    const [packageJson, packageLock, shrinkwrap] = await Promise.all([
      readJson(packagePaths.packageJson),
      readJson(packagePaths.packageLock),
      readJson(packagePaths.shrinkwrap),
    ]);
    const currentVersion = getCurrentPiSubagentsVersion(packageJson);
    assertLockfilesMatchPiSubagentsTarget({
      packageJson,
      packageLock,
      shrinkwrap,
      targetVersion: currentVersion,
    });
    const latestVersion = options.piSubagentsVersion
      ? undefined
      : await fetchLatestPiSubagentsVersion();
    const resolved = resolvePiSubagentsUpgrade({
      currentVersion,
      latestVersion,
      requestedVersion: options.piSubagentsVersion,
    });
    Object.assign(summary, resolved);

    console.log(`Current ${PI_SUBAGENTS_PACKAGE} version: ${currentVersion}`);
    console.log(
      `Selected ${PI_SUBAGENTS_PACKAGE} target: ${resolved.targetVersion}`,
    );

    if (!resolved.noUpdate) {
      summary.releaseNotes = await fetchPiSubagentsReleaseNotes({
        currentVersion: resolved.currentVersion,
        targetVersion: resolved.targetVersion,
        token: process.env.GITHUB_TOKEN,
      });
      await updatePackageMetadata(packageJson, resolved.targetVersion);
      const [updatedPackageJson, updatedPackageLock, updatedShrinkwrap] =
        await Promise.all([
          readJson(packagePaths.packageJson),
          readJson(packagePaths.packageLock),
          readJson(packagePaths.shrinkwrap),
        ]);
      assertLockfilesMatchPiSubagentsTarget({
        packageJson: updatedPackageJson,
        packageLock: updatedPackageLock,
        shrinkwrap: updatedShrinkwrap,
        targetVersion: resolved.targetVersion,
      });
      if (!options.skipNixHash) {
        await run("scripts/update-npm-deps-hash.sh", []);
      }
    }

    summary.changedFiles = await changedMetadataFiles(metadataSnapshot);
    console.log(
      `Changed metadata files: ${summary.changedFiles.join(", ") || "none"}`,
    );
    if (resolved.noUpdate)
      console.log(`No ${PI_SUBAGENTS_PACKAGE} update available`);
    await writeSummary(options, summary);
  } catch (error) {
    summary.error = errorMessage(error);
    try {
      summary.changedFiles = await changedMetadataFiles(metadataSnapshot);
    } catch {
      // Preserve the primary failure when metadata comparison also fails.
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
  console.error(errorMessage(error));
  process.exitCode = 1;
});
