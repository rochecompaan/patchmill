import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertInstalledPiSubagentsMatchesRootPin,
  isExactNpmVersion,
  piSubagentsExtensionFiles,
  readInstalledPiSubagentsManifest,
  readRootPiSubagentsPin,
  resolvePiSubagentsPackageRoot,
} from "./pi-subagents-package.ts";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "../..");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("root pi-subagents dependency is an exact installed pin", () => {
  const pin = readRootPiSubagentsPin(join(rootDir, "package.json"));
  assert.equal(isExactNpmVersion(pin), true);
  assertInstalledPiSubagentsMatchesRootPin(join(rootDir, "package.json"));
});

test("lockfiles agree with the root pi-subagents pin", () => {
  const pin = readRootPiSubagentsPin(join(rootDir, "package.json"));
  for (const filename of ["package-lock.json", "npm-shrinkwrap.json"]) {
    const lockfile = readJson(join(rootDir, filename)) as {
      packages?: Record<
        string,
        { version?: string; dependencies?: Record<string, string> }
      >;
    };
    assert.equal(lockfile.packages?.[""]?.dependencies?.["pi-subagents"], pin);
    assert.equal(
      lockfile.packages?.["node_modules/pi-subagents"]?.version,
      pin,
    );
  }
});

test("installed pi-subagents manifest declares existing extension files", () => {
  const packageRoot = resolvePiSubagentsPackageRoot();
  assert.equal(packageRoot.endsWith("pi-subagents"), true);
  const manifest = readInstalledPiSubagentsManifest();
  assert.equal(
    manifest.version,
    readRootPiSubagentsPin(join(rootDir, "package.json")),
  );
  assert.ok(Array.isArray(manifest.pi?.extensions));
  assert.ok((manifest.pi?.extensions ?? []).length > 0);
  for (const extensionFile of piSubagentsExtensionFiles()) {
    assert.equal(extensionFile.startsWith(packageRoot), true);
    assert.equal(
      existsSync(extensionFile),
      true,
      `missing extension ${extensionFile}`,
    );
    assert.equal(
      statSync(extensionFile).isFile(),
      true,
      `not a file ${extensionFile}`,
    );
  }
});

test("pi loads the resolved pi-subagents extension package without model execution", () => {
  const badResult = spawnSync(
    "./node_modules/.bin/pi",
    [
      "--mode",
      "json",
      "--print",
      "--no-session",
      "--offline",
      "-ne",
      "-e",
      join(rootDir, "node_modules", "not-pi-subagents"),
      "/subagents-doctor",
    ],
    { cwd: rootDir, encoding: "utf8", timeout: 30_000 },
  );
  assert.notEqual(badResult.status, 0, badResult.stdout);
  assert.match(
    `${badResult.stdout}\n${badResult.stderr}`,
    /Failed to load extension|Extension path does not exist/iu,
  );

  const homeDir = mkdtempSync(join(tmpdir(), "patchmill-pi-subagents-rpc-"));
  try {
    const result = spawnSync(
      "./node_modules/.bin/pi",
      [
        "--mode",
        "rpc",
        "--no-session",
        "--offline",
        "-ne",
        "-e",
        resolvePiSubagentsPackageRoot(),
      ],
      {
        cwd: rootDir,
        encoding: "utf8",
        input: '{"type":"get_commands"}\n',
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          HOME: homeDir,
          XDG_CONFIG_HOME: join(homeDir, ".config"),
        },
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const responses = result.stdout
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map(
        (line) =>
          JSON.parse(line) as {
            type?: string;
            command?: string;
            success?: boolean;
            data?: { commands?: Array<{ name?: string; source?: string }> };
          },
      );
    const commandResponse = responses.find(
      (response) =>
        response.type === "response" && response.command === "get_commands",
    );
    assert.equal(commandResponse?.success, true, result.stdout);
    assert.ok(
      commandResponse?.data?.commands?.some(
        (command) =>
          command.name === "subagents-doctor" && command.source === "extension",
      ),
      result.stdout,
    );
    assert.doesNotMatch(
      `${result.stdout}\n${result.stderr}`,
      /extension load failed|Cannot find module|ERR_MODULE_NOT_FOUND/iu,
    );
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});
