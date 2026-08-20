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

  npmDepsHash = "sha256-brdIN69Bu8cuW4dU3KUmSzppPiNwxF+MbdL5cwjekC8=";
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
    test -f "$out/share/${pname}/fixtures/run-once-installed-extension-load.mjs"
    (
      cd "$out/share/${pname}"
      PATCHMILL_INSTALL_CHECK_DIR="$install_check_dir" \
        ${nodejs_24}/bin/node --input-type=module <<'PATCHMILL_NODE'
import { join } from "node:path";
import { runOncePlanningPiProfile } from "./src/pi/resource-profiles.ts";
import { verifyInstalledRunOnceExtensions } from "./fixtures/run-once-installed-extension-load.mjs";
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
const installCheckDir = process.env.PATCHMILL_INSTALL_CHECK_DIR;
if (!installCheckDir) throw new Error("PATCHMILL_INSTALL_CHECK_DIR is required");
await verifyInstalledRunOnceExtensions({
  packageRoot: process.cwd(),
  profile,
  pi: await import("@earendil-works/pi-coding-agent"),
  piSubagentsRoot,
  piCommand: process.execPath,
  piCommandArgs: ["./node_modules/@earendil-works/pi-coding-agent/dist/cli.js"],
  cwd: process.cwd(),
  agentDir: join(installCheckDir, "pi-agent"),
  sentinelPath: join(installCheckDir, "run-once-extensions-loaded.txt"),
  env: {
    ...process.env,
    HOME: join(installCheckDir, "home"),
    XDG_CONFIG_HOME: join(installCheckDir, "config"),
  },
});
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
