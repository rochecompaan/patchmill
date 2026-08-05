import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertLockfilesMatchSuperpowersTarget,
  compareVersions,
  fetchReleasePackageVersion,
  fetchStableReleases,
  getCurrentSuperpowersVersion,
  normalizeGitHubRelease,
  normalizeVersion,
  renderSuperpowersPullRequestBody,
  resolveSuperpowersUpgrade,
  tagForVersion,
  tarballUrlForVersion,
} from "./superpowers-upgrade-lib.mjs";

const spec = tarballUrlForVersion("6.0.3");
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
const response = (body, options = {}) =>
  new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers: options.link ? { link: options.link } : {},
  });

test("normalizes strict stable versions and canonical dependency specs", () => {
  assert.equal(normalizeVersion("v6.2.0"), "6.2.0");
  assert.equal(tagForVersion("6.2.0"), "v6.2.0");
  assert.equal(
    tarballUrlForVersion("6.2.0"),
    "https://github.com/obra/superpowers/archive/refs/tags/v6.2.0.tar.gz",
  );
  assert.equal(compareVersions("6.1.1", "6.2.0"), -1);
  assert.equal(
    getCurrentSuperpowersVersion({ dependencies: { superpowers: spec } }),
    "6.0.3",
  );
  for (const invalid of ["6.2", "6.2.0-beta", "06.2.0"])
    assert.throws(() => normalizeVersion(invalid), /stable X\.Y\.Z/);
});

test("paginates stable releases and selects complete ordered range", async () => {
  const requests = [];
  const releases = await fetchStableReleases({
    token: "token",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return String(url).endsWith("page=1")
        ? response(
            [release("v6.2.0"), release("v6.2.0-beta", { prerelease: true })],
            {
              link: '<https://api.github.com/repos/obra/superpowers/releases?per_page=100&page=2>; rel="next"',
            },
          )
        : response([
            release("v6.1.1"),
            release("v6.1.0"),
            release("v6.0.3"),
            release("v6.0.2", { draft: true }),
          ]);
    },
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers.authorization, "Bearer token");
  assert.deepEqual(
    resolveSuperpowersUpgrade({
      currentVersion: "6.0.3",
      releases,
    }).releases.map(({ tag }) => tag),
    ["v6.1.0", "v6.1.1", "v6.2.0"],
  );
});

test("requires selected releases to have notes and validates no-update targets", () => {
  assert.throws(
    () =>
      resolveSuperpowersUpgrade({
        currentVersion: "6.0.3",
        requestedVersion: "6.2.0",
        releases: [
          normalizeGitHubRelease(release("v6.1.0", { body: " " })),
          normalizeGitHubRelease(release("v6.2.0")),
        ],
      }),
    /v6\.1\.0 has no release-note body/,
  );
  assert.throws(
    () =>
      resolveSuperpowersUpgrade({
        currentVersion: "6.0.3",
        requestedVersion: "6.2.0",
        releases: [
          normalizeGitHubRelease(release("v6.1.0", { body: null })),
          normalizeGitHubRelease(release("v6.2.0")),
        ],
      }),
    /v6\.1\.0 has no release-note body/,
  );
  assert.doesNotThrow(() =>
    resolveSuperpowersUpgrade({
      currentVersion: "6.0.3",
      requestedVersion: "6.2.0",
      releases: [
        normalizeGitHubRelease(release("v6.0.2", { body: null })),
        normalizeGitHubRelease(release("v6.2.0")),
        normalizeGitHubRelease(release("v6.3.0", { body: null })),
      ],
    }),
  );
  assert.equal(
    resolveSuperpowersUpgrade({
      currentVersion: "6.0.3",
      requestedVersion: "6.0.3",
      releases: [normalizeGitHubRelease(release("v6.0.3"))],
    }).noUpdate,
    true,
  );
  assert.throws(
    () =>
      resolveSuperpowersUpgrade({
        currentVersion: "6.0.3",
        requestedVersion: "6.0.3",
        releases: [],
      }),
    /Requested stable release v6\.0\.3 was not found/,
  );
});

test("reads release package versions and renders ordered release notes", async () => {
  assert.equal(
    await fetchReleasePackageVersion({
      tag: "v6.2.0",
      fetchImpl: async () =>
        response({
          encoding: "base64",
          content: Buffer.from(JSON.stringify({ version: "6.2.0" })).toString(
            "base64",
          ),
        }),
    }),
    "6.2.0",
  );
  const body = renderSuperpowersPullRequestBody({
    currentVersion: "6.0.3",
    targetVersion: "6.2.0",
    changedFiles: ["package.json"],
    validationCommands: ["npm test"],
    releases: ["v6.1.0", "v6.1.1", "v6.2.0"].map((tag) =>
      normalizeGitHubRelease(release(tag)),
    ),
  });
  assert.ok(body.indexOf("### v6.1.0") < body.indexOf("### v6.1.1"));
  assert.match(body, /does not auto-merge or publish/);
  const contained = renderSuperpowersPullRequestBody({
    currentVersion: "6.0.3",
    targetVersion: "6.2.0",
    changedFiles: [],
    validationCommands: [],
    releases: [
      normalizeGitHubRelease(
        release("v6.2.0", {
          body: "Fixes #123\n<!-- hide later content\n```` markdown",
        }),
      ),
    ],
  });
  assert.match(
    contained,
    /`````\nFixes #123\n<!-- hide later content\n```` markdown\n`````/,
  );
  const unsafePath = "skills/```\n## injected heading";
  const changedFiles = renderSuperpowersPullRequestBody({
    currentVersion: "6.0.3",
    targetVersion: "6.2.0",
    changedFiles: [unsafePath],
    validationCommands: [],
    releases: [normalizeGitHubRelease(release("v6.2.0"))],
  });
  assert.match(changedFiles, /- ````skills\/```\n## injected heading````/);
  assert.throws(
    () =>
      renderSuperpowersPullRequestBody({
        currentVersion: "1.0.0",
        targetVersion: "2.0.0",
        changedFiles: [],
        validationCommands: [],
        releases: [
          normalizeGitHubRelease(
            release("v2.0.0", { body: "x".repeat(70_000) }),
          ),
        ],
      }),
    /65,536/,
  );
});

test("checks root and installed lockfile records", () => {
  const target = "6.2.0";
  const root = { dependencies: { superpowers: tarballUrlForVersion(target) } };
  const lock = {
    packages: {
      "": root,
      "node_modules/superpowers": {
        version: target,
        resolved: tarballUrlForVersion(target),
        integrity: "sha512-test",
      },
    },
  };
  assert.doesNotThrow(() =>
    assertLockfilesMatchSuperpowersTarget({
      packageJson: root,
      packageLock: lock,
      shrinkwrap: lock,
      targetVersion: target,
    }),
  );
  assert.throws(
    () =>
      assertLockfilesMatchSuperpowersTarget({
        packageJson: root,
        packageLock: {
          packages: {
            ...lock.packages,
            "node_modules/superpowers": {
              ...lock.packages["node_modules/superpowers"],
              integrity: "",
            },
          },
        },
        shrinkwrap: lock,
        targetVersion: target,
      }),
    /package-lock\.json installed integrity/,
  );
});
