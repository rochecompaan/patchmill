export const PI_SUBAGENTS_PACKAGE = "pi-subagents";
export const PI_SUBAGENTS_REPOSITORY = "nicobailon/pi-subagents";

const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

export function normalizePiSubagentsVersion(
  value,
  label = "pi-subagents version",
) {
  if (typeof value !== "string" || !stableVersionPattern.test(value)) {
    throw new Error(`${label} must be a stable X.Y.Z version; found ${value}`);
  }
  return value;
}

export function comparePiSubagentsVersions(a, b) {
  const left = normalizePiSubagentsVersion(a).split(".").map(Number);
  const right = normalizePiSubagentsVersion(b).split(".").map(Number);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function getCurrentPiSubagentsVersion(packageJson) {
  return normalizePiSubagentsVersion(
    packageJson.dependencies?.[PI_SUBAGENTS_PACKAGE],
    "package.json pi-subagents dependency",
  );
}

export async function fetchLatestPiSubagentsVersion(fetchImpl = fetch) {
  const response = await fetchImpl(
    `https://registry.npmjs.org/${PI_SUBAGENTS_PACKAGE}`,
  );
  if (!response.ok) {
    throw new Error(
      `${PI_SUBAGENTS_PACKAGE}: npm registry request failed (${response.status})`,
    );
  }
  return normalizePiSubagentsVersion(
    (await response.json())?.["dist-tags"]?.latest,
    "npm latest pi-subagents version",
  );
}

function versionFromReleaseTag(tagName) {
  if (typeof tagName !== "string") return undefined;
  const match = tagName.match(
    /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/u,
  );
  return match?.[1];
}

export async function fetchPiSubagentsReleaseNotes({
  currentVersion,
  targetVersion,
  fetchImpl = fetch,
  token,
}) {
  const current = normalizePiSubagentsVersion(
    currentVersion,
    "Current pi-subagents version",
  );
  const target = normalizePiSubagentsVersion(
    targetVersion,
    "Target pi-subagents version",
  );
  const releaseNotes = new Map();

  for (let page = 1; ; page += 1) {
    const headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": "patchmill-pi-subagents-upgrade",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetchImpl(
      `https://api.github.com/repos/${PI_SUBAGENTS_REPOSITORY}/releases?per_page=100&page=${page}`,
      { headers },
    );
    if (!response.ok) {
      throw new Error(
        `${PI_SUBAGENTS_PACKAGE}: GitHub releases request failed (${response.status})`,
      );
    }
    const releases = await response.json();
    if (!Array.isArray(releases)) {
      throw new Error(
        `${PI_SUBAGENTS_PACKAGE}: GitHub releases response must be an array`,
      );
    }

    for (const release of releases) {
      const version = versionFromReleaseTag(release?.tag_name);
      if (
        !version ||
        release.draft ||
        release.prerelease ||
        comparePiSubagentsVersions(version, current) <= 0 ||
        comparePiSubagentsVersions(version, target) > 0
      ) {
        continue;
      }
      releaseNotes.set(version, {
        version,
        url:
          release.html_url ??
          `https://github.com/${PI_SUBAGENTS_REPOSITORY}/releases/tag/v${version}`,
        body: release.body?.trim() || "_No release notes were provided._",
      });
    }

    if (releases.length < 100) break;
  }

  if (!releaseNotes.has(target)) {
    throw new Error(
      `${PI_SUBAGENTS_PACKAGE}: no GitHub release notes found for v${target}`,
    );
  }
  return [...releaseNotes.values()].sort((left, right) =>
    comparePiSubagentsVersions(left.version, right.version),
  );
}

export function resolvePiSubagentsUpgrade({
  currentVersion,
  latestVersion,
  requestedVersion,
}) {
  const current = normalizePiSubagentsVersion(
    currentVersion,
    "Current pi-subagents version",
  );
  const target = normalizePiSubagentsVersion(
    requestedVersion ?? latestVersion,
    "Target pi-subagents version",
  );
  if (comparePiSubagentsVersions(target, current) < 0) {
    throw new Error(
      `Target pi-subagents version ${target} is older than current version ${current}`,
    );
  }
  return {
    noUpdate: comparePiSubagentsVersions(target, current) === 0,
    currentVersion: current,
    targetVersion: target,
  };
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${expected}; found ${actual ?? "missing"}`,
    );
  }
}

export function assertLockfilesMatchPiSubagentsTarget({
  packageJson,
  packageLock,
  shrinkwrap,
  targetVersion,
}) {
  const target = normalizePiSubagentsVersion(targetVersion, "Target version");
  assertEqual(
    "package.json dependencies.pi-subagents",
    packageJson.dependencies?.[PI_SUBAGENTS_PACKAGE],
    target,
  );
  for (const [label, lockfile] of [
    ["package-lock.json", packageLock],
    ["npm-shrinkwrap.json", shrinkwrap],
  ]) {
    assertEqual(
      `${label} root dependency`,
      lockfile.packages?.[""]?.dependencies?.[PI_SUBAGENTS_PACKAGE],
      target,
    );
    assertEqual(
      `${label} installed version`,
      lockfile.packages?.[`node_modules/${PI_SUBAGENTS_PACKAGE}`]?.version,
      target,
    );
  }
}

export function renderPiSubagentsPullRequestBody(summary) {
  const changedFiles = summary.changedFiles?.length
    ? summary.changedFiles.map((path) => `- \`${path}\``).join("\n")
    : "- No metadata changes";
  const validation = (summary.validationCommands ?? [])
    .map((command) => `- \`${command}\``)
    .join("\n");
  const releaseNotes = (summary.releaseNotes ?? [])
    .map(
      (release) =>
        `<details>\n<summary><a href="${release.url}">v${release.version}</a></summary>\n\n${release.body}\n\n</details>`,
    )
    .join("\n\n");
  const body = `## pi-subagents dependency upgrade\n\nUpdates \`${PI_SUBAGENTS_PACKAGE}\` from \`${summary.currentVersion}\` to \`${summary.targetVersion}\`.\n\n## Release notes\n\n${releaseNotes}\n\n## Changed files\n\n${changedFiles}\n\n## Validation\n\n${validation}\n\nThis pull request is review-gated and does not auto-merge or publish.\n`;
  if (body.length > 65_536) {
    throw new Error(
      "pi-subagents pull-request body exceeds GitHub's 65,536-character limit",
    );
  }
  return body;
}
