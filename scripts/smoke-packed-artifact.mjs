#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getRootPins, PI_PACKAGES } from "./pi-dependency-upgrade-lib.mjs";

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

function runPiExtensionLoad(command, args, options) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    input: '{"type":"get_commands"}\n',
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}`,
    /Failed to load extension|Cannot find module|ERR_MODULE_NOT_FOUND/iu,
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
    const { runOncePlanningPiProfile } = await import(
      pathToFileURL(
        join(patchmillPackageRoot, "dist", "src", "pi", "resource-profiles.js"),
      ).href
    );
    const skills = {
      triage: "triage",
      planning: "planning",
      implementation: "implementation",
      developmentEnvironment: "development-environment",
      toolchain: "toolchain",
      review: "review",
      visualEvidence: "visual-evidence",
      landing: "landing",
    };
    const profile = runOncePlanningPiProfile(skills, patchmillPackageRoot);
    if (
      realpathSync(profile.additionalExtensionPaths[0]) !==
      realpathSync(piSubagentsRoot)
    ) {
      throw new Error(
        "run-once profile does not load the installed pi-subagents package first",
      );
    }
    if (
      !profile.additionalExtensionPaths[1]
        ?.replaceAll("\\", "/")
        .endsWith("/extensions/todos.ts")
    ) {
      throw new Error(
        "run-once profile does not load the Patchmill todos extension second",
      );
    }
    if (
      !profile.additionalExtensionPaths[2]
        ?.replaceAll("\\", "/")
        .endsWith("/src/pi/extensions/run-once-subagent-progress.ts")
    ) {
      throw new Error(
        "run-once profile does not load the Patchmill subagent progress observer third",
      );
    }

    const installedPi = await import(
      pathToFileURL(
        join(
          nodeModulesDir,
          "@earendil-works",
          "pi-coding-agent",
          "dist",
          "index.js",
        ),
      ).href
    );
    const installedAgentDir = join(smokeDir, "pi-agent");
    await mkdir(installedAgentDir, { recursive: true });
    const loadedObserver = await installedPi.discoverAndLoadExtensions(
      [profile.additionalExtensionPaths[2]],
      patchmillPackageRoot,
      installedAgentDir,
    );
    assert.deepEqual(loadedObserver.errors, []);
    const observer = loadedObserver.extensions.find((extension) =>
      extension.resolvedPath
        .replaceAll("\\", "/")
        .endsWith("/src/pi/extensions/run-once-subagent-progress.ts"),
    );
    assert.ok(observer);
    for (const eventName of [
      "session_start",
      "tool_execution_update",
      "tool_execution_end",
    ]) {
      assert.ok((observer.handlers.get(eventName)?.length ?? 0) > 0);
    }

    const sentinelFixture = join(
      patchmillPackageRoot,
      "fixtures",
      "run-once-extension-load-sentinel.ts",
    );
    if (!existsSync(sentinelFixture)) {
      throw new Error(
        `Installed sentinel fixture is missing: ${sentinelFixture}`,
      );
    }
    const sentinelOutput = join(smokeDir, "run-once-extensions-loaded.txt");
    runPiExtensionLoad(
      join(projectDir, "node_modules", ".bin", "pi"),
      [
        "--mode",
        "rpc",
        "--no-session",
        "--offline",
        "-ne",
        ...profile.additionalExtensionPaths.flatMap((path) => ["-e", path]),
        "-e",
        sentinelFixture,
      ],
      {
        cwd: projectDir,
        env: {
          ...environment,
          PATCHMILL_RUN_ONCE_EXTENSION_SENTINEL: sentinelOutput,
        },
      },
    );
    assert.equal(
      await readFile(sentinelOutput, "utf8"),
      "patchmill-run-once-extensions-loaded\n",
    );
    console.log("packed run-once extensions loaded before sentinel");
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
