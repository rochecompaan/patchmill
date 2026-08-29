import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { HELP_TEXT } from "../src/cli/main.ts";

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function createStaleDependencyFixture(repoRoot: string, fixtureDir: string) {
  const fixturePaths = [
    "bin/patchmill.ts",
    "src/package-root.ts",
    "src/runtime-dependency-preflight.ts",
    "src/pi/pi-subagents-package.ts",
  ];
  for (const relativePath of fixturePaths) {
    const destination = join(fixtureDir, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(repoRoot, relativePath), destination);
  }

  writeJson(join(fixtureDir, "package.json"), {
    dependencies: { "pi-subagents": "2.0.0" },
  });
  const dependencyDir = join(fixtureDir, "node_modules", "pi-subagents");
  mkdirSync(dependencyDir, { recursive: true });
  writeJson(join(dependencyDir, "package.json"), {
    name: "pi-subagents",
    version: "1.0.0",
    main: "index.js",
  });
  writeFileSync(join(dependencyDir, "index.js"), "export {};\n");

  const sentinelPath = join(fixtureDir, "src", "cli", "main.ts");
  mkdirSync(dirname(sentinelPath), { recursive: true });
  writeFileSync(
    sentinelPath,
    'process.stdout.write("CLI_DISPATCHED");\nexport async function main() { return 23; }\n',
  );
}

test("patchmill sanitizes inherited Pi state before loading the actual executable CLI", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const registerPath = join(
    repoRoot,
    "test-support",
    "patchmill-bootstrap-register.mjs",
  );
  const executablePath = join(repoRoot, "bin", "patchmill.ts");

  const result = spawnSync(
    process.execPath,
    ["--import", registerPath, executablePath],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PI_PACKAGE_DIR: "/nix/store/outer-pi/libexec/pi",
        ANTHROPIC_API_KEY: "test-provider-token",
        PI_SUBAGENT_PARENT_SESSION: "test-parent-session",
        PATCHMILL_TEST_SENTINEL: "preserved",
      },
    },
  );

  assert.equal(result.error, undefined);
  assert.equal(result.status, 23, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    piPackageDir: null,
    providerCredential: "test-provider-token",
    parentSession: "test-parent-session",
    sentinel: "preserved",
  });
});

test("patchmill executes when invoked through a symlink", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const fixtureDir = mkdtempSync(join(tmpdir(), "patchmill-"));
  const symlinkPath = join(fixtureDir, "patchmill-link.ts");

  try {
    symlinkSync(join(repoRoot, "bin", "patchmill.ts"), symlinkPath, "file");

    const result = spawnSync(process.execPath, [symlinkPath, "--help"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `${HELP_TEXT}\n`);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("patchmill rejects stale runtime dependencies before CLI dispatch", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const fixtureDir = mkdtempSync(join(tmpdir(), "patchmill-stale-deps-"));

  try {
    createStaleDependencyFixture(repoRoot, fixtureDir);
    const result = spawnSync(
      process.execPath,
      [join(fixtureDir, "bin", "patchmill.ts"), "version"],
      { cwd: fixtureDir, encoding: "utf8" },
    );

    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stdout, /CLI_DISPATCHED/u);
    assert.match(
      result.stderr,
      /pi-subagents resolved 1\.0\.0 but package\.json pins 2\.0\.0/u,
    );
    assert.match(result.stderr, /Run `npm install`/u);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
