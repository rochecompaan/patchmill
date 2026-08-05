#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { repairMissingLockfileIntegrities } from "./lockfile-integrity.mjs";
import {
  SUPERPOWERS_PACKAGE,
  assertLockfilesMatchSuperpowersTarget,
  fetchReleasePackageVersion,
  fetchStableReleases,
  getCurrentSuperpowersVersion,
  resolveSuperpowersUpgrade,
  tarballUrlForVersion,
} from "./superpowers-upgrade-lib.mjs";
import {
  changedTrackedFiles,
  restoreTrackedPaths,
  snapshotTrackedPaths,
} from "./tracked-files.mjs";

const defaultRootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const trackedRoots = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "nix/package.nix",
  "src/workflow/skill-pack.ts",
  "THIRD_PARTY_NOTICES.md",
  ".patchmill/skills",
];
export const validationCommands = [
  "npm ci",
  "node bin/patchmill.ts skills update",
  "node --test src/cli/commands/init/pi-dependency-contract.test.ts",
  "npm test",
  "node scripts/smoke-packed-artifact.mjs",
  "npm run lint",
  "scripts/update-npm-deps-hash.sh",
  "nix build .#patchmill --print-build-logs",
];

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function summaryPathFromArgs(args) {
  for (let index = args.length - 2; index >= 0; index -= 1)
    if (
      args[index] === "--summary-json" &&
      args[index + 1] &&
      !args[index + 1].startsWith("--")
    )
      return args[index + 1];
}
function parseArgs(args) {
  const options = {
    mode: "scheduled",
    validateOnly: false,
    skipNixHash: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = () => {
      index += 1;
      if (!args[index]) throw new Error(`${argument} requires a value`);
      return args[index];
    };
    if (argument === "--mode") options.mode = value();
    else if (argument === "--superpowers-version")
      options.superpowersVersion = value();
    else if (argument === "--summary-json") options.summaryJson = value();
    else if (argument === "--validate-only") options.validateOnly = true;
    else if (argument === "--skip-nix-hash") options.skipNixHash = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!["scheduled", "manual"].includes(options.mode))
    throw new Error(
      `--mode must be scheduled or manual; found ${options.mode}`,
    );
  return options;
}
async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
async function defaultRunCommand(command, args, rootDir) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: rootDir, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Command failed: ${command} ${args.join(" ")}`)),
    );
  });
}
function replaceExpected(text, expected, target, expectedCount, label) {
  const count = text.split(expected).length - 1;
  if (count !== expectedCount)
    throw new Error(
      `${label}: expected ${expectedCount} references to ${expected}; found ${count}`,
    );
  return text.replaceAll(expected, target);
}
async function configuredSuperpowersSkills(rootDir) {
  const { PATCHMILL_RECOMMENDED_SKILL_PACK } = await import(
    pathToFileURL(join(rootDir, "src/workflow/skill-pack.ts")).href
  );
  return PATCHMILL_RECOMMENDED_SKILL_PACK.skills
    .filter((skill) => skill.source === "superpowers")
    .map((skill) => skill.name);
}
async function assertSynchronizedRepository(rootDir, expectedVersion) {
  const [
    packageJson,
    packageLock,
    shrinkwrap,
    skillPackSource,
    notices,
    metadata,
  ] = await Promise.all([
    readJson(join(rootDir, "package.json")),
    readJson(join(rootDir, "package-lock.json")),
    readJson(join(rootDir, "npm-shrinkwrap.json")),
    readFile(join(rootDir, "src/workflow/skill-pack.ts"), "utf8"),
    readFile(join(rootDir, "THIRD_PARTY_NOTICES.md"), "utf8"),
    readJson(join(rootDir, ".patchmill/skills/patchmill-skill-pack.json")),
  ]);
  assertLockfilesMatchSuperpowersTarget({
    packageJson,
    packageLock,
    shrinkwrap,
    targetVersion: expectedVersion,
  });
  const tag = `v${expectedVersion}`;
  const url = tarballUrlForVersion(expectedVersion);
  if (
    (skillPackSource.match(new RegExp(tag, "gu")) ?? []).length !== 2 ||
    !skillPackSource.includes(url)
  )
    throw new Error(
      `src/workflow/skill-pack.ts must contain exactly two ${tag} references and ${url}`,
    );
  const noticeUrl = `https://github.com/obra/superpowers/tree/${tag}/skills`;
  if (
    (
      notices.match(
        new RegExp(noticeUrl.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "gu"),
      ) ?? []
    ).length !== 1
  )
    throw new Error(
      `THIRD_PARTY_NOTICES.md must contain exactly one ${noticeUrl}`,
    );
  const source = metadata.pack?.source;
  if (
    source?.repository !== "obra/superpowers" ||
    source?.tag !== tag ||
    source?.tarballUrl !== url
  )
    throw new Error(
      `.patchmill/skills/patchmill-skill-pack.json source must match ${tag} and ${url}`,
    );
  for (const skill of await configuredSuperpowersSkills(rootDir))
    await access(
      join(rootDir, "node_modules/superpowers/skills", skill, "SKILL.md"),
    );
}
async function regenerateLockfiles(rootDir, runCommand) {
  await runCommand(
    "npm",
    ["install", "--package-lock-only", "--ignore-scripts"],
    rootDir,
  );
  const shrinkwrapPath = join(rootDir, "npm-shrinkwrap.json");
  const updatedShrinkwrap = await readFile(shrinkwrapPath);
  await rm(shrinkwrapPath);
  try {
    await runCommand(
      "npm",
      ["install", "--package-lock-only", "--ignore-scripts"],
      rootDir,
    );
  } finally {
    await writeFile(shrinkwrapPath, updatedShrinkwrap);
  }
  const [packageLock, shrinkwrap] = await Promise.all([
    readJson(join(rootDir, "package-lock.json")),
    readJson(shrinkwrapPath),
  ]);
  await repairMissingLockfileIntegrities([
    { label: "package-lock.json", lockfile: packageLock },
    { label: "npm-shrinkwrap.json", lockfile: shrinkwrap },
  ]);
  await Promise.all([
    writeJson(join(rootDir, "package-lock.json"), packageLock),
    writeJson(shrinkwrapPath, shrinkwrap),
  ]);
}
async function writeSummary(options, summary) {
  if (options.summaryJson) {
    await mkdir(dirname(options.summaryJson), { recursive: true });
    await writeJson(options.summaryJson, summary);
  }
}

