import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertLockfilesMatchPiSubagentsTarget,
  fetchLatestPiSubagentsVersion,
  getCurrentPiSubagentsVersion,
  renderPiSubagentsPullRequestBody,
  resolvePiSubagentsUpgrade,
} from "./pi-subagents-upgrade-lib.mjs";

function lockfile(version) {
  return {
    packages: {
      "": { dependencies: { "pi-subagents": version } },
      "node_modules/pi-subagents": { version },
    },
  };
}

test("scheduled resolution selects a newer npm latest version", () => {
  const result = resolvePiSubagentsUpgrade({
    currentVersion: "0.39.0",
    latestVersion: "0.40.0",
  });

  assert.deepEqual(result, {
    noUpdate: false,
    currentVersion: "0.39.0",
    targetVersion: "0.40.0",
  });
});

test("resolution reports no update for the current version", () => {
  const result = resolvePiSubagentsUpgrade({
    currentVersion: "0.39.0",
    latestVersion: "0.39.0",
  });

  assert.equal(result.noUpdate, true);
});

test("manual resolution selects a requested newer version", () => {
  const result = resolvePiSubagentsUpgrade({
    currentVersion: "0.39.0",
    requestedVersion: "0.50.0",
  });

  assert.equal(result.noUpdate, false);
  assert.equal(result.targetVersion, "0.50.0");
});

test("manual resolution rejects downgrades", () => {
  assert.throws(
    () =>
      resolvePiSubagentsUpgrade({
        currentVersion: "0.39.0",
        requestedVersion: "0.38.0",
      }),
    /Target pi-subagents version 0\.38\.0 is older than current version 0\.39\.0/,
  );
});

test("root pi-subagents dependency must be an exact stable version", () => {
  assert.throws(
    () =>
      getCurrentPiSubagentsVersion({
        dependencies: { "pi-subagents": "^0.39.0" },
      }),
    /must be a stable X\.Y\.Z version; found \^0\.39\.0/,
  );
});

test("npm latest resolution validates the registry response", async () => {
  const version = await fetchLatestPiSubagentsVersion(async () => ({
    ok: true,
    json: async () => ({ "dist-tags": { latest: "0.40.0" } }),
  }));

  assert.equal(version, "0.40.0");
});

test("lockfile validation identifies stale installed versions", () => {
  const packageLock = lockfile("0.40.0");
  const shrinkwrap = lockfile("0.40.0");
  shrinkwrap.packages["node_modules/pi-subagents"].version = "0.39.0";

  assert.throws(
    () =>
      assertLockfilesMatchPiSubagentsTarget({
        packageJson: { dependencies: { "pi-subagents": "0.40.0" } },
        packageLock,
        shrinkwrap,
        targetVersion: "0.40.0",
      }),
    /npm-shrinkwrap\.json installed version: expected 0\.40\.0; found 0\.39\.0/,
  );
});

test("PR body renders versions, changed files, and validation", () => {
  const body = renderPiSubagentsPullRequestBody({
    currentVersion: "0.39.0",
    targetVersion: "0.40.0",
    changedFiles: ["package.json", "nix/package.nix"],
    validationCommands: ["npm test"],
  });

  assert.match(body, /from `0\.39\.0` to `0\.40\.0`/);
  assert.match(body, /`package\.json`/);
  assert.match(body, /`nix\/package\.nix`/);
  assert.match(body, /`npm test`/);
});
