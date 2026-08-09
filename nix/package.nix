{
  lib,
  buildNpmPackage,
  nodejs_24,
  makeWrapper,
  git,
}:

let
  buildNpmPackageNode24 = buildNpmPackage.override { nodejs = nodejs_24; };
in
buildNpmPackageNode24 rec {
  pname = "patchmill";
  version = "0.19.0"; # x-release-please-version

  src = lib.cleanSourceWith {
    src = lib.cleanSource ../.;
    filter = path: type:
      let
        baseName = baseNameOf path;
      in
      !(baseName == ".git"
        || baseName == "node_modules"
        || baseName == ".devenv"
        || baseName == ".patchmill"
        || baseName == "result");
  };

  npmDepsHash = "sha256-YYn2W0uWehVrMldGdJ3otgtDEQ5v9HvClHW45/zkOtE=";
  npmDepsFetcherVersion = 2;

  dontNpmBuild = true;

  nativeBuildInputs = [ makeWrapper git ];

  env = {
    HUSKY = "0";
  };

  doCheck = true;
  checkPhase = ''
    runHook preCheck
    npm test
    runHook postCheck
  '';

  postInstall = ''
    package_dir="$out/lib/node_modules/${pname}"

    mkdir -p "$out/share/${pname}"
    cp -R "$package_dir/bin" "$out/share/${pname}/bin"
    cp -R "$package_dir/src" "$out/share/${pname}/src"
    cp -R "$package_dir/skills" "$out/share/${pname}/skills"
    cp -R "$package_dir/extensions" "$out/share/${pname}/extensions"
    cp -R "$package_dir/fixtures" "$out/share/${pname}/fixtures"
    cp "$package_dir/THIRD_PARTY_NOTICES.md" "$out/share/${pname}/THIRD_PARTY_NOTICES.md"
    cp "$package_dir/package.json" "$out/share/${pname}/package.json"
    ln -s "$package_dir/node_modules" "$out/share/${pname}/node_modules"

    rm -f "$out/bin/patchmill"
    makeWrapper ${nodejs_24}/bin/node "$out/bin/patchmill" \
      --add-flags "$out/share/${pname}/bin/patchmill.ts"
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    $out/bin/patchmill --help >/dev/null
    install_check_dir="$(mktemp -d)"
    mkdir -p "$install_check_dir/home" "$install_check_dir/config" "$install_check_dir/project"
    (
      cd "$install_check_dir/project"
      HOME="$install_check_dir/home" \
        XDG_CONFIG_HOME="$install_check_dir/config" \
        $out/bin/patchmill init >/dev/null
      test -f .patchmill/skills/patchmill-issue-triage/SKILL.md
    )
    test -f "$out/share/${pname}/fixtures/patchmill-test-repo/README.md"
    test -f "$out/share/${pname}/extensions/todos.ts"
    test -f "$out/share/${pname}/src/pi/subagent-progress.ts"
    test -f "$out/share/${pname}/src/pi/extensions/run-once-subagent-progress.ts"
    test -f "$out/share/${pname}/fixtures/run-once-extension-load-sentinel.ts"
    (
      cd "$out/share/${pname}"
      PATCHMILL_INSTALL_CHECK_DIR="$install_check_dir" \
        ${nodejs_24}/bin/node --input-type=module <<'PATCHMILL_NODE'
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { runOncePlanningPiProfile } from "./src/pi/resource-profiles.ts";
import {
  assertInstalledPiSubagentsMatchesRootPin,
  piSubagentsExtensionFiles,
  resolvePiSubagentsPackageRoot,
} from "./src/pi/pi-subagents-package.ts";

assertInstalledPiSubagentsMatchesRootPin("./package.json");
piSubagentsExtensionFiles();
const piSubagentsRoot = resolvePiSubagentsPackageRoot();
const skills = {
  triage: "triage",
  planning: "planning",
  implementation: "implementation",
  developmentEnvironment: "development-environment",
  toolchain: "toolchain",
  review: "review",
  visualEvidence: "visual-evidence",
  landing: "landing",
};
const profile = runOncePlanningPiProfile(skills, process.cwd());
assert.equal(
  realpathSync(profile.additionalExtensionPaths[0]),
  realpathSync(piSubagentsRoot),
);
assert.equal(
  profile.additionalExtensionPaths[1]
    .replaceAll("\\", "/")
    .endsWith("/extensions/todos.ts"),
  true,
);
assert.equal(
  profile.additionalExtensionPaths[2]
    .replaceAll("\\", "/")
    .endsWith("/src/pi/extensions/run-once-subagent-progress.ts"),
  true,
);

const installCheckDir = process.env.PATCHMILL_INSTALL_CHECK_DIR;
assert.ok(installCheckDir);
const agentDir = join(installCheckDir, "pi-agent");
mkdirSync(agentDir, { recursive: true });
const loadedObserver = await discoverAndLoadExtensions(
  [profile.additionalExtensionPaths[2]],
  process.cwd(),
  agentDir,
);
assert.deepEqual(loadedObserver.errors, []);
const observer = loadedObserver.extensions.find((extension) =>
  extension.resolvedPath
    .replaceAll("\\", "/")
    .endsWith("/src/pi/extensions/run-once-subagent-progress.ts"),
);
assert.ok(observer);
for (const eventName of [
  "session_start",
  "tool_execution_update",
  "tool_execution_end",
]) {
  assert.ok((observer.handlers.get(eventName)?.length ?? 0) > 0);
}

const sentinelPath = join(installCheckDir, "run-once-extensions-loaded.txt");
const result = spawnSync(
  process.execPath,
  [
    "./node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
    "--mode",
    "rpc",
    "--no-session",
    "--offline",
    "-ne",
    ...profile.additionalExtensionPaths.flatMap((path) => ["-e", path]),
    "-e",
    "./fixtures/run-once-extension-load-sentinel.ts",
  ],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    input: '{"type":"get_commands"}\n',
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      HOME: join(installCheckDir, "home"),
      XDG_CONFIG_HOME: join(installCheckDir, "config"),
      PATCHMILL_RUN_ONCE_EXTENSION_SENTINEL: sentinelPath,
    },
  },
);
assert.equal(result.error, undefined);
assert.equal(result.status, 0, result.stderr || result.stdout);
assert.doesNotMatch(
  result.stdout + "\n" + result.stderr,
  /Failed to load extension|Cannot find module|ERR_MODULE_NOT_FOUND/iu,
);
assert.equal(
  readFileSync(sentinelPath, "utf8"),
  "patchmill-run-once-extensions-loaded\n",
);
console.log("installed run-once extensions loaded before sentinel");
PATCHMILL_NODE
    )
    runHook postInstallCheck
  '';

  meta = {
    description = "Agent-driven software factory that turns issues into reviewed diffs";
    mainProgram = "patchmill";
    license = lib.licenses.asl20;
    platforms = lib.platforms.unix;
  };
}
