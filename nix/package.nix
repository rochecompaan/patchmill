{
  lib,
  buildNpmPackage,
  nodejs_24,
  makeWrapper,
}:

let
  buildNpmPackageNode24 = buildNpmPackage.override { nodejs = nodejs_24; };
in
buildNpmPackageNode24 rec {
  pname = "patchmill";
  version = "0.18.0"; # x-release-please-version

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

  npmDepsHash = "sha256-4e8QkXmodtvAOXUqCK8JMmc7XlzEjBJrGN1ITbME9b8=";
  npmDepsFetcherVersion = 2;

  dontNpmBuild = true;

  nativeBuildInputs = [ makeWrapper ];

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
    (
      cd "$out/share/${pname}"
      ${nodejs_24}/bin/node --input-type=module -e "
        import { realpathSync } from 'node:fs';
        import assert from 'node:assert/strict';
        import { runOncePlanningPiProfile } from './src/pi/resource-profiles.ts';
        import {
          assertInstalledPiSubagentsMatchesRootPin,
          piSubagentsExtensionFiles,
          resolvePiSubagentsPackageRoot,
        } from './src/pi/pi-subagents-package.ts';
        assertInstalledPiSubagentsMatchesRootPin('./package.json');
        piSubagentsExtensionFiles();
        const piSubagentsRoot = resolvePiSubagentsPackageRoot();
        const skills = {
          triage: 'triage', planning: 'planning', implementation: 'implementation',
          developmentEnvironment: 'development-environment', toolchain: 'toolchain',
          review: 'review', visualEvidence: 'visual-evidence', landing: 'landing',
        };
        const profile = runOncePlanningPiProfile(skills, process.cwd());
        assert.equal(
          realpathSync(profile.additionalExtensionPaths[0]),
          realpathSync(piSubagentsRoot),
        );
        assert.equal(
          profile.additionalExtensionPaths[1].replaceAll('\\\\', '/').endsWith('/extensions/todos.ts'),
          true,
        );
        console.log('installed pi-subagents manifest and extension order verified');
      "
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
