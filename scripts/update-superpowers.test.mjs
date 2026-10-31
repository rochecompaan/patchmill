import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  PATCHMILL_SKILLS,
  SUPERPOWERS_SKILLS,
  SIMPLE_ENGLISH_SKILLS,
} from "../src/cli/commands/init/skill-installer.ts";
import { snapshotTrackedPaths } from "./tracked-files.mjs";
import {
  commandEnvironment,
  runSuperpowersUpgrade,
  validationCommands,
} from "./update-superpowers.mjs";
import {
  assertLockfilesMatchSuperpowersTarget,
  tarballUrlForVersion,
} from "./superpowers-upgrade-lib.mjs";

const rootDir = process.cwd();
const trackedRoots = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "nix/package.nix",
  "THIRD_PARTY_NOTICES.md",
  ".patchmill/skills",
];
const release = (tag, overrides = {}) => ({
  tag_name: tag,
  name: tag,
  html_url: `https://github.com/obra/superpowers/releases/tag/${tag}`,
  published_at: "2026-07-24T00:00:00Z",
  body: `Notes for ${tag}`,
  draft: false,
  prerelease: false,
  ...overrides,
});

function releaseFetch(url) {
  if (String(url).includes("/contents/package.json"))
    return Promise.resolve(
      new Response(
        JSON.stringify({
          encoding: "base64",
          content: Buffer.from(JSON.stringify({ version: "6.2.0" })).toString(
            "base64",
          ),
        }),
      ),
    );
  return Promise.resolve(
    new Response(
      JSON.stringify([
        release("v6.2.0"),
        release("v6.1.1"),
        release("v6.1.0"),
        release("v6.0.3"),
      ]),
    ),
  );
}

function lockfile(version) {
  const spec = tarballUrlForVersion(version);
  return {
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { superpowers: spec } },
      "node_modules/superpowers": {
        version,
        resolved: spec,
        integrity: "sha512-test",
      },
    },
  };
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function createFixture() {
  const fixture = await mkdtemp(
    join(tmpdir(), "patchmill-superpowers-upgrade-"),
  );
  const currentVersion = "6.0.3";
  const spec = tarballUrlForVersion(currentVersion);
  await mkdir(join(fixture, "nix"), { recursive: true });
  await mkdir(join(fixture, "src/cli/commands/init"), { recursive: true });
  await cp(
    join(rootDir, "src/cli/commands/init/skill-installer.ts"),
    join(fixture, "src/cli/commands/init/skill-installer.ts"),
  );
  await Promise.all([
    writeJson(join(fixture, "package.json"), {
      type: "module",
      version: "0.1.0",
      dependencies: { superpowers: spec },
    }),
    writeJson(join(fixture, "package-lock.json"), lockfile(currentVersion)),
    writeJson(join(fixture, "npm-shrinkwrap.json"), lockfile(currentVersion)),
    writeFile(join(fixture, "nix/package.nix"), "{ }\n"),
    writeFile(
      join(fixture, "THIRD_PARTY_NOTICES.md"),
      `https://github.com/obra/superpowers/tree/v${currentVersion}/skills\n`,
    ),
  ]);
  for (const [packRoot, names, version] of [
    [fixture, PATCHMILL_SKILLS, "0.1.0"],
    [
      join(fixture, "node_modules/superpowers"),
      SUPERPOWERS_SKILLS,
      currentVersion,
    ],
    [
      join(fixture, "node_modules/simple-english"),
      SIMPLE_ENGLISH_SKILLS,
      "1.0.0",
    ],
  ]) {
    await mkdir(packRoot, { recursive: true });
    if (packRoot !== fixture)
      await writeJson(join(packRoot, "package.json"), { version });
    for (const name of names) {
      const dir = join(packRoot, "skills", name);
      await mkdir(join(dir, "references"), { recursive: true });
      await writeFile(join(dir, "SKILL.md"), `${name} skill\n`);
      await writeFile(join(dir, "references/example.md"), "old resource\n");
    }
  }
  await installFixture(fixture);
  return fixture;
}

async function installFixture(fixture) {
  const { installSkills } = await import(
    pathToFileURL(join(fixture, "src/cli/commands/init/skill-installer.ts"))
      .href
  );
  return installSkills({
    repoRoot: fixture,
    skillDir: ".patchmill/skills",
    packageRoot: fixture,
  });
}

