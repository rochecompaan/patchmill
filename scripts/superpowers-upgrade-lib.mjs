export const SUPERPOWERS_PACKAGE = "superpowers";
export const SUPERPOWERS_REPOSITORY = "obra/superpowers";

const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const canonicalSpecPattern =
  /^https:\/\/github\.com\/obra\/superpowers\/archive\/refs\/tags\/v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\.tar\.gz$/u;
const githubApi = "https://api.github.com";

export function normalizeVersion(value, label = "Superpowers version") {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a stable X.Y.Z version; found ${value}`);
  }
  const normalized = value.startsWith("v") ? value.slice(1) : value;
  if (!stableVersionPattern.test(normalized)) {
    throw new Error(`${label} must be a stable X.Y.Z version; found ${value}`);
  }
  return normalized;
}

export function tagForVersion(version) {
  return `v${normalizeVersion(version)}`;
}

export function tarballUrlForVersion(version) {
  return `https://github.com/obra/superpowers/archive/refs/tags/${tagForVersion(version)}.tar.gz`;
}

export function compareVersions(a, b) {
  const left = normalizeVersion(a).split(".").map(Number);
  const right = normalizeVersion(b).split(".").map(Number);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function getCurrentSuperpowersVersion(packageJson) {
  const spec = packageJson.dependencies?.[SUPERPOWERS_PACKAGE];
  const match = canonicalSpecPattern.exec(spec ?? "");
  if (!match) {
    throw new Error(
      `${SUPERPOWERS_PACKAGE} must use the canonical GitHub tag tarball; found ${spec ?? "missing"}`,
    );
  }
  return normalizeVersion(match[1]);
}

export function normalizeGitHubRelease(release) {
  if (release?.draft || release?.prerelease) return undefined;
  const version = normalizeVersion(release?.tag_name, "GitHub release tag");
  const body = release?.body ?? "";
  for (const [key, value] of Object.entries({
    name: release?.name ?? release?.tag_name,
    htmlUrl: release?.html_url,
    publishedAt: release?.published_at,
    body,
  })) {
    if (typeof value !== "string") {
      throw new Error(
        `GitHub release ${tagForVersion(version)} has invalid ${key}`,
      );
    }
  }
  return {
    tag: tagForVersion(version),
    version,
    name: release.name ?? release.tag_name,
    htmlUrl: release.html_url,
    publishedAt: release.published_at,
    body,
  };
}

function githubHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

function nextLink(link) {
  if (!link) return undefined;
  return link
    .split(",")
    .map((entry) => entry.trim())
    .find((entry) => /;\s*rel="next"$/u.test(entry))
    ?.match(/^<([^>]+)>/u)?.[1];
}

async function githubJson(fetchImpl, url, token, repository) {
  let response;
  try {
    response = await fetchImpl(url, { headers: githubHeaders(token) });
  } catch (error) {
    throw new Error(
      `GitHub request failed for ${repository} ${url}: ${error.message}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `GitHub request failed for ${repository} ${url}: ${response.status} ${response.statusText}`,
    );
  }
  return { body: await response.json(), response };
}

export async function fetchStableReleases({
  fetchImpl = fetch,
  token,
  repository = SUPERPOWERS_REPOSITORY,
}) {
  let url = `${githubApi}/repos/${repository}/releases?per_page=100&page=1`;
  const releases = [];
  while (url) {
    const { body, response } = await githubJson(
      fetchImpl,
      url,
      token,
      repository,
    );
    if (!Array.isArray(body))
      throw new Error(
        `GitHub releases response for ${repository} is not an array`,
      );
    for (const release of body) {
      const normalized = normalizeGitHubRelease(release);
      if (normalized) releases.push(normalized);
    }
    url = nextLink(response.headers.get("link"));
  }
  const byVersion = new Map();
  for (const release of releases) {
    if (byVersion.has(release.version))
      throw new Error(`Ambiguous stable release ${release.tag}`);
    byVersion.set(release.version, release);
  }
  return [...byVersion.values()].sort((a, b) =>
    compareVersions(a.version, b.version),
  );
}

export async function fetchReleasePackageVersion({
  fetchImpl = fetch,
  token,
  repository = SUPERPOWERS_REPOSITORY,
  tag,
}) {
  const normalizedTag = tagForVersion(tag);
  const url = `${githubApi}/repos/${repository}/contents/package.json?ref=${encodeURIComponent(normalizedTag)}`;
  const { body } = await githubJson(fetchImpl, url, token, repository);
  if (body?.encoding !== "base64" || typeof body.content !== "string") {
    throw new Error(
      `GitHub package.json response for ${repository}@${normalizedTag} is not base64 content`,
    );
  }
  let packageJson;
  try {
    packageJson = JSON.parse(
      Buffer.from(body.content.replace(/\s/g, ""), "base64").toString("utf8"),
    );
  } catch (error) {
    throw new Error(
      `GitHub package.json for ${repository}@${normalizedTag} is invalid: ${error.message}`,
    );
  }
  return normalizeVersion(
    packageJson.version,
    `package version for ${normalizedTag}`,
  );
}

export function resolveSuperpowersUpgrade({
  currentVersion,
  requestedVersion,
  releases,
}) {
  const current = normalizeVersion(
    currentVersion,
    "Current Superpowers version",
  );
  const normalized = releases
    .map((release) => {
      if (!release) throw new Error("GitHub release is missing");
      return release.version ? release : normalizeGitHubRelease(release);
    })
    .sort((a, b) => compareVersions(a.version, b.version));
  const target = normalizeVersion(
    requestedVersion ?? normalized.at(-1)?.version,
    "Target Superpowers version",
  );
  if (compareVersions(target, current) < 0) {
    throw new Error(
      `Target Superpowers version ${target} is older than current version ${current}`,
    );
  }
  const targetRelease = normalized.find(
    (release) => release.version === target,
  );
  if (!targetRelease)
    throw new Error(
      `Requested stable release ${tagForVersion(target)} was not found`,
    );
  if (compareVersions(target, current) === 0) {
    return {
      noUpdate: true,
      currentVersion: current,
      targetVersion: target,
      targetTag: targetRelease.tag,
      releases: [],
    };
  }
  const selected = normalized.filter(
    (release) =>
      compareVersions(release.version, current) > 0 &&
      compareVersions(release.version, target) <= 0,
  );
  for (const release of selected) {
    if (!release.body.trim())
      throw new Error(`${release.tag} has no release-note body`);
  }
  return {
    noUpdate: false,
    currentVersion: current,
    targetVersion: target,
    targetTag: targetRelease.tag,
    releases: selected,
  };
}

function assertEqual(label, actual, expected) {
  if (actual !== expected)
    throw new Error(
      `${label}: expected ${expected}; found ${actual ?? "missing"}`,
    );
}

export function assertLockfilesMatchSuperpowersTarget({
  packageJson,
  packageLock,
  shrinkwrap,
  targetVersion,
}) {
  const expectedSpec = tarballUrlForVersion(targetVersion);
  assertEqual(
    "package.json dependencies.superpowers",
    packageJson.dependencies?.[SUPERPOWERS_PACKAGE],
    expectedSpec,
  );
  for (const [label, lockfile] of [
    ["package-lock.json", packageLock],
    ["npm-shrinkwrap.json", shrinkwrap],
  ]) {
    const rootSpec =
      lockfile.packages?.[""]?.dependencies?.[SUPERPOWERS_PACKAGE];
    const installed =
      lockfile.packages?.[`node_modules/${SUPERPOWERS_PACKAGE}`];
    assertEqual(`${label} root dependency`, rootSpec, expectedSpec);
    assertEqual(
      `${label} installed version`,
      installed?.version,
      normalizeVersion(targetVersion),
    );
    assertEqual(
      `${label} installed resolved`,
      installed?.resolved,
      expectedSpec,
    );
    if (typeof installed?.integrity !== "string" || !installed.integrity) {
      throw new Error(
        `${label} installed integrity: expected a non-empty value; found ${installed?.integrity ?? "missing"}`,
      );
    }
  }
}

function markdownCodeFence(body) {
  const longestBacktickRun = Math.max(
    0,
    ...(body.match(/`+/gu) ?? []).map((run) => run.length),
  );
  return "`".repeat(Math.max(3, longestBacktickRun + 1));
}

export function renderSuperpowersPullRequestBody(summary) {
  const lines = [
    "## Superpowers dependency upgrade",
    "",
    `Updates Superpowers from \`${summary.currentVersion}\` to \`${summary.targetVersion}\`.`,
    "This pull request is review-gated and does not auto-merge or publish.",
    "",
    "## Changed files",
    ...summary.changedFiles.map((path) => `- \`${path}\``),
    "",
    "## Validation",
    ...summary.validationCommands.map((command) => `- \`${command}\``),
    "",
    "## Upstream release notes",
  ];
  for (const release of summary.releases) {
    if (!release.body?.trim())
      throw new Error(`${release.tag} has no release-note body`);
    lines.push(
      "",
      `### ${release.tag}`,
      "",
      `Published: ${release.publishedAt}`,
      "",
      `Release: ${release.htmlUrl}`,
      "",
      markdownCodeFence(release.body),
      release.body,
      markdownCodeFence(release.body),
    );
  }
  const body = `${lines.join("\n")}\n`;
  if (body.length > 65_536)
    throw new Error(
      "Superpowers pull-request body exceeds GitHub's 65,536-character limit",
    );
  return body;
}
