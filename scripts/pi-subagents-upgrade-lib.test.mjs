import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertLockfilesMatchPiSubagentsTarget,
  fetchLatestPiSubagentsVersion,
  fetchPiSubagentsReleaseNotes,
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

test("release notes include every stable release in the version jump", async () => {
  let request;
  const releaseNotes = await fetchPiSubagentsReleaseNotes({
    currentVersion: "0.39.0",
    targetVersion: "0.41.0",
    token: "test-token",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => [
          {
            tag_name: "v0.41.0",
            html_url: "https://example.test/v0.41.0",
            body: "Latest notes",
          },
          {
            tag_name: "v0.40.1",
            html_url: "https://example.test/v0.40.1",
            body: "Patch notes",
          },
          {
            tag_name: "v0.40.0",
            html_url: "https://example.test/v0.40.0",
            body: "First notes",
          },
          { tag_name: "v0.40.0-beta.1", prerelease: true },
          { tag_name: "v0.39.0", body: "Current notes" },
        ],
      };
    },
  });

  assert.match(request.url, /releases\?per_page=100&page=1$/);
  assert.equal(request.options.headers.Authorization, "Bearer test-token");
  assert.deepEqual(
    releaseNotes.map(({ version }) => version),
    ["0.40.0", "0.40.1", "0.41.0"],
  );
});

test("release notes fail when the target release is missing", async () => {
  await assert.rejects(
    fetchPiSubagentsReleaseNotes({
      currentVersion: "0.39.0",
      targetVersion: "0.40.0",
      fetchImpl: async () => ({ ok: true, json: async () => [] }),
    }),
    /no GitHub release notes found for v0\.40\.0/,
  );
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

test("PR body renders versions, release notes, changed files, and validation", () => {
  const body = renderPiSubagentsPullRequestBody({
    currentVersion: "0.39.0",
    targetVersion: "0.40.0",
    releaseNotes: [
      {
        version: "0.40.0",
        url: "https://example.test/v0.40.0",
        body: "Upstream release details",
      },
    ],
    changedFiles: ["package.json", "nix/package.nix"],
    validationCommands: ["npm test"],
  });

  assert.match(body, /from `0\.39\.0` to `0\.40\.0`/);
  assert.match(body, /href="https:\/\/example\.test\/v0\.40\.0"/);
  assert.match(body, /Upstream release details/);
  assert.match(body, /`package\.json`/);
  assert.match(body, /`nix\/package\.nix`/);
  assert.match(body, /`npm test`/);
});

test("PR body rejects release notes larger than GitHub accepts", () => {
  assert.throws(
    () =>
      renderPiSubagentsPullRequestBody({
        currentVersion: "0.39.0",
        targetVersion: "0.40.0",
        releaseNotes: [
          {
            version: "0.40.0",
            url: "https://example.test/v0.40.0",
            body: "x".repeat(65_536),
          },
        ],
        changedFiles: ["package.json"],
        validationCommands: ["npm test"],
      }),
    /exceeds GitHub's 65,536-character limit/,
  );
});
