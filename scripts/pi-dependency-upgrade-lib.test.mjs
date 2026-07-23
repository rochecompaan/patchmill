import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertLockfilesMatchTargets,
  getRootPins,
  renderPullRequestBody,
  resolveUpgradeTarget,
} from "./pi-dependency-upgrade-lib.mjs";

const currentPins = {
  "@earendil-works/pi-coding-agent": "0.80.10",
  "@earendil-works/pi-tui": "0.80.10",
};

const newerVersions = {
  "@earendil-works/pi-coding-agent": "0.80.11",
  "@earendil-works/pi-tui": "0.80.11",
};

test("scheduled mode selects a newer shared latest version", () => {
  const result = resolveUpgradeTarget({
    mode: "scheduled",
    currentPins,
    latestVersions: newerVersions,
  });

  assert.equal(result.noUpdate, false);
  assert.deepEqual(result.targets, newerVersions);
});

test("scheduled mode fails before edits when latest versions diverge", () => {
  assert.throws(
    () =>
      resolveUpgradeTarget({
        mode: "scheduled",
        currentPins,
        latestVersions: {
          "@earendil-works/pi-coding-agent": "0.80.12",
          "@earendil-works/pi-tui": "0.80.11",
        },
      }),
    /requires matching latest versions.*pi-coding-agent=0.80.12.*pi-tui=0.80.11/,
  );
});

test("scheduled mode does not update equal or older numeric versions", () => {
  const result = resolveUpgradeTarget({
    mode: "scheduled",
    currentPins,
    latestVersions: currentPins,
  });

  assert.equal(result.noUpdate, true);
  assert.deepEqual(result.targets, currentPins);
});

test("manual mode warns when Pi package versions differ", () => {
  const result = resolveUpgradeTarget({
    mode: "manual",
    currentPins,
    manualVersions: {
      "@earendil-works/pi-coding-agent": "0.80.11",
      "@earendil-works/pi-tui": "0.80.12",
    },
  });

  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /versions differ/);
});

test("root Pi pins must be exact versions", () => {
  assert.throws(
    () =>
      getRootPins({
        dependencies: {
          "@earendil-works/pi-coding-agent": "^0.80.10",
          "@earendil-works/pi-tui": "0.80.10",
        },
      }),
    /pi-coding-agent must be an exact version; found \^0.80.10/,
  );
});

test("lockfile validation identifies file, package, expected, and actual versions", () => {
  const validLockfile = {
    packages: {
      "": { dependencies: currentPins },
      "node_modules/@earendil-works/pi-coding-agent": { version: "0.80.10" },
      "node_modules/@earendil-works/pi-tui": { version: "0.80.10" },
    },
  };
  const invalidShrinkwrap = structuredClone(validLockfile);
  invalidShrinkwrap.packages["node_modules/@earendil-works/pi-tui"].version =
    "0.80.9";

  assert.throws(
    () =>
      assertLockfilesMatchTargets({
        packageJson: { dependencies: currentPins },
        packageLock: validLockfile,
        shrinkwrap: invalidShrinkwrap,
        targets: currentPins,
      }),
    /npm-shrinkwrap.json: @earendil-works\/pi-tui expected 0.80.10, resolved version is 0.80.9/,
  );
});

test("PR body renders target versions and validation commands", () => {
  const body = renderPullRequestBody({
    targets: currentPins,
    warnings: ["Versions differ for a manual upgrade"],
    changedFiles: ["package.json"],
    validationCommands: ["npm test"],
  });

  assert.match(body, /@earendil-works\/pi-coding-agent.*0.80.10/);
  assert.match(body, /Versions differ for a manual upgrade/);
  assert.match(body, /`package.json`/);
  assert.match(body, /`npm test`/);
});
