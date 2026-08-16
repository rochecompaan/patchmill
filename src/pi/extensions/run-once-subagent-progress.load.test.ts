import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { piCommandArgs, resolveBundledPiCommand } from "../../cli/pi-cli.ts";
import { findPackageRoot } from "../../package-root.ts";
import type { PatchmillSkillsConfig } from "../../workflow/skills.ts";
import {
  profileExtensionArgs,
  runOncePlanningPiProfile,
} from "../resource-profiles.ts";

const rootDir = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
const skills: PatchmillSkillsConfig = {
  triage: "triage",
  planning: "planning",
  implementation: "implementation",
  developmentEnvironment: "development-environment",
  toolchain: "toolchain",
  review: "review",
  visualEvidence: "visual-evidence",
  landing: "landing",
};

test("Pi loads the source run-once extensions before the sentinel", () => {
  const homeDir = mkdtempSync(join(tmpdir(), "patchmill-run-once-load-"));
  const sentinelPath = join(homeDir, "loaded.txt");
  try {
    const profile = runOncePlanningPiProfile(skills, rootDir);
    assert.equal(profile.additionalExtensionPaths.length, 3);
    const command = resolveBundledPiCommand();
    const result = spawnSync(
      command.command,
      piCommandArgs(command, [
        "--mode",
        "rpc",
        "--no-session",
        "--offline",
        "-ne",
        ...profileExtensionArgs(profile),
        "-e",
        join(rootDir, "fixtures", "run-once-extension-load-sentinel.ts"),
      ]),
      {
        cwd: rootDir,
        encoding: "utf8",
        input: '{"type":"get_commands"}\n',
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          HOME: homeDir,
          XDG_CONFIG_HOME: join(homeDir, "config"),
          PATCHMILL_RUN_ONCE_EXTENSION_SENTINEL: sentinelPath,
        },
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(
      readFileSync(sentinelPath, "utf8"),
      "patchmill-run-once-extensions-loaded\n",
    );
    assert.doesNotMatch(
      `${result.stdout}\n${result.stderr}`,
      /Failed to load extension|Cannot find module|ERR_MODULE_NOT_FOUND/iu,
    );
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});
