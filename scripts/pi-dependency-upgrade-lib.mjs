import { readFile, writeFile } from "node:fs/promises";

export const PI_PACKAGES = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
];

export function isExactVersion(spec) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(spec);
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function getRootPins(packageJson) {
  const dependencies = packageJson.dependencies ?? {};
  return Object.fromEntries(
    PI_PACKAGES.map((name) => {
      const spec = dependencies[name];
      if (!isExactVersion(spec ?? "")) {
        throw new Error(
          `${name} must be an exact version; found ${spec ?? "missing"}`,
        );
      }
      return [name, spec];
    }),
  );
}

export async function fetchLatestVersion(packageName, fetchImpl = fetch) {
  const encodedName = encodeURIComponent(packageName).replace("%40", "@");
  const response = await fetchImpl(`https://registry.npmjs.org/${encodedName}`);
  if (!response.ok) {
    throw new Error(
      `${packageName}: npm registry request failed (${response.status})`,
    );
  }

  const latest = (await response.json())?.["dist-tags"]?.latest;
  if (!latest) {
    throw new Error(`${packageName}: npm latest dist-tag not found`);
  }
  return latest;
}

export function compareVersions(a, b) {
  const parse = (version) => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
    if (!match) throw new Error(`Invalid version: ${version}`);
    return match.slice(1).map(Number);
  };
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function resolveUpgradeTarget({
  mode,
  currentPins,
  latestVersions,
  manualVersions,
}) {
  if (mode === "scheduled") {
    const [codingAgent, tui] = PI_PACKAGES.map(
      (name) => latestVersions?.[name],
    );
    if (codingAgent !== tui) {
      throw new Error(
        `Scheduled Pi upgrade requires matching latest versions: ${PI_PACKAGES[0]}=${codingAgent}, ${PI_PACKAGES[1]}=${tui}`,
      );
    }
    const noUpdate = !PI_PACKAGES.every(
      (name) => compareVersions(codingAgent, currentPins[name]) > 0,
    );
    return {
      noUpdate,
      targets: noUpdate
        ? currentPins
        : Object.fromEntries(PI_PACKAGES.map((name) => [name, codingAgent])),
      warnings: [],
    };
  }

  if (mode !== "manual") throw new Error(`Unsupported upgrade mode: ${mode}`);
  const targets = Object.fromEntries(
    PI_PACKAGES.map((name) => {
      const version = manualVersions?.[name];
      if (!isExactVersion(version ?? "")) {
        throw new Error(
          `${name} manual version must be an exact version; found ${version ?? "missing"}`,
        );
      }
      return [name, version];
    }),
  );
  const warnings =
    targets[PI_PACKAGES[0]] === targets[PI_PACKAGES[1]]
      ? []
      : [
          `Pi package versions differ: ${PI_PACKAGES[0]}=${targets[PI_PACKAGES[0]]}, ${PI_PACKAGES[1]}=${targets[PI_PACKAGES[1]]}`,
        ];
  return { noUpdate: false, targets, warnings };
}

function assertLockfileMatchesTargets(lockfile, label, targets) {
  const rootDependencies = lockfile.packages?.[""]?.dependencies ?? {};
  for (const name of PI_PACKAGES) {
    const expected = targets[name];
    const rootActual = rootDependencies[name];
    if (rootActual !== expected) {
      throw new Error(
        `${label}: ${name} expected ${expected}, root dependency is ${rootActual ?? "missing"}`,
      );
    }
    const resolvedActual = lockfile.packages?.[`node_modules/${name}`]?.version;
    if (resolvedActual !== expected) {
      throw new Error(
        `${label}: ${name} expected ${expected}, resolved version is ${resolvedActual ?? "missing"}`,
      );
    }
  }
}

export function assertLockfilesMatchTargets({
  packageJson,
  packageLock,
  shrinkwrap,
  targets,
}) {
  const pins = getRootPins(packageJson);
  for (const name of PI_PACKAGES) {
    if (pins[name] !== targets[name]) {
      throw new Error(
        `package.json: ${name} expected ${targets[name]}, dependency is ${pins[name]}`,
      );
    }
  }
  assertLockfileMatchesTargets(packageLock, "package-lock.json", targets);
  assertLockfileMatchesTargets(shrinkwrap, "npm-shrinkwrap.json", targets);
}

export function renderPullRequestBody(summary) {
  const versions = PI_PACKAGES.map(
    (name) => `- \`${name}\`: \`${summary.targets[name]}\``,
  ).join("\n");
  const warnings = summary.warnings?.length
    ? `\n## Warnings\n\n${summary.warnings.map((warning) => `- ${warning}`).join("\n")}\n`
    : "";
  const changedFiles =
    (summary.changedFiles ?? []).map((file) => `- \`${file}\``).join("\n") ||
    "- No metadata changes";
  const validation = (summary.validationCommands ?? [])
    .map((command) => `- \`${command}\``)
    .join("\n");
  return `## Pi runtime dependency upgrade\n\n### Target versions\n\n${versions}${warnings}\n## Changed files\n\n${changedFiles}\n\n## Validation\n\n${validation}\n\nThis PR is review-gated and does not auto-merge or publish.\n`;
}
