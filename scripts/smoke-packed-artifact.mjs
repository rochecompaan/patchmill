#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getRootPins, PI_PACKAGES } from "./pi-dependency-upgrade-lib.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

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

    const rootPins = getRootPins(
      JSON.parse(await readFile(join(rootDir, "package.json"), "utf8")),
    );
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