export async function runSuperpowersUpgrade(args, dependencies = {}) {
  const rootDir = dependencies.rootDir ?? defaultRootDir;
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  let options = { summaryJson: summaryPathFromArgs(args), validateOnly: false };
  const summary = {
    currentVersion: undefined,
    targetVersion: undefined,
    targetTag: undefined,
    noUpdate: false,
    validateOnly: false,
    releases: [],
    changedFiles: [],
    validationCommands: [...validationCommands],
  };
  let snapshot;
  try {
    options = { ...options, ...parseArgs(args) };
    summary.validateOnly = options.validateOnly;
    const packageJson = await readJson(join(rootDir, "package.json"));
    const currentVersion = getCurrentSuperpowersVersion(packageJson);
    summary.currentVersion = currentVersion;
    const releases = await fetchStableReleases({
      fetchImpl,
      token: dependencies.token ?? process.env.GITHUB_TOKEN,
    });
    const resolution = resolveSuperpowersUpgrade({
      currentVersion,
      requestedVersion: options.superpowersVersion,
      releases,
    });
    Object.assign(summary, resolution);
    if (!resolution.noUpdate) {
      const packageVersion = await fetchReleasePackageVersion({
        fetchImpl,
        token: dependencies.token ?? process.env.GITHUB_TOKEN,
        tag: resolution.targetTag,
      });
      if (packageVersion !== resolution.targetVersion)
        throw new Error(
          `Release package version ${packageVersion} does not match tag ${resolution.targetTag}`,
        );
    }
    if (options.validateOnly || resolution.noUpdate) {
      await assertSynchronizedRepository(rootDir, currentVersion);
      await writeSummary(options, summary);
      return summary;
    }
    snapshot = await snapshotTrackedPaths(rootDir, trackedRoots);
    try {
      packageJson.dependencies[SUPERPOWERS_PACKAGE] = tarballUrlForVersion(
        resolution.targetVersion,
      );
      await writeJson(join(rootDir, "package.json"), packageJson);
      const currentTag = `v${currentVersion}`;
      const targetTag = resolution.targetTag;
      const skillPath = join(rootDir, "src/workflow/skill-pack.ts");
      await writeFile(
        skillPath,
        replaceExpected(
          await readFile(skillPath, "utf8"),
          currentTag,
          targetTag,
          2,
          "src/workflow/skill-pack.ts",
        ),
      );
      const noticePath = join(rootDir, "THIRD_PARTY_NOTICES.md");
      await writeFile(
        noticePath,
        replaceExpected(
          await readFile(noticePath, "utf8"),
          currentTag,
          targetTag,
          1,
          "THIRD_PARTY_NOTICES.md",
        ),
      );
      await regenerateLockfiles(rootDir, runCommand);
      const changedPackageJson = await readJson(join(rootDir, "package.json"));
      const packageLock = await readJson(join(rootDir, "package-lock.json"));
      const shrinkwrap = await readJson(join(rootDir, "npm-shrinkwrap.json"));
      assertLockfilesMatchSuperpowersTarget({
        packageJson: changedPackageJson,
        packageLock,
        shrinkwrap,
        targetVersion: resolution.targetVersion,
      });
      await runCommand("npm", ["ci"], rootDir);
      await runCommand(
        "node",
        ["bin/patchmill.ts", "skills", "update"],
        rootDir,
      );
      if (!options.skipNixHash)
        await runCommand("scripts/update-npm-deps-hash.sh", [], rootDir);
      await assertSynchronizedRepository(rootDir, resolution.targetVersion);
      summary.changedFiles = changedTrackedFiles(
        snapshot,
        await snapshotTrackedPaths(rootDir, trackedRoots),
      );
    } catch (error) {
      await restoreTrackedPaths(rootDir, trackedRoots, snapshot);
      summary.changedFiles = [];
      throw error;
    }
    await writeSummary(options, summary);
    return summary;
  } catch (error) {
    summary.error = errorMessage(error);
    summary.changedFiles = [];
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

if (import.meta.url === pathToFileURL(process.argv[1]).href)
  runSuperpowersUpgrade(process.argv.slice(2)).catch((error) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
