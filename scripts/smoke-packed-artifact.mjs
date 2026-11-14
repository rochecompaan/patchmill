#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getRootPins, PI_PACKAGES } from "./pi-dependency-upgrade-lib.mjs";
import { smokeServe } from "./smoke-serve.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const PI_SUBAGENTS_PACKAGE = "pi-subagents";

function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`Command failed (${code}): ${command} ${args.join(" ")}`),
        );
    });
    child.on("error", reject);
  });
}

async function verifyDesignSkills(packageRoot, destination) {
  const require = createRequire(join(packageRoot, "package.json"));
  const upstream = dirname(require.resolve("mattpocock-skills/package.json"));
  const manifest = JSON.parse(
    await readFile(join(destination, "patchmill-skill-pack.json"), "utf8"),
  );
  const files = new Map(manifest.files.map((file) => [file.path, file.sha256]));
  const version = JSON.parse(
    await readFile(join(upstream, "package.json"), "utf8"),
  ).version;
  assert.equal(manifest.sources.mattPocock, version);
  async function compare(source, path) {
    const bytes = await readFile(source);
    assert.deepEqual(await readFile(join(destination, path)), bytes, path);
    assert.equal(
      files.get(path),
      createHash("sha256").update(bytes).digest("hex"),
      path,
    );
  }
  async function tree(source, relative) {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const from = join(source, entry.name);
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await tree(from, path);
      else await compare(from, path);
    }
  }
  for (const name of ["domain-modeling", "codebase-design"]) {
    await tree(join(upstream, "skills/engineering", name), name);
    await compare(join(upstream, "LICENSE"), join(name, "LICENSE"));
  }
  console.log(
    `Design skills ${version}: complete trees, licenses, and hashes verified from ${upstream}`,
  );
}

async function main() {
  const smokeDir = await mkdtemp(join(tmpdir(), "patchmill-smoke-"));
  const homeDir = join(smokeDir, "home");
  const configDir = join(smokeDir, "config");
  const cacheDir = join(smokeDir, "npm-cache");
  const projectDir = join(smokeDir, "project");
  let tarballPath;
  await Promise.all(
    [homeDir, configDir, cacheDir, projectDir].map((path) => mkdir(path)),
  );
  const environment = {
    ...process.env,
    HOME: homeDir,
    XDG_CONFIG_HOME: configDir,
    npm_config_cache: cacheDir,
  };

  try {
    const tarballName = await new Promise((resolve, reject) => {
      const child = spawn("npm", ["pack", "--silent"], {
        cwd: rootDir,
        env: environment,
      });
      let stdout = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        process.stdout.write(chunk);
      });
      child.stderr.pipe(process.stderr);
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(`Command failed (${code}): npm pack --silent`));
      });
    });
    tarballPath = join(rootDir, tarballName);

    await run("npm", ["init", "-y"], { cwd: projectDir, env: environment });
    await run("npm", ["install", tarballPath], {
      cwd: projectDir,
      env: environment,
    });
    await run("./node_modules/.bin/patchmill", ["--help"], {
      cwd: projectDir,
      env: environment,
    });
    await smokeServe(
      join(projectDir, "node_modules", ".bin", "patchmill"),
      [],
      { cwd: homeDir, env: environment },
    );
    await run("git", ["init"], { cwd: projectDir, env: environment });
    await run("./node_modules/.bin/patchmill", ["init"], {
      cwd: projectDir,
      env: environment,
    });

    const skillPath = join(
      projectDir,
      ".patchmill/skills/patchmill-issue-triage/SKILL.md",
    );
    if (!existsSync(skillPath)) {
      throw new Error(`Installed Patchmill skill is missing: ${skillPath}`);
    }

    const rootPackageJson = JSON.parse(
      await readFile(join(rootDir, "package.json"), "utf8"),
    );
    const rootPins = getRootPins(rootPackageJson);
    const projectRequire = createRequire(join(projectDir, "package.json"));
    const nodeModulesDir = dirname(
      dirname(projectRequire.resolve("patchmill/package.json")),
    );
    for (const name of PI_PACKAGES) {
      const packagePath = join(nodeModulesDir, name, "package.json");
      if (!existsSync(packagePath)) {
        throw new Error(
          `Could not locate package.json for ${name}: ${packagePath}`,
        );
      }
      const resolved = JSON.parse(await readFile(packagePath, "utf8"));
      if (resolved.version !== rootPins[name]) {
        throw new Error(
          `${name} resolved ${resolved.version} from ${packagePath} but package.json pins ${rootPins[name]}`,
        );
      }
      console.log(`${name} resolved ${resolved.version} from ${packagePath}`);
    }

    const patchmillPackageRoot = dirname(
      projectRequire.resolve("patchmill/package.json"),
    );
    await verifyDesignSkills(
      patchmillPackageRoot,
      join(projectDir, ".patchmill/skills"),
    );
    const compiledPiPackage = await import(
      pathToFileURL(
        join(
          patchmillPackageRoot,
          "dist",
          "src",
          "pi",
          "pi-subagents-package.js",
        ),
      ).href
    );
    compiledPiPackage.assertInstalledPiSubagentsMatchesRootPin(
      join(patchmillPackageRoot, "package.json"),
    );
    compiledPiPackage.piSubagentsExtensionFiles();
    const piSubagentsRoot = compiledPiPackage.resolvePiSubagentsPackageRoot();
    console.log(
      `${PI_SUBAGENTS_PACKAGE} resolved ${compiledPiPackage.readInstalledPiSubagentsManifest().version} from ${join(piSubagentsRoot, "package.json")}`,
    );
  } finally {
    if (process.env.PATCHMILL_KEEP_SMOKE_ARTIFACTS !== "1") {
      await Promise.all([
        rm(smokeDir, { recursive: true, force: true }),
        ...(tarballPath ? [rm(tarballPath, { force: true })] : []),
        rm(join(rootDir, "dist"), { recursive: true, force: true }),
      ]);
    } else {
      console.log(`Keeping smoke artifacts in ${smokeDir}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
