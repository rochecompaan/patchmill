export const PI_SUBAGENTS_PACKAGE = "pi-subagents";

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
  return `## pi-subagents dependency upgrade\n\nUpdates \`${PI_SUBAGENTS_PACKAGE}\` from \`${summary.currentVersion}\` to \`${summary.targetVersion}\`.\n\n## Changed files\n\n${changedFiles}\n\n## Validation\n\n${validation}\n\nThis pull request is review-gated and does not auto-merge or publish.\n`;
}
