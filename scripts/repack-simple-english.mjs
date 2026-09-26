#!/usr/bin/env node
// Vendors the upstream SimpleEnglish skill repository as an npm-installable
// local package at vendor/simple-english/.
//
// Why: package.json depends on upstream skill sources as pinned external
// packages (see the superpowers dependency), but AminBlg/SimpleEnglish ships no
// package.json, so npm cannot install its GitHub archive directly. This script
// downloads the pinned upstream tarball, verifies its sha256, injects a minimal
// package.json, and copies the skill payload into vendor/simple-english/, which
// package.json depends on as "simple-english": "file:vendor/simple-english".
// A directory (not a repacked .tgz) is used because nixpkgs prefetch-npm-deps
// cannot fetch file: tarball entries from lockfiles.
//
// To upgrade: update SIMPLE_ENGLISH_TAG and SIMPLE_ENGLISH_TARBALL_SHA256,
// rerun this script, regenerate the lockfiles, and run the simple-english
// repository contract test.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SIMPLE_ENGLISH_PACKAGE = "simple-english";
export const SIMPLE_ENGLISH_REPOSITORY = "AminBlg/SimpleEnglish";
export const SIMPLE_ENGLISH_TAG = "v1.2.0";
export const SIMPLE_ENGLISH_TARBALL_URL = `https://github.com/${SIMPLE_ENGLISH_REPOSITORY}/archive/refs/tags/${SIMPLE_ENGLISH_TAG}.tar.gz`;
export const SIMPLE_ENGLISH_TARBALL_SHA256 =
  "65923ad60093432e85a47c43b42efb58ced0db5f25824406673a3e21467179fb";

const defaultRootDir = dirname(dirname(fileURLToPath(import.meta.url)));

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function runCommand(command, args, cwd) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Command failed: ${command} ${args.join(" ")}`)),
    );
  });
}

async function downloadTarball(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(
      `Unable to fetch ${url} (${response.status} ${response.statusText})`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function repackSimpleEnglish(options = {}) {
  const rootDir = options.rootDir ?? defaultRootDir;
  const fetchImpl = options.fetchImpl ?? fetch;
  const version = SIMPLE_ENGLISH_TAG.replace(/^v/u, "");
  const tarball = await downloadTarball(SIMPLE_ENGLISH_TARBALL_URL, fetchImpl);
  const digest = createHash("sha256").update(tarball).digest("hex");
  if (digest !== SIMPLE_ENGLISH_TARBALL_SHA256) {
    throw new Error(
      `SimpleEnglish tarball sha256 mismatch for ${SIMPLE_ENGLISH_TAG}: expected ${SIMPLE_ENGLISH_TARBALL_SHA256}, found ${digest}`,
    );
  }

  const workDir = await mkdtemp(join(tmpdir(), "simple-english-repack-"));
  try {
    const archivePath = join(workDir, "upstream.tar.gz");
    await writeFile(archivePath, tarball);
    await runCommand("tar", ["-xzf", archivePath], workDir);
    const extractedDir = join(workDir, `SimpleEnglish-${version}`);
    const packageJson = {
      name: SIMPLE_ENGLISH_PACKAGE,
      version,
      description: `ASD-STE100 Simplified Technical English writing skill, repacked from ${SIMPLE_ENGLISH_REPOSITORY} ${SIMPLE_ENGLISH_TAG} by scripts/repack-simple-english.mjs`,
      license: "MIT",
      repository: {
        type: "git",
        url: `https://github.com/${SIMPLE_ENGLISH_REPOSITORY}.git`,
      },
      files: ["skills", "README.md", "LICENSE"],
    };

    const vendorDir = join(rootDir, "vendor", SIMPLE_ENGLISH_PACKAGE);
    await rm(vendorDir, { recursive: true, force: true });
    await mkdir(vendorDir, { recursive: true });
    for (const entry of ["skills", "README.md", "LICENSE"]) {
      await cp(join(extractedDir, entry), join(vendorDir, entry), {
        recursive: true,
      });
    }
    await writeFile(
      join(vendorDir, "package.json"),
      `${JSON.stringify(packageJson, null, 2)}\n`,
    );

    console.log(
      `Wrote ${vendorDir}\n` +
        `Next steps: set the package.json dependency to\n` +
        `  "${SIMPLE_ENGLISH_PACKAGE}": "file:vendor/${SIMPLE_ENGLISH_PACKAGE}"\n` +
        `then regenerate package-lock.json and npm-shrinkwrap.json.`,
    );
    return vendorDir;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  repackSimpleEnglish().catch((error) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