async function fixtureRunCommand(command, args, fixture, calls) {
  calls.push([command, ...args]);
  if (command === "npm" && args[0] === "install") {
    await Promise.all([
      writeJson(join(fixture, "package-lock.json"), lockfile("6.2.0")),
      writeJson(join(fixture, "npm-shrinkwrap.json"), lockfile("6.2.0")),
    ]);
  }
  if (command === "npm" && args[0] === "ci") {
    await writeJson(join(fixture, "node_modules/superpowers/package.json"), {
      version: "6.2.0",
    });
    await writeFile(
      join(
        fixture,
        "node_modules/superpowers/skills/brainstorming/references/example.md",
      ),
      "new resource\n",
    );
  }
  if (command === "node") {
    assert.equal(args[0], "--input-type=module");
    assert.equal(args[1], "-e");
    // Execute the emitted module against the fixture, without touching the host.
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(process.execPath, args, {
      cwd: fixture,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
  }
}

async function snapshotEntries(fixture) {
  return [...(await snapshotTrackedPaths(fixture, trackedRoots))].map(
    ([path, entry]) => [path, entry.content.toString("base64"), entry.mode],
  );
}

test("validate-only no-update checks a synchronized repository without commands", async () => {
  const fixture = await createFixture();
  try {
    const summary = await runSuperpowersUpgrade(
      ["--mode", "manual", "--superpowers-version", "6.0.3", "--validate-only"],
      {
        rootDir: fixture,
        fetchImpl: async (url) =>
          String(url).includes("/contents/package.json")
            ? new Response(
                JSON.stringify({
                  encoding: "base64",
                  content: Buffer.from(
                    JSON.stringify({ version: "6.0.3" }),
                  ).toString("base64"),
                }),
              )
            : new Response(JSON.stringify([release("v6.0.3")])),
        runCommand: async () => assert.fail("must not run commands"),
      },
    );
    assert.equal(summary.noUpdate, true);
    assert.equal(summary.currentVersion, "6.0.3");
    assert.deepEqual(summary.changedFiles, []);
    assert.equal(validationCommands[0], "npm ci");
    const resource = join(
      fixture,
      ".patchmill/skills/brainstorming/references/example.md",
    );
    await writeFile(resource, "corrupted\n");
    await assert.rejects(
      runSuperpowersUpgrade(
        ["--superpowers-version", "6.2.0", "--validate-only"],
        {
          rootDir: fixture,
          fetchImpl: releaseFetch,
          runCommand: async () => assert.fail("must not run commands"),
        },
      ),
      /hash|content/i,
    );
    await installFixture(fixture);
    await writeFile(
      join(
        fixture,
        "node_modules/superpowers/skills/brainstorming/references/omitted.md",
      ),
      "missing from manifest\n",
    );
    await assert.rejects(
      runSuperpowersUpgrade(
        ["--superpowers-version", "6.2.0", "--validate-only"],
        { rootDir: fixture, fetchImpl: releaseFetch },
      ),
      /manifest|files/i,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("writes parse failures to the requested summary", async () => {
  const dir = await mkdtemp(join(tmpdir(), "patchmill-superpowers-summary-"));
  const summaryPath = join(dir, "summary.json");
  try {
    await assert.rejects(
      runSuperpowersUpgrade(["--mode", "bad", "--summary-json", summaryPath], {
        rootDir,
      }),
      /--mode must be scheduled or manual/,
    );
    assert.match(
      JSON.parse(await readFile(summaryPath, "utf8")).error,
      /--mode must be scheduled or manual/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("removes GitHub tokens while preserving ordinary command environment", () => {
  assert.deepEqual(
    commandEnvironment({
      PATH: "/test/bin",
      HOME: "/test/home",
      GITHUB_TOKEN: "secret",
      GH_TOKEN: "secret",
    }),
    { PATH: "/test/bin", HOME: "/test/home" },
  );
});

test("upgrades metadata transactionally and reports nested skill changes without Git", async () => {
  const fixture = await createFixture();
  const calls = [];
  try {
    const summary = await runSuperpowersUpgrade(
      ["--mode", "manual", "--superpowers-version", "6.2.0", "--skip-nix-hash"],
      {
        rootDir: fixture,
        fetchImpl: releaseFetch,
        runCommand: (command, args, cwd) =>
          fixtureRunCommand(command, args, cwd, calls),
      },
    );
    assert.equal(summary.targetVersion, "6.2.0");
    assert.deepEqual(calls.slice(0, 3), [
      ["npm", "install", "--package-lock-only", "--ignore-scripts"],
      ["npm", "install", "--package-lock-only", "--ignore-scripts"],
      ["npm", "ci"],
    ]);
    assert.equal(calls.length, 4);
    assert.equal(
      await readFile(
        join(fixture, ".patchmill/skills/brainstorming/references/example.md"),
        "utf8",
      ),
      "new resource\n",
    );
    assert.equal(
      JSON.parse(
        await readFile(
          join(fixture, ".patchmill/skills/patchmill-skill-pack.json"),
          "utf8",
        ),
      ).sources.superpowers,
      "6.2.0",
    );
    assert.ok(
      summary.changedFiles.includes(
        ".patchmill/skills/brainstorming/references/example.md",
      ),
    );
    assert.equal(
      JSON.parse(await readFile(join(fixture, "package.json"), "utf8"))
        .dependencies.superpowers,
      tarballUrlForVersion("6.2.0"),
    );
    assertLockfilesMatchSuperpowersTarget({
      packageJson: JSON.parse(
        await readFile(join(fixture, "package.json"), "utf8"),
      ),
      packageLock: JSON.parse(
        await readFile(join(fixture, "package-lock.json"), "utf8"),
      ),
      shrinkwrap: JSON.parse(
        await readFile(join(fixture, "npm-shrinkwrap.json"), "utf8"),
      ),
      targetVersion: "6.2.0",
    });
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("restores all tracked files and preserves the command failure in the summary", async () => {
  const fixture = await createFixture();
  const summaryPath = join(fixture, "summary.json");
  const before = await snapshotEntries(fixture);
  try {
    await assert.rejects(
      runSuperpowersUpgrade(
        [
          "--mode",
          "manual",
          "--superpowers-version",
          "6.2.0",
          "--skip-nix-hash",
          "--summary-json",
          summaryPath,
        ],
        {
          rootDir: fixture,
          fetchImpl: releaseFetch,
          runCommand: async (command, args, cwd) => {
            if (command === "npm" && args[0] === "ci")
              throw new Error("Command failed: npm ci");
            await fixtureRunCommand(command, args, cwd, []);
          },
        },
      ),
      /Command failed: npm ci/,
    );
    assert.deepEqual(await snapshotEntries(fixture), before);
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    assert.match(summary.error, /Command failed: npm ci/);
    assert.deepEqual(summary.changedFiles, []);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("restores tracked files when writing the success summary fails", async () => {
  const fixture = await createFixture();
  const summaryPath = join(fixture, "summary-directory");
  const before = await snapshotEntries(fixture);
  await mkdir(summaryPath);
  try {
    await assert.rejects(
      runSuperpowersUpgrade(
        [
          "--mode",
          "manual",
          "--superpowers-version",
          "6.2.0",
          "--skip-nix-hash",
          "--summary-json",
          summaryPath,
        ],
        {
          rootDir: fixture,
          fetchImpl: releaseFetch,
          runCommand: (command, args, cwd) =>
            fixtureRunCommand(command, args, cwd, []),
        },
      ),
      /(EISDIR|directory)/,
    );
    assert.deepEqual(await snapshotEntries(fixture), before);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("reports rollback failures without replacing the original failure", async () => {
  const fixture = await createFixture();
  const summaryPath = join(fixture, "summary.json");
  try {
    await assert.rejects(
      runSuperpowersUpgrade(
        [
          "--mode",
          "manual",
          "--superpowers-version",
          "6.2.0",
          "--summary-json",
          summaryPath,
        ],
        {
          rootDir: fixture,
          fetchImpl: releaseFetch,
          runCommand: async () => {
            throw new Error("Command failed: npm install");
          },
          restoreTrackedPaths: async () => {
            throw new Error("disk unavailable");
          },
        },
      ),
      /Command failed: npm install/,
    );
    assert.match(
      JSON.parse(await readFile(summaryPath, "utf8")).error,
      /Command failed: npm install/,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("validates explicit current targets as stable releases with matching packages", async (t) => {
  const fixture = await createFixture();
  t.after(async () => rm(fixture, { recursive: true, force: true }));
  await assert.rejects(
    runSuperpowersUpgrade(
      ["--mode", "manual", "--superpowers-version", "6.0.3", "--validate-only"],
      {
        rootDir: fixture,
        fetchImpl: async () => new Response(JSON.stringify([])),
      },
    ),
    /Requested stable release v6\.0\.3 was not found/,
  );
  await assert.rejects(
    runSuperpowersUpgrade(
      ["--mode", "manual", "--superpowers-version", "6.0.3", "--validate-only"],
      {
        rootDir: fixture,
        fetchImpl: async (url) =>
          String(url).includes("/contents/package.json")
            ? new Response(
                JSON.stringify({
                  encoding: "base64",
                  content: Buffer.from(
                    JSON.stringify({ version: "6.0.4" }),
                  ).toString("base64"),
                }),
              )
            : new Response(JSON.stringify([release("v6.0.3")])),
      },
    ),
    /Release package version 6\.0\.4 does not match tag v6\.0\.3/,
  );
});
